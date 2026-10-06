/**
 * How the simulated provider misbehaves when nobody has scripted it — T-44.
 *
 * Until now the provider answered what a transfer's `scenario` told it to, so
 * every failure was rehearsed by whoever requested the transfer. Phase 3 asks
 * for the opposite end of that: a provider that fails *on its own*, at a rate an
 * administrator can turn up while the system is under load, and that can answer
 * slowly. This file holds the three numbers and the one decision made from
 * them, and nothing else.
 *
 * **Pure.** There is no `Math.random` in this file and no clock. The caller
 * rolls the dice and passes the result in as `roll`, which is what lets a test
 * assert that 30 % means "a roll of 0.29 fails and a roll of 0.31 does not"
 * without a seed, a loop and a statistical tolerance.
 *
 * **A failure and a timeout are one draw, not two.** An attempt can go wrong in
 * one way, so the two rates carve up the same interval: the first
 * `timeoutRatePercent` of it is a timeout, the next `failureRatePercent` is a
 * failure, and the rest is success. Drawing twice would make the effective rate
 * `1 - (1 - f)(1 - t)`, which is not the number anyone typed.
 */

/** What an administrator can set. Percentages are 0–100, not 0–1. */
export interface SimulationSettings {
  readonly failureRatePercent: number;
  readonly timeoutRatePercent: number;
  readonly latencyMs: number;
}

/** Nothing goes wrong and nothing is slow: the behaviour before T-44. */
export const NO_SIMULATION: SimulationSettings = {
  failureRatePercent: 0,
  timeoutRatePercent: 0,
  latencyMs: 0,
};

/**
 * The longest the provider may take to answer, in milliseconds.
 *
 * Mirrors `MAX_SIMULATED_LATENCY_MS` in `@bank/contracts`; the domain imports
 * nothing outside itself, so the number is repeated here and a test pins the
 * two together.
 */
export const MAX_LATENCY_MS = 30_000;

/** What one roll of the dice makes the provider do. */
export type SimulatedAnswer = 'SUCCESS' | 'FAILURE' | 'TIMEOUT';

/**
 * Whether a set of numbers is one the provider can honour: rates inside 0–100
 * that together do not exceed every attempt, and a whole, bounded latency.
 *
 * The contract refuses the same things at the Gateway; this is the second
 * lock, for values that arrive by another door — the ConfigMap, a row somebody
 * edited by hand.
 */
export function isValidSettings(settings: SimulationSettings): boolean {
  const { failureRatePercent, timeoutRatePercent, latencyMs } = settings;

  return (
    Number.isFinite(failureRatePercent) &&
    Number.isFinite(timeoutRatePercent) &&
    failureRatePercent >= 0 &&
    failureRatePercent <= 100 &&
    timeoutRatePercent >= 0 &&
    timeoutRatePercent <= 100 &&
    failureRatePercent + timeoutRatePercent <= 100 &&
    Number.isInteger(latencyMs) &&
    latencyMs >= 0 &&
    latencyMs <= MAX_LATENCY_MS
  );
}

/**
 * What the provider does for a roll in `[0, 1)`.
 *
 * Boundaries are exclusive on the upper side, so a 30 % failure rate fails
 * rolls in `[0.1, 0.4)` with a 10 % timeout rate and never one at exactly
 * `0.4` — and so 0 % never fails and 100 % always does, whatever the roll.
 */
export function answerFor(settings: SimulationSettings, roll: number): SimulatedAnswer {
  const percent = roll * 100;

  if (percent < settings.timeoutRatePercent) {
    return 'TIMEOUT';
  }

  if (percent < settings.timeoutRatePercent + settings.failureRatePercent) {
    return 'FAILURE';
  }

  return 'SUCCESS';
}
