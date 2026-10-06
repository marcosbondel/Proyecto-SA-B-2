import { metrics, trace } from '@opentelemetry/api';
import {
  AggregationTemporality,
  InMemoryMetricExporter,
  MeterProvider,
  PeriodicExportingMetricReader,
} from '@opentelemetry/sdk-metrics';
import type { HistogramMetricData, SumMetricData } from '@opentelemetry/sdk-metrics';
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import type { ReadableSpan } from '@opentelemetry/sdk-trace-base';

import { AdvanceSagaUseCase } from '../src/application/advance-saga.use-case';
import { RecordPaymentAttemptUseCase } from '../src/application/record-payment-attempt.use-case';
import { RequestTransferUseCase } from '../src/application/request-transfer.use-case';
import type { SagaEvent } from '../src/domain/transaction';
import { quetzales } from '../src/domain/money';
import {
  COMPENSATION_COMPLETED_SPAN,
  COMPENSATION_ORDERED_SPAN,
  DURATION_BUCKETS_S,
  DURATION_HISTOGRAM,
  FINISHED_COUNTER,
  OtelTransferTelemetry,
  PAYMENT_ATTEMPT_SPAN,
  ROOT_SPAN,
  STARTED_COUNTER,
  TRANSFER_SPAN,
} from '../src/infrastructure/telemetry/otel-transfer.telemetry';
import { StructuredLogger } from '../src/interfaces/logging';
import {
  FixedClock,
  InMemoryTransactionRepository,
  RecordingPublisher,
  SequentialIds,
} from './support/in-memory';

/**
 * T-43: a transfer, observed.
 *
 * Everything here runs against **real** OpenTelemetry SDK providers with
 * in-memory exporters, and through the real use cases and the same state
 * machine production uses. The API is a no-op without an SDK, so a test that
 * only checked "the Saga still works" would pass against code that emitted
 * nothing — exactly the defect these tests exist to catch.
 */

const T0 = new Date('2026-10-04T16:00:00.000Z');
const SECOND = 1_000;
const SOURCE = '11111111-1111-4111-8111-111111111111';
const TARGET = '22222222-2222-4222-8222-222222222222';
const TRANSACTION = '33333333-3333-4333-8333-333333333333';
const PAYMENT = '44444444-4444-4444-8444-444444444401';
const CORRELATION = '55555555-5555-4555-8555-555555555555';
const OWNER = { customerId: '77777777-7777-4777-8777-777777777701', role: 'CLIENTE' as const };

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
  // Unflushed measurements from the previous test would otherwise land in this
  // one's first collection: the reader holds them until somebody asks.
  await meterProvider.forceFlush();
  spans.reset();
  metricExporter.reset();
});

function world(options: { failingLog?: boolean } = {}) {
  const lines: string[] = [];
  const logger = new StructuredLogger('transaction-service', (line) => lines.push(line));
  const repository = new InMemoryTransactionRepository();
  const publisher = new RecordingPublisher();
  const clock = new FixedClock(T0);
  const ids = new SequentialIds();
  const log = options.failingLog
    ? {
        info: (): never => {
          throw new Error('log sink is down');
        },
        error: (): void => undefined,
      }
    : logger;
  const telemetry = new OtelTransferTelemetry(log);
  const saga = new AdvanceSagaUseCase({ repository, publisher, clock, ids, telemetry });
  const request = new RequestTransferUseCase({ repository, publisher, saga, clock, telemetry });
  const attempts = new RecordPaymentAttemptUseCase({ repository, telemetry });

  let counter = 0;

  const transfer = async (
    overrides: { occurredAt?: string; idempotencyKey?: string; transactionId?: string } = {},
  ) =>
    await request.execute(
      {
        transactionId: overrides.transactionId ?? TRANSACTION,
        sourceAccount: SOURCE,
        targetAccount: TARGET,
        amount: quetzales(15_000),
      },
      {
        messageId: `request-${String(counter++)}`,
        correlationId: CORRELATION,
        idempotencyKey: overrides.idempotencyKey ?? 'transfer-key-1',
        identity: OWNER,
        occurredAt: overrides.occurredAt ?? T0.toISOString(),
      },
    );

  /** Delivers one Saga event, `afterSeconds` after the transfer was requested. */
  const deliver = async (event: SagaEvent, afterSeconds: number, messageId?: string) => {
    clock.advance(T0.getTime() + afterSeconds * SECOND - clock.now().getTime());

    return await saga.execute({
      transactionId: TRANSACTION,
      event,
      messageId: messageId ?? `event-${String(counter++)}`,
      messageType: 'test.event',
      payload: {},
    });
  };

  return { lines, repository, clock, saga, attempts, transfer, deliver };
}

/** Accepted, KYC approved, debited, paid and credited: 2.5 s from request to completion. */
async function completedTransfer(w: ReturnType<typeof world>): Promise<void> {
  await w.transfer();
  await w.deliver({ kind: 'KYC_APPROVED' }, 0.5);
  await w.deliver({ kind: 'DEBITED' }, 1);
  await w.deliver({ kind: 'PAYMENT_SUCCEEDED' }, 2);
  await w.deliver({ kind: 'CREDITED' }, 2.5);
}

/** The payment is refused, the debit is returned: 3 s from request to compensation. */
async function compensatedTransfer(w: ReturnType<typeof world>): Promise<void> {
  await w.transfer();
  await w.deliver({ kind: 'KYC_APPROVED' }, 0.5);
  await w.deliver({ kind: 'DEBITED' }, 1);
  await w.deliver({ kind: 'PAYMENT_FAILED', reason: 'PAYMENT_DECLINED' }, 2);
  await w.deliver({ kind: 'DEBIT_COMPENSATED' }, 3);
}

async function collected() {
  await meterProvider.forceFlush();

  return metricExporter
    .getMetrics()
    .flatMap((resource) => resource.scopeMetrics)
    .flatMap((scope) => scope.metrics);
}

/** The labels of every data point, without the time each one covers. */
const labelsOfMetrics = (all: Awaited<ReturnType<typeof collected>>) =>
  all.flatMap((metric) => metric.dataPoints.map((point) => point.attributes));

const sumOf = (all: Awaited<ReturnType<typeof collected>>, name: string) =>
  all.find((metric) => metric.descriptor.name === name) as SumMetricData | undefined;

const histogramOf = (all: Awaited<ReturnType<typeof collected>>) =>
  all.find((metric) => metric.descriptor.name === DURATION_HISTOGRAM) as
    | HistogramMetricData
    | undefined;

const names = () => spans.getFinishedSpans().map((span) => span.name);
const byName = (name: string): ReadableSpan =>
  spans.getFinishedSpans().find((span) => span.name === name)!;
const millis = (time: [number, number]): number => time[0] * 1_000 + time[1] / 1_000_000;

describe('opening the transfer', () => {
  it('opens a root span, counts the transfer as started and stores the trace with the row', async () => {
    const w = world();

    await w.transfer();

    const root = byName(ROOT_SPAN);
    expect(root.attributes).toMatchObject({
      'bank.transfer.id': TRANSACTION,
      'bank.transfer.status': 'PENDING',
      'bank.transfer.phase_status': 'PENDING',
      'bank.correlation_id': CORRELATION,
    });

    // What the row holds is exactly the context a later step will join.
    const stored = w.repository.observations.get(TRANSACTION);
    expect(stored?.traceContext).toBe(
      `00-${root.spanContext().traceId}-${root.spanContext().spanId}-01`,
    );

    const started = sumOf(await collected(), STARTED_COUNTER);
    expect(started?.descriptor.unit).toBe('{transfer}');
    expect(started?.dataPoints[0]?.value).toBe(1);
  });

  it('records the request’s own timestamp as the start of the latency', async () => {
    const w = world();
    const requested = new Date(T0.getTime() - 400);

    await w.transfer({ occurredAt: requested.toISOString() });

    expect(w.repository.observations.get(TRANSACTION)?.requestedAt.toISOString()).toBe(
      requested.toISOString(),
    );
  });

  it('does not count a retry of a transfer that already exists', async () => {
    const w = world();

    await w.transfer();
    await w.transfer({ transactionId: '99999999-9999-4999-8999-999999999999' });

    const roots = spans.getFinishedSpans().filter((span) => span.name === ROOT_SPAN);
    expect(roots).toHaveLength(2);
    expect(roots.filter((span) => span.attributes['bank.transfer.duplicate'] === true)).toHaveLength(1);
    expect(sumOf(await collected(), STARTED_COUNTER)?.dataPoints[0]?.value).toBe(1);
  });
});

describe('a completed transfer', () => {
  it('has a span for every step, all in the trace the request opened', async () => {
    const w = world();
    await completedTransfer(w);

    expect(names()).toEqual([
      ROOT_SPAN,
      'saga.step KYC_CHECK_ORDERED',
      'saga.step KYC_APPROVED',
      'saga.step DEBITED',
      'saga.step PAYMENT_SUCCEEDED',
      'saga.step CREDITED',
      TRANSFER_SPAN,
    ]);

    const root = byName(ROOT_SPAN);
    for (const span of spans.getFinishedSpans().filter((candidate) => candidate !== root)) {
      expect(span.spanContext().traceId).toBe(root.spanContext().traceId);
      expect(span.parentSpanContext?.spanId).toBe(root.spanContext().spanId);
    }
  });

  it('describes each step with where it came from, where it went and what it ordered', async () => {
    const w = world();
    await completedTransfer(w);

    expect(byName('saga.step KYC_APPROVED').attributes).toMatchObject({
      'bank.saga.event': 'KYC_APPROVED',
      'bank.transfer.from_status': 'PENDING',
      'bank.transfer.status': 'DEBITING',
      'bank.transfer.phase_status': 'PENDING',
      'bank.saga.command': 'DEBIT',
      'bank.correlation_id': CORRELATION,
    });
    expect(byName('saga.step CREDITED').attributes).toMatchObject({
      'bank.transfer.status': 'COMPLETED',
      'bank.transfer.phase_status': 'APPROVED',
    });
  });

  it('closes with a transfer span covering the whole duration, with PENDING and APPROVED as events', async () => {
    const w = world();
    await completedTransfer(w);

    const span = byName(TRANSFER_SPAN);

    expect(millis(span.startTime)).toBe(T0.getTime());
    expect(millis(span.endTime)).toBe(T0.getTime() + 2.5 * SECOND);
    expect(span.events.map((event) => event.name)).toEqual(['PENDING', 'APPROVED']);
    expect(millis(span.events[0]!.time)).toBe(T0.getTime());
    expect(millis(span.events[1]!.time)).toBe(T0.getTime() + 2.5 * SECOND);
    expect(span.attributes).toMatchObject({
      'bank.transfer.id': TRANSACTION,
      'bank.transfer.status': 'COMPLETED',
      'bank.transfer.phase_status': 'APPROVED',
      'bank.transfer.duration_ms': 2_500,
      'bank.correlation_id': CORRELATION,
    });
  });

  it('has no compensation span', async () => {
    const w = world();
    await completedTransfer(w);

    expect(names()).not.toContain(COMPENSATION_ORDERED_SPAN);
    expect(names()).not.toContain(COMPENSATION_COMPLETED_SPAN);
  });
});

describe('a compensated transfer', () => {
  it('is told apart from a completed one by its spans alone', async () => {
    const w = world();
    await compensatedTransfer(w);

    expect(names()).toEqual([
      ROOT_SPAN,
      'saga.step KYC_CHECK_ORDERED',
      'saga.step KYC_APPROVED',
      'saga.step DEBITED',
      COMPENSATION_ORDERED_SPAN,
      COMPENSATION_COMPLETED_SPAN,
      TRANSFER_SPAN,
    ]);
    expect(names()).not.toContain('saga.step CREDITED');
  });

  it('shows why the compensation was ordered, and that the debit was returned', async () => {
    const w = world();
    await compensatedTransfer(w);

    expect(byName(COMPENSATION_ORDERED_SPAN).attributes).toMatchObject({
      'bank.saga.event': 'PAYMENT_FAILED',
      'bank.saga.command': 'COMPENSATION',
      'bank.transfer.failure_reason': 'PAYMENT_DECLINED',
      'bank.transfer.phase_status': 'PENDING',
    });
    expect(byName(COMPENSATION_COMPLETED_SPAN).attributes).toMatchObject({
      'bank.saga.event': 'DEBIT_COMPENSATED',
      'bank.transfer.status': 'COMPENSATED',
      'bank.transfer.phase_status': 'FAILED',
    });
  });

  it('ends in the Fase 2 phase FAILED, while keeping the real status', async () => {
    const w = world();
    await compensatedTransfer(w);

    const span = byName(TRANSFER_SPAN);

    expect(span.events.map((event) => event.name)).toEqual(['PENDING', 'FAILED']);
    expect(span.attributes).toMatchObject({
      'bank.transfer.status': 'COMPENSATED',
      'bank.transfer.phase_status': 'FAILED',
      'bank.transfer.failure_reason': 'PAYMENT_DECLINED',
      'bank.transfer.duration_ms': 3_000,
    });
  });
});

describe('a transfer that fails before any money moved', () => {
  it('closes FAILED with no compensation, and says why', async () => {
    const w = world();

    await w.transfer();
    await w.deliver({ kind: 'KYC_REJECTED', reason: 'KYC_NOT_VERIFIED' }, 0.2);

    expect(names()).not.toContain(COMPENSATION_ORDERED_SPAN);
    expect(byName(TRANSFER_SPAN).events.map((event) => event.name)).toEqual(['PENDING', 'FAILED']);
    expect(byName(TRANSFER_SPAN).attributes).toMatchObject({
      'bank.transfer.status': 'FAILED',
      'bank.transfer.failure_reason': 'KYC_NOT_VERIFIED',
    });
  });
});

describe('the latency histogram', () => {
  it('is a histogram in seconds, never an average', async () => {
    const w = world();
    await completedTransfer(w);

    const all = await collected();
    const histogram = histogramOf(all);

    expect(histogram?.descriptor.unit).toBe('s');
    expect(histogram?.dataPoints[0]?.value.count).toBe(1);
    expect(histogram?.dataPoints[0]?.value.sum).toBe(2.5);
    expect(all.map((metric) => metric.descriptor.name).sort()).toEqual(
      [DURATION_HISTOGRAM, FINISHED_COUNTER, STARTED_COUNTER].sort(),
    );
    expect(all.some((metric) => /avg|average|mean/i.test(metric.descriptor.name))).toBe(false);
  });

  it('has a bucket boundary at exactly five seconds, which is what SLO-2 reads', async () => {
    const w = world();
    await completedTransfer(w);

    const boundaries = histogramOf(await collected())?.dataPoints[0]?.value.buckets.boundaries;

    expect(boundaries).toEqual(DURATION_BUCKETS_S);
    expect(boundaries).toContain(5);
    expect(Math.max(...(boundaries ?? []))).toBeGreaterThanOrEqual(90);
  });

  it('labels a duration only by its result', async () => {
    const w = world();
    await completedTransfer(w);

    expect(histogramOf(await collected())?.dataPoints[0]?.attributes).toEqual({
      result: 'completed',
    });
  });

  it('measures from the request’s own timestamp, so the time in the broker counts', async () => {
    const w = world();

    // Emitted 1.5 s before the service picked it up; completed 2.5 s after that.
    await w.transfer({ occurredAt: new Date(T0.getTime() - 1.5 * SECOND).toISOString() });
    await w.deliver({ kind: 'KYC_APPROVED' }, 0.5);
    await w.deliver({ kind: 'DEBITED' }, 1);
    await w.deliver({ kind: 'PAYMENT_SUCCEEDED' }, 2);
    await w.deliver({ kind: 'CREDITED' }, 2.5);

    expect(histogramOf(await collected())?.dataPoints[0]?.value.sum).toBe(4);
  });

  it('never reports a negative duration when the two clocks disagree', async () => {
    const w = world();

    await w.transfer({ occurredAt: new Date(T0.getTime() + 10 * SECOND).toISOString() });
    await w.deliver({ kind: 'KYC_REJECTED', reason: 'KYC_NOT_VERIFIED' }, 1);

    expect(histogramOf(await collected())?.dataPoints[0]?.value.sum).toBe(0);
    expect(byName(TRANSFER_SPAN).attributes['bank.transfer.duration_ms']).toBe(0);
  });
});

describe('the outcome counter', () => {
  it('counts each final result under its own reason, and a completion under NONE', async () => {
    const w = world();
    await completedTransfer(w);

    const finished = sumOf(await collected(), FINISHED_COUNTER);

    expect(finished?.descriptor.unit).toBe('{transfer}');
    expect(finished?.dataPoints.map((point) => point.attributes)).toEqual([
      { result: 'completed', reason: 'NONE' },
    ]);
  });

  it('separates a refusal by the business from a failure of the payment', async () => {
    const refused = world();
    await refused.transfer();
    await refused.deliver({ kind: 'KYC_REJECTED', reason: 'KYC_NOT_VERIFIED' }, 0.1);

    const compensated = world();
    await compensated.transfer({
      transactionId: '88888888-8888-4888-8888-888888888801',
      idempotencyKey: 'key-2',
    });

    const finished = sumOf(await collected(), FINISHED_COUNTER);

    expect(finished?.dataPoints.map((point) => point.attributes)).toEqual([
      { result: 'failed', reason: 'KYC_NOT_VERIFIED' },
    ]);
  });

  it('counts a compensated transfer as compensated, with the reason of the payment', async () => {
    const w = world();
    await compensatedTransfer(w);

    expect(sumOf(await collected(), FINISHED_COUNTER)?.dataPoints[0]?.attributes).toEqual({
      result: 'compensated',
      reason: 'PAYMENT_DECLINED',
    });
  });

  it('never carries an identifier as a label', async () => {
    const w = world();
    await completedTransfer(w);

    for (const metric of await collected()) {
      for (const point of metric.dataPoints) {
        const rendered = JSON.stringify(point.attributes);

        expect(Object.keys(point.attributes)).not.toContain('transactionId');
        for (const identifier of [TRANSACTION, CORRELATION, SOURCE, TARGET, OWNER.customerId]) {
          expect(rendered).not.toContain(identifier);
        }
      }
    }
  });
});

describe('what is not a step', () => {
  it('does not count a redelivered event twice', async () => {
    const w = world();

    await w.transfer();
    await w.deliver({ kind: 'KYC_APPROVED' }, 0.5, 'the-same-message');
    await w.deliver({ kind: 'KYC_APPROVED' }, 0.6, 'the-same-message');

    expect(names().filter((name) => name === 'saga.step KYC_APPROVED')).toHaveLength(1);
  });

  it('does not make a span out of an event that has no place in the diagram', async () => {
    const w = world();

    await w.transfer();
    // A credit before the debit was ever confirmed: discarded and recorded, never applied.
    const outcome = await w.deliver({ kind: 'CREDITED' }, 0.5);

    expect(outcome.kind).toBe('ILLEGAL');
    expect(names()).not.toContain('saga.step CREDITED');
  });

  it('does not make a span out of an event about a transfer it does not hold', async () => {
    const w = world();

    const outcome = await w.saga.execute({
      transactionId: '00000000-0000-4000-8000-000000000000',
      event: { kind: 'KYC_APPROVED' },
      messageId: 'stray',
      messageType: 'test.event',
      payload: {},
    });

    expect(outcome.kind).toBe('UNKNOWN_TRANSACTION');
    expect(spans.getFinishedSpans()).toEqual([]);
  });
});

describe('the rungs of the payment retry ladder', () => {
  const attemptPayload = (attempt: number, willRetry: boolean) => ({
    paymentId: PAYMENT,
    transactionId: TRANSACTION,
    attempt,
    errorType: 'TRANSIENT' as const,
    providerResult: 'FAILURE' as const,
    willRetry,
    nextAttemptAt: willRetry ? '2026-10-04T16:00:01.000Z' : null,
    failureReason: null,
    failedAt: '2026-10-04T16:00:01.000Z',
  });

  it('are spans of their own, in the same trace, without being transitions', async () => {
    const w = world();
    await w.transfer();
    await w.deliver({ kind: 'KYC_APPROVED' }, 0.5);
    await w.deliver({ kind: 'DEBITED' }, 1);

    await w.attempts.execute(attemptPayload(1, true), {
      messageId: 'attempt-1',
      messageType: 'payment.attempt.failed.v1',
      correlationId: CORRELATION,
    });

    const attempt = byName(PAYMENT_ATTEMPT_SPAN);
    expect(attempt.attributes).toMatchObject({
      'bank.payment.attempt': 1,
      'bank.payment.error_type': 'TRANSIENT',
      'bank.payment.will_retry': true,
      'bank.correlation_id': CORRELATION,
    });
    expect(attempt.spanContext().traceId).toBe(byName(ROOT_SPAN).spanContext().traceId);
    expect(attempt.parentSpanContext?.spanId).toBe(byName(ROOT_SPAN).spanContext().spanId);
  });

  it('are reported once, however often the same attempt is delivered', async () => {
    const w = world();
    await w.transfer();
    await w.deliver({ kind: 'KYC_APPROVED' }, 0.5);
    await w.deliver({ kind: 'DEBITED' }, 1);

    for (let i = 0; i < 3; i += 1) {
      await w.attempts.execute(attemptPayload(2, false), {
        messageId: 'the-same-attempt',
        messageType: 'payment.attempt.failed.v1',
        correlationId: CORRELATION,
      });
    }

    expect(names().filter((name) => name === PAYMENT_ATTEMPT_SPAN)).toHaveLength(1);
  });
});

describe('the log', () => {
  const parsed = (lines: string[]) => lines.map((line) => JSON.parse(line) as Record<string, unknown>);

  it('has a line for each transition with the transfer id, the states and the span', async () => {
    const w = world();
    await completedTransfer(w);

    const steps = parsed(w.lines).filter((line) => line.message === 'transfer step');
    expect(steps).toHaveLength(5);

    const approved = steps.find((line) => line.outcome === 'KYC_APPROVED');
    const span = byName('saga.step KYC_APPROVED');

    expect(approved).toMatchObject({
      level: 'info',
      correlationId: CORRELATION,
      transactionId: TRANSACTION,
      from: 'PENDING',
      status: 'DEBITING',
      phaseStatus: 'PENDING',
      traceId: span.spanContext().traceId,
      spanId: span.spanContext().spanId,
    });
  });

  it('says how long a finished transfer took, and how it ended', async () => {
    const w = world();
    await compensatedTransfer(w);

    const finished = parsed(w.lines).find((line) => line.message === 'transfer finished');

    expect(finished).toMatchObject({
      transactionId: TRANSACTION,
      correlationId: CORRELATION,
      status: 'COMPENSATED',
      phaseStatus: 'FAILED',
      reason: 'PAYMENT_DECLINED',
      outcome: 'compensated',
      durationMs: 3_000,
    });
  });

  it('keeps accounts, customers and amounts out of every line, span and metric', async () => {
    const w = world();
    await completedTransfer(w);

    // What a metric says about *who* is its labels. The data points are not
    // serialised whole: they carry the time they cover as `[seconds, nanoseconds]`,
    // and a nanosecond count whose milliseconds end in `15` (`…515000000`)
    // contains `15000` by chance, which made this test fail intermittently
    // depending on the millisecond it ran in.
    const everything = JSON.stringify([
      w.lines.filter((line) => line.includes('"transfer ')),
      spans.getFinishedSpans().map((span) => span.attributes),
      labelsOfMetrics(await collected()),
    ]);

    for (const secret of [SOURCE, TARGET, OWNER.customerId]) {
      expect(everything).not.toContain(secret);
    }

    expect(everything).not.toMatch(/amountMinor|15000|credential|password|token|eyJ[\w-]+\.[\w-]+\.[\w-]+/i);
  });

  it('does not mistake the time of a data point for an amount', () => {
    // The shape the SDK gives, at a moment whose nanoseconds contain the amount's digits.
    const metrics = [
      {
        dataPoints: [
          {
            attributes: { result: 'completed' },
            startTime: [1_791_256_837, 515_000_000],
            endTime: [1_791_256_837, 515_000_000],
            value: 1,
          },
        ],
      },
    ] as unknown as Parameters<typeof labelsOfMetrics>[0];

    // Why the check above reads labels: the whole metric would be flagged for nothing...
    expect(JSON.stringify(metrics)).toContain('15000');
    // ...and the labels, which are all a person could be identified by, are not.
    expect(JSON.stringify(labelsOfMetrics(metrics))).not.toContain('15000');
  });
});

describe('a telemetry that fails never fails the transition', () => {
  it('lets the Saga advance when the log sink is down', async () => {
    const w = world({ failingLog: true });

    await w.transfer();
    const outcome = await w.deliver({ kind: 'KYC_APPROVED' }, 0.5);

    expect(outcome.kind).toBe('APPLIED');
    expect((await w.repository.findById(TRANSACTION))?.status).toBe('DEBITING');
  });
});
