import type { Role } from './navigation';
import type { AuditEvent, CommandOutcome } from './customer';

/**
 * Everything the Cuentas module *decides*, as plain functions.
 *
 * The frontend has no component-test framework (TD-010), so a rule written
 * inside a `.vue` file is a rule nobody can assert on. This module exists so
 * that the parts of the module that can be wrong — whether an identifier is
 * worth sending, whether an account is about to be deactivated, what a status
 * means to a person — are verifiable without a browser, exactly as
 * `navigation.ts` does for the permission matrix.
 *
 * Nothing here talks to the Gateway.
 */

export type AccountType = 'MONETARIA' | 'AHORRO';
export type AccountStatus = 'ACTIVE' | 'INACTIVE';
export type OperationType = 'DEBIT' | 'CREDIT' | 'COMPENSATION' | 'COMMISSION';
export type OperationStatus = 'APPLIED' | 'COMPENSATED';

/** Money as `GET /api/accounts` sends it. */
export interface WireMoney {
  readonly amountMinor: number;
  readonly currency: string;
}

export interface AccountSummary {
  readonly accountId: string;
  readonly customerId: string;
  /**
   * The holder's name, when the Gateway could resolve it.
   *
   * **Optional, and absent rather than null.** Account Service holds only the
   * opaque `customerId` and may not read Customer Service's database (§8.2,
   * 2.3); the Gateway composes the two replies and leaves the field out when it
   * could not — a client asking, a name lookup that timed out, a broker that is
   * away. A screen can then tell "we did not get a name" from "there is no
   * name" and fall back to the identifier it already had, instead of rendering
   * an empty cell that reads as a missing customer. Closes TD-026.
   */
  readonly holderName?: string;
  readonly accountType: AccountType;
  readonly balance: WireMoney;
  readonly status: AccountStatus;
  readonly lastActivityAt: string | null;
  readonly openedAt: string;
}

export interface AccountOperation {
  readonly operationId: string;
  readonly type: OperationType;
  readonly amount: WireMoney;
  readonly balanceAfter: WireMoney;
  readonly transactionId: string | null;
  readonly status: OperationStatus;
  readonly occurredAt: string;
}

export interface AccountTypePresentation {
  readonly label: string;
  /** The two-letter mark the prototype puts in the type column. */
  readonly mark: string;
  readonly description: string;
  /**
   * The initial deposit this type requires to open, in minor units — `null`
   * when it requires none. T-27 (Fase 2, §4.1 p. 6): a condition of *opening*
   * the account, never a floor re-enforced afterward — an `AHORRO` account may
   * be emptied by transfers down to Q0.00 once it exists.
   */
  readonly minimumOpeningDepositMinor: number | null;
}

/**
 * What each account type is, in the words a person opening one needs.
 *
 * **The `AHORRO` copy departs from the prototype**, which reads "Genera
 * intereses" — an interest rate this system does not pay. What `AHORRO` does
 * have, since T-27, is a Q100.00 minimum to open it and a Q3.00 commission on
 * every transfer out of it — real rules, said as what they are rather than
 * as a product feature the backend cannot honour.
 */
export const ACCOUNT_TYPE_PRESENTATION: Readonly<
  Record<AccountType, AccountTypePresentation>
> = {
  MONETARIA: {
    label: 'Monetaria',
    mark: 'MO',
    description: 'Uso diario, transferencias y pagos sin límite de movimientos ni saldo mínimo.',
    minimumOpeningDepositMinor: null,
  },
  AHORRO: {
    label: 'Ahorro',
    mark: 'AH',
    description: 'Para guardar dinero. Requiere un depósito inicial de Q100.00 y cobra Q3.00 de comisión por cada transferencia.',
    minimumOpeningDepositMinor: 10_000,
  },
};

export interface StatusPresentation {
  readonly label: string;
  readonly color: 'success' | 'warning' | 'error' | 'neutral';
  readonly explanation: string;
}

/**
 * What a status means, and what it stops you doing.
 *
 * `INACTIVE` is amber rather than grey on purpose: it is not "nothing is
 * happening", it is the state in which no transfer can leave this account. A
 * neutral chip would read as incidental, and somebody would wonder why their
 * transfer keeps being refused.
 */
export const ACCOUNT_STATUS_PRESENTATION: Readonly<Record<AccountStatus, StatusPresentation>> = {
  ACTIVE: {
    label: 'Activa',
    color: 'success',
    explanation: 'La cuenta opera con normalidad.',
  },
  INACTIVE: {
    label: 'Inactiva',
    color: 'warning',
    explanation:
      'No se puede debitar de esta cuenta. Un depósito la reactiva automáticamente, ' +
      'o un administrador puede hacerlo a mano.',
  },
};

export const OPERATION_PRESENTATION: Readonly<
  Record<OperationType, { readonly label: string; readonly sign: '+' | '−' }>
> = {
  DEBIT: { label: 'Débito', sign: '−' },
  CREDIT: { label: 'Crédito', sign: '+' },
  COMPENSATION: { label: 'Compensación', sign: '+' },
  /*
   * The Q3.00 a savings account charges on every debit (T-27). It was missing
   * from this table, and an account with one such debit lost its whole statement:
   * the row's label was read off `undefined` and the screen stopped drawing.
   */
  COMMISSION: { label: 'Comisión', sign: '−' },
};

/**
 * Whether this string is worth sending as an identifier.
 *
 * Version 4 specifically, because that is what the Gateway's own regular
 * expression accepts — a `400` the interface could have prevented is a `400`
 * somebody has to interpret.
 */
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuidV4(value: string): boolean {
  return UUID_V4.test(value.trim());
}

/**
 * The automatic deactivation, mirrored from the service that performs it.
 *
 * **These two numbers and the comparisons below must agree with
 * `apps/services/account-service/src/domain/deactivation-policy.ts`.** They are
 * duplicated rather than shared because `apps/web` depends on no service, and a
 * warning that disagreed with the job would be worse than no warning: it would
 * tell somebody their account is safe on the day it is deactivated. A test
 * asserts the same four boundaries on this side that the service asserts on its
 * own.
 */
export const INACTIVITY_MONTHS = 6;
export const INACTIVITY_MIN_BALANCE_MINOR = 5_000;

export interface DeactivationRisk {
  readonly atRisk: boolean;
  /** Whole days until the account qualifies. Negative once it already does. */
  readonly daysRemaining: number;
  readonly deactivatesOn: Date;
}

/**
 * When this account will be deactivated automatically, if nothing moves.
 *
 * Reproduces the prototype's `acctWarn` banner. Only accounts that are still
 * `ACTIVE` and already below the floor are at risk — an account with money in
 * it is never a candidate, however long it sits.
 */
export function deactivationRisk(
  account: Pick<AccountSummary, 'balance' | 'status' | 'lastActivityAt' | 'openedAt'>,
  now: Date,
): DeactivationRisk {
  const since = new Date(account.lastActivityAt ?? account.openedAt);
  const deactivatesOn = addMonths(since, INACTIVITY_MONTHS);
  const daysRemaining = Math.ceil(
    (deactivatesOn.getTime() - now.getTime()) / (24 * 60 * 60 * 1_000),
  );

  const eligible =
    account.status === 'ACTIVE' && account.balance.amountMinor < INACTIVITY_MIN_BALANCE_MINOR;

  return { atRisk: eligible, daysRemaining, deactivatesOn };
}

/**
 * Six calendar months later, clamped rather than rolled over.
 *
 * `setUTCMonth` turns 31 August into 31 February and then into 3 March. The
 * service clamps to the last day of the target month, so this does too — a
 * warning three days out of step with the job is a warning that lies on
 * exactly the days it matters.
 */
function addMonths(date: Date, months: number): Date {
  const result = new Date(date.getTime());
  const day = result.getUTCDate();

  result.setUTCDate(1);
  result.setUTCMonth(result.getUTCMonth() + months);
  result.setUTCDate(Math.min(day, daysInUtcMonth(result)));

  return result;
}

function daysInUtcMonth(date: Date): number {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
}

/**
 * Who may deactivate or reactivate an account by hand.
 *
 * Decision D-06: "Deactivate or reactivate an account manually — ✘ ✘ ✔". The
 * Gateway enforces it with `@Roles('ADMINISTRADOR')` on
 * `POST /api/accounts/:accountId/status`, and Account Service checks it again
 * because that message could arrive from anywhere on the broker.
 *
 * **This is convenience, not defence** — the same status `navigation.ts` gives
 * `canOpen`. It exists so the interface does not offer a screen whose every
 * request would come back `403`. It lives here rather than inside
 * `/cuentas/administracion.vue` because a decision written into a template is a
 * decision nobody can assert on (TD-010), and because `navigation-parity` needs
 * something to compare the Gateway's decorator against.
 *
 * It is deliberately **not** a fifth entry in `MODULES`: the four modules are
 * fixed and asserted by a test, and `docs/FRONTEND.md` says a module that needs
 * a role-restricted screen filters in the page.
 */
export function mayManageAccounts(role: Role | null): boolean {
  return role === 'ADMINISTRADOR' || role === 'CAJERO_RECEPTOR';
}

/**
 * What to write in a "Titular" cell: the name when there is one, the identifier
 * when there is not.
 *
 * A function rather than a template expression so the fallback is asserted
 * rather than assumed — the interesting case is the one where the composition
 * failed, and that is exactly the case a template makes invisible (TD-010).
 */
export function holderLabel(account: AccountSummary): string {
  return account.holderName ?? account.customerId;
}

/** Whether the holder cell is showing a name or falling back to an identifier. */
export function holderIsName(account: AccountSummary): boolean {
  return account.holderName !== undefined;
}

/**
 * Who may register a deposit at a window: staff, and no client.
 *
 * The sibling of `mayManageAccounts`, restricted one step wider because a
 * deposit is a teller's daily work rather than an administrator's intervention.
 * It carries the same caveat and for the same reason: **convenience, not
 * defence**. The Gateway restricts the route with `@Roles` and Account Service
 * refuses the command outright — a deposit mints money into an account from
 * outside the system, so the service that moves the balance checks too rather
 * than trusting the edge.
 *
 * Also deliberately not a navigation entry. The deposit window is a screen
 * inside Cuentas, which everybody sees; `docs/FRONTEND.md` says a module that
 * needs a role-restricted screen filters in the page.
 */
export function mayTakeDeposits(role: Role | null): boolean {
  return role === 'CAJERO_RECEPTOR' || role === 'ADMINISTRADOR';
}

/**
 * How an account opening ended, read from the audit trail — or `null` to wait.
 *
 * The same shape `outcomeFromAudit` has for customers, and it exists separately
 * because the message names differ, not because the logic does. Both are handed
 * to `useCommandOutcome`, which owns the waiting.
 */
export function outcomeFromAccountAudit(events: readonly AuditEvent[]): CommandOutcome | null {
  const types = new Set(events.map((event) => event.messageType));

  if (types.has('account.opened.v1')) {
    return 'SUCCESS';
  }

  if (types.has('account.open.rejected.v1')) {
    return 'BUSINESS_REJECTION';
  }

  return null;
}

/** The total of a set of accounts, for the consolidated figure the prototype shows. */
export function totalBalanceMinor(accounts: readonly AccountSummary[]): number {
  return accounts.reduce((total, account) => total + account.balance.amountMinor, 0);
}
