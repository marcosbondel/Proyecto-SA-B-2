import {
  accountCreditRequestedV1,
  accountDebitCompensationRequestedV1,
  accountDebitRequestedV1,
  paymentRequestedV1,
  transactionCompensatedV1,
  transactionCompletedV1,
  transactionFailedV1,
} from '@bank/contracts';

import { applyEvent } from '../domain/transaction';
import type { SagaEvent, Transaction, Transition } from '../domain/transaction';
import type {
  Clock,
  EventOutcome,
  EventPublisher,
  IdGenerator,
  TransactionRepository,
} from './ports';

/**
 * One step of the Saga, whichever step it is.
 *
 * Every event in this choreography does the same three things — decide the
 * transition against the row under a lock, order whatever comes next, announce
 * the ending if there is one — and only the event differs. Eight use cases that
 * differed by one `switch` arm would be eight places to forget the
 * deduplication, so there is one, and the arms live in the domain's
 * `applyEvent` where they can be tested without a database.
 *
 * **Publishing happens after the commit, deliberately and imperfectly.** The
 * alternative is an outbox, and the assignment's Saga does not require one
 * (TD-031 records the gap): a crash in the window between committing a
 * transition and publishing its command leaves a transfer stuck in the state it
 * legitimately reached, which the status query reports honestly and a human can
 * resolve. Publishing *before* the commit would be worse in the way that
 * matters — a debit ordered for a transition that then rolled back is money
 * moved for a transfer that never advanced.
 */
export class AdvanceSagaUseCase {
  readonly #repository: TransactionRepository;
  readonly #publisher: EventPublisher;
  readonly #clock: Clock;
  readonly #ids: IdGenerator;

  constructor(dependencies: {
    readonly repository: TransactionRepository;
    readonly publisher: EventPublisher;
    readonly clock: Clock;
    readonly ids: IdGenerator;
  }) {
    this.#repository = dependencies.repository;
    this.#publisher = dependencies.publisher;
    this.#clock = dependencies.clock;
    this.#ids = dependencies.ids;
  }

  /**
   * Applies one event and does whatever it implies.
   *
   * Returns the outcome rather than swallowing it so the interface layer can
   * log a duplicate, an unknown transaction and an illegal transition as the
   * three different things they are. None of them is a failure and none of them
   * throws: throwing would send a correct decision down the retry ladder and
   * into the dead-letter queue.
   */
  public async execute(input: {
    readonly transactionId: string;
    readonly event: SagaEvent;
    readonly messageId: string;
    readonly messageType: string;
    readonly payload: unknown;
  }): Promise<EventOutcome> {
    const now = this.#clock.now();

    const outcome = await this.#repository.applyEvent({
      transactionId: input.transactionId,
      messageId: input.messageId,
      messageType: input.messageType,
      payload: input.payload,
      decide: (transaction) => applyEvent(transaction, input.event),
      now,
    });

    if (outcome.kind !== 'APPLIED') {
      return outcome;
    }

    await this.#order(outcome.transaction, outcome.transition);
    await this.#announce(outcome.transaction, outcome.transition, now);

    return outcome;
  }

  /** The next command of the choreography, if this transition ordered one. */
  async #order(transaction: Transaction, transition: Transition): Promise<void> {
    switch (transition.command) {
      case null:
        return;

      case 'DEBIT':
        await this.#publisher.send({
          messageType: accountDebitRequestedV1.name,
          payload: {
            transactionId: transaction.transactionId,
            accountId: transaction.sourceAccount,
            amount: transaction.amount,
          },
        });

        return;

      case 'PAYMENT': {
        /**
         * The one identifier this service mints. It is recorded in the local
         * trail before it is published, because a `paymentId` that exists only
         * inside a message in flight is a payment nobody can ask about.
         */
        const paymentId = this.#ids.next();
        const payload = {
          paymentId,
          transactionId: transaction.transactionId,
          amount: transaction.amount,
          ...(transaction.paymentScenario === null
            ? {}
            : { scenario: transaction.paymentScenario }),
        };

        await this.#repository.recordCommand({
          transactionId: transaction.transactionId,
          messageType: paymentRequestedV1.name,
          payload,
        });

        await this.#publisher.send({ messageType: paymentRequestedV1.name, payload });

        return;
      }

      case 'CREDIT':
        await this.#publisher.send({
          messageType: accountCreditRequestedV1.name,
          payload: {
            transactionId: transaction.transactionId,
            accountId: transaction.targetAccount,
            amount: transaction.amount,
          },
        });

        return;

      case 'COMPENSATION':
        await this.#publisher.send({
          messageType: accountDebitCompensationRequestedV1.name,
          payload: {
            transactionId: transaction.transactionId,
            /** Back to where it came from. A compensation is not a transfer. */
            accountId: transaction.sourceAccount,
            amount: transaction.amount,
            /**
             * Never `null`. The domain sets `failureReason` on the same
             * transition that orders the compensation, and the contract makes
             * the cause mandatory — a refund with no recorded reason is an
             * audit record that explains nothing.
             */
            triggeredBy: transition.failureReason,
          },
        });

        return;
    }
  }

  /**
   * The ending, when this transition was one.
   *
   * `FAILED` and `COMPENSATED` are two events and not one with a flag. Both
   * mean the customer's money is where it started, but only the second means it
   * moved twice, and the audit record has to be able to say which happened.
   */
  async #announce(transaction: Transaction, transition: Transition, now: Date): Promise<void> {
    const at = (transaction.completedAt ?? now).toISOString();

    switch (transition.status) {
      case 'COMPLETED':
        await this.#publisher.publish({
          messageType: transactionCompletedV1.name,
          payload: {
            transactionId: transaction.transactionId,
            sourceAccount: transaction.sourceAccount,
            targetAccount: transaction.targetAccount,
            amount: transaction.amount,
            status: 'COMPLETED',
            completedAt: at,
          },
        });

        return;

      case 'FAILED':
        await this.#publisher.publish({
          messageType: transactionFailedV1.name,
          payload: {
            transactionId: transaction.transactionId,
            status: 'FAILED',
            reason: transition.failureReason,
            failedAt: at,
          },
        });

        return;

      case 'COMPENSATED':
        await this.#publisher.publish({
          messageType: transactionCompensatedV1.name,
          payload: {
            transactionId: transaction.transactionId,
            status: 'COMPENSATED',
            reason: transition.failureReason,
            compensatedAt: at,
          },
        });

        return;

      default:
        return;
    }
  }
}
