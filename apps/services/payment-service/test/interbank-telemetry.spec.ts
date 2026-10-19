import { metrics, trace } from '@opentelemetry/api';
import {
  AggregationTemporality,
  InMemoryMetricExporter,
  MeterProvider,
  PeriodicExportingMetricReader,
} from '@opentelemetry/sdk-metrics';
import type { DataPoint } from '@opentelemetry/sdk-metrics';
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';

import {
  CALLBACKS_COUNTER,
  CONFIRMATION_HISTOGRAM,
  DEPOSITS_COUNTER,
  DURATION_HISTOGRAM,
  OtelInterbankSendTelemetry,
  OtelInterbankTelemetry,
  SENT_COUNTER,
  STATE_EVENT,
} from '../src/infrastructure/telemetry/otel-interbank.telemetry';
import { StructuredLogger } from '../src/interfaces/logging';

const spans = new InMemorySpanExporter();
const exporter = new InMemoryMetricExporter(AggregationTemporality.DELTA);
const meter = new MeterProvider({
  readers: [new PeriodicExportingMetricReader({ exporter, exportIntervalMillis: 3_600_000 })],
});

beforeAll(() => {
  trace.setGlobalTracerProvider(
    new BasicTracerProvider({ spanProcessors: [new SimpleSpanProcessor(spans)] }),
  );
  metrics.setGlobalMeterProvider(meter);
});
afterAll(async () => {
  await meter.shutdown();
});
beforeEach(() => {
  spans.reset();
  exporter.reset();
});

async function points(name: string): Promise<readonly DataPoint<unknown>[]> {
  await meter.forceFlush();
  return exporter
    .getMetrics()
    .flatMap((resource) => resource.scopeMetrics)
    .flatMap((scope) => scope.metrics)
    .filter((metric) => metric.descriptor.name === name)
    .flatMap((metric): readonly DataPoint<unknown>[] => metric.dataPoints);
}

function fixture() {
  const lines: Record<string, unknown>[] = [];
  const logger = new StructuredLogger('payment-service', (line) => {
    lines.push(JSON.parse(line) as Record<string, unknown>);
  });
  return { lines, telemetry: new OtelInterbankTelemetry(logger) };
}

const BASE = {
  depositId: 'e9169e99-237a-4c81-9f4e-6e9ae27772ce',
  correlationId: 'fbbce136-7291-4401-a996-5fe231d4b6ce',
  reason: null,
};

describe('incoming interbank telemetry', () => {
  it('counts accepted and rejected deposits under closed result labels', async () => {
    const { telemetry } = fixture();
    telemetry.stateChanged({ ...BASE, stage: 'ACCEPTED', durationMs: 250 });
    telemetry.stateChanged({
      ...BASE,
      stage: 'REJECTED',
      reason: 'ACCOUNT_INACTIVE',
      durationMs: 500,
    });
    const values = (await points(DEPOSITS_COUNTER)).map((point) => ({
      label: point.attributes,
      value: point.value,
    }));
    expect(values).toEqual(
      expect.arrayContaining([
        { label: { result: 'accepted' }, value: 1 },
        { label: { result: 'rejected' }, value: 1 },
      ]),
    );
  });

  it('records decision latency as a histogram in seconds', async () => {
    const { telemetry } = fixture();
    telemetry.stateChanged({ ...BASE, stage: 'ACCEPTED', durationMs: 250 });
    const data = await points(DURATION_HISTOGRAM);
    expect(data).toHaveLength(1);
    expect(data[0]?.attributes).toEqual({ result: 'accepted' });
    expect((data[0]?.value as { sum: number }).sum).toBeCloseTo(0.25);
  });

  it('logs each transition and emits a span event without sensitive fields', () => {
    const { telemetry, lines } = fixture();
    telemetry.stateChanged({ ...BASE, stage: 'ELIGIBILITY', durationMs: null });
    telemetry.stateChanged({ ...BASE, stage: 'CREDIT', durationMs: null });
    expect(lines.map((line) => line.status)).toEqual(['ELIGIBILITY', 'CREDIT']);
    expect(lines.every((line) => line.correlationId === BASE.correlationId)).toBe(true);
    expect(spans.getFinishedSpans().map((span) => span.events[0]?.name)).toEqual([
      STATE_EVENT,
      STATE_EVENT,
    ]);
    expect(spans.getFinishedSpans()[0]?.attributes).toMatchObject({
      'bank.correlation_id': BASE.correlationId,
    });
    expect(
      JSON.stringify(
        spans.getFinishedSpans().map((span) => ({
          attributes: span.attributes,
          events: span.events,
        })),
      ),
    ).not.toMatch(/accountId|amountMinor|token/);
  });

  it('counts callback delivery and failure with no entity label', async () => {
    const { telemetry } = fixture();
    telemetry.callbackAttempt({ correlationId: BASE.correlationId, result: 'failed' });
    telemetry.callbackAttempt({ correlationId: BASE.correlationId, result: 'delivered' });
    const data = await points(CALLBACKS_COUNTER);
    expect(data.map((point) => point.attributes)).toEqual(
      expect.arrayContaining([{ result: 'failed' }, { result: 'delivered' }]),
    );
  });
});

describe('outgoing interbank telemetry (B9)', () => {
  const SEND = {
    correlationId: BASE.correlationId,
    interbankTransferId: BASE.depositId,
    transactionId: '00000000-0000-4000-8000-00000000bbbb',
    reason: null,
  };

  function sendFixture(): OtelInterbankSendTelemetry {
    const logger = new StructuredLogger('payment-service', () => undefined);

    return new OtelInterbankSendTelemetry(logger);
  }

  async function sent(): Promise<Record<string, number>> {
    const out: Record<string, number> = {};
    for (const point of await points(SENT_COUNTER)) {
      const result = String((point.attributes as { result: string }).result);
      out[result] = (out[result] ?? 0) + Number(point.value);
    }

    return out;
  }

  it('counts the timeout when the deposit ENTERS TIMEOUT, so the series is no longer dead', async () => {
    /*
     * Since TD-095 `isSendDecided` excludes TIMEOUT, so `result="timeout"` never
     * incremented and the assignment's "number of timeouts" read empty.
     */
    const telemetry = sendFixture();

    telemetry.stateChanged({ ...SEND, state: 'TIMEOUT', from: 'SENT', durationMs: null });

    expect(await sent()).toEqual({ timeout: 1 });
    // A timeout has no confirmation latency: its duration is the deadline.
    expect(await points(CONFIRMATION_HISTOGRAM)).toHaveLength(0);
  });

  it('does not count a deposit twice when a timeout later resolves', async () => {
    const telemetry = sendFixture();

    telemetry.stateChanged({ ...SEND, state: 'TIMEOUT', from: 'SENT', durationMs: null });
    telemetry.stateChanged({ ...SEND, state: 'ACCEPTED', from: 'TIMEOUT', durationMs: 200_000 });

    // One deposit, one count: the success-rate denominator stays honest.
    expect(await sent()).toEqual({ timeout: 1 });
  });

  it('still counts a normal accepted and rejected, with their latency', async () => {
    const telemetry = sendFixture();

    telemetry.stateChanged({ ...SEND, state: 'ACCEPTED', from: 'SENT', durationMs: 2_000 });
    telemetry.stateChanged({ ...SEND, state: 'REJECTED', from: 'SENT', reason: 'X', durationMs: 1_000 });

    expect(await sent()).toEqual({ accepted: 1, rejected: 1 });
    expect(await points(CONFIRMATION_HISTOGRAM)).toHaveLength(2);
  });

  it('does not count in-flight states or the REVERSED evidence', async () => {
    const telemetry = sendFixture();

    for (const [state, from] of [
      ['PENDING', null],
      ['SENT', 'PENDING'],
      ['REVERSED', 'REJECTED'],
    ] as const) {
      telemetry.stateChanged({ ...SEND, state, from, durationMs: null });
    }

    expect(await sent()).toEqual({});
  });
});
