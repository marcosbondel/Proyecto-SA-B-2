import {
  DomainRejection,
  compensate,
  credit,
  creditInterbank,
  debit,
  openAccount,
  openingDepositRefusal,
  openingRefusal,
} from '../src/domain/account';
import type { Account } from '../src/domain/account';
import {
  DEFAULT_CRITERIA,
  inactivityThreshold,
  shouldDeactivate,
} from '../src/domain/deactivation-policy';
import { minorUnitsFromNumeric, numericFromMinorUnits, quetzales } from '../src/domain/money';

const NOW = new Date('2026-08-26T12:00:00.000Z');

/**
 * `openAccount` devuelve una cuenta **sin número**, porque el número lo asigna
 * la secuencia de la base al insertar (T-56). Las pruebas que necesitan una
 * cuenta *persistida* se lo añaden aquí.
 */
const account = (overrides: Partial<Account> = {}): Account => ({
  ...openAccount({
    accountId: '3a7d9e14-6b25-4f83-9c01-8e5a2d7b4f60',
    customerId: '9f1c8b2a-4d63-4e57-8a90-1b2c3d4e5f60',
    accountType: 'MONETARIA' as const,
    now: NOW,
  }),
  accountNumber: '02-000000001',
  ...overrides,
});

describe('money, which is never a float', () => {
  it('reads a NUMERIC(14,2) exactly, including the values multiplication ruins', () => {
    // `Number('0.07') * 100` is 7.000000000000001 and `Number('19.99') * 100`
    // is 1998.9999999999998. Splitting on the decimal point is exact for both.
    expect(minorUnitsFromNumeric('0.07')).toBe(7);
    expect(minorUnitsFromNumeric('19.99')).toBe(1_999);
    expect(minorUnitsFromNumeric('1.005'.slice(0, 4))).toBe(100);
    expect(minorUnitsFromNumeric('0.00')).toBe(0);
    expect(minorUnitsFromNumeric('123456789012.34')).toBe(12_345_678_901_234);
  });

  it('accepts a value written without a fractional part, as PostgreSQL may send it', () => {
    expect(minorUnitsFromNumeric('50')).toBe(5_000);
    expect(minorUnitsFromNumeric('50.5')).toBe(5_050);
  });

  it('writes minor units back as a NUMERIC literal, round-tripping every time', () => {
    for (const minor of [0, 1, 7, 50, 4_999, 5_000, 123_456_789]) {
      expect(minorUnitsFromNumeric(numericFromMinorUnits(minor))).toBe(minor);
    }
  });

  it('refuses a string that is not a NUMERIC(14,2) rather than guessing', () => {
    expect(() => minorUnitsFromNumeric('abc')).toThrow(/NUMERIC/);
  });
});

describe('a new account', () => {
  it('starts at Q0.00 and ACTIVE, as criterion 1 requires', () => {
    const opened = account();

    expect(opened.balanceMinor).toBe(0);
    expect(opened.status).toBe('ACTIVE');
    expect(opened.version).toBe(0);
  });

  it('counts inactivity from its opening, so an untouched account is not immortal', () => {
    expect(account().lastActivityAt).toEqual(NOW);
  });
});

describe('who may open an account for whom', () => {
  const subject = '9f1c8b2a-4d63-4e57-8a90-1b2c3d4e5f60';

  it('lets a client open their own', () => {
    expect(openingRefusal({ customerId: subject, role: 'CLIENTE' }, subject)).toBeNull();
  });

  it('refuses a client acting for somebody else', () => {
    expect(openingRefusal({ customerId: 'other', role: 'CLIENTE' }, subject)).toBe(
      'FORBIDDEN_ACCOUNT_ACCESS',
    );
  });

  it('lets a teller open one for a client', () => {
    expect(openingRefusal({ customerId: 'staff', role: 'CAJERO_RECEPTOR' }, subject)).toBeNull();
  });

  it('refuses staff holding an account themselves — invariant C-6', () => {
    expect(openingRefusal({ customerId: subject, role: 'ADMINISTRADOR' }, subject)).toBe(
      'ROLE_NOT_ELIGIBLE',
    );
  });
});

describe('debiting', () => {
  it('moves the money and advances the version', () => {
    const moved = debit(account({ balanceMinor: 10_000 }), quetzales(2_500), NOW);

    expect(moved.account.balanceMinor).toBe(7_500);
    expect(moved.balanceAfter).toEqual(quetzales(7_500));
    expect(moved.account.version).toBe(1);
    expect(moved.account.lastActivityAt).toEqual(NOW);
  });

  it('allows a debit that empties the account exactly — no floor once it is open (T-27)', () => {
    expect(
      debit(account({ balanceMinor: 2_500 }), quetzales(2_500), NOW).account.balanceMinor,
    ).toBe(0);
  });

  it('refuses one centavo more than the balance, and says why', () => {
    expect(() => debit(account({ balanceMinor: 2_500 }), quetzales(2_501), NOW)).toThrow(
      expect.objectContaining({ code: 'INSUFFICIENT_FUNDS' }),
    );
  });

  it('refuses an inactive account before it looks at the balance', () => {
    // The order matters: ACCOUNT_INACTIVE and INSUFFICIENT_FUNDS lead the Saga
    // to different places, and an inactive account with money is the case where
    // collapsing them would be wrong.
    expect(() =>
      debit(account({ balanceMinor: 100_000, status: 'INACTIVE' }), quetzales(1), NOW),
    ).toThrow(expect.objectContaining({ code: 'ACCOUNT_INACTIVE' }));
  });

  it('refuses an amount in another currency', () => {
    expect(() =>
      debit(account({ balanceMinor: 10_000 }), { amountMinor: 100, currency: 'USD' }, NOW),
    ).toThrow(expect.objectContaining({ code: 'INVALID_AMOUNT_PRECISION' }));
  });

  it('refuses a non-integer amount, which is a float that got this far', () => {
    expect(() => debit(account({ balanceMinor: 10_000 }), quetzales(10.5), NOW)).toThrow(
      DomainRejection,
    );
  });

  it('refuses zero: a movement of nothing is not a movement', () => {
    expect(() => debit(account({ balanceMinor: 10_000 }), quetzales(0), NOW)).toThrow(
      expect.objectContaining({ code: 'INVALID_AMOUNT_PRECISION' }),
    );
  });
});

describe('crediting', () => {
  it('adds the money', () => {
    expect(credit(account({ balanceMinor: 1_000 }), quetzales(500), NOW).account.balanceMinor).toBe(
      1_500,
    );
  });

  it('wakes an inactive account, and says so — invariant A-3', () => {
    const moved = credit(account({ balanceMinor: 0, status: 'INACTIVE' }), quetzales(500), NOW);

    expect(moved.account.status).toBe('ACTIVE');
    expect(moved.reactivated).toBe(true);
  });

  it('does not claim to have reactivated an account that was already active', () => {
    expect(credit(account({ balanceMinor: 0 }), quetzales(500), NOW).reactivated).toBe(false);
  });
});

describe('an incoming interbank credit', () => {
  it('refuses an inactive destination instead of reactivating it', () => {
    expect(() =>
      creditInterbank(account({ balanceMinor: 1_000, status: 'INACTIVE' }), quetzales(500), NOW),
    ).toThrow(expect.objectContaining({ code: 'ACCOUNT_INACTIVE' }));
  });
});

describe('compensating', () => {
  it('returns the money to an inactive account, because the alternative is losing it', () => {
    const moved = compensate(
      account({ balanceMinor: 0, status: 'INACTIVE' }),
      quetzales(2_500),
      null,
      NOW,
    );

    expect(moved.account.balanceMinor).toBe(2_500);
  });

  it('does not reactivate: the account was corrected, not used', () => {
    const moved = compensate(
      account({ balanceMinor: 0, status: 'INACTIVE' }),
      quetzales(2_500),
      null,
      NOW,
    );

    expect(moved.reactivated).toBe(false);
    expect(moved.account.status).toBe('INACTIVE');
  });

  /**
   * The debit this compensation reverses already moved the clock, at the
   * moment the customer asked for the transfer. The compensation itself is the
   * bank undoing its own failed payment attempt, not the customer coming back
   * — so it must not extend the inactivity deadline a second time.
   */
  it('does not refresh the inactivity clock — a correction is not activity', () => {
    const EARLIER = new Date('2026-01-15T09:00:00.000Z');
    const moved = compensate(account({ lastActivityAt: EARLIER }), quetzales(2_500), null, NOW);

    expect(moved.account.lastActivityAt).toEqual(EARLIER);
  });

  /**
   * T-29 correction: a compensated `AHORRO` transfer used to return the
   * transfer amount and keep the Q3.00 commission — the bank cancelled the
   * transfer and still charged a fee for money that never moved. Discovered
   * testing T-29's TIMEOUT scenario end to end; fixed by having the
   * repository hand `compensate` the commission the original debit charged.
   */
  it('folds a reversed commission into the amount that comes back', () => {
    const moved = compensate(
      account({ balanceMinor: 0, status: 'INACTIVE' }),
      quetzales(10_000),
      quetzales(300),
      NOW,
    );

    expect(moved.account.balanceMinor).toBe(10_300);
    expect(moved.amount).toEqual(quetzales(10_300));
    // Compensation itself never charges a commission of its own (T-27) — this
    // field is about a fee it levies, not a fee it happens to be undoing.
    expect(moved.commission).toBeNull();
  });

  it('is unchanged for a MONETARIA compensation, which never charged a commission', () => {
    const moved = compensate(account({ balanceMinor: 0 }), quetzales(2_500), null, NOW);

    expect(moved.account.balanceMinor).toBe(2_500);
    expect(moved.amount).toEqual(quetzales(2_500));
  });
});

/**
 * The four cases the ticket names as mandatory, one test each.
 *
 * They are the whole specification of the automatic process, and each one is a
 * boundary somebody could reasonably have implemented the other way.
 */
describe('the automatic deactivation, at its four boundaries', () => {
  const candidate = (balanceMinor: number, lastActivityAt: Date) => ({
    status: 'ACTIVE' as const,
    balanceMinor,
    lastActivityAt,
    openedAt: new Date('2020-01-01T00:00:00.000Z'),
  });

  const SIX_MONTHS_AGO = new Date('2026-02-26T12:00:00.000Z');
  const NOT_QUITE_SIX = new Date('2026-02-27T12:00:00.000Z');

  it('does not deactivate a balance of exactly Q50.00 — "menor a" is strict', () => {
    expect(shouldDeactivate(candidate(5_000, SIX_MONTHS_AGO), NOW)).toBe(false);
  });

  it('deactivates one centavo below Q50.00', () => {
    expect(shouldDeactivate(candidate(4_999, SIX_MONTHS_AGO), NOW)).toBe(true);
  });

  it('deactivates at exactly six months — "tras 6 meses" is reached, not passed', () => {
    expect(shouldDeactivate(candidate(0, SIX_MONTHS_AGO), NOW)).toBe(true);
  });

  it('does not deactivate one day short of six months', () => {
    expect(shouldDeactivate(candidate(0, NOT_QUITE_SIX), NOW)).toBe(false);
  });

  it('needs both conditions: money is not enough, and neither is time', () => {
    expect(shouldDeactivate(candidate(100_000, SIX_MONTHS_AGO), NOW)).toBe(false);
    expect(shouldDeactivate(candidate(0, NOT_QUITE_SIX), NOW)).toBe(false);
  });

  it('leaves an already inactive account alone, so the job is idempotent', () => {
    expect(shouldDeactivate({ ...candidate(0, SIX_MONTHS_AGO), status: 'INACTIVE' }, NOW)).toBe(
      false,
    );
  });

  it('falls back to the opening date for an account that never moved', () => {
    expect(
      shouldDeactivate(
        { status: 'ACTIVE', balanceMinor: 0, lastActivityAt: null, openedAt: SIX_MONTHS_AGO },
        NOW,
      ),
    ).toBe(true);
  });

  it('counts calendar months, clamping rather than rolling over a short February', () => {
    // 31 August minus six months is 31 February. Rolling over would give
    // 3 March — three days *later* than the anniversary, so an account would
    // survive three days longer than the rule says.
    expect(inactivityThreshold(new Date('2026-08-31T00:00:00.000Z'))).toEqual(
      new Date('2026-02-28T00:00:00.000Z'),
    );
  });

  it('takes its numbers from the criteria, so a demonstration need not wait six months', () => {
    const relaxed = { minBalanceMinor: 100_000, inactivityMonths: 1 };
    const lastMonth = new Date('2026-07-26T12:00:00.000Z');

    expect(shouldDeactivate(candidate(90_000, lastMonth), NOW, relaxed)).toBe(true);
    expect(shouldDeactivate(candidate(90_000, lastMonth), NOW, DEFAULT_CRITERIA)).toBe(false);
  });
});

/**
 * T-27: `AHORRO` and `MONETARIA` each carry a different rule
 * (`account-type-rules.ts`) — a per-debit commission for `AHORRO` only, no
 * floor on either type once open.
 */
describe('account type rules (T-27): the AHORRO commission', () => {
  const ahorro = (overrides: Partial<Account> = {}): Account => ({
    ...openAccount({
      accountId: '3a7d9e14-6b25-4f83-9c01-8e5a2d7b4f60',
      customerId: '9f1c8b2a-4d63-4e57-8a90-1b2c3d4e5f60',
      accountType: 'AHORRO' as const,
      now: NOW,
    }),
    accountNumber: '02-000000002',
    ...overrides,
  });

  it('charges no commission on MONETARIA — the event stays null, not zero', () => {
    const moved = debit(account({ balanceMinor: 10_000 }), quetzales(2_000), NOW);

    expect(moved.commission).toBeNull();
    expect(moved.account.balanceMinor).toBe(8_000);
  });

  it('charges AHORRO its Q3.00 commission on top of the amount, in one atomic movement', () => {
    const moved = debit(ahorro({ balanceMinor: 20_000 }), quetzales(2_000), NOW);

    // balanceAfter (outer) is after the amount alone — what account.debited.v1
    // carries; the account itself lands after amount + commission.
    expect(moved.balanceAfter).toEqual(quetzales(18_000));
    expect(moved.commission).toEqual({
      amount: quetzales(300),
      balanceAfter: quetzales(17_700),
    });
    expect(moved.account.balanceMinor).toBe(17_700);
  });

  it('lets an AHORRO debit empty the account — the minimum is an opening condition, not a floor', () => {
    // Balance 600: amount 300 plus the Q3.00 (300) commission leaves exactly 0.
    expect(debit(ahorro({ balanceMinor: 600 }), quetzales(300), NOW).account.balanceMinor).toBe(0);
  });

  it('never charges a commission on credit or compensation, only on debit', () => {
    expect(credit(ahorro({ balanceMinor: 0 }), quetzales(500), NOW).commission).toBeNull();
    expect(
      compensate(ahorro({ balanceMinor: 0 }), quetzales(500), null, NOW).commission,
    ).toBeNull();
  });
});

/**
 * T-27, corrected: the minimum balance is a condition of *opening* an
 * `AHORRO` account, checked once by `openingDepositRefusal` — never a floor
 * `debit` re-enforces afterward.
 */
describe('the AHORRO minimum opening deposit (T-27)', () => {
  it('refuses an AHORRO opening below Q100.00', () => {
    expect(openingDepositRefusal('AHORRO', 9_999)).toBe('MINIMUM_BALANCE_VIOLATION');
  });

  it('allows an AHORRO opening at exactly Q100.00', () => {
    expect(openingDepositRefusal('AHORRO', 10_000)).toBeNull();
  });

  it('allows an AHORRO opening above Q100.00', () => {
    expect(openingDepositRefusal('AHORRO', 50_000)).toBeNull();
  });

  it('never refuses a MONETARIA opening, whatever the deposit — including none', () => {
    expect(openingDepositRefusal('MONETARIA', 0)).toBeNull();
    expect(openingDepositRefusal('MONETARIA', 1)).toBeNull();
  });

  it('opens an account with the initial deposit as its starting balance', () => {
    const opened = openAccount({
      accountId: '3a7d9e14-6b25-4f83-9c01-8e5a2d7b4f60',
      customerId: '9f1c8b2a-4d63-4e57-8a90-1b2c3d4e5f60',
      accountType: 'AHORRO',
      now: NOW,
      initialDepositMinor: 10_000,
    });

    expect(opened.balanceMinor).toBe(10_000);
  });

  it('still opens at Q0.00 when no deposit is given, as before T-27', () => {
    expect(account().balanceMinor).toBe(0);
  });
});
