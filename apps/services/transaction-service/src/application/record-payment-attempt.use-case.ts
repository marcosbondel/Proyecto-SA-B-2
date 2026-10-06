import type { PaymentAttemptFailedV1 } from '@bank/contracts';

import type { PaymentAttemptOutcome, TransactionRepository, TransferTelemetry } from './ports';

/**
 * Step 4½ of the Saga, and the one that closes the observability gap
 * `routing/topology.ts` promised and nothing delivered: a `payment.attempt.failed.v1`
 * used to arrive on `transaction.saga`, find no claimed handler, and be logged
 * as "message not claimed" without a trace.
 *
 * It records the rung of the retry ladder Payment Service just climbed onto
 * the transaction it already owns, in the trail `paymentOutcomeOf` folds — so
 * `transaction.status.replied.v1`'s `attempt` and `errorType` fields, which
 * used to fill in only once the payment was decided, now fill in while it is
 * still being decided.
 *
 * **This is not a Saga transition.** `PAYMENT_PENDING` stays `PAYMENT_PENDING`:
 * the event does not close the payment and must not move the state machine —
 * `topology.ts`'s own note on the binding says so, and `domain/transaction.ts`
 * is not touched by this file at all. That is also why this is a use case of
 * its own rather than one more arm of `AdvanceSagaUseCase`: that class exists
 * to decide transitions under a lock, and this decides nothing.
 */
export class RecordPaymentAttemptUseCase {
  readonly #repository: TransactionRepository;
  readonly #telemetry: TransferTelemetry;

  constructor(dependencies: {
    readonly repository: TransactionRepository;
    readonly telemetry: TransferTelemetry;
  }) {
    this.#repository = dependencies.repository;
    this.#telemetry = dependencies.telemetry;
  }

  public async execute(
    payload: PaymentAttemptFailedV1,
    envelope: {
      readonly messageId: string;
      readonly messageType: string;
      readonly correlationId: string;
    },
  ): Promise<PaymentAttemptOutcome> {
    const outcome = await this.#repository.recordPaymentAttempt({
      transactionId: payload.transactionId,
      messageId: envelope.messageId,
      messageType: envelope.messageType,
      payload,
    });

    // Reported only for the rung that was just recorded: a redelivery of the same
    // attempt is a `DUPLICATE`, and must not become a second span.
    if (outcome.kind === 'RECORDED') {
      this.#telemetry.paymentAttempt({
        transactionId: payload.transactionId,
        correlationId: envelope.correlationId,
        attempt: payload.attempt,
        errorType: payload.errorType,
        willRetry: payload.willRetry,
        observation: outcome.observation,
      });
    }

    return outcome;
  }
}
