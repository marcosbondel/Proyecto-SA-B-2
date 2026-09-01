import { transactionStatusRepliedV1 } from '@bank/contracts';
import type { Identity, TransactionStatusRequestedV1 } from '@bank/contracts';

import { mayReadTransaction } from '../domain/transaction';
import type { Transaction } from '../domain/transaction';
import type { PaymentOutcome, EventPublisher, TransactionRepository } from './ports';

/**
 * Answers "what became of my transfer".
 *
 * This is the query that makes the Gateway's five-second reply ceiling
 * survivable. When the Gateway stops waiting it cancels nothing — the Saga
 * carries on — so the caller needs somewhere to come back to, and this is it.
 * The frontend polls it every two seconds for exactly that reason.
 *
 * Two things it is careful about:
 *
 * - **It answers with the correlation the transfer was *born* under**, not the
 *   one the question arrived with. They are different identifiers: the Gateway
 *   stamps every request with a fresh correlation, so a screen polling every
 *   two seconds generates a new one each time, while the trail that explains
 *   what happened is filed under the first. This service is the only component
 *   that still knows it, because it is the only one that wrote it down.
 * - **It reports the payment step from its own trail**, never by reading
 *   Payment Service. What it repeats is the event it received; a second opinion
 *   would require a database this service must not have (§8.2, 2.3).
 */
export class GetTransactionStatusUseCase {
  readonly #repository: TransactionRepository;
  readonly #publisher: EventPublisher;

  constructor(dependencies: {
    readonly repository: TransactionRepository;
    readonly publisher: EventPublisher;
  }) {
    this.#repository = dependencies.repository;
    this.#publisher = dependencies.publisher;
  }

  public async execute(
    payload: TransactionStatusRequestedV1,
    identity: Identity | null,
  ): Promise<void> {
    const found = await this.#find(payload);

    /**
     * The ownership check TD-035 said this service could not make.
     *
     * It can now, because the row records who asked for the transfer. A
     * transfer that is not this actor's is answered `NOT_FOUND` and **not**
     * "forbidden": the identifier is a UUID v4, and a distinguishable refusal
     * would turn a guessed one into a way to learn that it names something real.
     * The same reasoning the account read paths use.
     */
    const transaction = found !== null && mayReadTransaction(identity, found) ? found : null;

    if (transaction === null) {
      /**
       * `NOT_FOUND` covers both "no such transfer" and "refused before it was
       * created". The reply carries no reason for the second case because the
       * contract has no field for one and the audit trail does have the
       * `transaction.failed.v1` that explains it (TD-032).
       */
      await this.#publisher.reply({
        messageType: transactionStatusRepliedV1.name,
        payload: { outcome: 'NOT_FOUND' },
      });

      return;
    }

    const payment = await this.#repository.paymentOutcomeOf(transaction.transactionId);

    await this.#publisher.reply({
      messageType: transactionStatusRepliedV1.name,
      payload: {
        outcome: 'FOUND',
        transactionId: transaction.transactionId,
        status: transaction.status,
        amount: transaction.amount,
        reason: transaction.failureReason,
        createdAt: transaction.createdAt.toISOString(),
        updatedAt: transaction.updatedAt.toISOString(),
        originCorrelationId: transaction.correlationId,
        ...(payment === null ? {} : { payment: wire(payment) }),
      },
    });
  }

  /**
   * Either identifier, in the order of specificity.
   *
   * The transaction's own id is tried first because it names one transfer;
   * a correlation may in principle name more than one, and answering with an
   * arbitrary member of a set would be worse than answering nothing.
   */
  async #find(payload: TransactionStatusRequestedV1): Promise<Transaction | null> {
    if (payload.transactionId !== undefined) {
      return await this.#repository.findById(payload.transactionId);
    }

    if (payload.correlationId !== undefined) {
      return await this.#repository.findByCorrelationId(payload.correlationId);
    }

    // The contract's own `refine` forbids this, so reaching it means a message
    // that never passed a schema — which is a message this service will not act on.
    return null;
  }
}

function wire(payment: PaymentOutcome): Record<string, unknown> {
  return {
    paymentId: payment.paymentId,
    status: payment.status,
    attempt: payment.attempt,
    reason: payment.reason,
    errorType: payment.errorType,
    decidedAt: payment.decidedAt?.toISOString() ?? null,
  };
}
