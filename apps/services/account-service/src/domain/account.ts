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
  | 'FORBIDDEN_ACCOUNT_ACCESS';

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
}

/**
 * Opens an account. Balance Q0.00, status ACTIVE, no activity yet.
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
}): Account {
  return {
    accountId: input.accountId,
    customerId: input.customerId,
    accountType: input.accountType,
    balanceMinor: 0,
    status: 'ACTIVE',
    lastActivityAt: input.now,
    openedAt: input.now,
    version: 0,
  };
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
 * Takes money out. Refuses rather than going negative.
 *
 * The order of the checks is the order of the answers a caller deserves: a
 * malformed amount is not an insufficient balance, and an inactive account is
 * not either. Collapsing them into one "cannot debit" would make the Saga
 * compensate for reasons it could not distinguish.
 */
export function debit(account: Account, amount: Money, now: Date): Movement {
  const problem = amountProblem(amount);

  if (problem !== null) {
    throw new DomainRejection(problem, 'El monto no cumple la precisión del contrato.');
  }

  if (account.status !== 'ACTIVE') {
    throw new DomainRejection('ACCOUNT_INACTIVE', 'La cuenta no está activa.');
  }

  if (account.balanceMinor < amount.amountMinor) {
    throw new DomainRejection('INSUFFICIENT_FUNDS', 'El saldo disponible no alcanza.');
  }

  return moved(account, -amount.amountMinor, amount, false, now, true);
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
 */
export function compensate(account: Account, amount: Money, now: Date): Movement {
  const problem = amountProblem(amount);

  if (problem !== null) {
    throw new DomainRejection(problem, 'El monto no cumple la precisión del contrato.');
  }

  return moved(account, amount.amountMinor, amount, false, now, false);
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
  };
}
