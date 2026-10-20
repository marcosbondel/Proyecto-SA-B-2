import { randomUUID } from 'node:crypto';

import { metrics, trace } from '@opentelemetry/api';
import {
  AggregationTemporality,
  DataPointType,
  InMemoryMetricExporter,
  MeterProvider,
  PeriodicExportingMetricReader,
} from '@opentelemetry/sdk-metrics';
import type { MetricData, SumMetricData } from '@opentelemetry/sdk-metrics';
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';

import { ActivityMonitor } from '../src/application/activity-monitor';
import { CompensateDebitUseCase } from '../src/application/compensate-debit.use-case';
import { CreditAccountUseCase } from '../src/application/credit-account.use-case';
import { DebitAccountUseCase } from '../src/application/debit-account.use-case';
import { DepositUseCase } from '../src/application/deposit.use-case';
import {
  ANOMALIES_COUNTER,
  ANOMALY_SPAN,
  OPERATIONS_COUNTER,
  OtelActivityTelemetry,
} from '../src/infrastructure/telemetry/otel-activity.telemetry';
import { StructuredLogger } from '../src/interfaces/logging';
import {
  FixedClock,
  InMemoryAccountRepository,
  RecordingPublisher,
  cuentaPersistida,
} from './support/in-memory';

/**
 * T-42's observability, against **real** OpenTelemetry SDK providers with
 * in-memory exporters.
 *
 * The API is a no-op without an SDK, so a test that only checked "the use case
 * did not throw" would pass against code that emitted nothing — exactly the
 * defect these tests exist to catch. Everything here runs through the real use
 * cases, so it is the movement that produces the signal, not a test calling the
 * adapter by hand.
 */

const T0 = new Date('2026-10-04T16:00:00.000Z');
const CUSTOMER = '9f1c8b2a-4d63-4e57-8a90-1b2c3d4e5f60';
const CORRELATION_ID = 'c0ffee00-1111-4222-8333-444455556666';
const RULE = { maxOperations: 10, windowMinutes: 5 };
const SECOND = 1_000;

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

function build(accountType: 'MONETARIA' | 'AHORRO' = 'MONETARIA', balanceMinor = 10_000_000) {
  const lines: string[] = [];
  const logger = new StructuredLogger('account-service', (line) => lines.push(line));
  const repository = new InMemoryAccountRepository();
  const publisher = new RecordingPublisher();
  const clock = new FixedClock(T0);
  const telemetry = new OtelActivityTelemetry(logger).forCorrelation(CORRELATION_ID);
  const activity = new ActivityMonitor({ repository, publisher, clock, telemetry, rule: RULE });

  const accountId = randomUUID();
  repository.accounts.set(accountId, {
    ...cuentaPersistida({ accountId, customerId: CUSTOMER, accountType, now: T0 }),
    balanceMinor,
  });

  const dependencies = { repository, publisher, clock, activity };

  async function debit(index: number, key = `debit-${String(index)}`): Promise<string> {
    const transactionId = randomUUID();
    clock.advanceTo(new Date(T0.getTime() + index * SECOND));
    await new DebitAccountUseCase(dependencies).execute(
      { transactionId, accountId, amount: { amountMinor: 100, currency: 'GTQ' } },
      { customerId: CUSTOMER, role: 'CLIENTE' },
      key,
    );

    return transactionId;
  }

  return { lines, accountId, repository, publisher, clock, dependencies, debit };
}

/** Every metric exported since the last reset, including the series seeded at 0. */
async function allCollected() {
  await meterProvider.forceFlush();

  return metricExporter
    .getMetrics()
    .flatMap((resource) => resource.scopeMetrics)
    .flatMap((scope) => scope.metrics);
}

/**
 * What *happened*: the series seeded at 0 at boot are filtered out, so a test
 * about one movement does not depend on whether it happens to be the first to
 * build the adapter (the seeding has its own describe at the end).
 */
async function collected(): Promise<MetricData[]> {
  return (await allCollected()).flatMap((metric): MetricData[] => {
    if (metric.dataPointType !== DataPointType.SUM) {
      return [metric];
    }

    const dataPoints = metric.dataPoints.filter((point) => point.value !== 0);

    return dataPoints.length === 0 ? [] : [{ ...metric, dataPoints } as MetricData];
  });
}

function counter(all: Awaited<ReturnType<typeof collected>>, name: string): SumMetricData {
  return all.find((metric) => metric.descriptor.name === name) as SumMetricData;
}

describe('the operations counter', () => {
  it('counts a debit and a credit under their account type, from the real use cases', async () => {
    const { dependencies, accountId, debit, clock } = build('AHORRO');

    await debit(0);
    clock.advanceTo(new Date(T0.getTime() + SECOND));
    await new CreditAccountUseCase(dependencies).execute(
      {
        transactionId: randomUUID(),
        accountId,
        amount: { amountMinor: 500, currency: 'GTQ' },
      },
      'credit-1',
    );

    const operations = counter(await collected(), OPERATIONS_COUNTER);
    const byLabels = Object.fromEntries(
      operations.dataPoints.map((point) => [
        `${String(point.attributes.account_type)}/${String(point.attributes.operation)}`,
        point.value,
      ]),
    );

    expect(operations.descriptor.unit).toBe('{operation}');
    expect(byLabels).toEqual({ 'AHORRO/debit': 1, 'AHORRO/credit': 1 });
  });

  it('counts a deposit as a credit, and a compensation as its own value', async () => {
    const { dependencies, accountId, debit } = build();
    const transactionId = await debit(0);

    await new DepositUseCase(dependencies).execute(
      {
        depositId: randomUUID(),
        accountId,
        amount: { amountMinor: 500, currency: 'GTQ' },
      },
      { role: 'CAJERO_RECEPTOR', customerId: randomUUID() },
      'deposit-1',
    );
    await new CompensateDebitUseCase(dependencies).execute(
      {
        transactionId,
        accountId,
        amount: { amountMinor: 100, currency: 'GTQ' },
        triggeredBy: 'PAYMENT_DECLINED',
      },
      'compensate-1',
    );

    const operations = counter(await collected(), OPERATIONS_COUNTER);
    const labels = operations.dataPoints.map((point) => String(point.attributes.operation)).sort();

    expect(labels).toEqual(['compensation', 'credit', 'debit']);
  });

  it('never carries an identifier as a label', async () => {
    const { debit, accountId } = build();
    await debit(0);

    for (const metric of await collected()) {
      for (const point of metric.dataPoints) {
        const rendered = JSON.stringify(point.attributes);

        expect(Object.keys(point.attributes).sort()).toEqual(['account_type', 'operation']);
        expect(rendered).not.toContain(accountId);
        expect(rendered).not.toContain(CUSTOMER);
        expect(rendered).not.toContain(CORRELATION_ID);
      }
    }
  });
});

describe('the anomalies counter, the span and the log', () => {
  it('counts one anomaly for a burst of thirty, with a span that carries the correlation id', async () => {
    const { debit, accountId, lines } = build('AHORRO');

    for (let i = 0; i < 30; i += 1) {
      await debit(i);
    }

    const anomalies = counter(await collected(), ANOMALIES_COUNTER);

    expect(anomalies.descriptor.unit).toBe('{anomaly}');
    expect(anomalies.dataPoints).toHaveLength(1);
    expect(anomalies.dataPoints[0]!.value).toBe(1);
    expect(anomalies.dataPoints[0]!.attributes).toEqual({
      account_type: 'AHORRO',
      rule: 'HIGH_FREQUENCY',
    });

    const anomalySpans = spans.getFinishedSpans().filter((span) => span.name === ANOMALY_SPAN);
    expect(anomalySpans).toHaveLength(1);
    expect(anomalySpans[0]!.attributes).toMatchObject({
      'bank.account.id': accountId,
      'bank.account.type': 'AHORRO',
      'bank.anomaly.rule': 'HIGH_FREQUENCY',
      'bank.anomaly.operation_count': 11,
      'bank.anomaly.threshold': 10,
      'bank.anomaly.window_minutes': 5,
      'bank.correlation_id': CORRELATION_ID,
    });

    const detected = lines
      .map((line) => JSON.parse(line) as Record<string, unknown>)
      .filter((line) => line.message === 'account anomaly detected');
    expect(detected).toHaveLength(1);
    expect(detected[0]).toMatchObject({
      level: 'warn',
      correlationId: CORRELATION_ID,
      accountId,
      operationCount: 11,
      threshold: 10,
      windowMinutes: 5,
      republished: false,
      traceId: anomalySpans[0]!.spanContext().traceId,
      spanId: anomalySpans[0]!.spanContext().spanId,
    });
  });

  it('writes one activity log line per movement, with the account id', async () => {
    const { debit, accountId, lines } = build();
    await debit(0);

    const operation = lines
      .map((line) => JSON.parse(line) as Record<string, unknown>)
      .find((line) => line.message === 'account operation');

    expect(operation).toMatchObject({
      level: 'info',
      correlationId: CORRELATION_ID,
      accountId,
      accountType: 'MONETARIA',
      operation: 'debit',
    });
  });

  it('emits nothing about anomalies below the limit', async () => {
    const { debit } = build();

    for (let i = 0; i < 10; i += 1) {
      await debit(i);
    }

    expect(counter(await collected(), ANOMALIES_COUNTER)).toBeUndefined();
    expect(spans.getFinishedSpans()).toEqual([]);
  });
});

describe('what never appears', () => {
  it('keeps names, documents and balances out of logs, spans and metrics', async () => {
    const { debit, lines } = build('AHORRO', 7_654_321);

    for (let i = 0; i < 11; i += 1) {
      await debit(i);
    }

    const everything = JSON.stringify([
      lines,
      spans.getFinishedSpans().map((span) => span.attributes),
      await collected(),
    ]);

    // Account Service holds no name, document or address, and its logs carry no balance.
    expect(everything).not.toMatch(/balanceMinor|balanceAfter|amountMinor/i);
    expect(everything).not.toContain('7654321');
    expect(everything).not.toMatch(/password|credential|token|secret|eyJ[\w-]+\.[\w-]+\.[\w-]+/i);
  });
});

describe('the counters exist at zero from boot', () => {
  // A series OpenTelemetry creates on its first `add()` is born at 1, and
  // Prometheus' `increase()` cannot see the first increment of a series that
  // had no earlier sample. Seeded at 0 when the process starts, it can.
  //
  // Each test gets a provider of its own - the seeding happens once per meter
  // provider, which is once per process in production - and a cumulative
  // exporter, which is what Prometheus scrapes.
  let exporter: InMemoryMetricExporter;
  let provider: MeterProvider;

  beforeEach(() => {
    exporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
    provider = new MeterProvider({
      readers: [new PeriodicExportingMetricReader({ exporter, exportIntervalMillis: 3_600_000 })],
    });
    metrics.disable();
    metrics.setGlobalMeterProvider(provider);
  });

  afterAll(() => {
    metrics.disable();
    metrics.setGlobalMeterProvider(meterProvider);
  });

  async function series(name: string): Promise<Record<string, number>> {
    exporter.reset();
    await provider.forceFlush();

    const metric = exporter
      .getMetrics()
      .flatMap((resource) => resource.scopeMetrics)
      .flatMap((scope) => scope.metrics)
      .find((m) => m.descriptor.name === name) as SumMetricData | undefined;

    return Object.fromEntries(
      (metric?.dataPoints ?? []).map((point) => [JSON.stringify(point.attributes), point.value]),
    );
  }

  const logger = () => new StructuredLogger('account-service', () => undefined);

  it('exports every account type and operation at 0 right after the adapter is built', async () => {
    new OtelActivityTelemetry(logger());

    expect(await series(OPERATIONS_COUNTER)).toEqual({
      '{"account_type":"MONETARIA","operation":"debit"}': 0,
      '{"account_type":"MONETARIA","operation":"credit"}': 0,
      '{"account_type":"MONETARIA","operation":"compensation"}': 0,
      '{"account_type":"AHORRO","operation":"debit"}': 0,
      '{"account_type":"AHORRO","operation":"credit"}': 0,
      '{"account_type":"AHORRO","operation":"compensation"}': 0,
    });
  });

  it('exports every anomaly series at 0, so the first anomaly of a demo is visible', async () => {
    new OtelActivityTelemetry(logger());

    expect(await series(ANOMALIES_COUNTER)).toEqual({
      '{"account_type":"MONETARIA","rule":"HIGH_FREQUENCY"}': 0,
      '{"account_type":"AHORRO","rule":"HIGH_FREQUENCY"}': 0,
    });
  });

  it('seeds once per process, however many deliveries build an adapter', async () => {
    const base = new OtelActivityTelemetry(logger());

    // The first movement is counted before the per-delivery adapters are built.
    base.operation({
      accountId: randomUUID(),
      accountType: 'AHORRO',
      operation: 'debit',
      transactionId: null,
    });
    const before = await series(OPERATIONS_COUNTER);

    base.forCorrelation('c0ffee00-1111-4222-8333-444455556666');
    base.forCorrelation('c0ffee00-1111-4222-8333-444455556667');

    // A second seeding would be harmless to a cumulative sum, but it must not happen.
    expect(await series(OPERATIONS_COUNTER)).toEqual(before);
    expect(before['{"account_type":"AHORRO","operation":"debit"}']).toBe(1);
  });

  it('lets the first real movement land on the series that was seeded', async () => {
    const base = new OtelActivityTelemetry(logger());

    base.operation({
      accountId: randomUUID(),
      accountType: 'AHORRO',
      operation: 'compensation',
      transactionId: null,
    });

    expect(await series(OPERATIONS_COUNTER)).toEqual({
      '{"account_type":"MONETARIA","operation":"debit"}': 0,
      '{"account_type":"MONETARIA","operation":"credit"}': 0,
      '{"account_type":"MONETARIA","operation":"compensation"}': 0,
      '{"account_type":"AHORRO","operation":"debit"}': 0,
      '{"account_type":"AHORRO","operation":"credit"}': 0,
      '{"account_type":"AHORRO","operation":"compensation"}': 1,
    });
  });
});
