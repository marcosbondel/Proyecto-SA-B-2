import {
  accountCreditRequestedV1,
  accountDebitCompensationRequestedV1,
  accountDebitRequestedV1,
  customerKycCheckRequestedV1,
  paymentRequestedV1,
  transactionCompensatedV1,
  transactionCompletedV1,
  transactionFailedV1,
} from '@bank/contracts';

import { phaseStatusOf } from '../domain/phase-status';
import { applyEvent } from '../domain/transaction';
import type { SagaEvent, Transaction, Transition } from '../domain/transaction';
import type {
  AppliedEffects,
  Clock,
  EventOutcome,
  EventPublisher,
  IdGenerator,
  OutboundMessage,
  OutboxMessage,
  TransactionRepository,
  TransferTelemetry,
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
  readonly #telemetry: TransferTelemetry;

  constructor(dependencies: {
    readonly repository: TransactionRepository;
    readonly publisher: EventPublisher;
    readonly clock: Clock;
    readonly ids: IdGenerator;
    readonly telemetry: TransferTelemetry;
  }) {
    this.#repository = dependencies.repository;
    this.#publisher = dependencies.publisher;
    this.#clock = dependencies.clock;
    this.#ids = dependencies.ids;
    this.#telemetry = dependencies.telemetry;
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
      /**
       * The command and event this transition implies, handed to the repository
       * so they are written to the outbox **in the same transaction** as the
       * state change (TD-031). Nothing is published here any more: the relay
       * sweeps the outbox and does that, which is what closes the crash window
       * between committing a transition and ordering the money movement it
       * demands. Called only for a transition that applied, so a duplicate or an
       * out-of-order event re-emits nothing.
       */
      outbound: (transaction, transition) => this.#effectsOf(transaction, transition),
      now,
    });

    /**
     * Reported only for a transition that applied, and only after it committed.
     * A duplicate, an unknown transaction and an illegal event are not steps of
     * the Saga, so none of them becomes a span or moves a counter — which is also
     * what keeps a redelivery from being counted twice. The state machine is not
     * consulted again and nothing here can change what it decided.
     */
    if (outcome.kind === 'APPLIED') {
      this.#telemetry.step({
        transactionId: input.transactionId,
        correlationId: outcome.transaction.correlationId,
        event: input.event.kind,
        from: outcome.transition.from,
        to: outcome.transition.status,
        phase: phaseStatusOf(outcome.transition.status),
        command: outcome.transition.command,
        failureReason: outcome.transition.failureReason,
        completedAt: outcome.transaction.completedAt,
        observation: outcome.observation,
      });
    }

    return outcome;
  }

  /**
   * Everything a transition implies, as data — the command it orders and the
   * ending it announces — built into durable outbox messages without sending
   * any of them. This ran, before the outbox, as two `await publisher.*` calls
   * after the commit; now it is a pure function of the transition, and the
   * repository persists what it returns alongside the state it decided.
   */
  #effectsOf(transaction: Transaction, transition: Transition): AppliedEffects {
    const dispatch: OutboxMessage[] = [];
    const trail: OutboundMessage[] = [];

    const ordered = this.#commandFor(transaction, transition);

    if (ordered !== null) {
      dispatch.push(this.#publisher.envelopeFor(ordered.message, 'command'));

      if (ordered.trail !== undefined) {
        trail.push(ordered.trail);
      }
    }

    const announced = this.#eventFor(transaction, transition);

    if (announced !== null) {
      dispatch.push(this.#publisher.envelopeFor(announced, 'event'));
    }

    return { dispatch, trail };
  }

  /** The next command of the choreography, if this transition ordered one. */
  #commandFor(
    transaction: Transaction,
    transition: Transition,
  ): { readonly message: OutboundMessage; readonly trail?: OutboundMessage } | null {
    switch (transition.command) {
      case null:
        return null;

      case 'KYC_CHECK':
        /**
         * `customerId` is never `null` here: `RequestTransferUseCase` refuses
         * an identity-less request before a row exists, and a customer's own
         * record is the only place this transition ever came from
         * (`domain/transaction.ts`'s `KYC_CHECK_ORDERED`, ordered once, from
         * `PENDING`). If that invariant is ever wrong, publishing a command
         * with no customer to ask about is a bug worth crashing loud on
         * rather than one this Saga would otherwise wait out silently.
         */
        if (transaction.customerId === null) {
          throw new Error(
            `Transaction ${transaction.transactionId} ordered a KYC check with no customerId.`,
          );
        }

        return {
          message: {
            messageType: customerKycCheckRequestedV1.name,
            payload: {
              transactionId: transaction.transactionId,
              customerId: transaction.customerId,
            },
          },
        };

      case 'DEBIT':
        return {
          message: {
            messageType: accountDebitRequestedV1.name,
            payload: {
              transactionId: transaction.transactionId,
              accountId: transaction.sourceAccount,
              amount: transaction.amount,
            },
          },
        };

      case 'PAYMENT': {
        /**
         * The one identifier this service mints. It is recorded in the local
         * trail in the same transaction it is enqueued in, because a `paymentId`
         * that exists only inside a message in flight is a payment nobody can
         * ask about — and now the trail row and the outbox row commit together.
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
        const message = { messageType: paymentRequestedV1.name, payload };

        return { message, trail: message };
      }

      case 'CREDIT':
        return {
          message: {
            messageType: accountCreditRequestedV1.name,
            payload: {
              transactionId: transaction.transactionId,
              accountId: transaction.targetAccount,
              amount: transaction.amount,
            },
          },
        };

      case 'COMPENSATION':
        return {
          message: {
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
          },
        };
    }
  }

  /**
   * The ending, when this transition was one.
   *
   * `FAILED` and `COMPENSATED` are two events and not one with a flag. Both
   * mean the customer's money is where it started, but only the second means it
   * moved twice, and the audit record has to be able to say which happened.
   *
   * The timestamp comes from the transaction the repository just updated: for a
   * terminal transition `completedAt` was stamped in that same write, so it is
   * the moment the ending actually happened rather than a clock read here.
   *
   * All three carry `customerId` from the row rather than leaving the subject
   * to the envelope. This service is the only one that still knows who asked by
   * the time a transfer ends: the identity is lost when Payment Service's retry
   * sweeper republishes on a timer, so a transfer that exhausts the ladder used
   * to compensate the money and tell nobody. The contracts explain the rest.
   */
  #eventFor(transaction: Transaction, transition: Transition): OutboundMessage | null {
    const at = (transaction.completedAt ?? transaction.updatedAt).toISOString();

    switch (transition.status) {
      case 'COMPLETED':
        return {
          messageType: transactionCompletedV1.name,
          payload: {
            transactionId: transaction.transactionId,
            customerId: transaction.customerId,
            sourceAccount: transaction.sourceAccount,
            targetAccount: transaction.targetAccount,
            amount: transaction.amount,
            status: 'COMPLETED',
            completedAt: at,
          },
        };

      case 'FAILED':
        return {
          messageType: transactionFailedV1.name,
          payload: {
            transactionId: transaction.transactionId,
            customerId: transaction.customerId,
            status: 'FAILED',
            reason: transition.failureReason,
            failedAt: at,
          },
        };

      case 'COMPENSATED':
        return {
          messageType: transactionCompensatedV1.name,
          payload: {
            transactionId: transaction.transactionId,
            customerId: transaction.customerId,
            status: 'COMPENSATED',
            reason: transition.failureReason,
            compensatedAt: at,
          },
        };

      default:
        return null;
    }
  }
}
