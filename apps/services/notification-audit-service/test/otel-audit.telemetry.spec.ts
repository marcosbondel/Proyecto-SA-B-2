import { alertSloReceivedV1, createEnvelope } from '@bank/contracts';
import type { MessageEnvelope } from '@bank/contracts';
import { metrics, trace } from '@opentelemetry/api';
import {
  AggregationTemporality,
  InMemoryMetricExporter,
  MeterProvider,
  PeriodicExportingMetricReader,
} from '@opentelemetry/sdk-metrics';
import type { SumMetricData } from '@opentelemetry/sdk-metrics';
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';

import { RecordEventUseCase } from '../src/application/record-event.use-case';
import {
  ALERTS_COUNTER,
  EVENTS_COUNTER,
  NOTIFICATIONS_COUNTER,
  OtelAuditTelemetry,
  SPAN_NAME,
  familyOf,
} from '../src/infrastructure/telemetry/otel-audit.telemetry';
import { StructuredLogger } from '../src/interfaces/logging';
import { RecordEventHandler } from '../src/interfaces/message-handlers';
import {
  CountingIds,
  FixedClock,
  InMemoryAuditRepository,
  RecordingSender,
} from './support/in-memory';

/**
 * T-45's own telemetry — what the audit trail reports about itself — checked
 * with a real SDK and in-memory exporters, as the ticket's conventions ask: a
 * no-op API must not be able to hide a defect, so the spans and the counters are
 * read back from what an SDK actually recorded.
 */

const spans = new InMemorySpanExporter();
const metricExporter = new InMemoryMetricExporter(AggregationTemporality.DELTA);
const meterProvider = new MeterProvider({
  readers: [
    new PeriodicExportingMetricReader({
      exporter: metricExporter,
      // Never fires on its own: the tests flush explicitly.
      exportIntervalMillis: 3_600_000,
    }),
  ],
});

beforeAll(() => {
  trace.setGlobalTracerProvider(
    new BasicTracerProvider({ spanProcessors: [new SimpleSpanProcessor(spans)] }),
  );
  metrics.setGlobalMeterProvider(meterProvider);
});

afterAll(async () => {
  await meterProvider.shutdown();
});

beforeEach(async () => {
  await meterProvider.forceFlush();
  spans.reset();
  metricExporter.reset();
});

const CORRELATION = '7d41e8b2-9a3f-4c15-8ee0-1b2f9a4c7d10';
const ACCOUNT = '5a1b2c3d-4e5f-4a6b-8c7d-8e9f0a1b2c3d';
const CUSTOMER = '3f2a1c04-9c2e-4a71-b8f5-2d6e7c0a1b93';

function build() {
  const repository = new InMemoryAuditRepository();
  const sender = new RecordingSender();
  const record = new RecordEventUseCase({
    repository,
    sender,
    clock: new FixedClock(),
    ids: new CountingIds(),
    telemetry: new OtelAuditTelemetry(),
  });
  const handler = (consumer: string) =>
    new RecordEventHandler(record, consumer, new StructuredLogger('test', () => {}));

  return { repository, sender, handler };
}

async function collected(name: string) {
  await meterProvider.forceFlush();

  const points = metricExporter
    .getMetrics()
    .flatMap((resource) => resource.scopeMetrics)
    .flatMap((scope) => scope.metrics)
    .filter((metric) => metric.descriptor.name === name)
    .flatMap((metric) => (metric as SumMetricData).dataPoints);

  return points.map((point) => ({ attributes: point.attributes, value: point.value }));
}

const anomaly = (overrides: Record<string, unknown> = {}): MessageEnvelope<unknown> =>
  createEnvelope(
    {
      accountId: ACCOUNT,
      customerId: CUSTOMER,
      accountType: 'AHORRO',
      rule: 'HIGH_FREQUENCY',
      operationCount: 11,
      threshold: 10,
      windowMinutes: 5,
      windowStart: '2026-10-05T17:55:00.000Z',
      detectedAt: '2026-10-05T18:00:00.000Z',
      ...overrides,
    },
    {
      messageType: 'account.anomaly.detected.v1',
      producer: 'account-service',
      identity: null,
      correlationId: CORRELATION,
    },
  );

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

const ALERT = {
  alertName: 'GatewayAvailabilityBurnRate',
  status: 'firing',
  severity: 'critical',
  startsAt: '2026-10-05T18:00:00.000Z',
};

describe('recording an event', () => {
  it('opens a span that carries the correlation id, the severity and how it ended', async () => {
    const { handler } = build();

    await handler('audit.account').handle(anomaly());

    const [span] = spans.getFinishedSpans();

    expect(span?.name).toBe(SPAN_NAME);
    expect(span?.attributes).toMatchObject({
      'bank.audit.message_type': 'account.anomaly.detected.v1',
      'bank.audit.severity': 'WARNING',
      'bank.audit.processing_status': 'PROCESSED',
      'bank.audit.outcome': 'RECORDED',
      'bank.audit.notification': 'SENT',
      'bank.correlation_id': CORRELATION,
    });
  });

  it('counts the event by family, severity and outcome — and by nothing that names an entity', async () => {
    const { handler } = build();

    await handler('audit.account').handle(anomaly());

    const points = await collected(EVENTS_COUNTER);

    expect(points).toEqual([
      {
        attributes: {
          family: 'account',
          severity: 'WARNING',
          outcome: 'recorded',
          processing: 'processed',
        },
        value: 1,
      },
    ]);
  });

  it('counts a redelivery as a duplicate and never as a second event', async () => {
    const { handler } = build();
    const envelope = anomaly();

    await handler('audit.account').handle(envelope);
    await handler('audit.account').handle(envelope);

    const points = await collected(EVENTS_COUNTER);
    const byOutcome = Object.fromEntries(points.map((p) => [p.attributes.outcome, p.value]));

    expect(byOutcome).toEqual({ recorded: 1, duplicate: 1 });
  });

  it('counts an unreadable message as invalid, at WARNING', async () => {
    const { handler } = build();

    await handler('audit.account').handle(anomaly({ accountId: 'not-a-uuid' }));

    const [point] = await collected(EVENTS_COUNTER);

    expect(point?.attributes).toMatchObject({ processing: 'invalid', severity: 'WARNING' });
  });

  it('never carries an identifier as a label', async () => {
    const { handler } = build();

    await handler('audit.account').handle(anomaly());
    await handler('audit.alert').handle(alertEnvelope([ALERT]));

    for (const name of [EVENTS_COUNTER, NOTIFICATIONS_COUNTER, ALERTS_COUNTER]) {
      for (const point of await collected(name)) {
        const labels = JSON.stringify(point.attributes);

        for (const identifier of [CORRELATION, ACCOUNT, CUSTOMER, 'GatewayAvailabilityBurnRate']) {
          expect(labels).not.toContain(identifier);
        }
      }
    }
  });
});

describe('the notifications the service decided on', () => {
  it('counts one that was sent, with the severity of the event that caused it', async () => {
    const { handler } = build();

    await handler('audit.account').handle(anomaly());

    expect(await collected(NOTIFICATIONS_COUNTER)).toEqual([
      { attributes: { severity: 'WARNING', result: 'sent' }, value: 1 },
    ]);
  });

  it('counts one that failed to send as failed', async () => {
    const { handler, sender } = build();

    sender.failNext();
    await handler('audit.account').handle(anomaly());

    const [point] = await collected(NOTIFICATIONS_COUNTER);

    expect(point?.attributes).toMatchObject({ result: 'failed' });
  });

  it('counts the second announcement of the same anomaly as suppressed, not as a notification sent', async () => {
    const { handler } = build();

    await handler('audit.account').handle(anomaly());
    await handler('audit.account').handle(anomaly());

    const byResult = Object.fromEntries(
      (await collected(NOTIFICATIONS_COUNTER)).map((p) => [p.attributes.result, p.value]),
    );

    expect(byResult).toEqual({ sent: 1, suppressed: 1 });
  });

  it('counts nothing for an event that calls for no notification', async () => {
    const { handler } = build();

    await handler('audit.transaction').handle(
      createEnvelope(
        {
          transactionId: '9f2a41c7-4d7b-4f0e-9c1e-0242ac120002',
          sourceAccount: '11111111-4d7b-4f0e-9c1e-0242ac120001',
          targetAccount: '22222222-4d7b-4f0e-9c1e-0242ac120002',
          amount: { amountMinor: 10_000, currency: 'GTQ' },
          initiatedAt: '2026-10-05T18:00:00.000Z',
        },
        {
          messageType: 'transaction.initiated.v1',
          producer: 'transaction-service',
          identity: null,
          correlationId: CORRELATION,
        },
      ),
    );

    expect(await collected(NOTIFICATIONS_COUNTER)).toEqual([]);
  });
});

describe('the SLO alerts', () => {
  it('counts each alert of a batch by state and severity', async () => {
    const { handler } = build();

    await handler('audit.alert').handle(
      alertEnvelope([
        ALERT,
        { ...ALERT, severity: 'warning' },
        { ...ALERT, status: 'resolved' },
        { ...ALERT, status: 'resolved' },
      ]),
    );

    const counted = (await collected(ALERTS_COUNTER))
      .map((p) => `${String(p.attributes.status)}/${String(p.attributes.severity)}=${String(p.value)}`)
      .sort();

    expect(counted).toEqual(['firing/critical=1', 'firing/warning=1', 'resolved/critical=2']);
  });

  it('counts the batch as one event of the alert family, at the severity of its worst alert', async () => {
    const { handler } = build();

    await handler('audit.alert').handle(alertEnvelope([ALERT, { ...ALERT, status: 'resolved' }]));

    const [point] = await collected(EVENTS_COUNTER);

    expect(point).toMatchObject({
      attributes: { family: 'alert', severity: 'ERROR' },
      value: 1,
    });
  });

  it('counts no alert from a batch it could not read', async () => {
    const { handler } = build();

    await handler('audit.alert').handle(alertEnvelope([{ ...ALERT, severity: 'catastrophic' }]));

    expect(await collected(ALERTS_COUNTER)).toEqual([]);
  });
});

describe('the family of a message', () => {
  it.each([
    ['customer.registered.v1', 'customer'],
    ['account.anomaly.detected.v1', 'account'],
    ['transaction.completed.v1', 'transaction'],
    ['payment.failed.v1', 'payment'],
    ['alert.slo.received.v1', 'alert'],
  ])('is the first word of %s', (messageType, family) => {
    expect(familyOf(messageType)).toBe(family);
  });

  it('is `other` for anything nobody anticipated, so a stray name cannot mint a time series', () => {
    expect(familyOf('unicorn.appeared.v1')).toBe('other');
    expect(familyOf('')).toBe('other');
  });
});
