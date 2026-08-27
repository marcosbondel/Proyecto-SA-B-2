import { randomUUID } from 'node:crypto';

import type { Account } from '../../src/domain/account';
import { shouldDeactivate } from '../../src/domain/deactivation-policy';
import type { DeactivationCriteria } from '../../src/domain/deactivation-policy';
import type {
  AccountFilter,
  AccountOperation,
  AccountRepository,
  AppliedMovement,
  EventPublisher,
  OutboundMessage,
  ProcessedMessage,
} from '../../src/application/ports';

/**
 * Doubles for the use-case tests: enough repository to exercise a decision, and
 * a publisher that remembers what it was told.
 *
 * **What these cannot demonstrate** is worth saying out loud, because a fake
 * that looks like it proves concurrency is worse than no fake at all. There is
 * no lock here and no unique index — `Map.set` cannot race with itself in a
 * single-threaded test. Two concurrent debits not producing a negative balance,
 * and a duplicate insert losing to a unique key, are facts about PostgreSQL and
 * are proved in `repository.integration.spec.ts` against a real one.
 *
 * What these are for is the other half: that the use cases publish the right
 * message, in the right order, with the right payload, and refuse before they
 * write rather than after.
 */
export class InMemoryAccountRepository implements AccountRepository {
  public readonly accounts = new Map<string, Account>();
  public readonly operations: AccountOperation[] = [];
  public readonly processed = new Map<string, ProcessedMessage>();

  public async openAccount(input: {
    readonly account: Account;
    readonly idempotency: ProcessedMessage;
  }): Promise<{ readonly account: Account; readonly created: boolean }> {
    await this.recordProcessed(input.idempotency);

    const existing = this.accounts.get(input.account.accountId);

    if (existing !== undefined) {
      return { account: existing, created: false };
    }

    this.accounts.set(input.account.accountId, input.account);

    return { account: input.account, created: true };
  }

  public async findById(accountId: string): Promise<Account | null> {
    return this.accounts.get(accountId) ?? null;
  }

  public async list(filter: AccountFilter): Promise<readonly Account[]> {
    return [...this.accounts.values()].filter(
      (account) =>
        (filter.customerId === undefined || account.customerId === filter.customerId) &&
        (filter.status === undefined || account.status === filter.status) &&
        (filter.accountType === undefined || account.accountType === filter.accountType),
    );
  }

  public async operationsOf(accountId: string): Promise<readonly AccountOperation[]> {
    return this.operations.filter((operation) => operation.accountId === accountId);
  }

  public async applyMovement(
    input: Parameters<AccountRepository['applyMovement']>[0],
  ): Promise<AppliedMovement | null> {
    const account = this.accounts.get(input.accountId);

    if (account === undefined) {
      return null;
    }

    // Throws out of here exactly as the real one does, before anything is
    // written, so a test can assert that a rejection changed nothing.
    const decided = input.decide(account);

    this.accounts.set(input.accountId, decided.account);

    if (input.compensates !== undefined) {
      for (const [index, operation] of this.operations.entries()) {
        if (
          operation.accountId === input.accountId &&
          operation.transactionId === input.compensates.transactionId &&
          operation.type === 'DEBIT'
        ) {
          this.operations[index] = { ...operation, status: 'COMPENSATED' };
        }
      }
    }

    const operation: AccountOperation = {
      operationId: randomUUID(),
      accountId: input.accountId,
      type: input.type,
      amount: decided.amount,
      balanceAfter: decided.balanceAfter,
      transactionId: input.transactionId,
      status: 'APPLIED',
      idempotencyKey: input.idempotencyKey,
      occurredAt: input.now,
    };

    this.operations.push(operation);

    await this.recordProcessed({
      idempotencyKey: input.idempotencyKey,
      messageType: input.messageType,
      resultSummary: {
        outcome: 'APPLIED',
        operationId: operation.operationId,
        amount: decided.amount,
        balanceAfter: decided.balanceAfter,
        reactivated: decided.reactivated,
        occurredAt: input.now.toISOString(),
      },
    });

    return { account: decided.account, operation, reactivated: decided.reactivated };
  }

  public async setStatus(input: {
    readonly accountId: string;
    readonly status: 'ACTIVE' | 'INACTIVE';
    readonly idempotency: ProcessedMessage;
  }): Promise<Account | null> {
    await this.recordProcessed(input.idempotency);

    const account = this.accounts.get(input.accountId);

    if (account === undefined) {
      return null;
    }

    // `lastActivityAt` untouched: a status change is not activity (A-4).
    const updated = { ...account, status: input.status, version: account.version + 1 };
    this.accounts.set(input.accountId, updated);

    return updated;
  }

  public async deactivateInactive(input: {
    readonly now: Date;
    readonly criteria: DeactivationCriteria;
    readonly runId: string;
  }): Promise<readonly Account[]> {
    const deactivated: Account[] = [];

    for (const account of this.accounts.values()) {
      if (!shouldDeactivate(account, input.now, input.criteria)) {
        continue;
      }

      const updated: Account = { ...account, status: 'INACTIVE', version: account.version + 1 };
      this.accounts.set(account.accountId, updated);
      deactivated.push(updated);
    }

    return deactivated;
  }

  public async findProcessed(
    idempotencyKey: string,
    messageType: string,
  ): Promise<ProcessedMessage | null> {
    return this.processed.get(`${idempotencyKey}::${messageType}`) ?? null;
  }

  public async recordProcessed(record: ProcessedMessage): Promise<void> {
    const key = `${record.idempotencyKey}::${record.messageType}`;

    // First writer wins, as `ON CONFLICT DO NOTHING` does.
    if (!this.processed.has(key)) {
      this.processed.set(key, record);
    }
  }

  public async isReachable(): Promise<boolean> {
    return true;
  }
}

/** Remembers what was said, and on which exchange it would have gone. */
export class RecordingPublisher implements EventPublisher {
  public readonly events: OutboundMessage[] = [];
  public readonly replies: OutboundMessage[] = [];

  public async publish(message: OutboundMessage): Promise<void> {
    this.events.push(message);
  }

  public async reply(message: OutboundMessage): Promise<void> {
    this.replies.push(message);
  }

  public typesPublished(): string[] {
    return this.events.map((event) => event.messageType);
  }

  public lastReply(): OutboundMessage | undefined {
    return this.replies.at(-1);
  }
}

/** A clock a test owns. */
export class FixedClock {
  #now: Date;

  constructor(now: Date) {
    this.#now = now;
  }

  public now(): Date {
    return this.#now;
  }

  public advanceTo(now: Date): void {
    this.#now = now;
  }
}
