import { randomUUID } from 'node:crypto';

import { Pool } from 'pg';

import { migrate } from '../src/infrastructure/persistence/migrations';
import { PostgresAuditRepository } from '../src/infrastructure/persistence/postgres-audit.repository';
import type { InboundRecord } from '../src/application/ports';

/**
 * The repository against a real PostgreSQL, because the guarantee that matters
 * here is enforced by the database and by nothing else.
 *
 * An in-memory double can be made to *look* like it refuses a duplicate; only a
 * primary key actually does it when two replicas drain the same queue and both
 * find nothing. Criterion 2 is that key, and this is the only test that touches
 * it.
 *
 * Requires the local stack (`infra/docker`) and `DATABASE_URL`. Skipped
 * otherwise, so a clone with no Docker still runs a green suite — and says
 * which tests it did not run.
 */

const DATABASE_URL = process.env.DATABASE_URL;
const describeIntegration = DATABASE_URL === undefined ? describe.skip : describe;

jest.setTimeout(30_000);

describeIntegration('PostgresAuditRepository', () => {
  let pool: Pool;
  let repository: PostgresAuditRepository;

  const NOW = new Date('2026-08-27T15:00:00.000Z');
  const CORRELATION = '7d41e8b2-9a3f-4c15-8ee0-1b2f9a4c7d10';

  beforeAll(async () => {
    if (DATABASE_URL === undefined) {
      console.warn('Skipping repository integration tests: DATABASE_URL is not set.');

      return;
    }

    pool = new Pool({ connectionString: DATABASE_URL });
    await migrate(pool);
    repository = new PostgresAuditRepository(pool);
  });

  afterAll(async () => {
    await pool?.end();
  });

  beforeEach(async () => {
    await pool.query('TRUNCATE audit_events, notifications, processed_messages');
  });

  const arriving = (overrides: Partial<InboundRecord> = {}): InboundRecord => ({
    eventId: randomUUID(),
    messageType: 'transaction.completed.v1',
    messageVersion: 1,
    producer: 'transaction-service',
    occurredAt: NOW,
    correlationId: CORRELATION,
    causationId: null,
    payload: { transactionId: randomUUID(), amount: { amountMinor: 125_000, currency: 'GTQ' } },
    processingStatus: 'PROCESSED',
    consumer: 'audit.transaction',
    severity: 'INFO',
    ...overrides,
  });

  const notifying = () => ({
    notificationId: randomUUID(),
    intent: {
      type: 'transfer.completed',
      subject: 'Tu transferencia se completó',
      referenceId: null,
      severity: 'INFO' as const,
    },
    recipient: 'cliente-3f2a1c04@simulado.bonking.gt',
    customerId: '3f2a1c04-9c2e-4a71-b8f5-2d6e7c0a1b93',
  });

  it('records an event and its notification in one transaction', async () => {
    const outcome = await repository.record({
      event: arriving(),
      notification: notifying(),
      now: NOW,
    });

    expect(outcome.kind).toBe('RECORDED');
    expect(await repository.trailFor(CORRELATION)).toHaveLength(1);
    expect(await repository.notificationsFor(CORRELATION)).toHaveLength(1);
  });

  /** Criterion 2, against the constraint that actually enforces it. */
  it('refuses the second delivery of the same message on the same consumer', async () => {
    const event = arriving();

    const first = await repository.record({ event, notification: notifying(), now: NOW });
    const second = await repository.record({ event, notification: notifying(), now: NOW });

    expect(first.kind).toBe('RECORDED');
    expect(second.kind).toBe('DUPLICATE');
    expect(await repository.trailFor(CORRELATION)).toHaveLength(1);
    expect(await repository.notificationsFor(CORRELATION)).toHaveLength(1);
  });

  /**
   * The case an in-memory double cannot reproduce: both callers read nothing
   * and both insert. Exactly one wins, and that is a fact about the database
   * rather than a hope about timing.
   */
  it('lets exactly one of two concurrent deliveries win', async () => {
    const event = arriving();

    const outcomes = await Promise.all([
      repository.record({ event, notification: notifying(), now: NOW }),
      repository.record({ event, notification: notifying(), now: NOW }),
    ]);

    expect(outcomes.filter((outcome) => outcome.kind === 'RECORDED')).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome.kind === 'DUPLICATE')).toHaveLength(1);
    expect(await repository.notificationsFor(CORRELATION)).toHaveLength(1);
  });

  it('counts every delivery, including the ones it refused', async () => {
    const event = arriving();

    await repository.record({ event, notification: null, now: NOW });
    await repository.record({ event, notification: null, now: NOW });
    await repository.record({ event, notification: null, now: NOW });

    const seen = await pool.query<{ deliveries: number }>(
      'SELECT deliveries FROM processed_messages WHERE message_id = $1',
      [event.eventId],
    );

    expect(seen.rows[0]?.deliveries).toBe(3);
  });

  /** The privacy rule, verified where it cannot be undone: on disk. */
  it('stores no unredacted payload', async () => {
    await repository.record({ event: arriving(), notification: null, now: NOW });

    const stored = await pool.query<{ payload: Record<string, unknown> }>(
      'SELECT payload FROM audit_events',
    );

    expect(stored.rows[0]?.payload.amount).toBe('[redactado]');
  });

  it('keeps the trail append-only for a message that could not be read', async () => {
    await repository.record({
      event: arriving({ processingStatus: 'INVALID', payload: { nonsense: true } }),
      notification: null,
      now: NOW,
    });

    const trail = await repository.trailFor(CORRELATION);

    expect(trail[0]?.processingStatus).toBe('INVALID');
  });

  it('settles a notification exactly once, and never back to pending', async () => {
    const notification = notifying();
    await repository.record({ event: arriving(), notification, now: NOW });

    await repository.settleNotification({
      notificationId: notification.notificationId,
      status: 'SENT',
      processedAt: NOW,
    });
    await repository.settleNotification({
      notificationId: notification.notificationId,
      status: 'FAILED',
      processedAt: NOW,
    });

    const [settled] = await repository.notificationsFor(CORRELATION);

    expect(settled?.status).toBe('SENT');
  });

  it('lists newest first and says how many rows it left out', async () => {
    for (let index = 0; index < 4; index += 1) {
      await repository.record({
        event: arriving({ occurredAt: new Date(NOW.getTime() + index * 1_000) }),
        notification: notifying(),
        now: new Date(NOW.getTime() + index * 1_000),
      });
    }

    const page = await repository.listNotifications({ limit: 2 });

    expect(page.notifications).toHaveLength(2);
    expect(page.omitted).toBe(2);
    expect(page.notifications[0]!.createdAt.getTime()).toBeGreaterThan(
      page.notifications[1]!.createdAt.getTime(),
    );
  });

  describe('§4.1 classification, persisted', () => {
    it('persists the severity computed for the event and its notification', async () => {
      await repository.record({
        event: arriving({ severity: 'ERROR' }),
        notification: { ...notifying(), intent: { ...notifying().intent, severity: 'ERROR' } },
        now: NOW,
      });

      const [event] = await repository.trailFor(CORRELATION);
      const [notification] = await repository.notificationsFor(CORRELATION);

      expect(event?.severity).toBe('ERROR');
      expect(notification?.severity).toBe('ERROR');
    });

    /** The `CHECK` is the enforcement; a bug upstream cannot write past it. */
    it('rejects a severity outside INFO/WARNING/ERROR at the database', async () => {
      await expect(
        pool.query(
          `INSERT INTO audit_events
             (event_id, message_type, message_version, producer, occurred_at, received_at,
              correlation_id, causation_id, payload, processing_status, consumer, severity)
           VALUES ($1, 'transaction.completed.v1', 1, 'transaction-service', $2, $2, $3, NULL,
                   '{}'::JSONB, 'PROCESSED', 'audit.transaction', 'NOT-A-SEVERITY')`,
          [randomUUID(), NOW, CORRELATION],
        ),
      ).rejects.toThrow();
    });

    it('narrows listRecentEvents by severity', async () => {
      await repository.record({ event: arriving({ severity: 'INFO' }), notification: null, now: NOW });
      await repository.record({
        event: arriving({ eventId: randomUUID(), severity: 'ERROR' }),
        notification: null,
        now: NOW,
      });

      const onlyErrors = await repository.listRecentEvents({ limit: 10, offset: 0, severity: 'ERROR' });

      expect(onlyErrors.total).toBe(1);
      expect(onlyErrors.events).toHaveLength(1);
      expect(onlyErrors.events[0]?.severity).toBe('ERROR');
    });

    /** A row written before T-30's migration has no classification. `NULL`, not a guess. */
    it('reads null for a row with no severity', async () => {
      await pool.query(
        `INSERT INTO audit_events
           (event_id, message_type, message_version, producer, occurred_at, received_at,
            correlation_id, causation_id, payload, processing_status, consumer)
         VALUES ($1, 'transaction.completed.v1', 1, 'transaction-service', $2, $2, $3, NULL,
                 '{}'::JSONB, 'PROCESSED', 'audit.transaction')`,
        [randomUUID(), NOW, CORRELATION],
      );

      const [event] = await repository.trailFor(CORRELATION);

      expect(event?.severity).toBeNull();
    });
  });
});
