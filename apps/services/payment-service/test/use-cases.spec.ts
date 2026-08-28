import { ProcessPaymentUseCase } from '../src/application/process-payment.use-case';
import { QueryPaymentUseCase } from '../src/application/query-payment.use-case';
import type {
  AttemptRecord,
  AttemptResult,
  OpenOutcome,
  OutboundMessage,
  OutboxMessage,
  PaymentFilter,
  PaymentRepository,
} from '../src/application/ports';
import { quetzales } from '../src/domain/money';
import type { Payment, PaymentAttempt } from '../src/domain/payment';

/**
 * The Saga's fourth step, asserted against a repository that is a `Map`.
 *
 * The fake is deliberately faithful about the one thing that matters — it
 * refuses an attempt whose number does not follow the row, exactly as the
 * `SELECT … FOR UPDATE` does — so the use case is tested against the contract
 * the real repository keeps rather than against a permissive stub that would
 * let a double charge through.
 */

const LADDER = [1_000, 5_000] as const;
const NOW = new Date('2026-08-27T12:00:00.000Z');
const PAYMENT_ID = '11111111-1111-4111-8111-111111111111';
const TRANSACTION_ID = '22222222-2222-4222-8222-222222222222';

class FakeRepository implements PaymentRepository {
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

  public async isReachable(): Promise<boolean> {
    return true;
  }
}

class RecordingPublisher {
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
function clockFrom(start: Date): { now: () => Date; advance: (ms: number) => void } {
  let current = start;

  return {
    now: () => current,
    advance: (ms: number) => {
      current = new Date(current.getTime() + ms);
    },
  };
}

function useCaseWith(
  repository: FakeRepository,
  clock: { now: () => Date },
): ProcessPaymentUseCase {
  let counter = 0;

  return new ProcessPaymentUseCase({
    repository,
    clock,
    ids: {
      next: () => {
        counter += 1;

        return `provider-ref-${String(counter)}`;
      },
    },
    delays: LADDER,
  });
}

const ORDER = {
  paymentId: PAYMENT_ID,
  transactionId: TRANSACTION_ID,
  amount: quetzales(25_000),
  scenario: null,
  originCorrelationId: '33333333-3333-4333-8333-333333333333',
};

describe('a payment the provider takes', () => {
  it('succeeds on the first attempt and tells the Saga once', async () => {
    const repository = new FakeRepository();
    const publisher = new RecordingPublisher();
    const clock = clockFrom(NOW);

    await useCaseWith(repository, clock).open({ ...ORDER, scenario: 'APPROVE' }, publisher);

    expect(publisher.published.map((message) => message.messageType)).toEqual([
      'payment.succeeded.v1',
    ]);

    const payment = await repository.findById(PAYMENT_ID);
    expect(payment).toMatchObject({
      status: 'SUCCEEDED',
      attempt: 1,
      providerReference: 'provider-ref-1',
      nextAttemptAt: null,
      decidedAt: NOW,
    });
  });

  /**
   * The command travels over a broker with at-least-once delivery, so a
   * redelivery is ordinary — and here it would be a second charge for one
   * transfer, which is the worst thing this service could do.
   */
  it('ignores a redelivered command instead of charging twice', async () => {
    const repository = new FakeRepository();
    const publisher = new RecordingPublisher();
    const useCase = useCaseWith(repository, clockFrom(NOW));

    await useCase.open({ ...ORDER, scenario: 'APPROVE' }, publisher);
    await useCase.open({ ...ORDER, scenario: 'APPROVE' }, publisher);

    expect(publisher.published).toHaveLength(1);
    expect(await repository.attemptsOf(PAYMENT_ID)).toHaveLength(1);
  });
});

describe('a payment the provider refuses', () => {
  it('fails immediately, and both events say so in the same breath', async () => {
    const repository = new FakeRepository();
    const publisher = new RecordingPublisher();

    await useCaseWith(repository, clockFrom(NOW)).open({ ...ORDER, scenario: 'REJECT' }, publisher);

    expect(publisher.published.map((message) => message.messageType)).toEqual([
      'payment.attempt.failed.v1',
      'payment.failed.v1',
    ]);

    expect(publisher.published[0]!.payload).toMatchObject({
      errorType: 'PERMANENT',
      willRetry: false,
      nextAttemptAt: null,
      failureReason: 'PAYMENT_DECLINED',
    });
    expect(publisher.published[1]!.payload).toMatchObject({
      status: 'FAILED',
      attempt: 1,
      failureReason: 'PAYMENT_DECLINED',
    });
  });

  it('schedules no retry, so the sweeper never comes back for it', async () => {
    const repository = new FakeRepository();

    await useCaseWith(repository, clockFrom(NOW)).open(
      { ...ORDER, scenario: 'REJECT' },
      new RecordingPublisher(),
    );

    expect(await repository.due(new Date(NOW.getTime() + 60_000), 10)).toEqual([]);
  });
});

describe('a payment that keeps timing out', () => {
  it('climbs the ladder, saying so each time, and only then gives up', async () => {
    const repository = new FakeRepository();
    const publisher = new RecordingPublisher();
    const clock = clockFrom(NOW);
    const useCase = useCaseWith(repository, clock);

    await useCase.open({ ...ORDER, scenario: 'TRANSIENT_FAILURE' }, publisher);

    /** Attempt 1 failed transiently: the Saga is told, and told not to act. */
    expect(publisher.published.map((message) => message.messageType)).toEqual([
      'payment.attempt.failed.v1',
    ]);
    expect(publisher.published[0]!.payload).toMatchObject({
      attempt: 1,
      willRetry: true,
      failureReason: null,
      nextAttemptAt: new Date(NOW.getTime() + 1_000).toISOString(),
    });

    /** The sweeper comes back for each rung in turn. */
    for (const delay of LADDER) {
      clock.advance(delay);
      const due = await repository.due(clock.now(), 10);
      expect(due).toHaveLength(1);
      await useCase.retry(due[0]!, publisher);
    }

    const kinds = publisher.published.map((message) => message.messageType);
    expect(kinds).toEqual([
      'payment.attempt.failed.v1',
      'payment.attempt.failed.v1',
      'payment.attempt.failed.v1',
      'payment.failed.v1',
    ]);

    /**
     * Three attempts with a two-rung ladder, and the terminal event carries the
     * code that distinguishes exhaustion from refusal — the thing an interface
     * needs to avoid telling somebody their bank declined a transfer that
     * actually timed out.
     */
    expect(publisher.published[3]!.payload).toMatchObject({
      status: 'FAILED',
      attempt: 3,
      failureReason: 'PAYMENT_RETRIES_EXHAUSTED',
    });

    expect(await repository.attemptsOf(PAYMENT_ID)).toHaveLength(3);
  });

  /**
   * The shape `apps/web/app/lib/payment.ts` reads as "retrying": no verdict yet
   * and a transient error. If the error type were cleared between attempts the
   * interface could not distinguish a payment mid-ladder from one that has not
   * started.
   */
  it('stays PENDING with a transient error while it is still trying', async () => {
    const repository = new FakeRepository();

    await useCaseWith(repository, clockFrom(NOW)).open(
      { ...ORDER, scenario: 'TRANSIENT_FAILURE' },
      new RecordingPublisher(),
    );

    expect(await repository.findById(PAYMENT_ID)).toMatchObject({
      status: 'PENDING',
      errorType: 'TRANSIENT',
      decidedAt: null,
    });
  });

  /** Nothing settled is ever due again. */
  it('stops being due once it has given up', async () => {
    const repository = new FakeRepository();
    const clock = clockFrom(NOW);
    const useCase = useCaseWith(repository, clock);

    await useCase.open({ ...ORDER, scenario: 'TRANSIENT_FAILURE' }, new RecordingPublisher());

    for (const delay of LADDER) {
      clock.advance(delay);
      const due = await repository.due(clock.now(), 10);
      await useCase.retry(due[0]!, new RecordingPublisher());
    }

    clock.advance(60_000);
    expect(await repository.due(clock.now(), 10)).toEqual([]);
  });
});

describe('two workers reaching for the same attempt', () => {
  /**
   * The sweeper and a redelivered command, or two replicas of the sweeper. The
   * repository refuses the second because the row no longer sits at the attempt
   * it expected — which in the real one is enforced under `FOR UPDATE`.
   */
  it('lets exactly one of them charge', async () => {
    const repository = new FakeRepository();
    const publisher = new RecordingPublisher();
    const clock = clockFrom(NOW);
    const useCase = useCaseWith(repository, clock);

    await useCase.open({ ...ORDER, scenario: 'TRANSIENT_FAILURE' }, publisher);

    clock.advance(1_000);
    const due = (await repository.due(clock.now(), 10))[0]!;

    await useCase.retry(due, publisher);
    /** The same stale row, handed to a second worker. */
    await useCase.retry(due, publisher);

    expect(await repository.attemptsOf(PAYMENT_ID)).toHaveLength(2);
  });
});

describe('the two questions this service answers', () => {
  it('replies NOT_FOUND for a payment nobody made', async () => {
    const publisher = new RecordingPublisher();

    await new QueryPaymentUseCase({ repository: new FakeRepository() }).status(
      PAYMENT_ID,
      publisher,
    );

    expect(publisher.replied[0]).toMatchObject({
      messageType: 'payment.status.replied.v1',
      payload: { outcome: 'NOT_FOUND' },
    });
  });

  it('replies with the payment and the ladder it climbed', async () => {
    const repository = new FakeRepository();
    const clock = clockFrom(NOW);
    const useCase = useCaseWith(repository, clock);

    await useCase.open({ ...ORDER, scenario: 'TRANSIENT_FAILURE' }, new RecordingPublisher());
    clock.advance(1_000);
    await useCase.retry((await repository.due(clock.now(), 10))[0]!, new RecordingPublisher());

    const publisher = new RecordingPublisher();
    await new QueryPaymentUseCase({ repository }).status(PAYMENT_ID, publisher);

    const payload = publisher.replied[0]!.payload as {
      outcome: string;
      payment: Record<string, unknown>;
      attempts: unknown[];
    };

    expect(payload.outcome).toBe('FOUND');
    expect(payload.attempts).toHaveLength(2);
    /**
     * `nextAttemptAt` is this service's own scheduling detail and must not
     * leave it: publishing it would let a caller build a countdown against a
     * clock that is not theirs.
     */
    expect(payload.payment).not.toHaveProperty('nextAttemptAt');
    expect(payload.payment.originCorrelationId).toBe(ORDER.originCorrelationId);
  });

  it('narrows a listing by every filter the contract offers', async () => {
    const repository = new FakeRepository();
    const clock = clockFrom(NOW);
    const useCase = useCaseWith(repository, clock);

    await useCase.open({ ...ORDER, scenario: 'APPROVE' }, new RecordingPublisher());

    const publisher = new RecordingPublisher();
    const query = new QueryPaymentUseCase({ repository });

    await query.list({ status: 'SUCCEEDED' }, publisher);
    await query.list({ status: 'FAILED' }, publisher);
    await query.list({ transactionId: TRANSACTION_ID }, publisher);

    const counts = publisher.replied.map(
      (message) => (message.payload as { payments: unknown[] }).payments.length,
    );

    expect(counts).toEqual([1, 0, 1]);
  });
});
