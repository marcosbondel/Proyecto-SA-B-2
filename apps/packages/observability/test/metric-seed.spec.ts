import { metrics } from '@opentelemetry/api';
import {
  AggregationTemporality,
  InMemoryMetricExporter,
  MeterProvider,
  PeriodicExportingMetricReader,
} from '@opentelemetry/sdk-metrics';
import type { SumMetricData } from '@opentelemetry/sdk-metrics';

import { labelValues, seedCounter, seriesOf } from '../src/metric-seed';

/**
 * The first-increment problem, from the side that causes it: what a counter
 * exports right after the process starts, before anything has happened.
 *
 * Real SDK, in-memory exporter. A test that only checked "the helper did not
 * throw" would pass against a helper that seeded nothing, because the API is a
 * no-op without a provider.
 */

const NAME = 'bank.test.decisions';

let exporter: InMemoryMetricExporter;
let provider: MeterProvider;

function register(): void {
  exporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
  provider = new MeterProvider({
    readers: [
      new PeriodicExportingMetricReader({
        exporter,
        // Never fires on its own: the tests flush explicitly.
        exportIntervalMillis: 3_600_000,
      }),
    ],
  });
  metrics.disable();
  metrics.setGlobalMeterProvider(provider);
}

/** Every exported point of the counter, as `{ attributes: value }` pairs. */
async function exported(name = NAME): Promise<Record<string, number>> {
  exporter.reset();
  await provider.forceFlush();

  const points: Record<string, number> = {};

  for (const resourceMetrics of exporter.getMetrics()) {
    for (const scope of resourceMetrics.scopeMetrics) {
      for (const metric of scope.metrics) {
        if (metric.descriptor.name !== name) continue;

        for (const point of (metric as SumMetricData).dataPoints) {
          points[JSON.stringify(point.attributes)] = point.value as number;
        }
      }
    }
  }

  return points;
}

beforeEach(register);

afterAll(async () => {
  await provider.shutdown();
  metrics.disable();
});

describe('seriesOf and labelValues', () => {
  it('builds the cartesian product of the labels, and one empty set for no labels', () => {
    expect(seriesOf({ result: ['a', 'b'], path: ['x', 'y', 'z'] })).toHaveLength(6);
    expect(seriesOf({ result: ['a', 'b'], path: ['x'] })).toEqual([
      { result: 'a', path: 'x' },
      { result: 'b', path: 'x' },
    ]);
    expect(seriesOf({})).toEqual([{}]);
  });

  it('reads the closed set from the keys of a record typed over the union', () => {
    type Result = 'verified' | 'rejected';
    const RESULTS = { verified: true, rejected: true } satisfies Record<Result, true>;

    expect(labelValues(RESULTS)).toEqual(['verified', 'rejected']);
  });
});

describe('seedCounter', () => {
  const series = seriesOf({ result: ['verified', 'rejected'] });

  it('exports every series at 0 before anything has happened', async () => {
    const counter = metrics.getMeter('test').createCounter(NAME);

    seedCounter(counter, NAME, series);

    expect(await exported()).toEqual({
      '{"result":"verified"}': 0,
      '{"result":"rejected"}': 0,
    });
  });

  it('lets the first real increment land on the series that was seeded', async () => {
    const counter = metrics.getMeter('test').createCounter(NAME);

    seedCounter(counter, NAME, series);
    counter.add(1, { result: 'verified' });

    expect(await exported()).toEqual({
      '{"result":"verified"}': 1,
      '{"result":"rejected"}': 0,
    });
  });

  it('seeds once per process however many adapters are constructed', async () => {
    const meter = metrics.getMeter('test');
    const first = meter.createCounter(NAME);

    seedCounter(first, NAME, series);
    first.add(1, { result: 'verified' });

    // A second adapter - one is built per delivery - must not add anything,
    // and above all must not reset what the first one counted.
    seedCounter(meter.createCounter(NAME), NAME, series);
    seedCounter(meter.createCounter(NAME), NAME, series);
    // The guard is per counter name: another counter is still seeded.
    seedCounter(meter.createCounter('bank.test.other'), 'bank.test.other', series);

    expect(await exported()).toEqual({
      '{"result":"verified"}': 1,
      '{"result":"rejected"}': 0,
    });
    expect(Object.keys(await exported('bank.test.other'))).toHaveLength(2);
  });

  it('seeds again for a new provider, which is a new process as far as the series go', async () => {
    seedCounter(metrics.getMeter('test').createCounter(NAME), NAME, series);

    register();
    seedCounter(metrics.getMeter('test').createCounter(NAME), NAME, series);

    expect(Object.keys(await exported())).toHaveLength(2);
  });

  it('is harmless without an SDK', () => {
    metrics.disable();

    expect(() => {
      seedCounter(metrics.getMeter('test').createCounter(NAME), NAME, series);
    }).not.toThrow();
  });
});
