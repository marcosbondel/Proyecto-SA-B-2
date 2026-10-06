import { randomUUID } from 'node:crypto';

import { Pool } from 'pg';

import type { InboundRecord } from '../src/application/ports';
import type { NotificationIntent } from '../src/domain/notification';
import { RecordEventUseCase } from '../src/application/record-event.use-case';
import { migrate } from '../src/infrastructure/persistence/migrations';
import { PostgresAuditRepository } from '../src/infrastructure/persistence/postgres-audit.repository';
import { CountingIds, FixedClock, RecordingSender } from './support/in-memory';

/**
 * T-45 against a real PostgreSQL, for the two guarantees only the database
 * gives: a trace id that is a trace id, and one notification for one anomaly.
 *
 * The second is the reason this file exists. The audit trail is deduplicated by
 * `(event_id, consumer)`, and Account Service can announce the same anomaly
 * twice under two message ids — a double that "refuses" the second is only
 * restating the test; the partial unique index on `dedupe_key` is what refuses
 * it when two replicas drain `audit.account` at once.
 *
 * Requires `DATABASE_URL`; skipped otherwise, like every integration suite here.
 */

const DATABASE_URL = process.env.DATABASE_URL;
const describeIntegration = DATABASE_URL === undefined ? describe.skip : describe;

jest.setTimeout(30_000);

describeIntegration('trace ids and the anomaly notification, in PostgreSQL', () => {
  let pool: Pool;
  let repository: PostgresAuditRepository;

  const NOW = new Date('2026-10-05T18:00:00.000Z');
  const TRACE_A = '4bf92f3577b34da6a3ce929d0e0e4736';
  const TRACE_B = '0af7651916cd43dd8448eb211c80319c';

  beforeAll(async () => {
    if (DATABASE_URL === undefined) {
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
    correlationId: randomUUID(),
    causationId: null,
    payload: { transactionId: randomUUID() },
    processingStatus: 'PROCESSED',
    consumer: 'audit.transaction',
    severity: 'INFO',
    traceId: null,
    ...overrides,
  });

  const anomalyIntent = (accountId: string, windowStart: string): NotificationIntent => ({
    type: 'account.anomaly',
    subject: 'Detectamos actividad inusual en tu cuenta',
    referenceId: accountId,
    severity: 'WARNING',
    dedupeKey: `anomaly:${accountId}:${windowStart}`,
  });

  const notifying = (intent: NotificationIntent) => ({
    notificationId: randomUUID(),
    intent,
    recipient: null,
    customerId: randomUUID(),
  });

  describe('the trace id', () => {
    it('is stored beside the correlation id and comes back on a list and on a trail', async () => {
      const correlationId = randomUUID();

      await repository.record({
        event: arriving({ correlationId, traceId: TRACE_A }),
        notification: null,
        now: NOW,
      });

      expect((await repository.trailFor(correlationId))[0]?.traceId).toBe(TRACE_A);
      expect((await repository.listRecentEvents({ limit: 10, offset: 0 })).events[0]?.traceId).toBe(
        TRACE_A,
      );
    });

    it('is NULL for an event with no trace, which is what a row before T-45 reads as', async () => {
      await repository.record({ event: arriving(), notification: null, now: NOW });

      expect((await repository.listRecentEvents({ limit: 10, offset: 0 })).events[0]?.traceId).toBeNull();
    });

    it('refuses a value that is not a trace id, and the reserved all-zero one', async () => {
      for (const bad of ['0'.repeat(32), TRACE_A.toUpperCase(), TRACE_A.slice(1), 'not-a-trace']) {
        await expect(
          repository.record({ event: arriving({ traceId: bad }), notification: null, now: NOW }),
        ).rejects.toThrow(/audit_events_trace_id_shape|value too long/);
      }
    });

    it('is indexed, so a lookup by trace does not scan the trail', async () => {
      const { rows } = await pool.query<{ indexdef: string }>(
        `SELECT indexdef FROM pg_indexes WHERE tablename = 'audit_events' AND indexname = 'audit_events_trace_idx'`,
      );

      expect(rows[0]?.indexdef).toContain('trace_id');
    });
  });

  describe('the list, filtered', () => {
    async function seed() {
      const correlationA = randomUUID();
      const correlationB = randomUUID();

      await repository.record({
        event: arriving({ correlationId: correlationA, traceId: TRACE_A, severity: 'INFO' }),
        notification: null,
        now: NOW,
      });
      await repository.record({
        event: arriving({
          correlationId: correlationA,
          traceId: TRACE_A,
          producer: 'account-service',
          messageType: 'account.debited.v1',
          consumer: 'audit.account',
          severity: 'INFO',
        }),
        notification: null,
        now: NOW,
      });
      await repository.record({
        event: arriving({
          correlationId: correlationB,
          traceId: TRACE_B,
          producer: 'payment-service',
          messageType: 'payment.failed.v1',
          consumer: 'audit.payment',
          severity: 'ERROR',
        }),
        notification: null,
        now: NOW,
      });

      return { correlationA, correlationB };
    }

    const list = (filter: object) =>
      repository.listRecentEvents({ limit: 10, offset: 0, ...filter });

    it('returns the events of one trace, and counts them', async () => {
      await seed();

      const result = await list({ traceId: TRACE_A });

      expect(result.total).toBe(2);
      expect(result.events.every((event) => event.traceId === TRACE_A)).toBe(true);
    });

    it('filters by correlation id, by service and by level', async () => {
      const { correlationB } = await seed();

      expect((await list({ correlationId: correlationB })).events).toHaveLength(1);
      expect((await list({ service: 'account-service' })).total).toBe(1);
      expect((await list({ severity: 'ERROR' })).events[0]?.producer).toBe('payment-service');
    });

    it('combines the filters with AND, and the total follows the same filter as the page', async () => {
      await seed();

      expect((await list({ traceId: TRACE_A, service: 'account-service' })).total).toBe(1);
      expect((await list({ traceId: TRACE_A, service: 'payment-service' })).total).toBe(0);

      const paged = await repository.listRecentEvents({
        limit: 1,
        offset: 1,
        traceId: TRACE_A,
      });

      expect(paged.events).toHaveLength(1);
      expect(paged.total).toBe(2);
    });

    it('treats a filter value as data, never as SQL', async () => {
      await seed();

      const result = await list({ service: `' OR '1'='1` });

      expect(result).toMatchObject({ events: [], total: 0 });
      expect((await pool.query('SELECT count(*)::int AS n FROM audit_events')).rows[0]?.n).toBe(3);
    });

    it('with no filter at all, lists everything as before', async () => {
      await seed();

      expect((await list({})).total).toBe(3);
    });
  });

  describe('the anomaly notification', () => {
    const ACCOUNT = '5a1b2c3d-4e5f-4a6b-8c7d-8e9f0a1b2c3d';
    const WINDOW = '2026-10-05T17:55:00.000Z';

    const announce = (intent: NotificationIntent) =>
      repository.record({
        event: arriving({
          messageType: 'account.anomaly.detected.v1',
          producer: 'account-service',
          consumer: 'audit.account',
          severity: 'WARNING',
        }),
        notification: notifying(intent),
        now: NOW,
      });

    it('writes one notification when the same window is announced under two message ids', async () => {
      const first = await announce(anomalyIntent(ACCOUNT, WINDOW));
      const second = await announce(anomalyIntent(ACCOUNT, WINDOW));

      expect(first).toMatchObject({ kind: 'RECORDED', notified: true });
      // The audit event is recorded — it arrived — but nobody is told twice.
      expect(second).toEqual({ kind: 'RECORDED', notified: false });
      expect((await pool.query('SELECT count(*)::int AS n FROM audit_events')).rows[0]?.n).toBe(2);
      expect((await pool.query('SELECT count(*)::int AS n FROM notifications')).rows[0]?.n).toBe(1);
    });

    it('holds when two replicas record the same anomaly at the same instant', async () => {
      const outcomes = await Promise.all(
        Array.from({ length: 8 }, () => announce(anomalyIntent(ACCOUNT, WINDOW))),
      );

      expect(outcomes.filter((outcome) => outcome.kind === 'RECORDED' && outcome.notified)).toHaveLength(1);
      expect((await pool.query('SELECT count(*)::int AS n FROM notifications')).rows[0]?.n).toBe(1);
    });

    it('writes another notification for the next window and for another account', async () => {
      await announce(anomalyIntent(ACCOUNT, WINDOW));
      await announce(anomalyIntent(ACCOUNT, '2026-10-05T18:00:00.000Z'));
      await announce(anomalyIntent('8e9f0a1b-2c3d-4e5f-8a6b-7c8d9e0f1a2b', WINDOW));

      expect((await pool.query('SELECT count(*)::int AS n FROM notifications')).rows[0]?.n).toBe(3);
    });

    it('leaves every notification without a key alone: they may repeat', async () => {
      const plain: NotificationIntent = {
        type: 'transfer.completed',
        subject: 'Tu transferencia se completó',
        referenceId: null,
        severity: 'INFO',
      };

      await repository.record({ event: arriving(), notification: notifying(plain), now: NOW });
      await repository.record({ event: arriving(), notification: notifying(plain), now: NOW });

      expect((await pool.query('SELECT count(*)::int AS n FROM notifications')).rows[0]?.n).toBe(2);
    });
  });

  describe('the whole use case, on the real repository', () => {
    const ACCOUNT = '5a1b2c3d-4e5f-4a6b-8c7d-8e9f0a1b2c3d';
    const WINDOW = '2026-10-05T17:55:00.000Z';

    function useCase() {
      const sender = new RecordingSender();

      return {
        sender,
        record: new RecordEventUseCase({
          repository,
          sender,
          clock: new FixedClock(NOW),
          ids: new CountingIds(),
        }),
      };
    }

    const anomalyEvent = () =>
      arriving({
        messageType: 'account.anomaly.detected.v1',
        producer: 'account-service',
        consumer: 'audit.account',
        severity: 'WARNING',
        payload: { accountId: ACCOUNT, customerId: randomUUID(), windowStart: WINDOW },
      });

    it('sends the anomaly once when it is announced twice, and settles the one it sent', async () => {
      const { record, sender } = useCase();

      await record.execute({ event: anomalyEvent(), customerId: null });
      await record.execute({ event: anomalyEvent(), customerId: null });

      expect(sender.sent).toHaveLength(1);

      const { rows } = await pool.query<{ status: string }>('SELECT status FROM notifications');

      expect(rows).toEqual([{ status: 'SENT' }]);
    });

    it('sends it once even when eight replicas announce it at the same instant', async () => {
      const { record, sender } = useCase();

      await Promise.all(
        Array.from({ length: 8 }, () => record.execute({ event: anomalyEvent(), customerId: null })),
      );

      expect(sender.sent).toHaveLength(1);
      expect((await pool.query('SELECT count(*)::int AS n FROM notifications')).rows[0]?.n).toBe(1);
      expect((await pool.query('SELECT count(*)::int AS n FROM audit_events')).rows[0]?.n).toBe(8);
    });

    it('gives the trail of one flow back in order, each event with the trace it was handled under', async () => {
      const { record } = useCase();
      const correlationId = randomUUID();

      await record.execute({
        event: arriving({
          correlationId,
          traceId: TRACE_A,
          occurredAt: new Date('2026-10-05T18:00:02.000Z'),
          messageType: 'transaction.completed.v1',
        }),
        customerId: null,
      });
      await record.execute({
        event: arriving({
          correlationId,
          traceId: TRACE_A,
          occurredAt: new Date('2026-10-05T18:00:01.000Z'),
          producer: 'account-service',
          messageType: 'account.debited.v1',
          consumer: 'audit.account',
        }),
        customerId: null,
      });

      const trail = await repository.trailFor(correlationId);

      expect(trail.map((event) => event.messageType)).toEqual([
        'account.debited.v1',
        'transaction.completed.v1',
      ]);
      expect(trail.map((event) => event.traceId)).toEqual([TRACE_A, TRACE_A]);
    });
  });
});
