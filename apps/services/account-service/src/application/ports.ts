import type { AccountOperationStatus, AccountOperationType, Money } from '@bank/contracts';

import type { Account } from '../domain/account';
import type { DeactivationCriteria } from '../domain/deactivation-policy';

/**
 * Everything this service needs from the outside, named by what it is for.
 *
 * The application layer may not import `@bank/messaging` or `pg` — `pnpm lint`
 * enforces it — because a use case that knows it publishes over AMQP cannot be
 * tested without AMQP. `@bank/contracts` is fair game: a contract is a shape,
 * not a transport.
 */

/** One movement, as it is written down and read back. */
export interface AccountOperation {
  readonly operationId: string;
  readonly accountId: string;
  readonly type: AccountOperationType;
  readonly amount: Money;
  readonly balanceAfter: Money;
  /** The Saga this belongs to, or `null` for anything the Saga did not cause. */
  readonly transactionId: string | null;
  readonly status: AccountOperationStatus;
  readonly idempotencyKey: string;
  readonly occurredAt: Date;
}

/**
 * What a previously-processed message produced.
 *
 * Stored so a redelivery can be answered with the **same** result instead of
 * being done twice. This is the whole of the idempotency guarantee the ticket
 * asks for, and the reason it is evaluated before the balance is touched.
 */
export interface ProcessedMessage {
  readonly idempotencyKey: string;
  readonly messageType: string;
  readonly resultSummary: Record<string, unknown>;
}

/** What a movement changed, once the database has agreed to it. */
export interface AppliedMovement {
  readonly account: Account;
  readonly operation: AccountOperation;
  readonly reactivated: boolean;
}

export interface AccountFilter {
  readonly customerId?: string;
  readonly status?: 'ACTIVE' | 'INACTIVE';
  readonly accountType?: 'MONETARIA' | 'AHORRO';
}

/**
 * The one door to this service's own database, and to no other's.
 *
 * The movement methods take the **intention** rather than an already-computed
 * account, and that is the load-bearing decision of this file. A repository
 * given a finished `Account` would have to trust that whoever computed it read
 * the same row the write is about to overwrite — which is exactly the
 * read-then-write race the assignment asks this service to survive (§4.1, p. 5).
 * Instead the repository locks the row, hands the domain what it actually
 * found, and writes what the domain decides, all inside one transaction.
 */
export interface AccountRepository {
  /**
   * Opens an account and records the message as processed, atomically.
   *
   * Returns the existing account when the same `accountId` is already there:
   * the Gateway mints the id before publishing, so a redelivery carries the
   * same one and must not become a second account.
   */
  openAccount(input: {
    readonly account: Account;
    readonly idempotency: ProcessedMessage;
  }): Promise<{ readonly account: Account; readonly created: boolean }>;

  findById(accountId: string): Promise<Account | null>;

  list(filter: AccountFilter): Promise<readonly Account[]>;

  operationsOf(accountId: string): Promise<readonly AccountOperation[]>;

  /**
   * Locks the row, applies `decide` to what was actually found, and writes the
   * result with the movement and the idempotency record in one transaction.
   *
   * `decide` is a domain function. It runs **inside** the lock, which is what
   * makes "do not debit more than the balance" true under concurrency rather
   * than true most of the time.
   *
   * @throws DomainRejection whatever `decide` threw, after rolling back.
   */
  applyMovement(input: {
    readonly accountId: string;
    readonly type: AccountOperationType;
    readonly transactionId: string | null;
    readonly idempotencyKey: string;
    readonly messageType: string;
    readonly decide: (account: Account) => {
      readonly account: Account;
      readonly amount: Money;
      readonly balanceAfter: Money;
      readonly reactivated: boolean;
    };
    /** Marks the debit this compensation returns, when there is one. */
    readonly compensates?: { readonly transactionId: string };
    readonly now: Date;
  }): Promise<AppliedMovement | null>;

  /** Sets the status by hand and records the message. `null` if there is no such account. */
  setStatus(input: {
    readonly accountId: string;
    readonly status: 'ACTIVE' | 'INACTIVE';
    readonly idempotency: ProcessedMessage;
  }): Promise<Account | null>;

  /**
   * Deactivates every account that meets the criteria, and says which.
   *
   * The selection happens in SQL rather than by loading the table into Node:
   * the job is expected to run against every account in the bank, and the
   * candidate set is a tiny fraction of it.
   */
  deactivateInactive(input: {
    readonly now: Date;
    readonly criteria: DeactivationCriteria;
    readonly runId: string;
  }): Promise<readonly Account[]>;

  /** What this message produced the first time, or `null` if it is new. */
  findProcessed(idempotencyKey: string, messageType: string): Promise<ProcessedMessage | null>;

  /** Records the outcome of a message that changed no balance. */
  recordProcessed(record: ProcessedMessage): Promise<void>;

  /** For the readiness probe: can this service reach its own database? */
  isReachable(): Promise<boolean>;
}

/** One outbound message, already shaped as a contract payload. */
export interface OutboundMessage {
  readonly messageType: string;
  readonly payload: unknown;
}

/**
 * How this service speaks to the rest of the system: events and replies only.
 *
 * Separate methods because they are different statements — an event is narrated
 * to whoever cares, a reply is addressed to whoever asked — and the exchange
 * each one goes to follows from that.
 */
export interface EventPublisher {
  publish(message: OutboundMessage): Promise<void>;
  reply(message: OutboundMessage): Promise<void>;
}

/** Injected so a test can decide what "now" is. */
export interface Clock {
  now(): Date;
}
