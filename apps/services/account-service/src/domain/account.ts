import { AHORRO_MINIMUM_OPENING_BALANCE_MINOR, ruleFor } from './account-type-rules';
import { amountProblem } from './money';
import type { Money } from './money';

/**
 * The vocabulary, spelled out rather than imported.
 *
 * `@bank/contracts` has the same three enums and the lint rules forbid reaching
 * for them here — rightly. A domain that imported its own vocabulary from the
 * wire format would be a domain that changes shape when the wire does, and the
 * dependency would point outward.
 */
export type AccountType = 'MONETARIA' | 'AHORRO';
export type AccountStatus = 'ACTIVE' | 'INACTIVE';
export type Role = 'CLIENTE' | 'CAJERO_RECEPTOR' | 'ADMINISTRADOR';

/** The refusals this aggregate can produce, from the catalogue's closed set. */
export type RejectionCode =
  | 'INSUFFICIENT_FUNDS'
  | 'ACCOUNT_INACTIVE'
  | 'ACCOUNT_NOT_FOUND'
  | 'INVALID_AMOUNT_PRECISION'
  | 'ROLE_NOT_ELIGIBLE'
  | 'FORBIDDEN_ACCOUNT_ACCESS'
  /**
   * Added by T-27 (Fase 2, §4.1 p. 6). Distinct from `INSUFFICIENT_FUNDS`: the
   * account has enough to cover the amount, but not enough to also stay above
   * its type's floor once the amount — and the commission, when the type
   * charges one — has left (`account-type-rules.ts`).
   */
  | 'MINIMUM_BALANCE_VIOLATION';

/**
 * The aggregate this service exists to protect.
 *
 * Everything that can refuse a movement is decided here, on plain data, so it
 * can be argued with and tested without a database. What the domain **cannot**
 * decide is which of two concurrent debits wins — that is a lock, and a lock
 * lives in the repository. The division matters: a rule expressed as a
 * read-then-write in the application layer is a rule that holds only when
 * nobody is in a hurry.
 */
export interface Account {
  readonly accountId: string;
  /**
   * El número con el que **otro banco** identifica esta cuenta (T-56).
   *
   * `02-NNNNNNNNN`, y existe porque el contrato interbancario define
   * `AccountNumber` como `^[A-Za-z0-9-]{1,34}$`: un UUID con guiones son 36
   * caracteres y **no cabe**. No es un alias de conveniencia, es el único
   * identificador de esta cuenta que puede cruzar la frontera.
   *
   * Lo asigna la base al abrir la cuenta, de una secuencia, así que el dominio
   * lo recibe y no lo inventa.
   */
  readonly accountNumber: string;
  /** An opaque reference to a customer this service never reads (§8.2, 2.3). */
  readonly customerId: string;
  readonly accountType: AccountType;
  readonly balanceMinor: number;
  readonly status: AccountStatus;
  /** Last confirmed movement, not last read (A-4). `null` until the first one. */
  readonly lastActivityAt: Date | null;
  readonly openedAt: Date;
  /** Optimistic lock. Every accepted movement advances it by one. */
  readonly version: number;
}

/**
 * Una cuenta **antes de existir**: lo mismo, sin número de cuenta.
 *
 * El número lo asigna la secuencia de la base al insertar, así que entre
 * «decidir abrir una cuenta» y «la cuenta existe» hay un momento en el que el
 * número no se sabe — y decirlo en el tipo evita la alternativa, que sería
 * inventarlo en el dominio o dejar el campo nulable para siempre por culpa de
 * un instante.
 */
export type NewAccount = Omit<Account, 'accountNumber'>;

/**
 * A refusal the domain is entitled to make, carrying a code from the closed
 * vocabulary rather than a sentence.
 *
 * It is an error class and not a returned union because every caller of these
 * methods treats a refusal the same way — publish the rejection, change
 * nothing — and threading a union through four use cases buys nothing for that.
 */
export class DomainRejection extends Error {
  public readonly code: RejectionCode;

  constructor(code: RejectionCode, detail?: string) {
    super(detail ?? code);
    this.name = 'DomainRejection';
    this.code = code;
  }
}

/** What a movement produced: the new account, and the amount that moved. */
export interface Movement {
  readonly account: Account;
  readonly amount: Money;
  readonly balanceAfter: Money;
  /** Only a credit can set this: it is what tells Notification an account woke up. */
  readonly reactivated: boolean;
  /**
   * The commission charged alongside this movement, or `null` when the
   * account's type charges none (T-27, `account-type-rules.ts`). Only `debit`
   * can set this — a commission is levied on money leaving, never on money
   * arriving or on a compensation undoing the bank's own mistake.
   * `balanceAfter` here is the account's balance once the amount **and** the
   * commission have both left, matching `account.balanceMinor` after the
   * movement; the outer `Movement.balanceAfter` is the intermediate figure,
   * after the amount alone — the number `account.debited.v1` carries, since
   * that event must never reflect the commission.
   */
  readonly commission: { readonly amount: Money; readonly balanceAfter: Money } | null;
}

/**
 * Opens an account. Status ACTIVE, no activity yet, balance the initial
 * deposit — Q0.00 when the caller gives none, which is every `MONETARIA`
 * opening and every `AHORRO` opening the domain already refused via
 * `openingDepositRefusal`.
 *
 * `lastActivityAt` starts at the opening rather than at `null` because the
 * deactivation job counts inactivity from *something*, and an account opened
 * and never touched is inactive from the day it was opened — not exempt
 * forever, which is what a `null` treated as "no deadline" would mean.
 */
export function openAccount(input: {
  readonly accountId: string;
  readonly customerId: string;
  readonly accountType: AccountType;
  readonly now: Date;
  readonly initialDepositMinor?: number;
}): NewAccount {
  return {
    accountId: input.accountId,
    customerId: input.customerId,
    accountType: input.accountType,
    balanceMinor: input.initialDepositMinor ?? 0,
    status: 'ACTIVE',
    lastActivityAt: input.now,
    openedAt: input.now,
    version: 0,
  };
}

/**
 * Whether an opening's initial deposit meets its type's requirement (T-27,
 * corrected: this is a condition of *opening* the account, not of keeping it
 * funded afterward — `debit` enforces no floor of its own).
 *
 * Only `AHORRO` has one. `MONETARIA` never refuses here, whatever the amount
 * — including none at all, which keeps every existing `MONETARIA` opening
 * (no deposit, criterion 1's Q0.00) exactly as it was before T-27.
 */
export function openingDepositRefusal(
  accountType: AccountType,
  initialDepositMinor: number,
): 'MINIMUM_BALANCE_VIOLATION' | null {
  if (accountType !== 'AHORRO') {
    return null;
  }

  return initialDepositMinor < AHORRO_MINIMUM_OPENING_BALANCE_MINOR
    ? 'MINIMUM_BALANCE_VIOLATION'
    : null;
}

/**
 * Whether this actor may open an account for this subject.
 *
 * The two things it can judge, it judges; the one it cannot, it does not
 * pretend to. A `CLIENTE` acting for somebody else is
 * `FORBIDDEN_ACCOUNT_ACCESS`, and staff holding an account is
 * `ROLE_NOT_ELIGIBLE` (invariant C-6). Whether the subject exists at all is
 * Customer Service's knowledge, and asking would be a synchronous read across a
 * boundary the assignment forbids — so an account may be opened for a
 * `customerId` that never existed, and the audit trail is where that shows up.
 */
export function openingRefusal(
  actor: { readonly customerId: string; readonly role: Role },
  subjectCustomerId: string,
): RejectionCode | null {
  if (actor.role === 'CLIENTE') {
    return actor.customerId === subjectCustomerId ? null : 'FORBIDDEN_ACCOUNT_ACCESS';
  }

  // Staff opening for themselves: C-6 says only a CLIENTE holds accounts.
  return actor.customerId === subjectCustomerId ? 'ROLE_NOT_ELIGIBLE' : null;
}

/**
 * Whether this actor may order a debit from this account (D-06, CDU003.1).
 *
 * "Transferir fondos: Cliente desde cuentas propias | Cajero en ventanilla |
 * Administrador". A `CLIENTE` debits their own accounts and no others; staff
 * originate on behalf of a customer, so no ownership is asked of them. The
 * `role` comes from the verified session, so a customer cannot present as staff.
 *
 * A `null` actor is **no one**: a debit that nobody ordered is not a debit the
 * system may make on its own initiative. The Saga's commands carry the identity
 * of whoever started the transfer, and one that arrives without it is refused
 * rather than trusted.
 *
 * Evaluated inside the row lock, next to `debit`, so the answer is about the
 * row that is actually being changed and not about a copy read a moment before.
 */
export function mayDebit(
  actor: { readonly customerId: string; readonly role: Role } | null,
  account: Pick<Account, 'customerId'>,
): boolean {
  if (actor === null) {
    return false;
  }

  return actor.role === 'CLIENTE' ? actor.customerId === account.customerId : true;
}

/**
 * Takes money out. Refuses rather than going negative.
 *
 * The order of the checks is the order of the answers a caller deserves: a
 * malformed amount is not an insufficient balance, and an inactive account is
 * not either. Collapsing them into one "cannot debit" would make the Saga
 * compensate for reasons it could not distinguish.
 *
 * `debit`'s own version of `moved`: the only movement that can carry a
 * commission (T-27, `account-type-rules.ts`), so it is not folded into the
 * generic `moved` that `credit` and `compensate` share. There is **no**
 * minimum-balance floor here — a debit may empty the account down to Q0.00.
 * The type's minimum, where it has one, is a requirement for *opening* the
 * account (`openingDepositRefusal`), not for keeping it funded afterward.
 */
export function debit(account: Account, amount: Money, now: Date): Movement {
  const problem = amountProblem(amount);

  if (problem !== null) {
    throw new DomainRejection(problem, 'El monto no cumple la precisión del contrato.');
  }

  if (account.status !== 'ACTIVE') {
    throw new DomainRejection('ACCOUNT_INACTIVE', 'La cuenta no está activa.');
  }

  const rule = ruleFor(account.accountType);
  const commissionMinor = rule.commissionMinor ?? 0;
  const totalMinor = amount.amountMinor + commissionMinor;

  if (account.balanceMinor < totalMinor) {
    throw new DomainRejection('INSUFFICIENT_FUNDS', 'El saldo disponible no alcanza.');
  }

  const balanceAfterAmount = account.balanceMinor - amount.amountMinor;
  const balanceAfterTotal = balanceAfterAmount - commissionMinor;

  return {
    account: {
      ...account,
      balanceMinor: balanceAfterTotal,
      lastActivityAt: now,
      version: account.version + 1,
    },
    amount,
    balanceAfter: { amountMinor: balanceAfterAmount, currency: amount.currency },
    reactivated: false,
    commission:
      rule.commissionMinor === null
        ? null
        : {
            amount: { amountMinor: rule.commissionMinor, currency: amount.currency },
            balanceAfter: { amountMinor: balanceAfterTotal, currency: amount.currency },
          },
  };
}

/**
 * Puts money in, and wakes the account if it was asleep.
 *
 * Invariant A-3: a credit to an INACTIVE account reactivates it. That is not a
 * convenience — an account that could receive money while staying inactive
 * would hold a balance nobody could move.
 */
export function credit(account: Account, amount: Money, now: Date): Movement {
  const problem = amountProblem(amount);

  if (problem !== null) {
    throw new DomainRejection(problem, 'El monto no cumple la precisión del contrato.');
  }

  return moved(account, amount.amountMinor, amount, account.status === 'INACTIVE', now, true);
}

/** An external bank may deposit only into an account that is active now. */
export function creditInterbank(account: Account, amount: Money, now: Date): Movement {
  if (account.status !== 'ACTIVE') {
    throw new DomainRejection('ACCOUNT_INACTIVE', 'La cuenta destino no está activa.');
  }

  return credit(account, amount, now);
}

/**
 * Returns a debit that should not have happened.
 *
 * Deliberately **not** `credit` with a different event name. A compensation
 * restores a specific debit and must succeed even for an account that has since
 * been deactivated — refusing it would strand the money outside every account
 * in the system, which is the one outcome a Saga exists to prevent. It also
 * does not reactivate and does not refresh `lastActivityAt`: the account was
 * not woken by activity, it was corrected. The customer's own request was the
 * debit that already moved the clock (`debit` runs `moved` at the moment it is
 * decided); the compensation that undoes it moments later, because a payment
 * downstream was refused, is the bank fixing its own process, not the customer
 * coming back to use the account. Letting it also count as activity would give
 * a dormant account with no genuine engagement six more months of life every
 * time one of its stale transfers finally failed.
 *
 * `commissionToReverse` is what `debit` charged alongside the movement this
 * undoes, or `null` when the account's type charges none. Before this
 * parameter existed, a compensated `AHORRO` transfer returned the transfer
 * amount but kept the Q3.00 commission — the bank cancelled the transfer and
 * still collected a fee for moving money that never actually moved. Nothing in
 * the ticket or the design ever decided that on purpose; it was a consequence
 * of `compensate` only ever being told the transfer amount. The repository is
 * what looks up whether a commission was charged for the debit being reversed
 * (its own `account_operations` row) and passes it here.
 */
export function compensate(
  account: Account,
  amount: Money,
  commissionToReverse: Money | null,
  now: Date,
): Movement {
  const problem = amountProblem(amount);

  if (problem !== null) {
    throw new DomainRejection(problem, 'El monto no cumple la precisión del contrato.');
  }

  if (commissionToReverse !== null) {
    const commissionProblem = amountProblem(commissionToReverse);

    if (commissionProblem !== null) {
      throw new DomainRejection(commissionProblem, 'El monto no cumple la precisión del contrato.');
    }
  }

  const totalMinor = amount.amountMinor + (commissionToReverse?.amountMinor ?? 0);

  return moved(
    account,
    totalMinor,
    { amountMinor: totalMinor, currency: amount.currency },
    false,
    now,
    false,
  );
}

/**
 * Deactivates an account. Idempotent: deactivating twice is not an error.
 *
 * `lastActivityAt` is left alone, here and in `reactivate`. **A status change is
 * not activity** (A-4): if it were, an administrator reactivating an account
 * would reset its inactivity clock, and the automatic process would never again
 * reach the accounts an administrator had touched. Only money moving counts.
 */
export function deactivate(account: Account): Account {
  return account.status === 'INACTIVE'
    ? account
    : { ...account, status: 'INACTIVE', version: account.version + 1 };
}

/** Reactivates an account by hand. Idempotent for the same reason. */
export function reactivate(account: Account): Account {
  return account.status === 'ACTIVE'
    ? account
    : { ...account, status: 'ACTIVE', version: account.version + 1 };
}

function moved(
  account: Account,
  deltaMinor: number,
  amount: Money,
  reactivated: boolean,
  now: Date,
  /**
   * Whether this movement counts as the customer using the account, for the
   * deactivation clock (A-4's own principle, applied to a third case: a status
   * change is not activity, and neither is a correction). `true` for `debit`
   * and `credit` — both are the customer moving money — and `false` for
   * `compensate`, which is the bank undoing its own failed attempt.
   */
  countsAsActivity: boolean,
): Movement {
  const balanceMinor = account.balanceMinor + deltaMinor;

  // The database carries the same CHECK. Both, because the domain must be
  // arguable without a database and the database must hold without the domain.
  if (balanceMinor < 0) {
    throw new DomainRejection('INSUFFICIENT_FUNDS', 'El saldo no puede quedar negativo.');
  }

  return {
    account: {
      ...account,
      balanceMinor,
      status: reactivated ? 'ACTIVE' : account.status,
      lastActivityAt: countsAsActivity ? now : account.lastActivityAt,
      version: account.version + 1,
    },
    amount,
    balanceAfter: { amountMinor: balanceMinor, currency: amount.currency },
    reactivated,
    // Only `debit` can charge a commission (T-27); `credit` and `compensate`
    // share this helper and never do.
    commission: null,
  };
}
