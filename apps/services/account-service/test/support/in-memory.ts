import { randomUUID } from 'node:crypto';

import { openAccount } from '../../src/domain/account';
import type { Account, NewAccount } from '../../src/domain/account';
import {
  ANOMALY_CLAIM_TTL_MS,
  COUNTED_OPERATION_TYPES,
  exceedsLimit,
  isCoolingDown,
  windowStart,
} from '../../src/domain/activity-policy';
import type { ActivityRule } from '../../src/domain/activity-policy';
import { shouldDeactivate } from '../../src/domain/deactivation-policy';
import type { DeactivationCriteria } from '../../src/domain/deactivation-policy';
import type {
  AccountFilter,
  AccountOperation,
  AccountActivity,
  AccountRepository,
  ActivityTelemetry,
  AnomalyClaim,
  AnomalyRecord,
  AppliedMovement,
  EventPublisher,
  ObservedMovement,
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

  /** Imita la secuencia de la base, que es quien asigna el número (T-56). */
  #siguienteNumero = 1;

  public async openAccount(input: {
    readonly account: NewAccount;
    readonly idempotency: ProcessedMessage;
  }): Promise<{ readonly account: Account; readonly created: boolean }> {
    await this.recordProcessed(input.idempotency);

    const existing = this.accounts.get(input.account.accountId);

    if (existing !== undefined) {
      return { account: existing, created: false };
    }

    const conNumero: Account = {
      ...input.account,
      accountNumber: `02-${String(this.#siguienteNumero++).padStart(9, '0')}`,
    };

    this.accounts.set(input.account.accountId, conNumero);

    return { account: conNumero, created: true };
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

    /**
     * Mirrors the real repository's lookup (T-29 correction): a compensation
     * marks the debit's own commission row `COMPENSATED` too, and hands its
     * amount to `decide` so `compensate` can fold it into what comes back.
     */
    let commissionToReverse: AccountOperation['amount'] | null = null;

    if (input.compensates !== undefined) {
      for (const [index, operation] of this.operations.entries()) {
        if (
          operation.accountId === input.accountId &&
          operation.transactionId === input.compensates.transactionId &&
          operation.type === 'DEBIT'
        ) {
          this.operations[index] = { ...operation, status: 'COMPENSATED' };
        }

        if (
          operation.accountId === input.accountId &&
          operation.transactionId === input.compensates.transactionId &&
          operation.type === 'COMMISSION' &&
          operation.status === 'APPLIED'
        ) {
          commissionToReverse = operation.amount;
          this.operations[index] = { ...operation, status: 'COMPENSATED' };
        }
      }
    }

    // Throws out of here exactly as the real one does, before anything is
    // written, so a test can assert that a rejection changed nothing.
    const decided = input.decide(account, commissionToReverse);

    this.accounts.set(input.accountId, decided.account);

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

    const commission: AccountOperation | null =
      decided.commission === null
        ? null
        : {
            operationId: randomUUID(),
            accountId: input.accountId,
            type: 'COMMISSION',
            amount: decided.commission.amount,
            balanceAfter: decided.commission.balanceAfter,
            transactionId: input.transactionId,
            status: 'APPLIED',
            idempotencyKey: input.idempotencyKey,
            occurredAt: input.now,
          };

    if (commission !== null) {
      this.operations.push(commission);
    }

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
        commission:
          commission === null
            ? null
            : { amount: commission.amount, balanceAfter: commission.balanceAfter },
      },
    });

    return { account: decided.account, operation, reactivated: decided.reactivated, commission };
  }

  /** The billers this fake knows about. Empty unless a test puts one here. */
  public readonly billers: { code: string; name: string; accountId: string }[] = [];

  public async listBillers(): Promise<
    readonly { readonly code: string; readonly name: string; readonly accountId: string }[]
  > {
    return await Promise.resolve([...this.billers]);
  }

  public async stats(): Promise<{
    readonly active: number;
    readonly inactive: number;
    readonly openedToday: number;
    readonly depositsToday: number;
    readonly depositedToday: { readonly amountMinor: number; readonly currency: string };
  }> {
    const all = [...this.accounts.values()];
    const deposits = this.operations.filter(
      (operation) => operation.type === 'CREDIT' && operation.transactionId === null,
    );

    return await Promise.resolve({
      active: all.filter((account) => account.status === 'ACTIVE').length,
      inactive: all.filter((account) => account.status === 'INACTIVE').length,
      openedToday: all.length,
      depositsToday: deposits.length,
      depositedToday: {
        amountMinor: deposits.reduce((sum, operation) => sum + operation.amount.amountMinor, 0),
        currency: 'GTQ',
      },
    });
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

  /** Every anomaly written down, with whether and when it was announced. */
  public readonly anomalies: {
    record: AnomalyRecord;
    claimedAt: Date;
    publishedAt: Date | null;
  }[] = [];

  /**
   * The same decision `PostgresAccountRepository.claimAnomaly` takes, minus the
   * lock: count the window, honour the cooldown, hand a stale claim back.
   *
   * What this cannot show is two detections racing — that is a fact about the
   * advisory lock, and `repository.integration.spec.ts` proves it against a real
   * PostgreSQL.
   */
  public async claimAnomaly(input: {
    readonly account: Pick<Account, 'accountId' | 'customerId' | 'accountType'>;
    readonly rule: ActivityRule;
    readonly now: Date;
  }): Promise<AnomalyClaim | null> {
    const { account, rule, now } = input;

    const previous = this.anomalies
      .filter((entry) => entry.record.accountId === account.accountId)
      .sort((a, b) => b.record.detectedAt.getTime() - a.record.detectedAt.getTime())[0];

    if (previous !== undefined && isCoolingDown(previous.record.detectedAt, now, rule)) {
      const stale =
        previous.publishedAt === null &&
        previous.claimedAt.getTime() <= now.getTime() - ANOMALY_CLAIM_TTL_MS;

      if (!stale) {
        return null;
      }

      previous.claimedAt = now;

      return { anomaly: previous.record, firstTime: false };
    }

    const start = windowStart(now, rule);
    const operationCount = this.operations.filter(
      (operation) =>
        operation.accountId === account.accountId &&
        (COUNTED_OPERATION_TYPES as readonly string[]).includes(operation.type) &&
        operation.occurredAt.getTime() > start.getTime() &&
        operation.occurredAt.getTime() <= now.getTime(),
    ).length;

    if (!exceedsLimit(operationCount, rule)) {
      return null;
    }

    const record: AnomalyRecord = {
      anomalyId: randomUUID(),
      accountId: account.accountId,
      customerId: account.customerId,
      accountType: account.accountType,
      operationCount,
      threshold: rule.maxOperations,
      windowMinutes: rule.windowMinutes,
      windowStart: start,
      detectedAt: now,
    };

    this.anomalies.push({ record, claimedAt: now, publishedAt: null });

    return { anomaly: record, firstTime: true };
  }

  public async markAnomalyPublished(anomalyId: string, now: Date): Promise<void> {
    const entry = this.anomalies.find((candidate) => candidate.record.anomalyId === anomalyId);

    if (entry !== undefined && entry.publishedAt === null) {
      entry.publishedAt = now;
    }
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

/** Remembers which movements the use cases reported to the monitor. */
export class RecordingActivity implements AccountActivity {
  public readonly movements: ObservedMovement[] = [];

  public async afterMovement(movement: ObservedMovement): Promise<void> {
    this.movements.push(movement);
  }
}

/** Remembers what the monitor said about itself. */
export class RecordingActivityTelemetry implements ActivityTelemetry {
  public readonly operations: Parameters<ActivityTelemetry['operation']>[0][] = [];
  public readonly anomalies: Parameters<ActivityTelemetry['anomaly']>[0][] = [];
  public readonly failures: Parameters<ActivityTelemetry['failed']>[0][] = [];

  public operation(event: Parameters<ActivityTelemetry['operation']>[0]): void {
    this.operations.push(event);
  }

  public anomaly(event: Parameters<ActivityTelemetry['anomaly']>[0]): void {
    this.anomalies.push(event);
  }

  public failed(event: Parameters<ActivityTelemetry['failed']>[0]): void {
    this.failures.push(event);
  }
}

/**
 * Una cuenta **ya persistida**, para las pruebas que no pasan por el
 * repositorio.
 *
 * `openAccount` del dominio devuelve una `NewAccount` —sin número— porque el
 * número lo asigna la secuencia al insertar (T-56). Las pruebas que sólo
 * necesitan «una cuenta que existe» usan esto en vez de repetir el número en
 * veinte sitios.
 */
export function cuentaPersistida(
  input: Parameters<typeof openAccount>[0],
  accountNumber = '02-000000001',
): Account {
  return { ...openAccount(input), accountNumber };
}
