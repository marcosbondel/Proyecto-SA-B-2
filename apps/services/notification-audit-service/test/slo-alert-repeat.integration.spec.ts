import { randomUUID } from 'node:crypto';

import { Pool } from 'pg';

import type { InboundRecord } from '../src/application/ports';
import { notificationFor } from '../src/domain/notification';
import { migrate } from '../src/infrastructure/persistence/migrations';
import { PostgresAuditRepository } from '../src/infrastructure/persistence/postgres-audit.repository';

/**
 * TD-083 against a real PostgreSQL: Grafana repeats a firing alert, and the
 * operators are told once per `(alert instance, status)` inside the window.
 *
 * The part only a database can prove is the arbitration. Two replicas draining
 * `audit.query` can receive the same repetition at the same instant; a
 * read-then-write guard lets both through, and the single upsert whose `WHERE`
 * is the window lets exactly one. The concurrency test below is that claim.
 *
 * Requires `DATABASE_URL`; skipped otherwise, like every integration suite here.
 */

const DATABASE_URL = process.env.DATABASE_URL;
const describeIntegration = DATABASE_URL === undefined ? describe.skip : describe;

jest.setTimeout(30_000);

const WINDOW_MS = 4 * 60 * 60 * 1000;
const T0 = new Date('2026-10-18T10:00:00.000Z');
const after = (ms: number): Date => new Date(T0.getTime() + ms);

const alert = (overrides: Record<string, unknown> = {}) => ({
  alertName: 'GatewayAvailabilityBurnRate',
  status: 'firing',
  severity: 'critical',
  startsAt: T0.toISOString(),
  fingerprint: 'c0ffee1234567890',
  ...overrides,
});

describeIntegration('the SLO alert repeat guard, in PostgreSQL', () => {
  let pool: Pool;
  let repository: PostgresAuditRepository;

  beforeAll(async () => {
    if (DATABASE_URL === undefined) {
      return;
    }

    pool = new Pool({ connectionString: DATABASE_URL });
    await migrate(pool);
    repository = new PostgresAuditRepository(pool, { alertRepeatWindowMs: WINDOW_MS });
  });

  afterAll(async () => {
    await pool?.end();
  });

  beforeEach(async () => {
    await pool.query(
      'TRUNCATE audit_events, notifications, processed_messages, slo_alert_notifications',
    );
  });

  /** Delivers one webhook; resolves to whether the operators were told. */
  async function deliver(alerts: readonly Record<string, unknown>[], now: Date): Promise<boolean> {
    const payload = { source: 'grafana', alerts };
    const intent = notificationFor('alert.slo.received.v1', payload);

    if (intent === null) {
      throw new Error('an SLO alert must call for a notification');
    }

    const event: InboundRecord = {
      eventId: randomUUID(),
      messageType: 'alert.slo.received.v1',
      messageVersion: 1,
      producer: 'gateway',
      occurredAt: now,
      correlationId: randomUUID(),
      causationId: null,
      payload,
      processingStatus: 'PROCESSED',
      consumer: 'audit.alert',
      severity: 'ERROR',
      traceId: null,
    };

    const outcome = await repository.record({
      event,
      notification: { notificationId: randomUUID(), intent, recipient: null, customerId: null },
      now,
    });

    return outcome.kind === 'RECORDED' && outcome.notified;
  }

  const count = async (table: string): Promise<number> =>
    Number((await pool.query<{ n: string }>(`SELECT count(*) AS n FROM ${table}`)).rows[0]?.n);

  it('notifies the first FIRING and suppresses its repetitions inside the window', async () => {
    expect(await deliver([alert()], T0)).toBe(true);
    expect(await deliver([alert()], after(60_000))).toBe(false);
    expect(await deliver([alert()], after(WINDOW_MS - 1))).toBe(false);

    expect(await count('notifications')).toBe(1);
  });

  it('still records every repetition in the audit trail', async () => {
    await deliver([alert()], T0);
    await deliver([alert()], after(60_000));
    await deliver([alert()], after(120_000));

    expect(await count('audit_events')).toBe(3);
    expect(await count('notifications')).toBe(1);
  });

  it('notifies a still-active alert again once the window has elapsed, and restarts the window', async () => {
    expect(await deliver([alert()], T0)).toBe(true);
    expect(await deliver([alert()], after(WINDOW_MS))).toBe(true);
    expect(await deliver([alert()], after(WINDOW_MS + 60_000))).toBe(false);

    expect(await count('notifications')).toBe(2);
  });

  it('notifies the RESOLVED once, and a new FIRING after it, however short the gaps', async () => {
    const resolved = alert({ status: 'resolved' });

    expect(await deliver([alert()], T0)).toBe(true);
    expect(await deliver([alert()], after(60_000))).toBe(false);
    expect(await deliver([resolved], after(120_000))).toBe(true);
    expect(await deliver([resolved], after(180_000))).toBe(false);
    // Inside the four hours of the first FIRING: it is a new incident, not a repeat.
    expect(await deliver([alert()], after(240_000))).toBe(true);
    expect(await deliver([alert()], after(300_000))).toBe(false);

    expect(await count('notifications')).toBe(3);
  });

  it('keeps instances apart by fingerprint', async () => {
    const other = alert({ fingerprint: 'deadbeef00000001' });

    expect(await deliver([alert()], T0)).toBe(true);
    expect(await deliver([other], after(1_000))).toBe(true);
    expect(await deliver([other], after(2_000))).toBe(false);
  });

  it('notifies a batch that contains one new instance, and claims all of them', async () => {
    const other = alert({ fingerprint: 'deadbeef00000001' });

    expect(await deliver([alert()], T0)).toBe(true);
    expect(await deliver([alert(), other], after(1_000))).toBe(true);
    // Both are claimed now: the next batch of the same two is a pure repetition.
    expect(await deliver([alert(), other], after(2_000))).toBe(false);
  });

  it('falls back to the alert name when Grafana sent no fingerprint', async () => {
    const anonymous = alert({ fingerprint: undefined });

    expect(await deliver([anonymous], T0)).toBe(true);
    expect(await deliver([anonymous], after(1_000))).toBe(false);
  });

  it('does not touch the notifications of anything that is not an SLO alert', async () => {
    const event: InboundRecord = {
      eventId: randomUUID(),
      messageType: 'customer.activation.requested.v1',
      messageVersion: 1,
      producer: 'customer-service',
      occurredAt: T0,
      correlationId: randomUUID(),
      causationId: null,
      payload: {},
      processingStatus: 'PROCESSED',
      consumer: 'audit.customer',
      severity: 'INFO',
      traceId: null,
    };
    const intent = {
      type: 'customer.activation',
      subject: 'Activa tu cuenta',
      referenceId: null,
      severity: 'INFO' as const,
    };

    const outcome = await repository.record({
      event,
      notification: { notificationId: randomUUID(), intent, recipient: null, customerId: null },
      now: T0,
    });

    expect(outcome).toMatchObject({ kind: 'RECORDED', notified: true });
    expect(await count('slo_alert_notifications')).toBe(0);
  });

  it('lets exactly one of several replicas notify the same repetition (the database arbitrates)', async () => {
    const results = await Promise.all(Array.from({ length: 8 }, () => deliver([alert()], T0)));

    expect(results.filter(Boolean)).toHaveLength(1);
    expect(await count('notifications')).toBe(1);
    expect(await count('audit_events')).toBe(8);
  });

  it('releases the claim when the transaction fails, so the alert is not silently lost', async () => {
    const payload = { source: 'grafana', alerts: [alert()] };
    const intent = notificationFor('alert.slo.received.v1', payload);

    if (intent === null) {
      throw new Error('an SLO alert must call for a notification');
    }

    // A severity the column's CHECK refuses: the failure comes AFTER the claim.
    await expect(
      repository.record({
        event: {
          eventId: randomUUID(),
          messageType: 'alert.slo.received.v1',
          messageVersion: 1,
          producer: 'gateway',
          occurredAt: T0,
          correlationId: randomUUID(),
          causationId: null,
          payload,
          processingStatus: 'PROCESSED',
          consumer: 'audit.alert',
          severity: 'ERROR',
          traceId: null,
        },
        notification: {
          notificationId: randomUUID(),
          intent: { ...intent, severity: 'BOGUS' as never },
          recipient: null,
          customerId: null,
        },
        now: T0,
      }),
    ).rejects.toThrow(/notifications_severity_known/);

    expect(await count('slo_alert_notifications')).toBe(0);
    expect(await deliver([alert()], after(1_000))).toBe(true);
  });
});
