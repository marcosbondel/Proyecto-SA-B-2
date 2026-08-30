import {
  paymentListQueryV1,
  paymentRequestedV1,
  paymentStatsQueryV1,
  paymentStatusQueryV1,
} from '@bank/contracts';
import type { MessageEnvelope } from '@bank/contracts';

import type { EventPublisher } from '../application/ports';
import type { ProcessPaymentUseCase } from '../application/process-payment.use-case';
import type { GetPaymentStatsUseCase } from '../application/get-payment-stats.use-case';
import type { QueryPaymentUseCase } from '../application/query-payment.use-case';
import type { InboundMessageHandler } from './inbound-message.handler';

/**
 * The three messages this service claims, each parsed against its own contract
 * before a use case sees it.
 *
 * The parse is the boundary. Everything inside the application layer may assume
 * its input is the shape the catalogue fixed, and everything outside is assumed
 * to be arbitrary — which for a service reached over a broker is the correct
 * assumption. A payload that fails here throws, which sends the message down
 * the retry ladder and then to the dead-letter queue, where a malformed command
 * belongs.
 */

/** `payment.requested.v1` — step 4 of the Saga, and the only command this service takes. */
export class ProcessPaymentHandler implements InboundMessageHandler {
  public readonly messageType = paymentRequestedV1.name;

  readonly #useCase: ProcessPaymentUseCase;
  readonly #publisher: EventPublisher;

  constructor(useCase: ProcessPaymentUseCase, publisher: EventPublisher) {
    this.#useCase = useCase;
    this.#publisher = publisher;
  }

  public async handle(envelope: MessageEnvelope<unknown>): Promise<void> {
    const command = paymentRequestedV1.schema.parse(envelope.payload);

    await this.#useCase.open(
      {
        paymentId: command.paymentId,
        transactionId: command.transactionId,
        amount: command.amount,
        scenario: command.scenario ?? null,
        /**
         * Kept so a retry three rungs later can still publish under the
         * correlation the transfer began with. Without it the sweeper would
         * have to start a fresh one, and the trail somebody follows to ask "why
         * did this take thirty seconds" would break at exactly the point the
         * answer is.
         */
        originCorrelationId: envelope.correlationId,
      },
      this.#publisher,
    );
  }
}

/** `payment.list.query.v1` — the monitoring screen. */
export class ListPaymentsHandler implements InboundMessageHandler {
  public readonly messageType = paymentListQueryV1.name;

  readonly #useCase: QueryPaymentUseCase;
  readonly #publisher: EventPublisher;

  constructor(useCase: QueryPaymentUseCase, publisher: EventPublisher) {
    this.#useCase = useCase;
    this.#publisher = publisher;
  }

  public async handle(envelope: MessageEnvelope<unknown>): Promise<void> {
    const query = paymentListQueryV1.schema.parse(envelope.payload);

    await this.#useCase.list(query, this.#publisher);
  }
}

/** `payment.stats.query.v1` — the dashboard's counts. Staff only. */
export class PaymentStatsHandler implements InboundMessageHandler {
  public readonly messageType = paymentStatsQueryV1.name;

  readonly #useCase: GetPaymentStatsUseCase;

  constructor(useCase: GetPaymentStatsUseCase) {
    this.#useCase = useCase;
  }

  public async handle(envelope: MessageEnvelope<unknown>): Promise<void> {
    paymentStatsQueryV1.schema.parse(envelope.payload);

    await this.#useCase.execute(envelope.identity);
  }
}

/** `payment.status.query.v1` — one payment and the ladder it climbed. */
export class PaymentStatusHandler implements InboundMessageHandler {
  public readonly messageType = paymentStatusQueryV1.name;

  readonly #useCase: QueryPaymentUseCase;
  readonly #publisher: EventPublisher;

  constructor(useCase: QueryPaymentUseCase, publisher: EventPublisher) {
    this.#useCase = useCase;
    this.#publisher = publisher;
  }

  public async handle(envelope: MessageEnvelope<unknown>): Promise<void> {
    const query = paymentStatusQueryV1.schema.parse(envelope.payload);

    await this.#useCase.status(query.paymentId, this.#publisher);
  }
}
