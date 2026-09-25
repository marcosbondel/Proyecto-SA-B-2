import type { AccountType } from './account';

/**
 * The rules each account type carries (Fase 2, §4.1 p. 6: "Definir reglas:
 * Límite de saldo mínimo, Comisión por transacción (opcional)").
 *
 * Fixed per type, not configurable per account — the assignment asks for
 * "reglas diferentes y verificables para cada tipo", which a value attached to
 * the type itself satisfies directly. Same shape of decision as
 * `deactivation-policy.ts`: the assignment does not name the amounts, so they
 * are picked here and stated out loud rather than left implicit.
 *
 * The two rules are independent, and deliberately checked at different
 * moments:
 *
 * - **Minimum balance** (`AHORRO_MINIMUM_OPENING_BALANCE_MINOR`) is a
 *   condition of *opening* an `AHORRO` account — the initial deposit must
 *   reach Q100.00 — checked once by `openingDepositRefusal`, never again.
 *   Once open, an `AHORRO` account may be debited down to Q0.00 like any
 *   other; the assignment's "saldo mínimo" is an entry requirement, not a
 *   floor the domain re-enforces on every movement. `MONETARIA` has none —
 *   it keeps opening at Q0.00 exactly as it did before T-27.
 * - **Commission** (`commissionMinor`) is charged on every `AHORRO` debit,
 *   forever, which is what makes "opcional" true as a fact about the system:
 *   `MONETARIA` never charges one, `AHORRO` always does.
 *
 * `commissionMinor: null` is not "commission zero" — it is "this type has no
 * commission rule at all", which is why `debit()` and the repository branch on
 * `!== null` rather than `> 0`.
 */
export interface AccountTypeRule {
  readonly commissionMinor: number | null;
}

export const ACCOUNT_TYPE_RULES: Readonly<Record<AccountType, AccountTypeRule>> = {
  MONETARIA: { commissionMinor: null },
  AHORRO: { commissionMinor: 300 },
};

/** The rule for a type, looked up in one place so nobody indexes the map by hand. */
export function ruleFor(accountType: AccountType): AccountTypeRule {
  return ACCOUNT_TYPE_RULES[accountType];
}

/** The initial deposit an `AHORRO` opening must reach. Q100.00. */
export const AHORRO_MINIMUM_OPENING_BALANCE_MINOR = 10_000;
