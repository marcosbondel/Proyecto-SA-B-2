/**
 * What counts as an account being used too often (Fase 3, §4.1 — Account
 * Service, T-42), as two small functions and nothing else.
 *
 * "Más de N operaciones sobre una misma cuenta en una ventana de M minutos":
 * every word of that sentence is a decision, and the assignment leaves them to
 * the team, so they are made here and stated out loud.
 *
 * - **More than N means N + 1.** Ten operations in five minutes is allowed; the
 *   eleventh is the anomaly. A limit that fired *at* N would flag an account for
 *   doing exactly what the rule says is fine.
 * - **The window slides.** It is the M minutes before the operation that was
 *   just applied, not a clock-aligned bucket. A fixed bucket would miss a burst
 *   of ten that straddles the boundary, which is precisely when somebody is
 *   trying to stay under it.
 * - **Only debits and credits count.** A deposit enters as a credit. A
 *   commission is the bank's own fee derived from a debit, and a compensation is
 *   the system undoing one: counting either would flag a single transfer that
 *   went wrong as several operations by the customer.
 * - **One alert per window, not one per operation.** After an anomaly the same
 *   account is quiet for M minutes (`isCoolingDown`), so a burst of thirty
 *   operations is one event rather than twenty.
 *
 * The clock is a parameter. A rule that read `Date.now()` could only be tested
 * by waiting five minutes.
 */

/** The two numbers the rule is made of, both configuration. */
export interface ActivityRule {
  /** "N": the most operations allowed inside the window. */
  readonly maxOperations: number;
  /** "M": the length of the window, in minutes. */
  readonly windowMinutes: number;
}

/** The assignment's suggested values: ten operations in five minutes. */
export const DEFAULT_ACTIVITY_RULE: ActivityRule = { maxOperations: 10, windowMinutes: 5 };

/** The movement types that count towards the rule. */
export const COUNTED_OPERATION_TYPES = ['DEBIT', 'CREDIT'] as const;

/**
 * How long a detector may hold an anomaly it has recorded but not yet
 * published before another may take it over. Long enough that a slow publish
 * is not mistaken for a lost one, short enough that a crashed pod's anomaly is
 * announced by the next movement on that account.
 */
export const ANOMALY_CLAIM_TTL_MS = 60_000;

const MS_PER_MINUTE = 60_000;

/** When the window that ends at `now` begins. */
export function windowStart(now: Date, rule: ActivityRule): Date {
  return new Date(now.getTime() - rule.windowMinutes * MS_PER_MINUTE);
}

/** Strictly more than `maxOperations`: the eleventh, with the default of ten. */
export function exceedsLimit(operationCount: number, rule: ActivityRule): boolean {
  return operationCount > rule.maxOperations;
}

/**
 * Whether an anomaly detected at `detectedAt` still covers `now`.
 *
 * Inside it, a further burst on the same account is the same anomaly. The
 * boundary is exclusive on the far side — exactly M minutes later the account
 * is eligible again — mirroring how `windowStart` excludes the operation made
 * exactly M minutes ago.
 */
export function isCoolingDown(detectedAt: Date, now: Date, rule: ActivityRule): boolean {
  return detectedAt.getTime() > windowStart(now, rule).getTime();
}
