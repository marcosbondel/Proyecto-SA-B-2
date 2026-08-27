import { paymentListRepliedV1, paymentStatusRepliedV1 } from '@bank/contracts';

import type { Payment, PaymentAttempt } from '../domain/payment';
import type { EventPublisher, PaymentFilter, PaymentRepository } from './ports';

/**
 * The two questions this service answers, and the only reason it holds a read
 * model at all.
 *
 * Both are asked over the broker and answered on the replies exchange. Nothing
 * outside this service reads the `payments` table — the Gateway asks, and this
 * answers (constitution II, §8.2 2.3).
 *
 * **Neither is scoped by who is asking.** A payment row holds a `transactionId`
 * and no customer reference, so this service cannot narrow a listing to what
 * the requester owns without reading tables it must not read. The Gateway
 * restricts `GET /api/payments` to staff instead, which is recorded and argued
 * as TD-037 — a stricter reading than D-06 states, taken because the
 * alternative hands every authenticated client every payment in the bank.
 */
export class QueryPaymentUseCase {
  readonly #repository: PaymentRepository;

  constructor(dependencies: { repository: PaymentRepository }) {
    this.#repository = dependencies.repository;
  }

  /** `payment.list.query.v1` → `payment.list.replied.v1`. */
  public async list(filter: PaymentFilter, publisher: EventPublisher): Promise<void> {
    const payments = await this.#repository.list(filter);

    await publisher.reply({
      messageType: paymentListRepliedV1.name,
      payload: { payments: payments.map(viewOf) },
    });
  }

  /**
   * `payment.status.query.v1` → `payment.status.replied.v1`.
   *
   * The attempts travel with it, because the one screen that asks this question
   * is the one that draws the ladder. Fetching them separately would be a
   * second round trip for a list that is never more than four rows.
   */
  public async status(paymentId: string, publisher: EventPublisher): Promise<void> {
    const payment = await this.#repository.findById(paymentId);

    if (payment === null) {
      await publisher.reply({
        messageType: paymentStatusRepliedV1.name,
        payload: { outcome: 'NOT_FOUND' },
      });

      return;
    }

    const attempts = await this.#repository.attemptsOf(paymentId);

    await publisher.reply({
      messageType: paymentStatusRepliedV1.name,
      payload: {
        outcome: 'FOUND',
        payment: viewOf(payment),
        attempts: attempts.map(attemptViewOf),
      },
    });
  }
}

/**
 * A row, as the contract's `paymentView` wants it.
 *
 * `nextAttemptAt` is deliberately **not** on the view. It is this service's
 * own scheduling detail: publishing it would let a caller build a countdown
 * against a clock that is not theirs, and would make a sweeper's timing part of
 * a contract the sweeper is free to change.
 */
function viewOf(payment: Payment): Record<string, unknown> {
  return {
    paymentId: payment.paymentId,
    transactionId: payment.transactionId,
    status: payment.status,
    amount: payment.amount,
    attempt: payment.attempt,
    errorType: payment.errorType,
    failureReason: payment.failureReason,
    providerReference: payment.providerReference,
    scenario: payment.scenario,
    originCorrelationId: payment.originCorrelationId,
    createdAt: payment.createdAt.toISOString(),
    updatedAt: payment.updatedAt.toISOString(),
    decidedAt: payment.decidedAt === null ? null : payment.decidedAt.toISOString(),
  };
}

function attemptViewOf(attempt: PaymentAttempt): Record<string, unknown> {
  return {
    attemptNumber: attempt.attemptNumber,
    result: attempt.result,
    errorType: attempt.errorType,
    failureReason: attempt.failureReason,
    occurredAt: attempt.occurredAt.toISOString(),
  };
}
