import {
  paymentListQueryV1,
  accountDebitCompensatedV1,
  paymentInterbankCallbackReceivedV1,
  paymentInterbankReceiveV1,
  type PaymentInterbankCallbackReceivedV1,
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
import type { SendInterbankDepositUseCase } from '../application/send-interbank-deposit.use-case';
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
  readonly #interbank: SendInterbankDepositUseCase | null;

  constructor(
    useCase: ProcessPaymentUseCase,
    publisher: EventPublisher,
    interbank: SendInterbankDepositUseCase | null = null,
  ) {
    this.#useCase = useCase;
    this.#publisher = publisher;
    this.#interbank = interbank;
  }

  public async handle(envelope: MessageEnvelope<unknown>): Promise<void> {
    const command = paymentRequestedV1.schema.parse(envelope.payload);

    /**
     * La bifurcación del pago (T-47): si el comando trae el bloque
     * `interbank`, a quien hay que pedirle el dinero es al banco pareja y no al
     * proveedor simulado.
     *
     * Aquí y no en el caso de uso de pagos, porque aquí es donde el mensaje se
     * entiende: `process-payment.use-case.ts` decide con una escalera de
     * reintentos y un proveedor que contesta al momento, y un depósito
     * interbancario no tiene ni lo uno ni lo otro — tiene un acuse, una espera
     * y un vencimiento. Meter las dos cosas en el mismo caso de uso habría
     * sido una condición dentro de la función que decide si se compensa un
     * débito, que es el último sitio del sistema donde conviene una rama.
     *
     * Un despliegue sin el interbancario configurado (`#interbank` nulo) paga
     * como siempre: el bloque se ignora y el pago va al proveedor simulado. Es
     * deliberado — un banco sin banco pareja sigue siendo un banco.
     */
    if (command.interbank !== undefined && this.#interbank !== null) {
      await this.#interbank.requested(
        envelope as MessageEnvelope<typeof command>,
      );
      return;
    }

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

/**
 * `payment.interbank.callback.received.v1` — la decisión del banco pareja sobre
 * un depósito que este banco envió (T-47).
 *
 * Entra por el Gateway, que es el único que habla con fuera, y llega aquí como
 * comando porque dice «registra esta decisión» y el único que puede es este
 * servicio.
 */
export class InterbankCallbackHandler implements InboundMessageHandler {
  public readonly messageType = paymentInterbankCallbackReceivedV1.name;

  readonly #useCase: SendInterbankDepositUseCase;

  constructor(useCase: SendInterbankDepositUseCase) {
    this.#useCase = useCase;
  }

  public async handle(envelope: MessageEnvelope<unknown>): Promise<void> {
    // Se valida el cuerpo y se pasa la envolvente entera: el caso de uso
    // necesita la correlación y la identidad, no sólo el payload.
    paymentInterbankCallbackReceivedV1.schema.parse(envelope.payload);

    await this.#useCase.callback(
      envelope as MessageEnvelope<PaymentInterbankCallbackReceivedV1>,
    );
  }
}

/**
 * `account.debit.compensated.v1` — el dinero volvió a la cuenta origen (T-47).
 *
 * Este servicio escucha un evento de la Saga que no le concierne en general, y
 * por un motivo concreto: es el único que puede escribir `REVERSED`, que es la
 * constancia de que la devolución **ocurrió** y no sólo se ordenó. Sin esto,
 * «rechazado» y «rechazado y devuelto» serían el mismo estado — la diferencia
 * que §8.3 penaliza con un 50 %.
 *
 * Los eventos de transferencias que no son interbancarias se descartan sin
 * ruido: el caso de uso busca por `transactionId` y no encuentra fila.
 */
export class InterbankCompensatedHandler implements InboundMessageHandler {
  public readonly messageType = accountDebitCompensatedV1.name;

  readonly #useCase: SendInterbankDepositUseCase;

  constructor(useCase: SendInterbankDepositUseCase) {
    this.#useCase = useCase;
  }

  public async handle(envelope: MessageEnvelope<unknown>): Promise<void> {
    const event = accountDebitCompensatedV1.schema.parse(envelope.payload);

    await this.#useCase.compensated(event.transactionId);
  }
}
