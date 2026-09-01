import { transactionFailedV1, transactionInitiatedV1 } from '@bank/contracts';
import type { TransferRequestedV1 } from '@bank/contracts';

import {
  conflictsWithOriginal,
  isPending,
  openTransaction,
  requestRefusal,
} from '../domain/transaction';
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
      /**
       * Who the system is acting for, recorded on the row at request time.
       *
       * It is the only moment this service ever learns that a transfer belongs
       * to a person: both account references are opaque here, and resolving
       * either means reading Account Service's database (§8.2, 2.3). Missing it
       * once is missing it forever — which is why the column is written on the
       * insert rather than derived later (TD-033, TD-035).
       */
      readonly identity: { readonly customerId: string } | null;
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
      customerId: envelope.identity?.customerId ?? null,
      reference: payload.reference ?? null,
      paymentScenario: payload.paymentScenario ?? null,
      now,
    });

    const outcome = await this.#repository.start({
      transaction: candidate,
      /**
       * Announced in `PENDING`, which is where it genuinely is for the length
       * of this method. The audit record is meant to reconstruct the flow, and
       * a flow whose first event already claimed `DEBITING` would have no
       * record of the transfer ever having been merely accepted.
       *
       * Built here as a callback rather than up front, and — like
       * `applyEvent`'s own `outbound` — called only for the delivery that
       * actually creates the row (TD-031's one remaining gap, now closed): the
       * repository writes it to the outbox in the same insert transaction, and
       * a delivery that loses the race to an existing key never builds it at
       * all, so a retry of the request never announces
       * `transaction.initiated.v1` a second time.
       */
      outbound: (created) =>
        this.#publisher.envelopeFor(
          {
            messageType: transactionInitiatedV1.name,
            payload: {
              transactionId: created.transactionId,
              sourceAccount: created.sourceAccount,
              targetAccount: created.targetAccount,
              amount: created.amount,
              status: 'PENDING',
              createdAt: created.createdAt.toISOString(),
            },
          },
          'event',
        ),
    });

    if (outcome.kind === 'EXISTS') {
      return await this.#existing(outcome.transaction, payload, envelope);
    }

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
  async #existing(
    original: Transaction,
    payload: TransferRequestedV1,
    envelope: { readonly messageId: string },
  ): Promise<RequestOutcome> {
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

    /**
     * The row this delivery found can be a transfer whose Saga never started:
     * `start` committed the insert, and the process died before the
     * `saga.execute` below ever ran — a real crash window, not a hypothetical
     * one, because the two used to be two separate steps with nothing between
     * them but the process staying alive. A transaction left in `PENDING` is
     * indistinguishable from that crash, so it is resumed here, on whatever
     * delivery next finds it.
     *
     * Resuming costs nothing extra. `saga.execute` deduplicates by `messageId`
     * under the same row lock every other transition uses, so a plain
     * redelivery — the common case, same `messageId` as the request that
     * already ordered the debit — is a no-op the moment the row shows
     * `DEBITING`. And if two *different* deliveries (different `messageId`s)
     * ever raced here at once, the domain's own guard closes the gap the
     * dedup check cannot: `applyEvent`'s `DEBIT_ORDERED` case only accepts a
     * transaction that is still `PENDING` (`domain/transaction.ts`), so
     * whichever delivery's lock loses the race finds the row already
     * `DEBITING` and gets `ILLEGAL` — discarded and recorded, never a second
     * debit.
     */
    if (isPending(original)) {
      await this.#saga.execute({
        transactionId: original.transactionId,
        event: { kind: 'DEBIT_ORDERED' },
        messageId: envelope.messageId,
        messageType: 'transfer.requested.v1',
        payload,
      });
    }

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
