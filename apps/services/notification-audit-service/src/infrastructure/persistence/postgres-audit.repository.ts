import type { Pool, PoolClient } from 'pg';

import { redactPayload } from '../../domain/redaction';
import type { AuditEvent, AuditProcessingStatus } from '../../domain/audit-event';
import type { EventSeverity } from '../../domain/classification';
import type {
  Notification,
  NotificationIntent,
  NotificationStatus,
} from '../../domain/notification';
import type { RecordOutcome } from '../../domain/deduplication';
import type { InboxNotification } from '../../application/ports';
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
      /** Whose inbox this belongs in — the subject, not the address. */
      readonly customerId: string | null;
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
            correlation_id, causation_id, payload, processing_status, consumer, severity)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::JSONB, $10, $11, $12)
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
          event.severity,
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
              status, correlation_id, caused_by, created_at, processed_at, customer_id, severity)
           VALUES ($1, $2, 'EMAIL', $3, $4, $5, 'PENDING', $6, $7, $8, NULL, $9, $10)
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
            notification.customerId,
            notification.intent.severity,
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
  public async inboxOf(input: {
    readonly customerId: string;
    readonly limit: number;
  }): Promise<{ readonly notifications: readonly InboxNotification[]; readonly unread: number }> {
    const [rows, unread] = await Promise.all([
      this.#pool.query<InboxRow>(
        `SELECT notification_id, type, subject, reference_id, correlation_id, created_at, read_at, severity
           FROM notifications
          WHERE customer_id = $1
          ORDER BY created_at DESC, notification_id
          LIMIT $2`,
        [input.customerId, input.limit],
      ),
      this.#unreadCount(input.customerId),
    ]);

    return {
      notifications: rows.rows.map((row) => ({
        notificationId: row.notification_id,
        type: row.type,
        subject: row.subject,
        referenceId: row.reference_id,
        correlationId: row.correlation_id,
        createdAt: row.created_at.toISOString(),
        readAt: row.read_at?.toISOString() ?? null,
        severity: row.severity,
      })),
      unread,
    };
  }

  public async unreadCountOf(customerId: string): Promise<number> {
    return await this.#unreadCount(customerId);
  }

  public async markRead(input: {
    readonly customerId: string;
    readonly notificationIds: readonly string[] | null;
    readonly now: Date;
  }): Promise<number> {
    /*
     * `customer_id = $1` is in the WHERE clause rather than checked beforehand.
     * An id belonging to somebody else matches no row, so the request is a
     * no-op instead of a refusal that would confirm the id exists — and there
     * is no window between a check and a write for the two to disagree.
     *
     * `read_at IS NULL` keeps the first read's timestamp: marking an already
     * read notification read again is not a second reading.
     */
    const updated =
      input.notificationIds === null
        ? await this.#pool.query(
            `UPDATE notifications SET read_at = $2
              WHERE customer_id = $1 AND read_at IS NULL`,
            [input.customerId, input.now],
          )
        : await this.#pool.query(
            `UPDATE notifications SET read_at = $2
              WHERE customer_id = $1 AND read_at IS NULL
                AND notification_id = ANY($3::uuid[])`,
            [input.customerId, input.now, [...input.notificationIds]],
          );

    return updated.rowCount ?? 0;
  }

  async #unreadCount(customerId: string): Promise<number> {
    const counted = await this.#pool.query<{ total: string }>(
      `SELECT COUNT(*)::TEXT AS total FROM notifications
        WHERE customer_id = $1 AND read_at IS NULL`,
      [customerId],
    );

    return Number(counted.rows[0]?.total ?? '0');
  }

  public async stats(): Promise<{
    readonly eventsToday: number;
    readonly invalidToday: number;
    readonly notificationsToday: number;
    readonly lastEventType: string | null;
    readonly lastEventAt: string | null;
    readonly infoToday: number;
    readonly warningToday: number;
    readonly errorToday: number;
  }> {
    /**
     * "Today" means Guatemala's calendar day, not the container's.
     *
     * A bare `::date` cast resolves against the session's timezone, which is
     * UTC here. Between 18:00 and midnight local time (UTC-6, no DST) that is
     * already tomorrow in Guatemala, so this would count the wrong day's
     * events — informational only, but exactly the number a demo run in the
     * evening would show as zero for no reason anyone could see. `AT TIME
     * ZONE` converts to Guatemala's wall clock before the date is taken, on
     * both sides, so the answer stops depending on the container's clock —
     * see also `account-service`'s `postgres-account.repository.ts#stats`.
     */
    const [events, notifications, last] = await Promise.all([
      this.#pool.query<{
        events_today: string;
        invalid_today: string;
        info_today: string;
        warning_today: string;
        error_today: string;
      }>(
        `SELECT COUNT(*) FILTER (
                  WHERE (occurred_at AT TIME ZONE 'America/Guatemala')::date
                      = (now() AT TIME ZONE 'America/Guatemala')::date
                )::TEXT AS events_today,
                COUNT(*) FILTER (
                  WHERE (occurred_at AT TIME ZONE 'America/Guatemala')::date
                      = (now() AT TIME ZONE 'America/Guatemala')::date
                    AND processing_status = 'INVALID'
                )::TEXT AS invalid_today,
                COUNT(*) FILTER (
                  WHERE (occurred_at AT TIME ZONE 'America/Guatemala')::date
                      = (now() AT TIME ZONE 'America/Guatemala')::date
                    AND severity = 'INFO'
                )::TEXT AS info_today,
                COUNT(*) FILTER (
                  WHERE (occurred_at AT TIME ZONE 'America/Guatemala')::date
                      = (now() AT TIME ZONE 'America/Guatemala')::date
                    AND severity = 'WARNING'
                )::TEXT AS warning_today,
                COUNT(*) FILTER (
                  WHERE (occurred_at AT TIME ZONE 'America/Guatemala')::date
                      = (now() AT TIME ZONE 'America/Guatemala')::date
                    AND severity = 'ERROR'
                )::TEXT AS error_today
           FROM audit_events`,
      ),
      this.#pool.query<{ total: string }>(
        `SELECT COUNT(*)::TEXT AS total FROM notifications
          WHERE (created_at AT TIME ZONE 'America/Guatemala')::date
              = (now() AT TIME ZONE 'America/Guatemala')::date`,
      ),
      /* A message name and a timestamp. Never a payload: this says the system
         is alive and what it was last doing, and carries nothing about anyone. */
      this.#pool.query<{ message_type: string; occurred_at: Date }>(
        `SELECT message_type, occurred_at FROM audit_events
          ORDER BY occurred_at DESC, event_id LIMIT 1`,
      ),
    ]);

    const row = events.rows[0];
    const newest = last.rows[0];

    return {
      eventsToday: Number(row?.events_today ?? '0'),
      invalidToday: Number(row?.invalid_today ?? '0'),
      notificationsToday: Number(notifications.rows[0]?.total ?? '0'),
      lastEventType: newest?.message_type ?? null,
      lastEventAt: newest?.occurred_at.toISOString() ?? null,
      infoToday: Number(row?.info_today ?? '0'),
      warningToday: Number(row?.warning_today ?? '0'),
      errorToday: Number(row?.error_today ?? '0'),
    };
  }

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
              correlation_id, causation_id, payload, processing_status, consumer, severity
         FROM audit_events
        WHERE correlation_id = $1
        ORDER BY occurred_at, event_id`,
      [correlationId],
    );

    return result.rows.map(auditEventFrom);
  }

  public async listRecentEvents(input: {
    readonly limit: number;
    readonly offset: number;
    readonly severity?: string;
  }): Promise<{ readonly events: readonly AuditEvent[]; readonly total: number }> {
    const where = input.severity === undefined ? '' : 'WHERE severity = $3';
    const parameters =
      input.severity === undefined
        ? [input.limit, input.offset]
        : [input.limit, input.offset, input.severity];

    const [eventsResult, countResult] = await Promise.all([
      this.#pool.query<AuditRow>(
        `SELECT event_id, message_type, message_version, producer, occurred_at, received_at,
                correlation_id, causation_id, payload, processing_status, consumer, severity
           FROM audit_events
           ${where}
          ORDER BY occurred_at DESC, event_id DESC
          LIMIT $1 OFFSET $2`,
        parameters,
      ),
      input.severity === undefined
        ? this.#pool.query<{ total: string }>(`SELECT COUNT(*)::TEXT AS total FROM audit_events`)
        : this.#pool.query<{ total: string }>(
            `SELECT COUNT(*)::TEXT AS total FROM audit_events WHERE severity = $1`,
            [input.severity],
          ),
    ]);

    return {
      events: eventsResult.rows.map(auditEventFrom),
      total: Number(countResult.rows[0]?.total ?? '0'),
    };
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

    if (filter.severity !== undefined) {
      parameters.push(filter.severity);
      conditions.push(`severity = $${String(parameters.length)}`);
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
                              subject, status, correlation_id, created_at, processed_at, severity`;

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
  readonly severity: EventSeverity | null;
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
  readonly severity: EventSeverity | null;
  /** Optional in the row type: the console's projection does not select them. */
  readonly customer_id?: string | null;
  readonly read_at?: Date | null;
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
    severity: row.severity,
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
    customerId: row.customer_id ?? null,
    readAt: row.read_at ?? null,
    severity: row.severity,
  };
}

/** One row of a customer's inbox, as the projection returns it. */
interface InboxRow {
  notification_id: string;
  type: string;
  subject: string;
  reference_id: string | null;
  correlation_id: string;
  created_at: Date;
  read_at: Date | null;
  severity: EventSeverity | null;
}

