import { metrics, trace } from '@opentelemetry/api';
import {
  AggregationTemporality,
  InMemoryMetricExporter,
  MeterProvider,
  PeriodicExportingMetricReader,
} from '@opentelemetry/sdk-metrics';
import type { DataPoint, HistogramMetricData, SumMetricData } from '@opentelemetry/sdk-metrics';
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';

import { SimulationUseCase } from '../src/application/manage-simulation.use-case';
import { ProcessPaymentUseCase } from '../src/application/process-payment.use-case';
import { quetzales } from '../src/domain/money';
import type { SimulationSettings } from '../src/domain/simulation';
import {
  CALLS_COUNTER,
  CALL_SPAN,
  CHANGES_COUNTER,
  DURATION_BUCKETS_S,
  DURATION_HISTOGRAM,
  OtelProviderTelemetry,
  SIMULATED_FAILURE_EVENT,
} from '../src/infrastructure/telemetry/otel-provider.telemetry';
import { StructuredLogger } from '../src/interfaces/logging';
import { FakeRepository, RecordingPublisher, clockFrom } from './support/in-memory';

/**
 * T-44: the simulated provider, observed.
 *
 * Everything here runs against **real** OpenTelemetry SDK providers with
 * in-memory exporters, and through the real use cases. The API is a no-op
 * without an SDK, so a test that only checked "the payment still works" would
 * pass against code that emitted nothing.
 */

const NOW = new Date('2026-10-05T12:00:00.000Z');
const PAYMENT_ID = '11111111-1111-4111-8111-111111111111';
const TRANSACTION_ID = '22222222-2222-4222-8222-222222222222';
const CORRELATION = '33333333-3333-4333-8333-333333333333';
const ADMIN = { customerId: '77777777-7777-4777-8777-777777777701', role: 'ADMINISTRADOR' as const };
const NOTHING: SimulationSettings = { failureRatePercent: 0, timeoutRatePercent: 0, latencyMs: 0 };

const spans = new InMemorySpanExporter();
const metricExporter = new InMemoryMetricExporter(AggregationTemporality.DELTA);
const meterProvider = new MeterProvider({
  readers: [
    new PeriodicExportingMetricReader({ exporter: metricExporter, exportIntervalMillis: 3_600_000 }),
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

beforeEach(() => {
  spans.reset();
  metricExporter.reset();
});

/** The data points of one metric, merged across every export since the last reset. */
async function pointsOf(name: string): Promise<readonly DataPoint<unknown>[]> {
  await meterProvider.forceFlush();

  return metricExporter
    .getMetrics()
    .flatMap((resource) => resource.scopeMetrics)
    .flatMap((scope) => scope.metrics)
    .filter((metric) => metric.descriptor.name === name)
    .flatMap((metric): readonly DataPoint<unknown>[] => metric.dataPoints);
}

function build(defaults: SimulationSettings, rolls: number[] = []) {
  const lines: Record<string, unknown>[] = [];
  const logger = new StructuredLogger('payment-service', (line) => {
    lines.push(JSON.parse(line) as Record<string, unknown>);
  });
  const telemetry = new OtelProviderTelemetry(logger);
  const repository = new FakeRepository();
  const clock = clockFrom(NOW);
  const simulation = new SimulationUseCase({ repository, defaults, clock, telemetry });
  const payments = new ProcessPaymentUseCase({
    repository,
    clock,
    ids: { next: () => 'provider-ref' },
    delays: [1_000, 5_000, 30_000],
    simulation,
    random: { next: () => rolls.shift() ?? 0.5 },
    sleeper: {
      sleep: async (milliseconds: number) => {
        clock.advance(milliseconds);
        await Promise.resolve();
      },
    },
    telemetry,
  });

  return { lines, payments, simulation, repository, publisher: new RecordingPublisher() };
}

const ORDER = {
  paymentId: PAYMENT_ID,
  transactionId: TRANSACTION_ID,
  amount: quetzales(25_000),
  scenario: null,
  originCorrelationId: CORRELATION,
};

const labelsOf = (points: readonly { attributes: Record<string, unknown> }[]): string[] =>
  points.map((point) => JSON.stringify(point.attributes)).sort();

describe('the calls counter, which is the failure rate', () => {
  it('counts each call under the result the provider gave', async () => {
    const { payments, publisher } = build({ ...NOTHING, failureRatePercent: 50, timeoutRatePercent: 25 }, [0.9, 0.3, 0.1]);

    await payments.open(ORDER, publisher);
    await payments.open({ ...ORDER, paymentId: '99999999-9999-4999-8999-999999999991' }, publisher);
    await payments.open({ ...ORDER, paymentId: '99999999-9999-4999-8999-999999999992' }, publisher);

    const points = (await pointsOf(CALLS_COUNTER)) as SumMetricData['dataPoints'];
    const byResult = Object.fromEntries(points.map((point) => [String(point.attributes.result), point.value]));

    // rolls: 0.9 succeeds, 0.3 fails (25–75 %), 0.1 times out (< 25 %).
    expect(byResult).toEqual({ success: 1, failure: 1, timeout: 1 });
  });

  it('tells a scripted failure from one the dial produced, with nothing else as a label', async () => {
    const { payments, publisher } = build({ ...NOTHING, failureRatePercent: 100 });

    await payments.open(ORDER, publisher);
    await payments.open({ ...ORDER, paymentId: '99999999-9999-4999-8999-999999999991', scenario: 'REJECT' }, publisher);

    const points = (await pointsOf(CALLS_COUNTER)) as SumMetricData['dataPoints'];

    expect(labelsOf(points)).toEqual([
      JSON.stringify({ result: 'failure', source: 'configuration' }),
      JSON.stringify({ result: 'failure', source: 'scenario' }),
    ]);
  });

  it('never carries an identifier as a label', async () => {
    const { payments, publisher } = build({ ...NOTHING, failureRatePercent: 100 });

    await payments.open(ORDER, publisher);

    for (const name of [CALLS_COUNTER, DURATION_HISTOGRAM]) {
      const serialised = JSON.stringify(await pointsOf(name));

      expect(serialised).not.toContain(PAYMENT_ID);
      expect(serialised).not.toContain(TRANSACTION_ID);
      expect(serialised).not.toContain(CORRELATION);
    }
  });
});

describe('the duration histogram, which is the p95 of the simulated provider', () => {
  it('is a histogram in seconds with buckets that reach the contract’s ceiling', async () => {
    const { payments, publisher } = build({ ...NOTHING, latencyMs: 750 });

    await payments.open(ORDER, publisher);

    const [point] = (await pointsOf(DURATION_HISTOGRAM)) as HistogramMetricData['dataPoints'];

    expect(point!.value.count).toBe(1);
    expect(point!.value.sum).toBeCloseTo(0.75, 5);
    expect(point!.value.buckets.boundaries).toEqual(DURATION_BUCKETS_S);
    expect(Math.max(...DURATION_BUCKETS_S)).toBe(30);
  });

  it('puts the answer in the bucket its latency belongs to, so a percentile can be read', async () => {
    const { payments, publisher } = build({ ...NOTHING, latencyMs: 750 });

    await payments.open(ORDER, publisher);

    const [point] = (await pointsOf(DURATION_HISTOGRAM)) as HistogramMetricData['dataPoints'];
    const { boundaries, counts } = point!.value.buckets;
    const index = counts.findIndex((count) => count === 1);

    // 0.75 s falls in (0.5, 1].
    expect(boundaries[index - 1]).toBe(0.5);
    expect(boundaries[index]).toBe(1);
  });

  it('is labelled only by result', async () => {
    const { payments, publisher } = build({ ...NOTHING, failureRatePercent: 100, latencyMs: 100 });

    await payments.open(ORDER, publisher);

    const points = (await pointsOf(DURATION_HISTOGRAM)) as HistogramMetricData['dataPoints'];

    expect(labelsOf(points)).toEqual([JSON.stringify({ result: 'failure' })]);
  });

  it('is the only latency metric, and nothing is an average', async () => {
    const { payments, publisher } = build({ ...NOTHING, latencyMs: 100 });

    await payments.open(ORDER, publisher);
    await meterProvider.forceFlush();

    const names = metricExporter
      .getMetrics()
      .flatMap((resource) => resource.scopeMetrics)
      .flatMap((scope) => scope.metrics)
      .map((metric) => metric.descriptor.name);

    expect(names.filter((name) => /avg|average|mean/i.test(name))).toEqual([]);
    expect(names).toContain(DURATION_HISTOGRAM);
  });
});

describe('the span of a provider call', () => {
  it('is one span per attempt, carrying the correlation and what decided the answer', async () => {
    const { payments, publisher } = build({ ...NOTHING, failureRatePercent: 100 });

    await payments.open(ORDER, publisher);

    const [span] = spans.getFinishedSpans();

    expect(span!.name).toBe(CALL_SPAN);
    expect(span!.attributes).toMatchObject({
      'bank.correlation_id': CORRELATION,
      'bank.payment.attempt': 1,
      'bank.payment.provider.result': 'failure',
      'bank.payment.provider.source': 'configuration',
      'bank.payment.error_type': 'TRANSIENT',
      'bank.payment.will_retry': true,
    });
  });

  it('carries a simulated_failure event for a failure and for a timeout, and none for a success', async () => {
    const failing = build({ ...NOTHING, failureRatePercent: 100 });
    await failing.payments.open(ORDER, failing.publisher);

    const timing = build({ ...NOTHING, timeoutRatePercent: 100 });
    await timing.payments.open({ ...ORDER, paymentId: '99999999-9999-4999-8999-999999999991' }, timing.publisher);

    const fine = build(NOTHING);
    await fine.payments.open({ ...ORDER, paymentId: '99999999-9999-4999-8999-999999999992' }, fine.publisher);

    const [failure, timeout, success] = spans.getFinishedSpans();

    expect(failure!.events.map((event) => event.name)).toEqual([SIMULATED_FAILURE_EVENT]);
    expect(timeout!.events.map((event) => event.name)).toEqual([SIMULATED_FAILURE_EVENT]);
    expect(timeout!.events[0]!.attributes).toMatchObject({ 'bank.payment.provider.result': 'timeout' });
    expect(success!.events).toEqual([]);
  });

  it('numbers every rung of the ladder as a span of its own', async () => {
    const { payments, publisher, repository } = build({ ...NOTHING, failureRatePercent: 100 });

    await payments.open(ORDER, publisher);

    for (let rung = 0; rung < 3; rung += 1) {
      await payments.retry((await repository.findById(PAYMENT_ID))!, publisher);
    }

    const attempts = spans.getFinishedSpans().map((span) => span.attributes['bank.payment.attempt']);
    const retries = spans.getFinishedSpans().map((span) => span.attributes['bank.payment.will_retry']);

    expect(attempts).toEqual([1, 2, 3, 4]);
    expect(retries).toEqual([true, true, true, false]);
  });
});

describe('the log of a simulated failure', () => {
  it('is marked simulated, and says who decided it', async () => {
    const { payments, publisher, lines } = build({ ...NOTHING, failureRatePercent: 100 });

    await payments.open(ORDER, publisher);

    const failure = lines.find((line) => line.message === 'simulated provider failure');

    expect(failure).toMatchObject({
      level: 'warn',
      service: 'payment-service',
      correlationId: CORRELATION,
      transactionId: TRANSACTION_ID,
      paymentId: PAYMENT_ID,
      attempt: 1,
      providerResult: 'FAILURE',
      errorType: 'TRANSIENT',
      simulated: true,
      source: 'configuration',
      outcome: 'retrying',
    });
  });

  it('says exhausted on the last rung, and marks a scripted failure simulated too', async () => {
    const { payments, publisher, lines } = build(NOTHING);

    await payments.open({ ...ORDER, scenario: 'REJECT' }, publisher);

    expect(lines.find((line) => line.message === 'simulated provider failure')).toMatchObject({
      simulated: true,
      source: 'scenario',
      outcome: 'exhausted',
      errorType: 'PERMANENT',
    });
  });

  it('is a log of a success, still marked simulated, when the provider answers', async () => {
    const { payments, publisher, lines } = build(NOTHING);

    await payments.open(ORDER, publisher);

    expect(lines.find((line) => line.message === 'provider answered')).toMatchObject({
      level: 'info',
      simulated: true,
      outcome: 'success',
    });
  });

  it('carries the trace and span ids of the call it describes', async () => {
    const { payments, publisher, lines } = build({ ...NOTHING, failureRatePercent: 100 });

    await payments.open(ORDER, publisher);

    const [span] = spans.getFinishedSpans();
    const failure = lines.find((line) => line.message === 'simulated provider failure');

    expect(failure).toMatchObject({
      traceId: span!.spanContext().traceId,
      spanId: span!.spanContext().spanId,
    });
  });

  it('keeps every field a person could be identified by out of the line, the span and the labels', async () => {
    const { payments, publisher, lines } = build({ ...NOTHING, failureRatePercent: 100 });

    await payments.open(ORDER, publisher);

    const everything = JSON.stringify([
      lines,
      spans.getFinishedSpans().map((span) => span.attributes),
      await pointsOf(CALLS_COUNTER),
    ]);

    expect(everything).not.toMatch(/email|document|password|token|photo|fotograf/i);
    // No amount either: what was paid is the transfer's business, not the provider's.
    expect(everything).not.toContain('25000');
  });
});

describe('changing the simulation', () => {
  it('is counted by action, and logged with the numbers that took effect', async () => {
    const { simulation, publisher, lines } = build(NOTHING);

    await simulation.update({
      command: { failureRatePercent: 40, timeoutRatePercent: 10, latencyMs: 300 },
      identity: ADMIN,
      correlationId: CORRELATION,
      publisher,
    });
    await simulation.update({ command: { reset: true }, identity: ADMIN, correlationId: CORRELATION, publisher });

    const points = (await pointsOf(CHANGES_COUNTER)) as SumMetricData['dataPoints'];

    expect(labelsOf(points)).toEqual([
      JSON.stringify({ action: 'reset' }),
      JSON.stringify({ action: 'update' }),
    ]);

    expect(lines.find((line) => line.message === 'provider simulation update')).toMatchObject({
      correlationId: CORRELATION,
      failureRatePercent: 40,
      timeoutRatePercent: 10,
      latencyMs: 300,
    });
  });
});
