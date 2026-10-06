import type {
  AttemptRecord,
  AttemptResult,
  OpenOutcome,
  OutboundMessage,
  OutboxMessage,
  PaymentFilter,
  PaymentRepository,
  StoredSimulation,
} from '../../src/application/ports';
import type { Payment, PaymentAttempt } from '../../src/domain/payment';
import type { SimulationSettings } from '../../src/domain/simulation';

/**
 * The doubles the payment-service's use-case suites share: a repository that is
 * a `Map` and keeps the one promise that matters, a publisher that records, and
 * a clock that moves when a test says so.
 *
 * The repository is deliberately faithful about the one thing that matters — it
 * refuses an attempt whose number does not follow the row, exactly as the
 * `SELECT … FOR UPDATE` does — so a use case is tested against the contract the
 * real repository keeps rather than against a permissive stub that would let a
 * double charge through.
 */

export class FakeRepository implements PaymentRepository {
  public async stats(): Promise<{
    readonly today: number;
    readonly succeededToday: number;
    readonly failedToday: number;
    readonly retrying: number;
  }> {
    const all = [...this.payments.values()];

    return await Promise.resolve({
      today: all.length,
      succeededToday: all.filter((payment) => payment.status === 'SUCCEEDED').length,
      failedToday: all.filter((payment) => payment.status === 'FAILED').length,
      retrying: all.filter(
        (payment) => payment.status === 'PENDING' && payment.nextAttemptAt !== null,
      ).length,
    });
  }

  public readonly payments = new Map<string, Payment>();
  public readonly attempts = new Map<string, PaymentAttempt[]>();
  /** What each attempt wrote to the outbox — the durable form of `published`. */
  public readonly outbox: OutboxMessage[] = [];

  public async open(input: { readonly payment: Payment }): Promise<OpenOutcome> {
    const existing = this.payments.get(input.payment.paymentId);

    if (existing !== undefined) {
      return { kind: 'EXISTS', payment: existing };
    }

    this.payments.set(input.payment.paymentId, input.payment);

    return { kind: 'CREATED', payment: input.payment };
  }

  public async attempt(input: {
    readonly paymentId: string;
    readonly expectedAttempt: number;
    readonly decide: (payment: Payment, attempt: number) => AttemptResult;
    readonly outbound?: (payment: Payment, attempt: number) => readonly OutboxMessage[];
    readonly now: Date;
  }): Promise<AttemptRecord> {
    const found = this.payments.get(input.paymentId);

    if (found === undefined) {
      return { kind: 'UNKNOWN' };
    }

    if (found.status !== 'PENDING' || (found.attempt ?? 0) + 1 !== input.expectedAttempt) {
      return { kind: 'SUPERSEDED', payment: found };
    }

    const result = input.decide(found, input.expectedAttempt);

    const updated: Payment = {
      ...found,
      status: result.status,
      attempt: input.expectedAttempt,
      errorType: result.errorType,
      failureReason: result.failureReason,
      providerReference: result.providerReference,
      nextAttemptAt: result.nextAttemptAt,
      updatedAt: input.now,
      decidedAt: result.status === 'PENDING' ? null : input.now,
    };

    this.payments.set(input.paymentId, updated);
    this.attempts.set(input.paymentId, [
      ...(this.attempts.get(input.paymentId) ?? []),
      {
        attemptNumber: input.expectedAttempt,
        result: result.attemptResult,
        errorType: result.attemptResult === 'FAILED' ? result.errorType : null,
        failureReason: result.attemptResult === 'FAILED' ? result.failureReason : null,
        providerResult: result.providerResult,
        occurredAt: input.now,
      },
    ]);

    if (input.outbound !== undefined) {
      this.outbox.push(...input.outbound(updated, input.expectedAttempt));
    }

    return { kind: 'RECORDED', payment: updated, attempt: input.expectedAttempt };
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

  public async findById(paymentId: string): Promise<Payment | null> {
    return this.payments.get(paymentId) ?? null;
  }

  public async attemptsOf(paymentId: string): Promise<readonly PaymentAttempt[]> {
    return this.attempts.get(paymentId) ?? [];
  }

  public async list(filter: PaymentFilter): Promise<readonly Payment[]> {
    return [...this.payments.values()].filter(
      (payment) =>
        (filter.transactionId === undefined || payment.transactionId === filter.transactionId) &&
        (filter.status === undefined || payment.status === filter.status) &&
        (filter.errorType === undefined || payment.errorType === filter.errorType),
    );
  }

  public async due(now: Date, limit: number): Promise<readonly Payment[]> {
    return [...this.payments.values()]
      .filter(
        (payment) =>
          payment.status === 'PENDING' &&
          payment.nextAttemptAt !== null &&
          payment.nextAttemptAt.getTime() <= now.getTime(),
      )
      .slice(0, limit);
  }

  /** The administrator's override; `null` while the defaults are in force. */
  public simulation: StoredSimulation | null = null;

  public async loadSimulation(): Promise<StoredSimulation | null> {
    return this.simulation;
  }

  public async saveSimulation(
    settings: SimulationSettings,
    now: Date,
  ): Promise<StoredSimulation> {
    this.simulation = { settings, updatedAt: now };

    return this.simulation;
  }

  public async clearSimulation(): Promise<void> {
    this.simulation = null;
  }

  public async isReachable(): Promise<boolean> {
    return true;
  }
}

export class RecordingPublisher {
  public readonly published: OutboundMessage[] = [];
  public readonly replied: OutboundMessage[] = [];

  public async publish(message: OutboundMessage): Promise<void> {
    this.published.push(message);
  }

  public async reply(message: OutboundMessage): Promise<void> {
    this.replied.push(message);
  }

  /**
   * Records exactly as `publish` would, so every existing assertion on
   * `published` still describes what the payment announced — the outbox only
   * means the event is written down before it is sent. Returns a stand-in outbox
   * row for the repository double to carry.
   */
  public envelopeFor(message: OutboundMessage): OutboxMessage {
    this.published.push(message);

    return {
      exchange: 'bank.events',
      routingKey: message.messageType,
      envelope: {
        messageId: '00000000-0000-4000-8000-000000000000',
        messageType: message.messageType,
        messageVersion: 1,
        producer: 'payment-service',
        correlationId: '00000000-0000-4000-8000-000000000001',
        causationId: null,
        idempotencyKey: 'test-idempotency-key',
        occurredAt: '2026-01-01T00:00:00.000Z',
        identity: null,
        payload: message.payload,
      },
    };
  }
}

/** A clock that only moves when a test says so. */
export function clockFrom(start: Date): { now: () => Date; advance: (ms: number) => void } {
  let current = start;

  return {
    now: () => current,
    advance: (ms: number) => {
      current = new Date(current.getTime() + ms);
    },
  };
}
