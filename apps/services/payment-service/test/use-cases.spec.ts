import { ProcessPaymentUseCase } from '../src/application/process-payment.use-case';
import { QueryPaymentUseCase } from '../src/application/query-payment.use-case';
import { quetzales } from '../src/domain/money';
import { FakeRepository, RecordingPublisher, clockFrom } from './support/in-memory';

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

    expect(await repository.attemptsOf(PAYMENT_ID)).toMatchObject([
      { result: 'SUCCEEDED', providerResult: 'SUCCESS' },
    ]);
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

describe('a payment the provider never answers — T-29', () => {
  it('climbs the same ladder as a transient failure, tagged as a timeout', async () => {
    const repository = new FakeRepository();
    const publisher = new RecordingPublisher();
    const clock = clockFrom(NOW);
    const useCase = useCaseWith(repository, clock);

    await useCase.open({ ...ORDER, scenario: 'TIMEOUT' }, publisher);

    expect(publisher.published.map((message) => message.messageType)).toEqual([
      'payment.attempt.failed.v1',
    ]);
    expect(publisher.published[0]!.payload).toMatchObject({
      attempt: 1,
      errorType: 'TRANSIENT',
      providerResult: 'TIMEOUT',
      willRetry: true,
      failureReason: null,
    });

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

    /** Every failed attempt kept the `TIMEOUT` tag, including the last one. */
    for (const message of publisher.published.slice(0, 3)) {
      expect(message.payload).toMatchObject({ providerResult: 'TIMEOUT' });
    }

    expect(publisher.published[3]!.payload).toMatchObject({
      status: 'FAILED',
      attempt: 3,
      failureReason: 'PAYMENT_RETRIES_EXHAUSTED',
    });

    const attempts = await repository.attemptsOf(PAYMENT_ID);
    expect(attempts).toHaveLength(3);
    expect(attempts.every((recorded) => recorded.providerResult === 'TIMEOUT')).toBe(true);
  });

  it('does not charge twice on a redelivered command', async () => {
    const repository = new FakeRepository();
    const publisher = new RecordingPublisher();
    const useCase = useCaseWith(repository, clockFrom(NOW));

    await useCase.open({ ...ORDER, scenario: 'TIMEOUT' }, publisher);
    await useCase.open({ ...ORDER, scenario: 'TIMEOUT' }, publisher);

    expect(publisher.published).toHaveLength(1);
    expect(await repository.attemptsOf(PAYMENT_ID)).toHaveLength(1);
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
