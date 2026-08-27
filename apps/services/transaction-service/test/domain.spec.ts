import {
  IllegalTransition,
  afterTransition,
  applyEvent,
  conflictsWithOriginal,
  isTerminal,
  openTransaction,
  requestRefusal,
} from '../src/domain/transaction';
import type { SagaEvent, Transaction, TransactionStatus } from '../src/domain/transaction';
import {
  amountProblem,
  minorUnitsFromNumeric,
  numericFromMinorUnits,
  quetzales,
} from '../src/domain/money';

const NOW = new Date('2026-08-26T12:00:00.000Z');

const SOURCE = '11111111-1111-4111-8111-111111111111';
const TARGET = '22222222-2222-4222-8222-222222222222';
const ID = '33333333-3333-4333-8333-333333333333';

const transaction = (overrides: Partial<Transaction> = {}): Transaction => ({
  ...openTransaction({
    transactionId: ID,
    sourceAccount: SOURCE,
    targetAccount: TARGET,
    amount: quetzales(15_000),
    correlationId: '55555555-5555-4555-8555-555555555555',
    idempotencyKey: 'key-1',
    paymentScenario: null,
    now: NOW,
  }),
  ...overrides,
});

describe('an amount worth moving', () => {
  it('accepts a whole number of centavos in quetzales', () => {
    expect(amountProblem(quetzales(1))).toBeNull();
    expect(amountProblem(quetzales(15_000))).toBeNull();
  });

  /**
   * Two codes and not one. `INVALID_AMOUNT` is T-1 — a request that means
   * nothing. `INVALID_AMOUNT_PRECISION` is A-6 — a real amount this system
   * cannot represent, refused rather than rounded. Collapsing them would send
   * somebody looking at their decimals when their problem is a zero.
   */
  it('separates "not an amount" from "not representable"', () => {
    expect(amountProblem(quetzales(0))).toBe('INVALID_AMOUNT');
    expect(amountProblem(quetzales(-1))).toBe('INVALID_AMOUNT');
    expect(amountProblem({ amountMinor: 100, currency: 'USD' })).toBe('INVALID_AMOUNT_PRECISION');
    expect(amountProblem({ amountMinor: 10.5, currency: 'GTQ' })).toBe('INVALID_AMOUNT_PRECISION');
  });

  it('refuses more than the column can hold', () => {
    expect(amountProblem(quetzales(999_999_999_999_99))).toBeNull();
    expect(amountProblem(quetzales(1_000_000_000_000_00))).toBe('INVALID_AMOUNT_PRECISION');
  });
});

describe('NUMERIC(14,2) as pg hands it over', () => {
  /**
   * The whole reason the column is read as text. `Number('0.07') * 100` is
   * 7.000000000000001, and a rounding error in a ledger is not a rendering bug.
   */
  it('round-trips every value without touching a float', () => {
    for (const minor of [0, 1, 7, 99, 100, 12_345, 999_999_999_999_99]) {
      expect(minorUnitsFromNumeric(numericFromMinorUnits(minor))).toBe(minor);
    }
  });

  it('reads the shapes PostgreSQL actually returns', () => {
    expect(minorUnitsFromNumeric('150.00')).toBe(15_000);
    expect(minorUnitsFromNumeric('0.07')).toBe(7);
    expect(minorUnitsFromNumeric('  12.5 ')).toBe(1_250);
    expect(minorUnitsFromNumeric('9')).toBe(900);
  });

  it('refuses anything that is not one, rather than guessing', () => {
    expect(() => minorUnitsFromNumeric('1.234')).toThrow(/NUMERIC/);
    expect(() => minorUnitsFromNumeric('abc')).toThrow(/NUMERIC/);
  });
});

describe('refusing a request before any Saga starts', () => {
  const request = { sourceAccount: SOURCE, targetAccount: TARGET, amount: quetzales(15_000) };

  it('lets a well-formed transfer through', () => {
    expect(requestRefusal(request)).toBeNull();
  });

  it('refuses a zero or negative amount (T-1)', () => {
    expect(requestRefusal({ ...request, amount: quetzales(0) })).toBe('INVALID_AMOUNT');
  });

  it('refuses a transfer to the same account (T-2)', () => {
    expect(requestRefusal({ ...request, targetAccount: SOURCE })).toBe('SAME_ACCOUNT_TRANSFER');
  });

  /**
   * The amount is judged first because it is the more specific complaint. A
   * request that is both malformed and self-directed should say what is wrong
   * with the money, which is the part somebody typed.
   */
  it('reports the amount before the accounts when both are wrong', () => {
    expect(
      requestRefusal({ sourceAccount: SOURCE, targetAccount: SOURCE, amount: quetzales(0) }),
    ).toBe('INVALID_AMOUNT');
  });
});

describe('a repeated idempotency key', () => {
  const original = transaction();

  it('is the same intention when the content matches (T-3)', () => {
    expect(
      conflictsWithOriginal(original, {
        sourceAccount: SOURCE,
        targetAccount: TARGET,
        amount: quetzales(15_000),
      }),
    ).toBe(false);
  });

  /**
   * The Gateway mints a fresh `transactionId` for every HTTP request, so a
   * genuine retry always carries a new one. Comparing it would make every retry
   * a conflict — the exact opposite of what an idempotency key is for.
   */
  it('ignores the transactionId, which a retry always changes', () => {
    expect(
      conflictsWithOriginal(
        { ...original, transactionId: 'a-different-one' },
        {
          sourceAccount: SOURCE,
          targetAccount: TARGET,
          amount: quetzales(15_000),
        },
      ),
    ).toBe(false);
  });

  it.each([
    ['a different amount', { amount: quetzales(15_001) }],
    ['a different source', { sourceAccount: TARGET }],
    ['a different target', { targetAccount: SOURCE }],
  ])('is a conflict with %s (T-4)', (_label, difference) => {
    expect(
      conflictsWithOriginal(original, {
        sourceAccount: SOURCE,
        targetAccount: TARGET,
        amount: quetzales(15_000),
        ...difference,
      }),
    ).toBe(true);
  });
});

describe('the legal transitions', () => {
  it.each([
    ['PENDING', 'DEBIT_ORDERED', 'DEBITING', 'DEBIT'],
    ['DEBITING', 'DEBITED', 'PAYMENT_PENDING', 'PAYMENT'],
    ['PAYMENT_PENDING', 'PAYMENT_SUCCEEDED', 'PAYMENT_PENDING', 'CREDIT'],
    ['PAYMENT_PENDING', 'CREDITED', 'COMPLETED', null],
  ] as const)('%s + %s → %s ordering %s', (from, kind, to, command) => {
    const result = applyEvent(transaction({ status: from }), { kind } as SagaEvent);

    expect(result.status).toBe(to);
    expect(result.command).toBe(command);
    expect(result.failureReason).toBeNull();
  });

  it('a rejected debit is the only door to FAILED (T-7)', () => {
    const result = applyEvent(transaction({ status: 'DEBITING' }), {
      kind: 'DEBIT_REJECTED',
      reason: 'INSUFFICIENT_FUNDS',
    });

    expect(result.status).toBe('FAILED');
    expect(result.failureReason).toBe('INSUFFICIENT_FUNDS');
    expect(result.command).toBeNull();
  });

  it.each([
    [
      'a failed payment',
      { kind: 'PAYMENT_FAILED', reason: 'PAYMENT_DECLINED' } as const,
      'PAYMENT_DECLINED',
    ],
    [
      'a rejected credit',
      { kind: 'CREDIT_REJECTED', reason: 'ACCOUNT_NOT_FOUND' } as const,
      'ACCOUNT_NOT_FOUND',
    ],
  ])('%s orders a compensation and records why', (_label, event, reason) => {
    const result = applyEvent(transaction({ status: 'PAYMENT_PENDING' }), event);

    // It stays where it is: the money has not come back yet, and claiming
    // COMPENSATED before Account Service says so would be a refund on paper.
    expect(result.status).toBe('PAYMENT_PENDING');
    expect(result.command).toBe('COMPENSATION');
    expect(result.failureReason).toBe(reason);
  });

  it('closes in COMPENSATED once the money is actually back', () => {
    const compensating = transaction({
      status: 'PAYMENT_PENDING',
      failureReason: 'PAYMENT_RETRIES_EXHAUSTED',
    });

    const result = applyEvent(compensating, { kind: 'DEBIT_COMPENSATED' });

    expect(result.status).toBe('COMPENSATED');
    expect(result.failureReason).toBe('PAYMENT_RETRIES_EXHAUSTED');
  });

  it('knows which three states nothing follows', () => {
    expect(['COMPLETED', 'FAILED', 'COMPENSATED'].every(isTerminal)).toBe(true);
    expect(['PENDING', 'DEBITING', 'PAYMENT_PENDING'].some(isTerminal)).toBe(false);
  });
});

describe('an event that has no place here (T-6)', () => {
  const EVERY_EVENT: readonly SagaEvent[] = [
    { kind: 'DEBIT_ORDERED' },
    { kind: 'DEBITED' },
    { kind: 'DEBIT_REJECTED', reason: 'INSUFFICIENT_FUNDS' },
    { kind: 'PAYMENT_SUCCEEDED' },
    { kind: 'PAYMENT_FAILED', reason: 'PAYMENT_DECLINED' },
    { kind: 'CREDITED' },
    { kind: 'CREDIT_REJECTED', reason: 'ACCOUNT_NOT_FOUND' },
    { kind: 'DEBIT_COMPENSATED' },
  ];

  /**
   * The blunt version of the diagram: nothing at all follows a terminal state.
   * This is the case a late redelivery actually produces — the Saga finished
   * ten seconds ago and one more copy of `account.credited.v1` turns up.
   */
  it.each(['COMPLETED', 'FAILED', 'COMPENSATED'] as const)(
    'refuses every event from %s',
    (status) => {
      for (const event of EVERY_EVENT) {
        expect(() => applyEvent(transaction({ status }), event)).toThrow(IllegalTransition);
      }
    },
  );

  /**
   * The out-of-order case the ticket names: a credit confirmation that
   * overtook the debit it depends on. Applying it would close a transfer as
   * completed while the money was still in the source account.
   */
  it('refuses a credit that arrived before the debit', () => {
    expect(() => applyEvent(transaction({ status: 'DEBITING' }), { kind: 'CREDITED' })).toThrow(
      /not a legal event for a transaction in DEBITING/,
    );
  });

  it('refuses a debit confirmation for a transfer that was never ordered', () => {
    expect(() => applyEvent(transaction({ status: 'PENDING' }), { kind: 'DEBITED' })).toThrow(
      IllegalTransition,
    );
  });

  /**
   * A second compensation is the expensive mistake: it would return the money
   * twice, from an account that only ever lost it once. `failureReason` is what
   * records that the decision was already taken.
   */
  it('refuses a second compensation trigger once one is in flight (T-5)', () => {
    const compensating = transaction({
      status: 'PAYMENT_PENDING',
      failureReason: 'PAYMENT_DECLINED',
    });

    expect(() =>
      applyEvent(compensating, { kind: 'PAYMENT_FAILED', reason: 'PAYMENT_DECLINED' }),
    ).toThrow(IllegalTransition);
  });

  /**
   * And the mirror: a success that arrives after the compensation was ordered.
   * Honouring it would credit the target for a transfer that is being refunded.
   */
  it.each([{ kind: 'PAYMENT_SUCCEEDED' } as const, { kind: 'CREDITED' } as const])(
    'refuses %p once a compensation has been ordered',
    (event) => {
      const compensating = transaction({
        status: 'PAYMENT_PENDING',
        failureReason: 'PAYMENT_DECLINED',
      });

      expect(() => applyEvent(compensating, event)).toThrow(IllegalTransition);
    },
  );

  /**
   * The reverse guard. A compensation confirmation for a transfer nobody asked
   * to compensate is an event for another Saga, or one that overtook its cause.
   */
  it('refuses a compensation confirmation nobody asked for', () => {
    expect(() =>
      applyEvent(transaction({ status: 'PAYMENT_PENDING' }), { kind: 'DEBIT_COMPENSATED' }),
    ).toThrow(IllegalTransition);
  });

  it('names the state and the event, so a log line explains itself', () => {
    try {
      applyEvent(transaction({ status: 'COMPLETED' }), { kind: 'DEBITED' });
      throw new Error('it should have refused');
    } catch (error) {
      expect(error).toBeInstanceOf(IllegalTransition);
      expect((error as IllegalTransition).from).toBe('COMPLETED');
      expect((error as IllegalTransition).event).toBe('DEBITED');
      expect((error as IllegalTransition).code).toBe('ILLEGAL_TRANSITION');
    }
  });
});

describe('T-7, stated as the property it is', () => {
  /**
   * Any transaction that left DEBITING with the debit applied ends in COMPLETED
   * or COMPENSATED, never in FAILED. Walked here rather than asserted, because
   * the invariant is about every path and not about one.
   */
  it('cannot reach FAILED from anywhere the money has already moved', () => {
    const afterTheDebit: readonly TransactionStatus[] = [
      'PAYMENT_PENDING',
      'COMPLETED',
      'COMPENSATED',
    ];

    for (const status of afterTheDebit) {
      for (const reason of ['INSUFFICIENT_FUNDS', 'ACCOUNT_INACTIVE'] as const) {
        expect(() =>
          applyEvent(transaction({ status }), { kind: 'DEBIT_REJECTED', reason }),
        ).toThrow(IllegalTransition);
      }
    }
  });
});

describe('writing a transition down', () => {
  const later = new Date('2026-08-26T12:00:05.000Z');

  it('stamps a closing time only when the transaction closed', () => {
    const open = afterTransition(
      transaction(),
      applyEvent(transaction(), { kind: 'DEBIT_ORDERED' }),
      later,
    );

    expect(open.completedAt).toBeNull();
    expect(open.updatedAt).toEqual(later);
  });

  it('stamps it once and never again', () => {
    const debiting = transaction({ status: 'DEBITING' });
    const rejected = afterTransition(
      debiting,
      applyEvent(debiting, { kind: 'DEBIT_REJECTED', reason: 'ACCOUNT_INACTIVE' }),
      later,
    );

    expect(rejected.completedAt).toEqual(later);

    /**
     * A redelivery cannot move the closing time of a transfer that closed
     * yesterday. The state machine refuses the event first, but this is the
     * property that holds even if it did not.
     */
    const again = afterTransition(
      rejected,
      { from: 'FAILED', status: 'FAILED', failureReason: 'ACCOUNT_INACTIVE', command: null },
      new Date('2026-08-27T00:00:00.000Z'),
    );

    expect(again.completedAt).toEqual(later);
  });
});
