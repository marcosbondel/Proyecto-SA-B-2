import { auditEventsListRepliedV1, createEnvelope } from '@bank/contracts';
import type { Identity } from '@bank/contracts';

import { ListAuditEventsUseCase } from '../src/application/list-audit-events.use-case';
import { RecordEventUseCase } from '../src/application/record-event.use-case';
import { classify, classifyAlerts } from '../src/domain/classification';
import { notificationFor, subjectCustomerIdFrom } from '../src/domain/notification';
import { redactPayload } from '../src/domain/redaction';
import { StructuredLogger } from '../src/interfaces/logging';
import { RecordEventHandler } from '../src/interfaces/message-handlers';
import {
  CountingIds,
  FixedClock,
  InMemoryAuditRepository,
  RecordingPublisher,
  RecordingSender,
} from './support/in-memory';

/**
 * The edges of T-45 that `trace-anomaly-alert.spec.ts` leaves to the middle of
 * the road: how the listing pages and clamps while it filters, what it leaves
 * *out* of a reply rather than sending as nothing, what the redaction does and
 * does not do to an alert, and the precedence rules that decide what an alert
 * that cannot be trusted is worth.
 */

const ADMIN: Identity = { customerId: 'a1c2e3f4-4d7b-4f0e-9c1e-0242ac120099', role: 'ADMINISTRADOR' };
const TRACE = '4bf92f3577b34da6a3ce929d0e0e4736';
const CORRELATION = '7d41e8b2-9a3f-4c15-8ee0-1b2f9a4c7d10';

const ALERT = {
  alertName: 'PaymentFailureRate',
  status: 'firing',
  severity: 'critical',
  summary: 'La tasa de fallos externos supera el umbral',
  runbookUrl: 'https://example.invalid/runbooks/payment-failure-rate',
  slo: 'SLO-3',
  startsAt: '2026-10-05T18:00:00.000Z',
  fingerprint: 'abc123',
};

function world() {
  const repository = new InMemoryAuditRepository();
  const publisher = new RecordingPublisher();
  const sender = new RecordingSender();
  const record = new RecordEventUseCase({
    repository,
    sender,
    clock: new FixedClock(),
    ids: new CountingIds(),
  });
  const lines: string[] = [];
  const handler = (traceId: string | null = null) =>
    new RecordEventHandler(
      record,
      'audit.payment',
      new StructuredLogger('test', (line) => lines.push(line)),
      () => traceId,
    );

  return { repository, publisher, sender, lines, handler };
}

const paymentFailed = (n: number) =>
  createEnvelope(
    {
      paymentId: '6b7c8d9e-0f1a-4b2c-8d3e-4f5a6b7c8d9e',
      transactionId: '9f2a41c7-4d7b-4f0e-9c1e-0242ac120002',
      status: 'FAILED',
      attempt: n,
      failureReason: 'PAYMENT_RETRIES_EXHAUSTED',
      failedAt: '2026-10-05T18:00:00.000Z',
    },
    {
      messageType: 'payment.failed.v1',
      producer: 'payment-service',
      identity: null,
      correlationId: CORRELATION,
    },
  );

describe('the audit listing, paged while it filters', () => {
  async function listWith(count: number, query: { page?: number; limit?: number }) {
    const { repository, publisher, handler } = world();

    for (let n = 1; n <= count; n += 1) {
      await handler(TRACE).handle(paymentFailed(n));
    }

    await new ListAuditEventsUseCase({ repository, publisher }).execute(
      { page: 1, limit: 10, ...query },
      ADMIN,
    );

    return publisher.last?.payload as { events: unknown[]; total: number; page: number; limit: number };
  }

  it('counts every match in `total`, and returns only the page asked for', async () => {
    const reply = await listWith(7, { page: 2, limit: 3 });

    expect(reply.total).toBe(7);
    expect(reply.events).toHaveLength(3);
    expect(reply.page).toBe(2);
  });

  it('answers the last page with what is left, not with a full one', async () => {
    const reply = await listWith(7, { page: 3, limit: 3 });

    expect(reply.events).toHaveLength(1);
  });

  it('clamps a page size nobody should ask for to the hundred the contract allows', async () => {
    const reply = await listWith(2, { limit: 5_000 });

    expect(reply.limit).toBe(100);
  });

  it('reads a page before the first as the first', async () => {
    const reply = await listWith(2, { page: -4 });

    expect(reply.page).toBe(1);
  });

  it('leaves `traceId` out of an event that has none, instead of sending it as nothing', async () => {
    const { repository, publisher, handler } = world();

    await handler(null).handle(paymentFailed(1));
    await new ListAuditEventsUseCase({ repository, publisher }).execute({ page: 1, limit: 10 }, ADMIN);

    const [event] = (publisher.last?.payload as { events: Record<string, unknown>[] }).events;

    expect(event).not.toHaveProperty('traceId');
    expect(auditEventsListRepliedV1.schema.safeParse(publisher.last?.payload).success).toBe(true);
  });

  it('puts `causationId` in only when the event had a cause', async () => {
    const { repository, publisher, handler } = world();

    await handler(TRACE).handle(paymentFailed(1));
    await new ListAuditEventsUseCase({ repository, publisher }).execute({ page: 1, limit: 10 }, ADMIN);

    const [event] = (publisher.last?.payload as { events: Record<string, unknown>[] }).events;

    expect(event).not.toHaveProperty('causationId');
  });
});

describe('the log line of a recorded event', () => {
  it('names the trace it was handled under, so a log can be followed to its trace', async () => {
    const { lines, handler } = world();

    await handler(TRACE).handle(paymentFailed(1));

    expect(JSON.parse(lines.at(-1) ?? '{}')).toMatchObject({ traceId: TRACE, outcome: 'RECORDED' });
  });

  it('carries no trace field at all when there is none', async () => {
    const { lines, handler } = world();

    await handler(null).handle(paymentFailed(1));

    expect(JSON.parse(lines.at(-1) ?? '{}')).not.toHaveProperty('traceId');
  });
});

describe('what the redaction does to an alert', () => {
  it('keeps everything an operator needs: name, state, summary, runbook, SLO', () => {
    const kept = JSON.stringify(redactPayload({ source: 'grafana', alerts: [ALERT] }));

    for (const field of ['PaymentFailureRate', 'firing', 'tasa de fallos', 'runbooks/payment', 'SLO-3', 'abc123']) {
      expect(kept).toContain(field);
    }
  });

  it('still hides a field whose name says it is a secret, wherever the alert carries one', () => {
    const redacted = JSON.stringify(
      redactPayload({ source: 'grafana', alerts: [{ ...ALERT, token: 'must-not-be-stored' }] }),
    );

    expect(redacted).not.toContain('must-not-be-stored');
    expect(redacted).toContain('[redactado]');
  });
});

describe('what an alert that cannot be trusted is worth', () => {
  it('is a WARNING when its payload fails its contract, whatever it claims to be', () => {
    expect(
      classify({
        messageType: 'alert.slo.received.v1',
        processingStatus: 'INVALID',
        payload: { alerts: [ALERT] },
      }),
    ).toBe('WARNING');
  });

  it('is an ERROR when it arrived through the parked-message drain', () => {
    expect(
      classify({
        messageType: 'alert.slo.received.v1',
        processingStatus: 'INVALID',
        parked: true,
        payload: { alerts: [{ ...ALERT, severity: 'info', status: 'resolved' }] },
      }),
    ).toBe('ERROR');
  });

  it('reads the live payload, so an alert past the redaction cut-off is still as serious as it says', () => {
    // Redaction keeps twenty list items; the classification is computed before it, from all fifty.
    const quiet = { ...ALERT, status: 'resolved' };
    const alerts = [...Array.from({ length: 49 }, () => quiet), ALERT];

    expect(classifyAlerts({ alerts })).toBe('ERROR');
  });

  it('does not mistake any other message that happens to carry an `alerts` field for one', () => {
    expect(notificationFor('transaction.completed.v1', { alerts: [ALERT] })?.type).toBe(
      'transfer.completed',
    );
    expect(notificationFor('payment.attempt.failed.v1', { alerts: [ALERT] })).toBeNull();
  });
});

describe('who an anomaly is about', () => {
  it('is the holder for the anomaly, and for no other account event', () => {
    const payload = { customerId: '3f2a1c04-9c2e-4a71-b8f5-2d6e7c0a1b93' };

    expect(subjectCustomerIdFrom('account.anomaly.detected.v1', payload)).toBe(payload.customerId);
    expect(subjectCustomerIdFrom('account.debited.v1', payload)).toBeNull();
    expect(subjectCustomerIdFrom('account.credited.v1', payload)).toBeNull();
  });

  it('is announced without a dedupe key when the payload cannot say which window it was', () => {
    const intent = notificationFor('account.anomaly.detected.v1', {
      accountId: '5a1b2c3d-4e5f-4a6b-8c7d-8e9f0a1b2c3d',
    });

    expect(intent?.type).toBe('account.anomaly');
    expect(intent).not.toHaveProperty('dedupeKey');
  });
});
