import {
  DEFAULT_RETRY_DELAYS_MS,
  decideAttempt,
  isTerminal,
  maxAttempts,
} from '../src/domain/payment';
import type { AttemptOutcome, PaymentScenario } from '../src/domain/payment';

/**
 * The provider, as a pure function — which is the whole reason it is one.
 *
 * There is no real payment provider in this system, so what would otherwise be
 * an integration test against somebody's sandbox is instead a table of
 * assertions with no clock, no broker and no database in it. What is being
 * asserted is not "does the provider work" but the thing that actually matters
 * and is actually ours: **which failures end the Saga and which do not**.
 */

const LADDER = [1_000, 5_000, 30_000] as const;

function attempt(scenario: PaymentScenario | null, number_: number): AttemptOutcome {
  return decideAttempt({
    scenario,
    attempt: number_,
    delays: LADDER,
    reference: 'ref-0001',
  });
}

describe('the ladder the assignment fixed', () => {
  it('is the one topology.md fixed for the broker: 1 s, 5 s, 30 s', () => {
    expect(DEFAULT_RETRY_DELAYS_MS).toEqual([1_000, 5_000, 30_000]);
  });

  it('allows four attempts: the first, plus one per rung', () => {
    expect(maxAttempts(LADDER)).toBe(4);
  });

  /**
   * A ladder with no rungs is legal and means one attempt. It is the shape a
   * real provider with its own internal retries would want, and it must not
   * accidentally mean "retry forever".
   */
  it('allows one attempt when there is no ladder at all', () => {
    expect(maxAttempts([])).toBe(1);
    expect(
      decideAttempt({ scenario: 'TRANSIENT_FAILURE', attempt: 1, delays: [], reference: 'r' }),
    ).toMatchObject({ kind: 'EXHAUSTED' });
  });
});

describe('a payment that is approved', () => {
  it('succeeds on the first attempt and carries the provider reference', () => {
    expect(attempt('APPROVE', 1)).toEqual({ kind: 'SUCCEEDED', providerReference: 'ref-0001' });
  });

  /**
   * A transfer that says nothing about payment is a transfer that expects to
   * work. If this ever stopped defaulting to success, every transfer made
   * through the ordinary form — which sends no scenario — would fail.
   */
  it('treats an absent scenario as approval', () => {
    expect(attempt(null, 1)).toMatchObject({ kind: 'SUCCEEDED' });
  });
});

describe('a payment that is declined', () => {
  it('fails permanently on the first attempt, with the code the Saga reads', () => {
    expect(attempt('REJECT', 1)).toEqual({
      kind: 'DECLINED',
      errorType: 'PERMANENT',
      failureReason: 'PAYMENT_DECLINED',
    });
  });

  /**
   * The load-bearing one. A refusal must not climb the ladder: asking a
   * provider that declined to decline again is three more round trips to reach
   * an answer already given, and thirty-six seconds during which the money is
   * debited and the customer is told nothing.
   */
  it('never retries, at any attempt number', () => {
    for (const number_ of [1, 2, 3, 4]) {
      expect(attempt('REJECT', number_).kind).toBe('DECLINED');
    }
  });
});

describe('a payment that keeps timing out', () => {
  it('retries while there are rungs left, on the ladder in order', () => {
    expect(attempt('TRANSIENT_FAILURE', 1)).toEqual({
      kind: 'RETRY',
      errorType: 'TRANSIENT',
      delayMs: 1_000,
    });
    expect(attempt('TRANSIENT_FAILURE', 2)).toMatchObject({ delayMs: 5_000 });
    expect(attempt('TRANSIENT_FAILURE', 3)).toMatchObject({ delayMs: 30_000 });
  });

  it('gives up on the fourth attempt, and says why', () => {
    expect(attempt('TRANSIENT_FAILURE', 4)).toEqual({
      kind: 'EXHAUSTED',
      errorType: 'TRANSIENT',
      failureReason: 'PAYMENT_RETRIES_EXHAUSTED',
    });
  });

  /**
   * The distinction the interface depends on. Both end the transfer, and
   * telling somebody their bank *declined* a transfer that actually timed out
   * four times is a different — and wrong — thing to say.
   */
  it('reports exhaustion with a different code from a refusal', () => {
    const exhausted = attempt('TRANSIENT_FAILURE', 4);
    const declined = attempt('REJECT', 1);

    expect(exhausted).toMatchObject({ failureReason: 'PAYMENT_RETRIES_EXHAUSTED' });
    expect(declined).toMatchObject({ failureReason: 'PAYMENT_DECLINED' });
  });
});

describe('which outcomes end the Saga', () => {
  /**
   * `RETRY` is the only one that does not, and it is the one Transaction
   * Service must not act on: treating an attempt failure as terminal
   * compensates a debit while an attempt that might still succeed is pending.
   */
  it('ends on everything except a retry', () => {
    expect(isTerminal(attempt('APPROVE', 1))).toBe(true);
    expect(isTerminal(attempt('REJECT', 1))).toBe(true);
    expect(isTerminal(attempt('TRANSIENT_FAILURE', 4))).toBe(true);
    expect(isTerminal(attempt('TRANSIENT_FAILURE', 1))).toBe(false);
  });
});

describe('an attempt number that cannot exist', () => {
  it('is refused rather than indexed into the ladder', () => {
    expect(() => attempt('TRANSIENT_FAILURE', 0)).toThrow(/numbered from 1/);
  });
});
