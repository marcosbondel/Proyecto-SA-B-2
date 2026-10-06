import type { PaymentErrorType, PaymentScenario } from './payment';
import { answerFor } from './simulation';
import type { SimulationSettings } from './simulation';

/**
 * The simulated external provider, as a pure function — T-29.
 *
 * This is the one call `decideAttempt` makes to "the provider". Splitting it
 * out of `decideAttempt` is what the ticket actually asks for: a provider that
 * can be pointed at on its own, separately from the retry-ladder policy that
 * decides what to do about what it said. Before this file existed, "ask the
 * provider" and "apply the ladder" were one `if` chain in `decideAttempt`, and
 * a timeout had nowhere to live that was not also a decision about retrying.
 *
 * **No clock, no `setTimeout`, no randomness.** A `TIMEOUT` answer is returned
 * immediately, exactly like `SUCCESS` and `FAILURE` are: it is what the
 * provider is being asked to say, not something this service waits to
 * discover. Actually sleeping for a "timeout" would risk the Gateway's
 * five-second request/reply ceiling and the SLO-2 latency budget in
 * `docs/RELIABILITY.md` on every rehearsed transfer, and it would make this
 * function's own tests slow for no assertion anybody needs.
 */
export type ProviderResult = 'SUCCESS' | 'FAILURE' | 'TIMEOUT';

/** What one call to the provider produced. */
export type ProviderResponse =
  | { readonly result: 'SUCCESS'; readonly providerReference: string }
  | { readonly result: 'FAILURE'; readonly errorType: PaymentErrorType }
  /** No answer. Whether this is worth retrying is `decideAttempt`'s call, not the provider's. */
  | { readonly result: 'TIMEOUT' };

/**
 * The unscripted half of the provider (T-44): the configured rates and the roll
 * of the dice that decides this attempt. Both are handed in; neither is read
 * from the clock, the environment or `Math.random` in here.
 */
export interface Simulation {
  readonly settings: SimulationSettings;
  /** A number in `[0, 1)`. */
  readonly roll: number;
}

/**
 * Asks the simulated provider what happened to this attempt.
 *
 * A transfer that names a `scenario` gets exactly that answer, as it always
 * has: a rehearsal has to be repeatable. Only a transfer that said nothing
 * (`scenario` is `null`) is left to `simulation`, which is what lets an
 * administrator turn the failure rate up under load without changing what a
 * scripted transfer does.
 *
 * `reference` is passed in rather than generated here, for the same reason
 * `decideAttempt` already took it: a test has to be able to assert on the
 * identifier a successful payment ends up carrying.
 */
export function callProvider(input: {
  readonly scenario: PaymentScenario | null;
  readonly reference: string;
  readonly simulation?: Simulation | null;
}): ProviderResponse {
  const { scenario, reference, simulation } = input;

  if (scenario === 'REJECT') {
    return { result: 'FAILURE', errorType: 'PERMANENT' };
  }

  if (scenario === 'TRANSIENT_FAILURE') {
    return { result: 'FAILURE', errorType: 'TRANSIENT' };
  }

  if (scenario === 'TIMEOUT') {
    return { result: 'TIMEOUT' };
  }

  if (scenario === null && simulation !== undefined && simulation !== null) {
    const answer = answerFor(simulation.settings, simulation.roll);

    if (answer === 'TIMEOUT') {
      return { result: 'TIMEOUT' };
    }

    // An intermittent failure is the transient kind: a provider that is flaky
    // today may answer tomorrow, so the ladder retries it. A permanent refusal
    // is something only a scripted `REJECT` produces.
    if (answer === 'FAILURE') {
      return { result: 'FAILURE', errorType: 'TRANSIENT' };
    }
  }

  // `APPROVE`, and `null` with nothing simulated — a transfer that said nothing.
  return { result: 'SUCCESS', providerReference: reference };
}

/**
 * How long this attempt takes to be answered, in milliseconds.
 *
 * Only an unscripted attempt is slow, and only one the provider actually
 * answers: a timeout is the absence of an answer, so it is returned at once,
 * as it always was — waiting out a "timeout" would only hold a database row
 * and the Saga's latency budget for nothing anybody asserts.
 */
export function providerLatencyMs(input: {
  readonly scenario: PaymentScenario | null;
  readonly simulation?: Simulation | null;
}): number {
  const { scenario, simulation } = input;

  if (scenario !== null || simulation === undefined || simulation === null) {
    return 0;
  }

  return answerFor(simulation.settings, simulation.roll) === 'TIMEOUT'
    ? 0
    : simulation.settings.latencyMs;
}
