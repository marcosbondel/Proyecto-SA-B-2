import { paymentAttemptFailedV1, paymentFailedV1, paymentSucceededV1 } from '@bank/contracts';

import { decideAttempt } from '../domain/payment';
import type { AttemptOutcome, Payment } from '../domain/payment';
import type {
  AttemptResult,
  Clock,
  EventPublisher,
  IdGenerator,
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
   * A redelivery finds the payment already there and stops. It does **not**
   * re-publish the terminal event, deliberately: Transaction Service
   * deduplicates by the envelope's `messageId` and would discard it, and
   * `notification-audit-service` deduplicates by `(event_id, consumer)` and
   * would too — so the only thing a re-publish achieves is a second row in
   * nobody's table and a second notification nobody asked for.
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

    const recorded = await this.#repository.attempt({
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
    });

    if (recorded.kind !== 'RECORDED' || outcome === null) {
      return;
    }

    await this.#announce(recorded.payment, recorded.attempt, outcome, now, publisher);
  }

  /**
   * One outcome, one event — and for a retry, one event that says so.
   *
   * `payment.attempt.failed.v1` is published for **every** failed attempt,
   * including the last. That is what makes the ladder observable while it is
   * being climbed rather than only in a log: without it "we are retrying" is
   * something no screen can say truthfully. It does not close the Saga, and
   * `willRetry` is what says so on the wire.
   */
  async #announce(
    payment: Payment,
    attempt: number,
    outcome: AttemptOutcome,
    now: Date,
    publisher: EventPublisher,
  ): Promise<void> {
    if (outcome.kind === 'SUCCEEDED') {
      await publisher.publish({
        messageType: paymentSucceededV1.name,
        payload: {
          paymentId: payment.paymentId,
          transactionId: payment.transactionId,
          status: 'SUCCEEDED',
          attempt,
          succeededAt: now.toISOString(),
        },
      });

      return;
    }

    const willRetry = outcome.kind === 'RETRY';

    await publisher.publish({
      messageType: paymentAttemptFailedV1.name,
      payload: {
        paymentId: payment.paymentId,
        transactionId: payment.transactionId,
        attempt,
        errorType: outcome.errorType,
        willRetry,
        nextAttemptAt: willRetry ? new Date(now.getTime() + outcome.delayMs).toISOString() : null,
        failureReason: willRetry ? null : outcome.failureReason,
        failedAt: now.toISOString(),
      },
    });

    if (willRetry) {
      return;
    }

    /**
     * Only now does the Saga learn the payment is over — and only now may it
     * compensate. Publishing the terminal event alongside every attempt failure
     * would compensate a debit while an attempt that might still succeed was
     * pending, which is the note `topology.md` carries on this binding.
     */
    await publisher.publish({
      messageType: paymentFailedV1.name,
      payload: {
        paymentId: payment.paymentId,
        transactionId: payment.transactionId,
        status: 'FAILED',
        attempt,
        failureReason: outcome.failureReason,
        failedAt: now.toISOString(),
      },
    });
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
      };
  }
}
