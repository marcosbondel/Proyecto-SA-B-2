import {
  paymentListQueryV1,
  paymentInterbankReceiveV1,
  accountInterbankEligibilityRepliedV1,
  accountInterbankCreditedV1,
  accountInterbankCreditRejectedV1,
  paymentRequestedV1,
  paymentSimulationQueryV1,
  paymentSimulationUpdateV1,
  paymentStatsQueryV1,
  paymentStatusQueryV1,
} from '@bank/contracts';
import type { MessageEnvelope } from '@bank/contracts';

import type { EventPublisher } from '../application/ports';
import type { SimulationUseCase } from '../application/manage-simulation.use-case';
import type { ProcessPaymentUseCase } from '../application/process-payment.use-case';
import type { InterbankUseCase } from '../application/interbank.use-case';
import type { GetPaymentStatsUseCase } from '../application/get-payment-stats.use-case';
import type { QueryPaymentUseCase } from '../application/query-payment.use-case';
import type { InboundMessageHandler } from './inbound-message.handler';

export class InterbankReceiveHandler implements InboundMessageHandler {
  readonly messageType = paymentInterbankReceiveV1.name;
  constructor(readonly useCase: InterbankUseCase) {}
  async handle(envelope: MessageEnvelope<unknown>): Promise<void> {
    paymentInterbankReceiveV1.schema.parse(envelope.payload);
    await this.useCase.receive(envelope);
  }
}

export class InterbankEligibilityReplyHandler implements InboundMessageHandler {
  readonly messageType = accountInterbankEligibilityRepliedV1.name;
  constructor(readonly useCase: InterbankUseCase) {}
  async handle(envelope: MessageEnvelope<unknown>): Promise<void> {
    await this.useCase.eligibility(
      envelope,
      accountInterbankEligibilityRepliedV1.schema.parse(envelope.payload),
    );
  }
}

export class InterbankCreditedHandler implements InboundMessageHandler {
  readonly messageType = accountInterbankCreditedV1.name;
  constructor(readonly useCase: InterbankUseCase) {}
  async handle(envelope: MessageEnvelope<unknown>): Promise<void> {
    await this.useCase.credited(
      envelope,
      accountInterbankCreditedV1.schema.parse(envelope.payload),
    );
  }
}

export class InterbankCreditRejectedHandler implements InboundMessageHandler {
  readonly messageType = accountInterbankCreditRejectedV1.name;
  constructor(readonly useCase: InterbankUseCase) {}
  async handle(envelope: MessageEnvelope<unknown>): Promise<void> {
    await this.useCase.creditRejected(
      envelope,
      accountInterbankCreditRejectedV1.schema.parse(envelope.payload),
    );
  }
}

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

/**
 * `payment.simulation.update.v1` — an administrator changing how the simulated
 * provider misbehaves, without a redeploy (T-44).
 *
 * The envelope's identity goes to the use case, which refuses anybody who is
 * not an administrator: the Gateway checks the role too, but this service is
 * reachable by the broker and does not trust its caller.
 */
export class SimulationUpdateHandler implements InboundMessageHandler {
  public readonly messageType = paymentSimulationUpdateV1.name;

  readonly #useCase: SimulationUseCase;
  readonly #publisher: EventPublisher;

  constructor(useCase: SimulationUseCase, publisher: EventPublisher) {
    this.#useCase = useCase;
    this.#publisher = publisher;
  }

  public async handle(envelope: MessageEnvelope<unknown>): Promise<void> {
    const command = paymentSimulationUpdateV1.schema.parse(envelope.payload);

    await this.#useCase.update({
      command,
      identity: envelope.identity,
      correlationId: envelope.correlationId,
      publisher: this.#publisher,
    });
  }
}

/** `payment.simulation.query.v1` — how the provider is set up right now. */
export class SimulationQueryHandler implements InboundMessageHandler {
  public readonly messageType = paymentSimulationQueryV1.name;

  readonly #useCase: SimulationUseCase;
  readonly #publisher: EventPublisher;

  constructor(useCase: SimulationUseCase, publisher: EventPublisher) {
    this.#useCase = useCase;
    this.#publisher = publisher;
  }

  public async handle(envelope: MessageEnvelope<unknown>): Promise<void> {
    paymentSimulationQueryV1.schema.parse(envelope.payload);

    await this.#useCase.query(this.#publisher);
  }
}
