/**
 * The automatic deactivation the assignment requires, as one function.
 *
 * §4.1 (p. 4): an account is deactivated when it has been inactive for six
 * months **and** holds less than Q50.00. Both conditions, never one.
 *
 * Every boundary in that sentence is a decision somebody has to make, and the
 * assignment does not make them, so they are made here and stated out loud:
 *
 * - **Exactly Q50.00 does not deactivate.** "Menor a Q50.00" is strict. An
 *   account sitting on the threshold keeps its money.
 * - **Exactly six months does deactivate.** "Tras 6 meses" is reached, not
 *   passed. The comparison is `<=` against the threshold date.
 * - **Six calendar months, not 180 days.** 26 August → 26 February, whatever
 *   the month lengths in between. A day count would deactivate February
 *   accounts sooner than August ones for no reason anybody could defend.
 * - **An account with no movement counts from its opening.** `openAccount`
 *   sets `lastActivityAt` to the opening for exactly this reason; a `null`
 *   would make an untouched account immortal.
 *
 * The clock is a parameter. A policy that read `Date.now()` could only be
 * tested by waiting six months.
 */

/** Below this, in minor units, an account is eligible. Q50.00 exactly is not. */
export const MIN_BALANCE_MINOR = 5_000;

/** How long without a movement makes an account eligible. */
export const INACTIVITY_MONTHS = 6;

export interface DeactivationCandidate {
  readonly status: 'ACTIVE' | 'INACTIVE';
  readonly balanceMinor: number;
  readonly lastActivityAt: Date | null;
  readonly openedAt: Date;
}

export interface DeactivationCriteria {
  readonly minBalanceMinor: number;
  readonly inactivityMonths: number;
}

export const DEFAULT_CRITERIA: DeactivationCriteria = {
  minBalanceMinor: MIN_BALANCE_MINOR,
  inactivityMonths: INACTIVITY_MONTHS,
};

/**
 * The date on or before which a last movement makes an account eligible.
 *
 * Exposed because the repository needs it as a SQL parameter: selecting the
 * candidates in the database rather than filtering a full table scan in Node is
 * the difference between a job that finishes and one that does not. Sharing the
 * function is what keeps the two from disagreeing.
 */
export function inactivityThreshold(
  now: Date,
  months: number = INACTIVITY_MONTHS,
): Date {
  const threshold = new Date(now.getTime());

  /**
   * `setUTCMonth` rolls over rather than clamping: 31 August minus six months
   * is 31 February, which becomes 3 March — three days *later* than the
   * account's anniversary, so an account would survive three days too long.
   * Clamping to the last day of the target month is what "six months earlier"
   * means to a person.
   */
  const day = threshold.getUTCDate();
  threshold.setUTCDate(1);
  threshold.setUTCMonth(threshold.getUTCMonth() - months);
  threshold.setUTCDate(Math.min(day, daysInUtcMonth(threshold)));

  return threshold;
}

/** Whether this account meets both conditions right now. */
export function shouldDeactivate(
  account: DeactivationCandidate,
  now: Date,
  criteria: DeactivationCriteria = DEFAULT_CRITERIA,
): boolean {
  if (account.status !== 'ACTIVE') {
    return false;
  }

  if (account.balanceMinor >= criteria.minBalanceMinor) {
    return false;
  }

  const since = account.lastActivityAt ?? account.openedAt;

  return since.getTime() <= inactivityThreshold(now, criteria.inactivityMonths).getTime();
}

function daysInUtcMonth(date: Date): number {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
}
