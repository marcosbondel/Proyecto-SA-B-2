/** The smallest amount this system will move: one centavo. */
export const MIN_AMOUNT_MINOR = 1;

/**
 * Money as it is written for a person, in `es-GT`.
 *
 * Always two decimals, always a thousands separator, always the `Q` prefix.
 * Consistency matters more than brevity here: a column of amounts is scanned,
 * not read, and one row rendered `Q 1,250` next to `Q 1,250.00` costs the
 * reader a double-take on the one thing they cannot afford to misread.
 */
export function formatQuetzales(amountMinor: number): string {
  const formatted = new Intl.NumberFormat('es-GT', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amountMinor / 100);

  return `Q ${formatted}`;
}

/**
 * A decimal amount as the wire wants it: an integer of minor units.
 *
 * Floating-point money is a defect waiting for a reconciliation report, so the
 * conversion rounds once, here, and never again. Every module gets this for
 * free rather than each remembering to multiply by a hundred.
 */
export function toAmountMinor(amount: number): number {
  /**
   * Binary floating point puts `19.99 * 100` at 1998.9999999999998 and
   * `1.005 * 100` at 100.49999999999999. Rounding those directly gives 1999
   * (right, by luck) and 100 (wrong). Normalising to a fixed number of digits
   * first removes the artefact, without pulling a decimal library into a
   * demonstration for the sake of four decimal places nobody will ever send.
   */
  return Math.round(Number((amount * 100).toFixed(4)));
}

/** The inverse, for putting a wire amount back into an input. */
export function toDecimal(amountMinor: number): number {
  return amountMinor / 100;
}

export type AmountProblem = 'NOT_A_NUMBER' | 'TOO_SMALL' | 'TOO_PRECISE';

/**
 * Why an amount cannot be sent, or `null` when it can.
 *
 * Returns the reason rather than a boolean so the field can say what is wrong
 * instead of just refusing.
 */
export function amountProblem(amount: number): AmountProblem | null {
  if (!Number.isFinite(amount)) {
    return 'NOT_A_NUMBER';
  }

  if (toAmountMinor(amount) < MIN_AMOUNT_MINOR) {
    return 'TOO_SMALL';
  }

  /**
   * Anything finer than a centavo cannot be represented on the wire, and
   * silently rounding somebody's money is not an option.
   *
   * The comparison is against the round trip rather than against the raw
   * multiplication: `19.99 * 100` is off by 2e-13 in binary floating point, and
   * an epsilon tight enough to catch a real third decimal would reject that
   * perfectly ordinary amount.
   */
  if (Math.abs(amount - toDecimal(toAmountMinor(amount))) > 1e-9) {
    return 'TOO_PRECISE';
  }

  return null;
}

/** A date as `es-GT` writes it. */
export function formatDate(iso: string): string {
  return new Intl.DateTimeFormat('es-GT', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(iso));
}
