import type { PaymentErrorType, PaymentScenario } from './payment';

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
 * Asks the simulated provider what happened to this attempt.
 *
 * `reference` is passed in rather than generated here, for the same reason
 * `decideAttempt` already took it: a test has to be able to assert on the
 * identifier a successful payment ends up carrying.
 */
export function callProvider(input: {
  readonly scenario: PaymentScenario | null;
  readonly reference: string;
}): ProviderResponse {
  const { scenario, reference } = input;

  if (scenario === 'REJECT') {
    return { result: 'FAILURE', errorType: 'PERMANENT' };
  }

  if (scenario === 'TRANSIENT_FAILURE') {
    return { result: 'FAILURE', errorType: 'TRANSIENT' };
  }

  if (scenario === 'TIMEOUT') {
    return { result: 'TIMEOUT' };
  }

  // `APPROVE`, and `null` — a transfer that said nothing about payment.
  return { result: 'SUCCESS', providerReference: reference };
}
