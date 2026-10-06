import {
  alertSloReceivedV1,
  auditEventsListRepliedV1,
  auditQueryRepliedV1,
  createEnvelope,
} from '@bank/contracts';
import type { Identity, MessageEnvelope } from '@bank/contracts';
import { ROOT_CONTEXT, context, trace } from '@opentelemetry/api';
import type { Context, ContextManager } from '@opentelemetry/api';
import { BasicTracerProvider } from '@opentelemetry/sdk-trace-base';

import { ListAuditEventsUseCase } from '../src/application/list-audit-events.use-case';
import { QueryAuditUseCase } from '../src/application/query-audit.use-case';
import { RecordEventUseCase } from '../src/application/record-event.use-case';
import { classify, classifyAlerts } from '../src/domain/classification';
import {
  OPERATORS_RECIPIENT,
  notificationFor,
  subjectCustomerIdFrom,
} from '../src/domain/notification';
import { SimulatedNotificationAdapter } from '../src/infrastructure/notification/simulated-notification.adapter';
import { activeTraceId } from '../src/infrastructure/telemetry/active-trace';
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
 * T-45's criteria, as tests. The first group is the one the ticket opens with —
 * "una consulta por `traceId` devuelve los eventos de auditoría de esa
 * operación" — and it runs against a real OpenTelemetry SDK, because a test that
 * hands the trace id to the handler would prove only that the handler stores
 * what it is given. What matters is that the id comes out of the *active span*,
 * which is where `@bank/messaging` will put the extracted `traceparent` (T-48).
 */

const CORRELATION = '7d41e8b2-9a3f-4c15-8ee0-1b2f9a4c7d10';
const OTHER_CORRELATION = '1c0b2d3e-5f6a-4b7c-8d9e-0f1a2b3c4d5e';
const ACCOUNT = '5a1b2c3d-4e5f-4a6b-8c7d-8e9f0a1b2c3d';
const CUSTOMER = '3f2a1c04-9c2e-4a71-b8f5-2d6e7c0a1b93';

const ADMIN: Identity = { customerId: 'a1c2e3f4-4d7b-4f0e-9c1e-0242ac120099', role: 'ADMINISTRADOR' };
const TELLER: Identity = { customerId: CUSTOMER, role: 'CAJERO_RECEPTOR' };

/**
 * The smallest context manager that makes `context.with` do something. The SDK
 * packages the repository carries do not include the async-hooks one, and the
 * handler reads the trace id synchronously, before its first `await`, so a stack
 * is exactly enough.
 */
class StackContextManager implements ContextManager {
  #stack: Context[] = [ROOT_CONTEXT];

  public active(): Context {
    return this.#stack.at(-1) ?? ROOT_CONTEXT;
  }

  public with<A extends unknown[], F extends (...args: A) => ReturnType<F>>(
    ctx: Context,
    fn: F,
    thisArg?: ThisParameterType<F>,
    ...args: A
  ): ReturnType<F> {
    this.#stack.push(ctx);

    try {
      return fn.call(thisArg, ...args);
    } finally {
      this.#stack.pop();
    }
  }

  public bind<T>(_context: Context, target: T): T {
    return target;
  }

  public enable(): this {
    return this;
  }

  public disable(): this {
    this.#stack = [ROOT_CONTEXT];

    return this;
  }
}

const provider = new BasicTracerProvider();
const tracer = provider.getTracer('test');

beforeAll(() => {
  context.setGlobalContextManager(new StackContextManager());
});

afterAll(() => {
  context.disable();
});

/** Runs `work` inside a span, the way the broker consumer will once T-48 lands. */
async function inNewTrace<T>(work: () => Promise<T>): Promise<{ traceId: string; result: T }> {
  const span = tracer.startSpan('consume');
  const traceId = span.spanContext().traceId;

  try {
    const result = await context.with(trace.setSpan(context.active(), span), work);

    return { traceId, result };
  } finally {
    span.end();
  }
}

function harness() {
  const repository = new InMemoryAuditRepository();
  const sender = new RecordingSender();
  const publisher = new RecordingPublisher();
  const record = new RecordEventUseCase({
    repository,
    sender,
    clock: new FixedClock(),
    ids: new CountingIds(),
  });
  const handlerFor = (consumer: string, traceIdOf: () => string | null = activeTraceId) =>
    new RecordEventHandler(record, consumer, new StructuredLogger('test', () => {}), traceIdOf);

  return { repository, sender, publisher, handlerFor };
}

const completed = (correlationId: string): MessageEnvelope<unknown> =>
  createEnvelope(
    {
      transactionId: '9f2a41c7-4d7b-4f0e-9c1e-0242ac120002',
      customerId: null,
      sourceAccount: '11111111-4d7b-4f0e-9c1e-0242ac120001',
      targetAccount: '22222222-4d7b-4f0e-9c1e-0242ac120002',
      amount: { amountMinor: 10_000, currency: 'GTQ' },
      status: 'COMPLETED',
      completedAt: '2026-08-27T15:00:00.000Z',
    },
    {
      messageType: 'transaction.completed.v1',
      producer: 'transaction-service',
      identity: null,
      correlationId,
    },
  );

describe('the trace id of an audit event', () => {
  it('is the one of the span the message was handled under', async () => {
    const { repository, handlerFor } = harness();

    const { traceId } = await inNewTrace(() => handlerFor('audit.transaction').handle(completed(CORRELATION)));

    expect(traceId).toMatch(/^[0-9a-f]{32}$/);
    expect(repository.events[0]?.traceId).toBe(traceId);
  });

  it('is null — never a placeholder — when no SDK recorded a trace', async () => {
    const { repository, handlerFor } = harness();

    await handlerFor('audit.transaction').handle(completed(CORRELATION));

    expect(activeTraceId()).toBeNull();
    expect(repository.events[0]?.traceId).toBeNull();
  });

  it('is null under a span the SDK does not record, whose context is invalid', async () => {
    const { repository, handlerFor } = harness();
    const invalid = trace.wrapSpanContext({
      traceId: '0'.repeat(32),
      spanId: '0'.repeat(16),
      traceFlags: 0,
    });

    await context.with(trace.setSpan(context.active(), invalid), () =>
      handlerFor('audit.transaction').handle(completed(CORRELATION)),
    );

    expect(repository.events[0]?.traceId).toBeNull();
  });

  describe('queried through the list (§4.1, "por correlationId, traceId, servicio y nivel")', () => {
    async function twoOperations() {
      const world = harness();
      const first = await inNewTrace(() =>
        world.handlerFor('audit.transaction').handle(completed(CORRELATION)),
      );
      const second = await inNewTrace(async () => {
        await world.handlerFor('audit.payment').handle(
          createEnvelope(
            {
              paymentId: '6b7c8d9e-0f1a-4b2c-8d3e-4f5a6b7c8d9e',
              transactionId: '9f2a41c7-4d7b-4f0e-9c1e-0242ac120002',
              status: 'FAILED',
              attempt: 4,
              failureReason: 'PAYMENT_RETRIES_EXHAUSTED',
              failedAt: '2026-08-27T15:00:05.000Z',
            },
            {
              messageType: 'payment.failed.v1',
              producer: 'payment-service',
              identity: null,
              correlationId: OTHER_CORRELATION,
            },
          ),
        );
      });
      const list = new ListAuditEventsUseCase({
        repository: world.repository,
        publisher: world.publisher,
      });

      return { ...world, first, second, list };
    }

    const ask = async (
      world: Awaited<ReturnType<typeof twoOperations>>,
      query: Record<string, unknown>,
      identity: Identity | null = ADMIN,
    ) => {
      await world.list.execute({ page: 1, limit: 10, ...query }, identity);

      return world.publisher.last?.payload as {
        events: { traceId?: string; correlationId: string; producer: string; severity?: string }[];
        total: number;
      };
    };

    it('returns the events of that trace, and only those', async () => {
      const world = await twoOperations();

      const reply = await ask(world, { traceId: world.first.traceId });

      expect(reply.total).toBe(1);
      expect(reply.events.map((event) => event.traceId)).toEqual([world.first.traceId]);
      expect(reply.events[0]?.correlationId).toBe(CORRELATION);
    });

    it('answers a trace nobody recorded with an empty list, not an error', async () => {
      const world = await twoOperations();

      const reply = await ask(world, { traceId: 'f'.repeat(32) });

      expect(reply).toMatchObject({ events: [], total: 0 });
    });

    it('filters by correlation id, by service and by level, each on its own', async () => {
      const world = await twoOperations();

      expect((await ask(world, { correlationId: OTHER_CORRELATION })).events).toHaveLength(1);
      expect((await ask(world, { service: 'payment-service' })).events[0]?.producer).toBe(
        'payment-service',
      );
      expect((await ask(world, { severity: 'ERROR' })).events).toHaveLength(1);
      expect((await ask(world, { severity: 'INFO' })).events[0]?.producer).toBe(
        'transaction-service',
      );
    });

    it('combines the filters with AND, so a trace of another service finds nothing', async () => {
      const world = await twoOperations();

      const reply = await ask(world, {
        traceId: world.first.traceId,
        service: 'payment-service',
      });

      expect(reply.total).toBe(0);
    });

    it('answers a reader who is not an administrator with nothing, filters or not', async () => {
      const world = await twoOperations();

      expect(await ask(world, { traceId: world.first.traceId }, TELLER)).toMatchObject({
        events: [],
        total: 0,
      });
      expect(await ask(world, {}, null)).toMatchObject({ events: [], total: 0 });
    });

    it('replies in the shape the contract promises', async () => {
      const world = await twoOperations();

      await ask(world, {});

      expect(auditEventsListRepliedV1.schema.safeParse(world.publisher.last?.payload).success).toBe(
        true,
      );
    });

    it('puts the trace id in the trail of a flow too', async () => {
      const world = await twoOperations();
      const query = new QueryAuditUseCase({
        repository: world.repository,
        publisher: world.publisher,
      });

      await query.execute({ correlationId: CORRELATION }, ADMIN);

      const reply = world.publisher.last?.payload as { events: { traceId?: string }[] };

      expect(reply.events[0]?.traceId).toBe(world.first.traceId);
      expect(auditQueryRepliedV1.schema.safeParse(world.publisher.last?.payload).success).toBe(true);
    });
  });
});

const ANOMALY = {
  accountId: ACCOUNT,
  customerId: CUSTOMER,
  accountType: 'AHORRO',
  rule: 'HIGH_FREQUENCY',
  operationCount: 11,
  threshold: 10,
  windowMinutes: 5,
  windowStart: '2026-08-27T14:55:00.000Z',
  detectedAt: '2026-08-27T15:00:00.000Z',
};

const anomaly = (payload: Record<string, unknown> = ANOMALY, correlationId = CORRELATION) =>
  createEnvelope(payload, {
    messageType: 'account.anomaly.detected.v1',
    producer: 'account-service',
    identity: null,
    correlationId,
  });

describe('account.anomaly.detected.v1 becomes a WARNING notification (§4.1, Account Service)', () => {
  it('is classified WARNING, as the assignment names it', () => {
    expect(classify({ messageType: 'account.anomaly.detected.v1', processingStatus: 'PROCESSED' })).toBe(
      'WARNING',
    );
    expect(notificationFor('account.anomaly.detected.v1', ANOMALY)?.severity).toBe('WARNING');
  });

  it('reaches the account holder, says nothing about the numbers, and is sent', async () => {
    const { repository, sender, handlerFor } = harness();

    await handlerFor('audit.account').handle(anomaly());

    expect(repository.notifications).toHaveLength(1);

    const [notification] = repository.notifications;

    expect(notification).toMatchObject({
      type: 'account.anomaly',
      severity: 'WARNING',
      customerId: CUSTOMER,
      referenceId: ACCOUNT,
    });
    expect(notification?.subject).not.toMatch(/\d/);
    expect(sender.sent).toHaveLength(1);
  });

  it('is delivered by the real simulated channel when it goes to the operators, not reported as failed', async () => {
    const repository = new InMemoryAuditRepository();
    const warnings: string[] = [];
    const channel = new SimulatedNotificationAdapter({
      info: () => undefined,
      warn: (message) => warnings.push(message),
    });
    const handler = new RecordEventHandler(
      new RecordEventUseCase({
        repository,
        sender: channel,
        clock: new FixedClock(),
        ids: new CountingIds(),
      }),
      'audit.account',
      new StructuredLogger('test', () => {}),
    );
    const { customerId: _omitted, ...withoutCustomer } = ANOMALY;

    await handler.handle(anomaly(withoutCustomer));

    expect(repository.notifications[0]?.status).toBe('SENT');
    expect(warnings).not.toContain('notification has no recipient');
  });

  it('goes to the operators when the event names no customer, in words that claim no owner', async () => {
    const { repository, sender, handlerFor } = harness();
    const { customerId: _omitted, ...withoutCustomer } = ANOMALY;

    await handlerFor('audit.account').handle(anomaly(withoutCustomer));

    expect(subjectCustomerIdFrom('account.anomaly.detected.v1', withoutCustomer)).toBeNull();
    expect(repository.notifications).toHaveLength(1);

    const [notification] = repository.notifications;

    expect(notification).toMatchObject({
      type: 'account.anomaly',
      severity: 'WARNING',
      customerId: null,
      recipient: OPERATORS_RECIPIENT,
      referenceId: ACCOUNT,
    });
    expect(notification?.subject).not.toMatch(/\d|\btu\b/i);
    expect(sender.sent).toHaveLength(1);
  });

  it('keeps the holder as the audience whenever the event names one', () => {
    const intent = notificationFor('account.anomaly.detected.v1', ANOMALY);

    expect(intent?.audience).toBeUndefined();
    expect(intent?.subject).toBe('Detectamos actividad inusual en tu cuenta');
  });

  it('chooses the operators for an anomaly without a customer, whatever else the payload says', () => {
    const { customerId: _omitted, ...withoutCustomer } = ANOMALY;
    const intent = notificationFor('account.anomaly.detected.v1', withoutCustomer);

    expect(intent?.audience).toBe('OPERATORS');
    expect(intent?.severity).toBe('WARNING');
    expect(intent?.referenceId).toBe(ACCOUNT);
  });

  it('does not send any other event to the operators for lacking a customer', () => {
    expect(notificationFor('account.deactivated.v1', { accountId: ACCOUNT })?.audience).toBeUndefined();
  });

  it('tells the holder once when the producer announces the same window twice', async () => {
    const { repository, sender, handlerFor } = harness();

    // Two messages, two ids: Account Service republishes after a failed publication.
    await handlerFor('audit.account').handle(anomaly());
    await handlerFor('audit.account').handle(anomaly());

    expect(repository.events).toHaveLength(2);
    expect(repository.notifications).toHaveLength(1);
    expect(sender.sent).toHaveLength(1);
  });

  it('tells the holder again about the next window, which is a different anomaly', async () => {
    const { repository, sender, handlerFor } = harness();

    await handlerFor('audit.account').handle(anomaly());
    await handlerFor('audit.account').handle(
      anomaly({ ...ANOMALY, windowStart: '2026-08-27T15:05:00.000Z' }),
    );

    expect(repository.notifications).toHaveLength(2);
    expect(sender.sent).toHaveLength(2);
  });

  it('does not mistake another account in the same window for the same anomaly', async () => {
    const { repository, handlerFor } = harness();

    await handlerFor('audit.account').handle(anomaly());
    await handlerFor('audit.account').handle(
      anomaly({ ...ANOMALY, accountId: '8e9f0a1b-2c3d-4e5f-8a6b-7c8d9e0f1a2b' }),
    );

    expect(repository.notifications).toHaveLength(2);
  });

  it('does not notify on an anomaly it could not read, but records it', async () => {
    const { repository, sender, handlerFor } = harness();

    await handlerFor('audit.account').handle(anomaly({ accountId: 'not-a-uuid' }));

    expect(repository.events[0]?.processingStatus).toBe('INVALID');
    expect(repository.notifications).toHaveLength(0);
    expect(sender.sent).toHaveLength(0);
  });
});

const ALERT = {
  alertName: 'GatewayAvailabilityBurnRate',
  status: 'firing',
  severity: 'critical',
  summary: 'El presupuesto de error de SLO-1 se consume 14 veces más rápido',
  runbookUrl: 'https://example.invalid/runbooks/gateway-availability-burn-rate',
  slo: 'SLO-1',
  startsAt: '2026-10-05T18:00:00.000Z',
  fingerprint: 'c0ffee1234567890',
} as const;

const alertEnvelope = (alerts: readonly Record<string, unknown>[]) =>
  createEnvelope(
    { source: 'grafana', alerts },
    {
      messageType: alertSloReceivedV1.name,
      producer: 'gateway',
      identity: null,
      correlationId: CORRELATION,
    },
  );

describe('an SLO alert from the webhook is recorded and notified (§4.1, Notification & Audit)', () => {
  describe('its severity is what it says', () => {
    it.each([
      ['a critical alert that fires', [ALERT], 'ERROR'],
      ['a warning that fires', [{ ...ALERT, severity: 'warning' }], 'WARNING'],
      ['an informational one that fires', [{ ...ALERT, severity: 'info' }], 'INFO'],
      ['a critical alert that has resolved', [{ ...ALERT, status: 'resolved' }], 'INFO'],
      [
        'a batch, which is as serious as its worst alert',
        [
          { ...ALERT, status: 'resolved' },
          { ...ALERT, severity: 'warning' },
          ALERT,
        ],
        'ERROR',
      ],
    ])('%s is %s', (_label, alerts, expected) => {
      expect(classifyAlerts({ source: 'grafana', alerts })).toBe(expected);
    });

    it('falls back to WARNING for a payload that is not an alert list', () => {
      expect(classifyAlerts(undefined)).toBe('WARNING');
      expect(classifyAlerts({})).toBe('WARNING');
      expect(classifyAlerts({ alerts: [] })).toBe('WARNING');
    });

    it('is read from the payload by `classify`, which is not an event contract', () => {
      expect(
        classify({
          messageType: alertSloReceivedV1.name,
          processingStatus: 'PROCESSED',
          payload: { alerts: [ALERT] },
        }),
      ).toBe('ERROR');
    });
  });

  it('is recorded as an audit event of the gateway, with what the alert said', async () => {
    const { repository, handlerFor } = harness();

    await handlerFor('audit.alert').handle(alertEnvelope([ALERT]));

    const [event] = repository.events;

    expect(event).toMatchObject({
      messageType: 'alert.slo.received.v1',
      producer: 'gateway',
      consumer: 'audit.alert',
      processingStatus: 'PROCESSED',
      severity: 'ERROR',
      correlationId: CORRELATION,
    });
    expect(JSON.stringify(event?.payload)).toContain('GatewayAvailabilityBurnRate');
    expect(JSON.stringify(event?.payload)).toContain('SLO-1');
  });

  it('is notified once for the whole batch, with the severity of the audit row', async () => {
    const { repository, sender, handlerFor } = harness();

    await handlerFor('audit.alert').handle(alertEnvelope([ALERT, { ...ALERT, alertName: 'Other' }]));

    expect(repository.notifications).toHaveLength(1);
    expect(repository.notifications[0]).toMatchObject({
      type: 'alert.slo',
      severity: repository.events[0]?.severity,
      customerId: null,
      recipient: OPERATORS_RECIPIENT,
    });
    expect(repository.notifications[0]?.subject).toBe('2 alertas de SLO (2 activas)');
    expect(sender.sent).toEqual([expect.objectContaining({ type: 'alert.slo' })]);
  });

  /**
   * With the *real* simulated channel, which reports `FAILED` for a notification
   * with nobody to tell. The recording double used everywhere else always answers
   * `SENT`, and that is how the first version of this feature reached a browser
   * as an alert marked "No enviada" under a red banner.
   */
  it('is delivered by the simulated channel, not reported as failed for want of somebody to tell', async () => {
    const repository = new InMemoryAuditRepository();
    const warnings: string[] = [];
    const channel = new SimulatedNotificationAdapter({
      info: () => undefined,
      warn: (message) => warnings.push(message),
    });
    const handler = new RecordEventHandler(
      new RecordEventUseCase({
        repository,
        sender: channel,
        clock: new FixedClock(),
        ids: new CountingIds(),
      }),
      'audit.alert',
      new StructuredLogger('test', () => {}),
    );

    await handler.handle(alertEnvelope([ALERT]));

    expect(repository.notifications[0]?.status).toBe('SENT');
    expect(repository.notifications[0]?.recipient).toBe(OPERATORS_RECIPIENT);
    // An ERROR is logged as a warning by design; what must not appear is the complaint about nobody to tell.
    expect(warnings).not.toContain('notification has no recipient');
    // Simulated and anonymous: nothing in it names a person.
    expect(OPERATORS_RECIPIENT).not.toMatch(/\d/);
  });

  it('names the alert when there is one, and says whether it fired or resolved', () => {
    expect(notificationFor('alert.slo.received.v1', { alerts: [ALERT] })?.subject).toBe(
      'Alerta de SLO activa: GatewayAvailabilityBurnRate',
    );
    expect(
      notificationFor('alert.slo.received.v1', { alerts: [{ ...ALERT, status: 'resolved' }] })?.subject,
    ).toBe('Alerta de SLO resuelta: GatewayAvailabilityBurnRate');
  });

  it('never builds a subject longer than the column holds', () => {
    const subject = notificationFor('alert.slo.received.v1', {
      alerts: [{ ...ALERT, alertName: 'x'.repeat(200) }],
    })?.subject;

    expect(subject?.length).toBeLessThanOrEqual(200);
  });

  it('notifies a redelivery once, because the message id is the gate', async () => {
    const { repository, sender, handlerFor } = harness();
    const envelope = alertEnvelope([ALERT]);

    await handlerFor('audit.alert').handle(envelope);
    await handlerFor('audit.alert').handle(envelope);

    expect(repository.events).toHaveLength(1);
    expect(repository.notifications).toHaveLength(1);
    expect(sender.sent).toHaveLength(1);
  });

  it('records every repetition Grafana sends while an alert stays active', async () => {
    const { repository, handlerFor } = harness();

    await handlerFor('audit.alert').handle(alertEnvelope([ALERT]));
    await handlerFor('audit.alert').handle(alertEnvelope([ALERT]));

    expect(repository.events).toHaveLength(2);
    expect(repository.notifications).toHaveLength(2);
  });

  it('records and does not notify an alert that fails its own contract', async () => {
    const { repository, sender, handlerFor } = harness();

    await handlerFor('audit.alert').handle(alertEnvelope([]));

    expect(repository.events[0]).toMatchObject({ processingStatus: 'INVALID', severity: 'WARNING' });
    expect(repository.notifications).toHaveLength(0);
    expect(sender.sent).toHaveLength(0);
  });

  it('keeps the alert out of every holder inbox', async () => {
    const { repository, handlerFor } = harness();

    await handlerFor('audit.alert').handle(alertEnvelope([ALERT]));

    expect(await repository.unreadCountOf(CUSTOMER)).toBe(0);
    expect(repository.notifications.every((notification) => notification.customerId === null)).toBe(
      true,
    );
  });
});
