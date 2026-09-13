import { paymentAttemptFailedV1, paymentFailedV1, paymentSucceededV1 } from '@bank/contracts';

import { decideAttempt } from '../domain/payment';
import type { AttemptOutcome, Payment } from '../domain/payment';
import type {
  AttemptResult,
  Clock,
  EventPublisher,
  IdGenerator,
  OutboxMessage,
  PaymentOrder,
  PaymentRepository,
} from './ports';

/**
 * The whole of what this service does: ask the provider, write down the answer,
 * and tell the Saga.
 *
 * Two entry points, one body. `open` is the Saga's command arriving; `retry` is
 * the sweeper coming back for a rung of the ladder. They differ in where the
 * attempt number comes from and in nothing else, which is why the interesting
 * part — `#attemptOnce` — is written once.
 *
 * **The publish happens after the commit, and that is a known window.** A crash
 * between them leaves a payment settled in this database and a Saga that never
 * heard, exactly the shape recorded as TD-031 for Transaction Service. The same
 * fix serves both — an outbox written in the same transaction, plus a relay —
 * and it is not built here for the same reason: publishing *before* the commit
 * is worse. A Saga told a payment succeeded, against a row that then rolled
 * back, credits a target account for money nobody took.
 */
export class ProcessPaymentUseCase {
  readonly #repository: PaymentRepository;
  readonly #clock: Clock;
  readonly #ids: IdGenerator;
  readonly #delays: readonly number[];

  constructor(dependencies: {
    repository: PaymentRepository;
    clock: Clock;
    ids: IdGenerator;
    delays: readonly number[];
  }) {
    this.#repository = dependencies.repository;
    this.#clock = dependencies.clock;
    this.#ids = dependencies.ids;
    this.#delays = dependencies.delays;
  }

  /**
   * A `payment.requested.v1` arrived: record the payment, then make attempt 1.
   *
   * A redelivery finds the payment already there and stops, and with the outbox
   * that is not just harmless but complete. Whatever event the original attempt
   * produced was written to the outbox in that attempt's transaction, so the
   * relay delivers it exactly once whether or not this redelivery does anything.
   * And if the original crashed *after* recording the payment but *before* its
   * first attempt, the payment is `PENDING` with `next_attempt_at` already set,
   * so the sweeper makes the attempt — the terminal event is, or will be,
   * dispatched either way. Re-attempting here would only race the sweeper into
   * the row lock.
   */
  public async open(order: PaymentOrder, publisher: EventPublisher): Promise<void> {
    const now = this.#clock.now();

    const opened = await this.#repository.open({
      payment: {
        paymentId: order.paymentId,
        transactionId: order.transactionId,
        status: 'PENDING',
        amount: order.amount,
        attempt: null,
        errorType: null,
        failureReason: null,
        providerReference: null,
        scenario: order.scenario,
        originCorrelationId: order.originCorrelationId,
        nextAttemptAt: now,
        createdAt: now,
        updatedAt: now,
        decidedAt: null,
      },
    });

    if (opened.kind === 'EXISTS') {
      return;
    }

    await this.#attemptOnce(opened.payment, 1, publisher);
  }

  /**
   * The sweeper found a payment whose next attempt is owed.
   *
   * The attempt number is read from the row rather than carried, because the
   * sweeper may be one of several replicas and the row is the only thing that
   * knows how many attempts have actually been made.
   */
  public async retry(payment: Payment, publisher: EventPublisher): Promise<void> {
    await this.#attemptOnce(payment, (payment.attempt ?? 0) + 1, publisher);
  }

  async #attemptOnce(
    payment: Payment,
    attemptNumber: number,
    publisher: EventPublisher,
  ): Promise<void> {
    const now = this.#clock.now();
    const reference = this.#ids.next();

    /**
     * Computed inside the repository's lock. `decide` is called with the row as
     * it was actually found, so two replicas cannot both read attempt 1 and
     * both charge — one of them gets `SUPERSEDED` and does nothing.
     */
    let outcome: AttemptOutcome | null = null;

    await this.#repository.attempt({
      paymentId: payment.paymentId,
      expectedAttempt: attemptNumber,
      now,
      decide: (found, attempt) => {
        outcome = decideAttempt({
          scenario: found.scenario,
          attempt,
          delays: this.#delays,
          reference,
        });

        return resultOf(outcome, now);
      },
      /**
       * The events this attempt implies, written to the outbox **in the same
       * transaction** as the attempt (TD-047). Nothing is published here any
       * more: the relay sweeps the outbox and does that, which closes the crash
       * window between committing an attempt and telling the Saga what it was.
       * Only reached for a `RECORDED` attempt, so a superseded one — another
       * replica already finished this rung — enqueues nothing.
       */
      outbound: (recorded, attempt) =>
        outcome === null ? [] : this.#effectsOf(recorded, attempt, outcome, now, publisher),
    });
  }

  /**
   * One outcome, one event — and for a retry, one event that says so — built
   * into durable outbox messages without sending any of them.
   *
   * `payment.attempt.failed.v1` is enqueued for **every** failed attempt,
   * including the last. That is what makes the ladder observable while it is
   * being climbed rather than only in a log: without it "we are retrying" is
   * something no screen can say truthfully. It does not close the Saga, and
   * `willRetry` is what says so on the wire. The terminal `payment.failed.v1`
   * follows only when the ladder is spent — publishing it alongside every
   * attempt failure would compensate a debit while an attempt that might still
   * succeed was pending, which is the note `topology.md` carries on this binding.
   */
  #effectsOf(
    payment: Payment,
    attempt: number,
    outcome: AttemptOutcome,
    now: Date,
    publisher: EventPublisher,
  ): readonly OutboxMessage[] {
    if (outcome.kind === 'SUCCEEDED') {
      return [
        publisher.envelopeFor({
          messageType: paymentSucceededV1.name,
          payload: {
            paymentId: payment.paymentId,
            transactionId: payment.transactionId,
            status: 'SUCCEEDED',
            attempt,
            succeededAt: now.toISOString(),
          },
        }),
      ];
    }

    const willRetry = outcome.kind === 'RETRY';

    const messages: OutboxMessage[] = [
      publisher.envelopeFor({
        messageType: paymentAttemptFailedV1.name,
        payload: {
          paymentId: payment.paymentId,
          transactionId: payment.transactionId,
          attempt,
          errorType: outcome.errorType,
          providerResult: outcome.providerResult,
          willRetry,
          nextAttemptAt: willRetry
            ? new Date(now.getTime() + outcome.delayMs).toISOString()
            : null,
          failureReason: willRetry ? null : outcome.failureReason,
          failedAt: now.toISOString(),
        },
      }),
    ];

    if (!willRetry) {
      messages.push(
        publisher.envelopeFor({
          messageType: paymentFailedV1.name,
          payload: {
            paymentId: payment.paymentId,
            transactionId: payment.transactionId,
            status: 'FAILED',
            attempt,
            failureReason: outcome.failureReason,
            failedAt: now.toISOString(),
          },
        }),
      );
    }

    return messages;
  }
}

/** The domain's answer, translated into the columns the repository writes. */
function resultOf(outcome: AttemptOutcome, now: Date): AttemptResult {
  switch (outcome.kind) {
    case 'SUCCEEDED':
      return {
        status: 'SUCCEEDED',
        errorType: null,
        failureReason: null,
        providerReference: outcome.providerReference,
        nextAttemptAt: null,
        attemptResult: 'SUCCEEDED',
        providerResult: outcome.providerResult,
      };

    case 'RETRY':
      return {
        status: 'PENDING',
        /**
         * The error type is kept on a payment that is still `PENDING`, and that
         * pairing is what the interface reads as "retrying": a payment with no
         * verdict and a transient error is one mid-ladder. `payment.ts` in
         * `apps/web` recognises exactly that shape.
         */
        errorType: outcome.errorType,
        failureReason: null,
        providerReference: null,
        nextAttemptAt: new Date(now.getTime() + outcome.delayMs),
        attemptResult: 'FAILED',
        providerResult: outcome.providerResult,
      };

    case 'DECLINED':
    case 'EXHAUSTED':
      return {
        status: 'FAILED',
        errorType: outcome.errorType,
        failureReason: outcome.failureReason,
        providerReference: null,
        nextAttemptAt: null,
        attemptResult: 'FAILED',
        providerResult: outcome.providerResult,
      };
  }
}
