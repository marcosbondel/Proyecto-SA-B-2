import { metrics } from '@opentelemetry/api';
import type { Attributes, Counter } from '@opentelemetry/api';

/**
 * Counters that exist at zero before anything happens.
 *
 * **The problem this solves.** OpenTelemetry creates a counter's time series on
 * the first `add()`, so a series is *born at its first increment*. Prometheus'
 * `increase()` and `rate()` need two samples to measure a change: a series that
 * first appears at 1 has no earlier sample to subtract, so the very first
 * increment is invisible (`increase = 0`). With low traffic - one KYC decision,
 * one anomaly, one interbank deposit - every panel and alert built on a rate or
 * an increase reads zero, and a new pod (HPA, rollout) starts the counting over.
 *
 * **The remedy.** Add `0` to every combination of the counter's closed label
 * set when the process starts. The series then exists at 0 before the first real
 * increment, and `increase()` sees 0 -> 1.
 *
 * **Only closed sets.** A label drawn from user data cannot be enumerated and
 * must never be seeded; the catalogue (`docs/sre/telemetry-catalog.md`) lists the
 * labels that are closed sets.
 */

/** What has been seeded, per meter provider: one process, one provider, one seeding. */
const seeded = new WeakMap<object, Set<string>>();

/**
 * The values a closed label can take, taken from the **keys** of a record typed
 * over the union that defines them.
 *
 * Declare the record as `{ ... } satisfies Record<TheUnion, true>` (or give it
 * that annotation): the compiler then refuses a record that misses a member of
 * the union, so a value added to the code cannot be forgotten by the seed.
 */
export function labelValues<T extends string>(closedSet: Readonly<Record<T, unknown>>): T[] {
  return Object.keys(closedSet) as T[];
}

/**
 * Every combination of the given labels - the cartesian product - as attribute
 * sets. `seriesOf({})` is the single empty set, for a counter with no labels.
 */
export function seriesOf(labels: Readonly<Record<string, readonly string[]>>): Attributes[] {
  return Object.entries(labels).reduce<Attributes[]>(
    (series, [name, values]) =>
      series.flatMap((attributes) => values.map((value) => ({ ...attributes, [name]: value }))),
    [{}],
  );
}

/**
 * Adds `0` to `counter` for each attribute set, **once per meter provider**.
 *
 * Safe to call from a constructor that runs per delivery: the second call, and
 * every one after it, returns without touching the counter. The guard is the
 * provider rather than a bare module flag so that a test that registers a fresh
 * provider gets its own seeding, while a process - which registers exactly one -
 * seeds exactly once.
 *
 * Telemetry never throws into the work it describes.
 */
export function seedCounter(counter: Counter, name: string, series: readonly Attributes[]): void {
  const provider = metrics.getMeterProvider();
  const done = seeded.get(provider) ?? new Set<string>();

  seeded.set(provider, done);

  if (done.has(name)) {
    return;
  }

  done.add(name);

  try {
    for (const attributes of series) {
      counter.add(0, attributes);
    }
  } catch {
    // A failed seed costs the first-increment visibility, never the request.
  }
}
