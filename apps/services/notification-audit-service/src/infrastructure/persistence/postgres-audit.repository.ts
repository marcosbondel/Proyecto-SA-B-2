import type { Pool, PoolClient } from 'pg';

import { redactPayload } from '../../domain/redaction';
import type { AuditEvent, AuditProcessingStatus } from '../../domain/audit-event';
import type {
  Notification,
  NotificationIntent,
  NotificationStatus,
} from '../../domain/notification';
import type { RecordOutcome } from '../../domain/deduplication';
import type {
  AuditRepository,
  InboundRecord,
  NotificationFilter,
  NotificationPage,
} from '../../application/ports';

/**
 * This service's own database, and the place where "a duplicate produces
 * nothing twice" stops being a claim and becomes a mechanism.
 *
 * The whole of criterion 2 is one line of SQL: `ON CONFLICT DO NOTHING` on the
 * primary key `(event_id, consumer)`. Everything else follows from where that
 * line sits — **first**, inside the transaction, before the notification is
 * written and before anything is sent. A check-then-insert in the use case
 * would be correct on one replica and wrong on two, because two consumers
 * draining the same queue can both find nothing.
 *
 * The redaction happens here, on the way in, and never on the way out. Storing
 * the raw payload and hiding it at read time would mean the unredacted copy
 * exists on disk — and the copy on disk is the one that ends up in a backup.
 */
export class PostgresAuditRepository implements AuditRepository {
  readonly #pool: Pool;

  constructor(pool: Pool) {
    this.#pool = pool;
  }

  public async record(input: {
    readonly event: InboundRecord;
    readonly notification: {
      readonly notificationId: string;
      readonly intent: NotificationIntent;
      readonly recipient: string | null;
    } | null;
    readonly now: Date;
  }): Promise<RecordOutcome & { readonly notificationId?: string }> {
    const { event, notification, now } = input;

    return await this.#inTransaction(async (client) => {
      /*
       * The consumption log is written whatever happens, and it is written
       * first. It is the only place a *refused* redelivery leaves a trace: the
       * trail is append-only, so a duplicate correctly rejected is invisible
       * there, and "the retry ladder is climbing" would look exactly like
       * "nothing is arriving".
       */
      await client.query(
        `INSERT INTO processed_messages
           (message_id, consumer, message_type, outcome, deliveries, first_seen_at, last_seen_at)
         VALUES ($1, $2, $3, $4, 1, $5, $5)
         ON CONFLICT (message_id, consumer) DO UPDATE
           SET deliveries = processed_messages.deliveries + 1,
               last_seen_at = EXCLUDED.last_seen_at`,
        [event.eventId, event.consumer, event.messageType, event.processingStatus, now],
      );

      const inserted = await client.query(
        `INSERT INTO audit_events
           (event_id, message_type, message_version, producer, occurred_at, received_at,
            correlation_id, causation_id, payload, processing_status, consumer)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::JSONB, $10, $11)
         ON CONFLICT (event_id, consumer) DO NOTHING`,
        [
          event.eventId,
          event.messageType,
          event.messageVersion,
          event.producer,
          event.occurredAt,
          now,
          event.correlationId,
          event.causationId,
          JSON.stringify(redactPayload(event.payload)),
          event.processingStatus,
          event.consumer,
        ],
      );

      // The redelivery lost the insert. Nothing else in this transaction runs.
      if (inserted.rowCount === 0) {
        return { kind: 'DUPLICATE' };
      }

      if (notification !== null) {
        /*
         * `DO NOTHING` here too, against the partial unique index on
         * (caused_by, type). Redundant while the insert above is the gate, and
         * kept because the guarantee should survive a future handler that
         * forgets why the order matters.
         */
        await client.query(
          `INSERT INTO notifications
             (notification_id, type, channel, recipient, reference_id, subject,
              status, correlation_id, caused_by, created_at, processed_at)
           VALUES ($1, $2, 'EMAIL', $3, $4, $5, 'PENDING', $6, $7, $8, NULL)
           ON CONFLICT DO NOTHING`,
          [
            notification.notificationId,
            notification.intent.type,
            notification.recipient,
            notification.intent.referenceId,
            notification.intent.subject,
            event.correlationId,
            event.eventId,
            now,
          ],
        );
      }

      return {
        kind: 'RECORDED',
        notified: notification !== null,
        ...(notification === null ? {} : { notificationId: notification.notificationId }),
      };
    });
  }

  /** The only `UPDATE` in this service, and it touches no trail row. */
  public async settleNotification(input: {
    readonly notificationId: string;
    readonly status: Extract<NotificationStatus, 'SENT' | 'FAILED'>;
    readonly processedAt: Date;
  }): Promise<void> {
    await this.#pool.query(
      `UPDATE notifications
          SET status = $2, processed_at = $3
        WHERE notification_id = $1 AND status = 'PENDING'`,
      [input.notificationId, input.status, input.processedAt],
    );
  }

  public async trailFor(correlationId: string): Promise<readonly AuditEvent[]> {
    const result = await this.#pool.query<AuditRow>(
      `SELECT event_id, message_type, message_version, producer, occurred_at, received_at,
              correlation_id, causation_id, payload, processing_status, consumer
         FROM audit_events
        WHERE correlation_id = $1
        ORDER BY occurred_at, event_id`,
      [correlationId],
    );

    return result.rows.map(auditEventFrom);
  }

  public async notificationsFor(correlationId: string): Promise<readonly Notification[]> {
    const result = await this.#pool.query<NotificationRow>(
      `SELECT ${NOTIFICATION_COLUMNS}
         FROM notifications
        WHERE correlation_id = $1
        ORDER BY created_at, notification_id`,
      [correlationId],
    );

    return result.rows.map(notificationFrom);
  }

  /**
   * The listing, plus how many rows it left behind.
   *
   * Two statements rather than a window function, because the count is over the
   * filter and the page is over the filter *and* the limit, and expressing both
   * in one query makes the limit apply to the count as well — which would have
   * the console cheerfully report that nothing was omitted.
   */
  public async listNotifications(filter: NotificationFilter): Promise<NotificationPage> {
    const conditions: string[] = [];
    const parameters: unknown[] = [];

    if (filter.correlationId !== undefined) {
      parameters.push(filter.correlationId);
      conditions.push(`correlation_id = $${String(parameters.length)}`);
    }

    if (filter.status !== undefined) {
      parameters.push(filter.status);
      conditions.push(`status = $${String(parameters.length)}`);
    }

    if (filter.type !== undefined) {
      parameters.push(filter.type);
      conditions.push(`type = $${String(parameters.length)}`);
    }

    const where = conditions.length === 0 ? '' : `WHERE ${conditions.join(' AND ')}`;
    const limit = filter.limit ?? 50;

    const total = await this.#pool.query<{ count: string }>(
      `SELECT count(*)::TEXT AS count FROM notifications ${where}`,
      parameters,
    );

    const page = await this.#pool.query<NotificationRow>(
      `SELECT ${NOTIFICATION_COLUMNS}
         FROM notifications ${where}
        ORDER BY created_at DESC, notification_id
        LIMIT $${String(parameters.length + 1)}`,
      [...parameters, limit],
    );

    const matched = Number.parseInt(total.rows[0]?.count ?? '0', 10);

    return {
      notifications: page.rows.map(notificationFrom),
      omitted: Math.max(0, matched - page.rows.length),
    };
  }

  public async isReachable(): Promise<boolean> {
    try {
      await this.#pool.query('SELECT 1');

      return true;
    } catch {
      return false;
    }
  }

  async #inTransaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.#pool.connect();

    try {
      await client.query('BEGIN');
      const result = await work(client);
      await client.query('COMMIT');

      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}

const NOTIFICATION_COLUMNS = `notification_id, type, channel, recipient, reference_id,
                              subject, status, correlation_id, created_at, processed_at`;

interface AuditRow {
  readonly event_id: string;
  readonly message_type: string;
  readonly message_version: number;
  readonly producer: string;
  readonly occurred_at: Date;
  readonly received_at: Date;
  readonly correlation_id: string;
  readonly causation_id: string | null;
  readonly payload: Record<string, unknown>;
  readonly processing_status: AuditProcessingStatus;
  readonly consumer: string;
}

interface NotificationRow {
  readonly notification_id: string;
  readonly type: string;
  readonly channel: 'EMAIL';
  readonly recipient: string | null;
  readonly reference_id: string | null;
  readonly subject: string;
  readonly status: NotificationStatus;
  readonly correlation_id: string;
  readonly created_at: Date;
  readonly processed_at: Date | null;
}

function auditEventFrom(row: AuditRow): AuditEvent {
  return {
    eventId: row.event_id,
    messageType: row.message_type,
    messageVersion: row.message_version,
    producer: row.producer,
    occurredAt: row.occurred_at,
    receivedAt: row.received_at,
    correlationId: row.correlation_id,
    causationId: row.causation_id,
    payload: row.payload,
    processingStatus: row.processing_status,
    consumer: row.consumer,
  };
}

function notificationFrom(row: NotificationRow): Notification {
  return {
    notificationId: row.notification_id,
    type: row.type,
    channel: row.channel,
    recipient: row.recipient,
    referenceId: row.reference_id,
    subject: row.subject,
    status: row.status,
    correlationId: row.correlation_id,
    createdAt: row.created_at,
    processedAt: row.processed_at,
  };
}
