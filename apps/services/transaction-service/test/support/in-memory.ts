import { IllegalTransition, afterTransition } from '../../src/domain/transaction';
import type { Transaction, Transition } from '../../src/domain/transaction';
import type {
  AppliedEffects,
  EventOutcome,
  EventPublisher,
  OutboundMessage,
  OutboxMessage,
  PaymentAttemptOutcome,
  PaymentOutcome,
  StartOutcome,
  TransactionRepository,
} from '../../src/application/ports';

/**
 * Doubles for the use-case tests: enough repository to exercise a decision, and
 * a publisher that remembers what it was told.
 *
 * **What these cannot demonstrate** is worth saying out loud, because a fake
 * that looks like it proves concurrency is worse than no fake at all. There is
 * no row lock here and no unique index — `Map.set` cannot race with itself in a
 * single-threaded test. That two Saga events arriving at once produce one
 * transition, and that a duplicate insert loses to a unique key, are facts
 * about PostgreSQL and are proved in `repository.integration.spec.ts` against a
 * real one.
 *
 * What these are for is the other half: that the Saga orders the right command,
 * in the right order, with the right payload, and refuses before it writes
 * rather than after.
 */
export class InMemoryTransactionRepository implements TransactionRepository {
  public readonly transactions = new Map<string, Transaction>();
  public readonly aliases = new Map<string, string>();
  public readonly events: { transactionId: string; messageType: string; payload: unknown }[] = [];
  public readonly processed = new Set<string>();
  /** What the Saga wrote to the outbox, in order — the durable form of `sent`/`published`. */
  public readonly outbox: OutboxMessage[] = [];
  readonly #byKey = new Map<string, string>();

  public async start(input: {
    readonly transaction: Transaction;
    readonly outbound?: (transaction: Transaction) => OutboxMessage;
  }): Promise<StartOutcome> {
    const existingId = this.#byKey.get(input.transaction.idempotencyKey);

    if (existingId !== undefined) {
      return { kind: 'EXISTS', transaction: this.transactions.get(existingId)! };
    }

    this.transactions.set(input.transaction.transactionId, input.transaction);
    this.#byKey.set(input.transaction.idempotencyKey, input.transaction.transactionId);

    // Called only for the delivery that actually created the row — same rule
    // the real repository follows, so a test can trust `outbox` either way.
    if (input.outbound !== undefined) {
      this.outbox.push(input.outbound(input.transaction));
    }

    return { kind: 'CREATED', transaction: input.transaction };
  }

  public async list(input: {
    readonly ownerId: string | null;
    readonly customerId?: string;
    readonly accountId?: string;
    readonly status?: Transaction['status'];
    readonly limit: number;
  }): Promise<{ readonly transactions: readonly Transaction[]; readonly total: number }> {
    const matching = [...this.transactions.values()]
      .filter((transaction) => input.ownerId === null || transaction.customerId === input.ownerId)
      .filter(
        (transaction) =>
          input.customerId === undefined || transaction.customerId === input.customerId,
      )
      .filter(
        (transaction) =>
          input.accountId === undefined ||
          transaction.sourceAccount === input.accountId ||
          transaction.targetAccount === input.accountId,
      )
      .filter((transaction) => input.status === undefined || transaction.status === input.status)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

    return {
      transactions: matching.slice(0, input.limit),
      total: matching.length,
    };
  }

  public async stats(): Promise<{
    readonly today: number;
    readonly completedToday: number;
    readonly failedToday: number;
    readonly compensatedToday: number;
    readonly inFlight: number;
  }> {
    const all = [...this.transactions.values()];
    const counted = (status: string) => all.filter((one) => one.status === status).length;

    return await Promise.resolve({
      today: all.length,
      completedToday: counted('COMPLETED'),
      failedToday: counted('FAILED'),
      compensatedToday: counted('COMPENSATED'),
      inFlight: all.filter((one) =>
        ['PENDING', 'DEBITING', 'PAYMENT_PENDING'].includes(one.status),
      ).length,
    });
  }

  public async recordAlias(input: {
    readonly requestedTransactionId: string;
    readonly transactionId: string;
  }): Promise<void> {
    if (input.requestedTransactionId !== input.transactionId) {
      this.aliases.set(input.requestedTransactionId, input.transactionId);
    }
  }

  public async findById(transactionId: string): Promise<Transaction | null> {
    const resolved = this.aliases.get(transactionId) ?? transactionId;

    return this.transactions.get(resolved) ?? null;
  }

  public async findByCorrelationId(correlationId: string): Promise<Transaction | null> {
    for (const transaction of this.transactions.values()) {
      if (transaction.correlationId === correlationId) {
        return transaction;
      }
    }

    return null;
  }

  public async applyEvent(input: {
    readonly transactionId: string;
    readonly messageId: string;
    readonly messageType: string;
    readonly payload: unknown;
    readonly decide: (transaction: Transaction) => Transition;
    readonly outbound?: (transaction: Transaction, transition: Transition) => AppliedEffects;
    readonly now: Date;
  }): Promise<EventOutcome> {
    const transaction = this.transactions.get(input.transactionId);

    if (transaction === undefined) {
      return { kind: 'UNKNOWN_TRANSACTION' };
    }

    if (this.processed.has(input.messageId)) {
      return { kind: 'DUPLICATE' };
    }

    this.processed.add(input.messageId);

    let transition: Transition;

    try {
      transition = input.decide(transaction);
    } catch (error) {
      if (!(error instanceof IllegalTransition)) {
        throw error;
      }

      this.events.push({
        transactionId: input.transactionId,
        messageType: `${input.messageType}#discarded`,
        payload: { reason: 'ILLEGAL_TRANSITION', from: error.from, event: error.event },
      });

      return { kind: 'ILLEGAL', from: error.from, event: error.event };
    }

    const updated = afterTransition(transaction, transition, input.now);

    this.transactions.set(input.transactionId, updated);
    this.events.push({
      transactionId: input.transactionId,
      messageType: input.messageType,
      payload: input.payload,
    });

    /**
     * The same seam the real repository uses: whatever the transition implies is
     * built by the use case and written here, in the one operation that also
     * changed the state. The extra trail rows land in `events` (so
     * `paymentOutcomeOf` sees the payment it ordered) and the dispatch rows in
     * `outbox` (so a test can assert on what will be published, and `dispatch`
     * can drain it).
     */
    if (input.outbound !== undefined) {
      const effects = input.outbound(updated, transition);

      for (const entry of effects.trail) {
        this.events.push({
          transactionId: input.transactionId,
          messageType: entry.messageType,
          payload: entry.payload,
        });
      }

      this.outbox.push(...effects.dispatch);
    }

    return { kind: 'APPLIED', transaction: updated, transition };
  }

  public async dispatchPendingOutbox(
    deliver: (message: OutboxMessage) => Promise<void>,
    limit: number,
  ): Promise<number> {
    const batch = this.outbox.splice(0, limit);

    for (const message of batch) {
      await deliver(message);
    }

    return batch.length;
  }

  public async recordCommand(input: {
    readonly transactionId: string;
    readonly messageType: string;
    readonly payload: unknown;
  }): Promise<void> {
    this.events.push(input);
  }

  public async recordPaymentAttempt(input: {
    readonly transactionId: string;
    readonly messageId: string;
    readonly messageType: string;
    readonly payload: unknown;
  }): Promise<PaymentAttemptOutcome> {
    if (!this.transactions.has(input.transactionId)) {
      return { kind: 'UNKNOWN_TRANSACTION' };
    }

    if (this.processed.has(input.messageId)) {
      return { kind: 'DUPLICATE' };
    }

    this.processed.add(input.messageId);
    this.events.push({
      transactionId: input.transactionId,
      messageType: input.messageType,
      payload: input.payload,
    });

    return { kind: 'RECORDED' };
  }

  public async paymentOutcomeOf(transactionId: string): Promise<PaymentOutcome | null> {
    let outcome: PaymentOutcome | null = null;

    for (const event of this.events) {
      if (event.transactionId !== transactionId) {
        continue;
      }

      const payload = event.payload as {
        paymentId?: string;
        attempt?: number;
        failureReason?: 'PAYMENT_DECLINED' | 'PAYMENT_RETRIES_EXHAUSTED';
        errorType?: 'TRANSIENT' | 'PERMANENT';
        succeededAt?: string;
        failedAt?: string;
      };

      if (event.messageType === 'payment.requested.v1') {
        outcome = {
          paymentId: payload.paymentId!,
          status: 'PENDING',
          attempt: null,
          reason: null,
          errorType: null,
          decidedAt: null,
        };
      }

      if (event.messageType === 'payment.attempt.failed.v1') {
        // Mirrors the guard in `PostgresTransactionRepository`: an
        // out-of-order attempt row must not un-decide a settled outcome.
        if (outcome === null || outcome.status === 'PENDING') {
          outcome = {
            paymentId: payload.paymentId!,
            status: 'PENDING',
            attempt: payload.attempt ?? null,
            reason: payload.failureReason ?? null,
            errorType: payload.errorType ?? null,
            decidedAt: null,
          };
        }
      }

      if (event.messageType === 'payment.succeeded.v1') {
        outcome = {
          paymentId: payload.paymentId!,
          status: 'SUCCEEDED',
          attempt: payload.attempt ?? null,
          reason: null,
          errorType: null,
          decidedAt: payload.succeededAt === undefined ? null : new Date(payload.succeededAt),
        };
      }

      if (event.messageType === 'payment.failed.v1') {
        outcome = {
          paymentId: payload.paymentId!,
          status: 'FAILED',
          attempt: payload.attempt ?? null,
          reason: payload.failureReason ?? null,
          errorType: null,
          decidedAt: payload.failedAt === undefined ? null : new Date(payload.failedAt),
        };
      }
    }

    return outcome;
  }

  public async isReachable(): Promise<boolean> {
    return true;
  }
}

/** A publisher that remembers, so a test can assert on what the Saga ordered. */
export class RecordingPublisher implements EventPublisher {
  public readonly sent: OutboundMessage[] = [];
  public readonly published: OutboundMessage[] = [];
  public readonly replies: OutboundMessage[] = [];

  public async send(message: OutboundMessage): Promise<void> {
    this.sent.push(message);
  }

  public async publish(message: OutboundMessage): Promise<void> {
    this.published.push(message);
  }

  public async reply(message: OutboundMessage): Promise<void> {
    this.replies.push(message);
  }

  /**
   * Records exactly as `send`/`publish` would, so every existing assertion on
   * `sent` and `published` still describes what the Saga ordered — the outbox
   * only means the message is written down before it is sent, not that it is a
   * different message. Returns a stand-in outbox row for the repository double
   * to carry.
   */
  public envelopeFor(message: OutboundMessage, kind: 'command' | 'event'): OutboxMessage {
    (kind === 'command' ? this.sent : this.published).push(message);

    return {
      exchange: kind === 'command' ? 'bank.commands' : 'bank.events',
      routingKey: message.messageType,
      envelope: {
        messageId: '00000000-0000-4000-8000-000000000000',
        messageType: message.messageType,
        messageVersion: 1,
        producer: 'transaction-service',
        correlationId: '00000000-0000-4000-8000-000000000001',
        causationId: null,
        idempotencyKey: 'test-idempotency-key',
        occurredAt: '2026-01-01T00:00:00.000Z',
        identity: null,
        payload: message.payload,
      },
    };
  }

  /** Every message in the order the Saga produced it, whatever kind it was. */
  public get everything(): readonly OutboundMessage[] {
    return [...this.sent, ...this.published, ...this.replies];
  }

  public typesOf(kind: 'sent' | 'published' | 'replies'): string[] {
    return this[kind].map((message) => message.messageType);
  }
}

/** A clock a test can move. */
export class FixedClock {
  #now: Date;

  constructor(now: Date) {
    this.#now = now;
  }

  public now(): Date {
    return this.#now;
  }

  public advance(milliseconds: number): void {
    this.#now = new Date(this.#now.getTime() + milliseconds);
  }
}

/** Identifiers a test can predict, because asserting on a random UUID asserts nothing. */
export class SequentialIds {
  #issued = 0;

  public next(): string {
    this.#issued += 1;

    return `44444444-4444-4444-8444-4444444444${String(this.#issued).padStart(2, '0')}`;
  }
}
