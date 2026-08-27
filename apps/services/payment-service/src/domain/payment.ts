import type { Money } from './money';

/**
 * What a payment is, and what may become of one attempt at it.
 *
 * **This file imports nothing outside the domain**, `@bank/contracts`
 * included — `pnpm lint` enforces it and the design agrees: whether a payment
 * retries has to be arguable with no broker and no database in sight.
 *
 * The whole of this service is one question asked repeatedly — *did the
 * provider take the money?* — and the interesting part is not the answer but
 * what follows a "no". A permanent refusal and a temporary one look identical
 * on the wire and mean opposite things: one ends the Saga and compensates the
 * debit, the other means try again in a second. Confusing them either tells
 * somebody their bank declined a transfer that actually timed out, or retries a
 * card that will never be accepted until the ladder runs out.
 */

/** The three states a payment can be in. Structurally the contracts' `paymentStatus`. */
export type PaymentStatus = 'PENDING' | 'SUCCEEDED' | 'FAILED';

/**
 * Whether asking again could plausibly change the answer.
 *
 * `PERMANENT` is a refusal: the provider said no about *this* payment and will
 * say it again. `TRANSIENT` is an absence of an answer — a timeout, a
 * connection reset, a 503 — where the payment may or may not have happened and
 * asking again is the only way to find out.
 */
export type PaymentErrorType = 'TRANSIENT' | 'PERMANENT';

/** The two reasons a payment ends unpaid. Structurally the contracts' extract. */
export type PaymentFailureReason = 'PAYMENT_DECLINED' | 'PAYMENT_RETRIES_EXHAUSTED';

/**
 * Which behaviour to simulate, carried from the transfer request.
 *
 * Demonstration only, and the assignment asks for exactly this: §6 paso 12
 * requires failure scenarios to be validated, "no solo casos exitosos". There
 * is no real payment provider in this system and inventing one would be a
 * product, not a ticket — so the scenario *is* the provider, and it is chosen
 * by whoever requests the transfer rather than by chance.
 *
 * `undefined` means `APPROVE`. A transfer that says nothing about payment is a
 * transfer that expects to work.
 */
export type PaymentScenario = 'APPROVE' | 'REJECT' | 'TRANSIENT_FAILURE';

/** A payment, as this service holds it. */
export interface Payment {
  readonly paymentId: string;
  readonly transactionId: string;
  readonly status: PaymentStatus;
  readonly amount: Money;
  /** The number of the last attempt made, or `null` before the first one. */
  readonly attempt: number | null;
  readonly errorType: PaymentErrorType | null;
  readonly failureReason: PaymentFailureReason | null;
  /** What the simulated provider called this payment. `null` until it succeeds. */
  readonly providerReference: string | null;
  readonly scenario: PaymentScenario | null;
  /** The correlation the transfer was requested under, kept for the audit trail. */
  readonly originCorrelationId: string | null;
  /** When the next attempt is owed, or `null` when none is. */
  readonly nextAttemptAt: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly decidedAt: Date | null;
}

/** One attempt, written down whether it worked or not. */
export interface PaymentAttempt {
  readonly attemptNumber: number;
  readonly result: 'SUCCEEDED' | 'FAILED';
  readonly errorType: PaymentErrorType | null;
  readonly failureReason: PaymentFailureReason | null;
  readonly occurredAt: Date;
}

/**
 * The delays between attempts, in milliseconds.
 *
 * The same ladder `docs/events/topology.md` fixed for the broker's own retries
 * (T-05): 1 s, 5 s, 30 s, so four attempts at most. It is repeated here rather
 * than imported because this is a *different* retry — the broker's ladder
 * re-delivers a message this service failed to process, and this one re-asks a
 * provider that answered. A message that arrives once and is retried three
 * times internally is one delivery and four attempts, and the two counters must
 * not be confused.
 *
 * Overridable, because a demonstration cannot spend thirty-six seconds watching
 * a compensation it already understands.
 */
export const DEFAULT_RETRY_DELAYS_MS: readonly number[] = [1_000, 5_000, 30_000];

/** Four: the first attempt, plus one per rung of the ladder. */
export function maxAttempts(delays: readonly number[]): number {
  return delays.length + 1;
}

/**
 * What one attempt at a payment produced.
 *
 * Four outcomes and not two, because `FAILED` and `RETRY` are the same event on
 * the wire and opposite instructions to the Saga, and because "the ladder ran
 * out" has to be distinguishable from "the provider said no" in the trail
 * somebody reads afterwards.
 */
export type AttemptOutcome =
  | { readonly kind: 'SUCCEEDED'; readonly providerReference: string }
  /** Refused. No retry could change it, so the Saga compensates now. */
  | {
      readonly kind: 'DECLINED';
      readonly errorType: 'PERMANENT';
      readonly failureReason: 'PAYMENT_DECLINED';
    }
  /** No answer, and rungs left. The Saga is told, and told not to act. */
  | {
      readonly kind: 'RETRY';
      readonly errorType: 'TRANSIENT';
      readonly delayMs: number;
    }
  /** No answer, and no rungs left. Now the Saga compensates. */
  | {
      readonly kind: 'EXHAUSTED';
      readonly errorType: 'TRANSIENT';
      readonly failureReason: 'PAYMENT_RETRIES_EXHAUSTED';
    };

/**
 * The provider, as a pure function.
 *
 * `attempt` is one-based: the first call is attempt 1. `reference` is passed in
 * rather than generated so that a test can assert on the identifier the payment
 * ends up carrying, which is the only thing a person can quote back when asking
 * what happened to their money.
 */
export function decideAttempt(input: {
  readonly scenario: PaymentScenario | null;
  readonly attempt: number;
  readonly delays: readonly number[];
  readonly reference: string;
}): AttemptOutcome {
  const { scenario, attempt, delays, reference } = input;

  if (attempt < 1) {
    throw new Error(`An attempt is numbered from 1; got ${String(attempt)}.`);
  }

  if (scenario === 'REJECT') {
    /**
     * Refused on the first attempt and every one after it. There is no ladder
     * for a refusal: asking a provider that declined to decline again is three
     * more round trips to reach the answer already given, and thirty-six
     * seconds during which the money is debited and the customer is told
     * nothing.
     */
    return { kind: 'DECLINED', errorType: 'PERMANENT', failureReason: 'PAYMENT_DECLINED' };
  }

  if (scenario === 'TRANSIENT_FAILURE') {
    const remaining = maxAttempts(delays) - attempt;

    if (remaining > 0) {
      /**
       * `delays[attempt - 1]` and not `delays[attempt]`: after attempt 1 the
       * wait is the first rung. The off-by-one here would be invisible — every
       * transfer would simply retry on the wrong schedule — which is why the
       * indexing is spelled out rather than left to be re-derived.
       */
      return { kind: 'RETRY', errorType: 'TRANSIENT', delayMs: delays[attempt - 1]! };
    }

    return {
      kind: 'EXHAUSTED',
      errorType: 'TRANSIENT',
      failureReason: 'PAYMENT_RETRIES_EXHAUSTED',
    };
  }

  // `APPROVE`, and `null` — a transfer that said nothing about payment.
  return { kind: 'SUCCEEDED', providerReference: reference };
}

/** Whether a payment has reached an answer nothing will change. */
export function isSettled(payment: Payment): boolean {
  return payment.status !== 'PENDING';
}

/**
 * Whether an outcome ends the payment.
 *
 * `RETRY` is the only one that does not, and it is the one the Saga must not
 * act on — treating an attempt failure as terminal would compensate a payment
 * that is about to succeed, which is the note `topology.md` already carries
 * against `payment.attempt.failed.v1`.
 */
export function isTerminal(outcome: AttemptOutcome): boolean {
  return outcome.kind !== 'RETRY';
}
