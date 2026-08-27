/**
 * Money, as this service is allowed to hold it.
 *
 * One rule, enforced in one place: **an amount is an integer of minor units and
 * never anything else**. `NUMERIC(14,2)` in the database and `amountMinor` on
 * the wire agree on that; the gap between them is the only place a `0.1 + 0.2`
 * could get in, so the conversion lives here and in SQL, never in a call site.
 *
 * **This file imports nothing**, `@bank/contracts` included. The lint rules
 * forbid it and the design agrees: how money behaves has to be readable and
 * testable with no transport in sight.
 *
 * It is deliberately a near-copy of `account-service/src/domain/money.ts`.
 * Sharing it would mean a package two services import, and the two services
 * would then be coupled through the one thing constitution II says they must
 * not share. The duplication is small, both copies are tested, and the column
 * type is the real contract between them.
 */

/** Structurally the contracts' `money`, declared here so the domain imports nothing. */
export interface Money {
  readonly amountMinor: number;
  readonly currency: string;
}

/**
 * Why an amount cannot start a transfer.
 *
 * Two codes and not one, because they are two different mistakes. `INVALID_AMOUNT`
 * is invariant T-1 — zero or negative, a request that means nothing.
 * `INVALID_AMOUNT_PRECISION` is A-6 — a real amount this system cannot represent
 * exactly, which is refused rather than rounded, because silently changing
 * somebody's amount is worse than making them retype it.
 */
export type AmountRejection = 'INVALID_AMOUNT' | 'INVALID_AMOUNT_PRECISION';

/** The only currency this system moves. */
export const CURRENCY = 'GTQ';

/** The smallest amount that means anything: one centavo. */
export const MIN_AMOUNT_MINOR = 1;

/**
 * `NUMERIC(14,2)` holds twelve digits before the point. Anything larger is not
 * a large transfer, it is a bug about to be written to a column that will
 * refuse it — better refused here, with a name.
 */
export const MAX_AMOUNT_MINOR = 999_999_999_999_99;

/** Why an amount cannot be used, or `null` when it can. */
export function amountProblem(amount: Money): AmountRejection | null {
  if (!Number.isSafeInteger(amount.amountMinor)) {
    return 'INVALID_AMOUNT_PRECISION';
  }

  // T-1 first: zero and negative are the invariant's own case, and reporting
  // them as a precision problem would send the caller looking at their decimals.
  if (amount.amountMinor < MIN_AMOUNT_MINOR) {
    return 'INVALID_AMOUNT';
  }

  if (amount.currency !== CURRENCY || amount.amountMinor > MAX_AMOUNT_MINOR) {
    return 'INVALID_AMOUNT_PRECISION';
  }

  return null;
}

/** An amount of minor units, written the way the contracts want it. */
export function quetzales(amountMinor: number): Money {
  return { amountMinor, currency: CURRENCY };
}

/** Whether two amounts are the same amount. Used to judge an idempotent retry. */
export function sameAmount(left: Money, right: Money): boolean {
  return left.amountMinor === right.amountMinor && left.currency === right.currency;
}

/**
 * A `NUMERIC(14,2)` as `pg` hands it over — a string — turned into minor units.
 *
 * `pg` returns `NUMERIC` as a string precisely so the driver does not lose
 * precision, and `Number('0.07') * 100` is 7.000000000000001. Parsing the two
 * sides of the decimal point separately is exact for every value the column can
 * hold, which multiplying is not.
 */
export function minorUnitsFromNumeric(value: string): number {
  const match = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(value.trim());

  if (match === null) {
    throw new Error(`"${value}" is not a NUMERIC(14,2) this service can read.`);
  }

  const [, sign, whole, fraction = ''] = match;
  const centavos = Number(`${whole!}${fraction.padEnd(2, '0')}`);

  return sign === '-' ? -centavos : centavos;
}

/** The inverse, for handing an amount to a `NUMERIC` parameter. */
export function numericFromMinorUnits(amountMinor: number): string {
  const sign = amountMinor < 0 ? '-' : '';
  const absolute = Math.abs(amountMinor);

  return `${sign}${String(Math.trunc(absolute / 100))}.${String(absolute % 100).padStart(2, '0')}`;
}
