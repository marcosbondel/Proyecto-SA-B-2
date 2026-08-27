import { transactionFailedV1, transactionInitiatedV1 } from '@bank/contracts';
import type { TransferRequestedV1 } from '@bank/contracts';

import { conflictsWithOriginal, openTransaction, requestRefusal } from '../domain/transaction';
import type { RequestRejection, Transaction } from '../domain/transaction';
import type { AdvanceSagaUseCase } from './advance-saga.use-case';
import type { Clock, EventPublisher, TransactionRepository } from './ports';

/** What a request did, for the log line the interface layer writes. */
export type RequestOutcome =
  | { readonly kind: 'STARTED'; readonly transaction: Transaction }
  /** Invariant T-3: a retry, honoured with the original and no second Saga. */
  | { readonly kind: 'DUPLICATE'; readonly transaction: Transaction }
  /** Invariant T-4, or T-1/T-2. Nothing was started. */
  | { readonly kind: 'REFUSED'; readonly reason: RequestRejection };

/**
 * Step 1 of the Saga: accept the transfer, or refuse it before anything moves.
 *
 * The order of this method is the order of the invariants it protects:
 *
 * 1. **T-1 and T-2 first, on the request alone.** An amount that is not an
 *    amount and a transfer to the same account are properties of what was
 *    asked, not of any account's state, so they are decided with no row read
 *    and no transaction created.
 * 2. **T-3 and T-4 next, against the key.** The insert races on a unique
 *    constraint; whoever loses reads the original and compares. Same content is
 *    a retry and is honoured with the original transfer; different content is a
 *    conflict, because answering it with the original's result would tell
 *    somebody their money went where it did not.
 * 3. **Only then does the Saga start.**
 *
 * What this method deliberately does **not** do is look at a balance. Whether
 * the source account can afford this is Account Service's judgement, it is made
 * under a row lock in another database, and it arrives here as an event. A
 * check here would be a second opinion that is stale by the time it is written
 * down — and criterion 8 of this ticket exists to say so.
 */
export class RequestTransferUseCase {
  readonly #repository: TransactionRepository;
  readonly #publisher: EventPublisher;
  readonly #saga: AdvanceSagaUseCase;
  readonly #clock: Clock;

  constructor(dependencies: {
    readonly repository: TransactionRepository;
    readonly publisher: EventPublisher;
    readonly saga: AdvanceSagaUseCase;
    readonly clock: Clock;
  }) {
    this.#repository = dependencies.repository;
    this.#publisher = dependencies.publisher;
    this.#saga = dependencies.saga;
    this.#clock = dependencies.clock;
  }

  public async execute(
    payload: TransferRequestedV1,
    envelope: {
      readonly messageId: string;
      readonly correlationId: string;
      readonly idempotencyKey: string;
    },
  ): Promise<RequestOutcome> {
    const refusal = requestRefusal(payload);

    if (refusal !== null) {
      await this.#refuse(payload.transactionId, refusal);

      return { kind: 'REFUSED', reason: refusal };
    }

    const now = this.#clock.now();
    const candidate = openTransaction({
      transactionId: payload.transactionId,
      sourceAccount: payload.sourceAccount,
      targetAccount: payload.targetAccount,
      amount: payload.amount,
      correlationId: envelope.correlationId,
      idempotencyKey: envelope.idempotencyKey,
      paymentScenario: payload.paymentScenario ?? null,
      now,
    });

    const outcome = await this.#repository.start({ transaction: candidate });

    if (outcome.kind === 'EXISTS') {
      return await this.#existing(outcome.transaction, payload);
    }

    /**
     * Announced in `PENDING`, which is where it genuinely is for the length of
     * this method. The audit record is meant to reconstruct the flow, and a
     * flow whose first event already claimed `DEBITING` would have no record of
     * the transfer ever having been merely accepted.
     */
    await this.#publisher.publish({
      messageType: transactionInitiatedV1.name,
      payload: {
        transactionId: outcome.transaction.transactionId,
        sourceAccount: outcome.transaction.sourceAccount,
        targetAccount: outcome.transaction.targetAccount,
        amount: outcome.transaction.amount,
        status: 'PENDING',
        createdAt: outcome.transaction.createdAt.toISOString(),
      },
    });

    /**
     * The first edge of the diagram, taken through the same code path as every
     * other edge — deduplicated by `messageId`, decided under the row lock,
     * recorded in the local trail. Ordering the debit by hand here would be one
     * transition that skipped the machine that governs all the others.
     */
    await this.#saga.execute({
      transactionId: outcome.transaction.transactionId,
      event: { kind: 'DEBIT_ORDERED' },
      messageId: envelope.messageId,
      messageType: 'transfer.requested.v1',
      payload,
    });

    return { kind: 'STARTED', transaction: outcome.transaction };
  }

  /** A key that was used before. Which of T-3 and T-4 applies is the content. */
  async #existing(original: Transaction, payload: TransferRequestedV1): Promise<RequestOutcome> {
    if (conflictsWithOriginal(original, payload)) {
      await this.#refuse(payload.transactionId, 'IDEMPOTENCY_KEY_CONFLICT');

      return { kind: 'REFUSED', reason: 'IDEMPOTENCY_KEY_CONFLICT' };
    }

    /**
     * A retry. No second Saga, no second event, no balance touched — and the
     * identifier the caller was handed made to resolve to the transfer that
     * actually exists.
     */
    await this.#repository.recordAlias({
      requestedTransactionId: payload.transactionId,
      transactionId: original.transactionId,
    });

    return { kind: 'DUPLICATE', transaction: original };
  }

  /**
   * Says no, in the audit trail, for a transaction that was never created.
   *
   * `transaction.failed.v1` carries the identifier the caller was given rather
   * than one this service invented, because that is the identifier they will
   * ask about. The row genuinely does not exist — `docs/domain/entities.md` is
   * explicit that these refusals happen "before the transaction is created" —
   * so the status query will answer `NOT_FOUND`, and the trail is where the
   * reason lives. Recorded as TD-032.
   */
  async #refuse(transactionId: string, reason: RequestRejection): Promise<void> {
    await this.#publisher.publish({
      messageType: transactionFailedV1.name,
      payload: {
        transactionId,
        status: 'FAILED',
        reason,
        failedAt: this.#clock.now().toISOString(),
      },
    });
  }
}
