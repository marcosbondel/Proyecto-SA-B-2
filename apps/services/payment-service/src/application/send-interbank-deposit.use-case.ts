import {
  paymentFailedV1,
  paymentInterbankSentV1,
  paymentSucceededV1,
  type MessageEnvelope,
  type PaymentInterbankCallbackReceivedV1,
  type PaymentRequestedV1,
} from '@bank/contracts';

import {
  applyInterbankSend,
  IllegalInterbankSendTransition,
  isSendDecided,
  type InterbankSendEvent,
  type InterbankSendTransition,
} from '../domain/interbank-send';
import type {
  InterbankSend,
  InterbankSendMessenger,
  InterbankSendRepository,
  InterbankSendTelemetry,
  PartnerBankClient,
} from './interbank-send.ports';

/**
 * Enviar un depósito al banco pareja (T-47, §4.1 — Integración interbancaria).
 *
 * Se le pide por `payment.requested.v1`, el mismo comando con el que la Saga
 * ordena cualquier pago: lo que distingue a este es que trae el bloque
 * `interbank`. Así que para la Saga **esto es un pago** y acaba como acaban los
 * pagos, con `payment.succeeded.v1` o `payment.failed.v1`. La compensación, el
 * historial, el estado de fase y la notificación salen de la maquinaria que ya
 * existe, en vez de una segunda copia que habría que mantener igual de correcta.
 *
 * Lo único que este servicio no sabía hacer, y que es toda la novedad del
 * ticket: **la respuesta no llega al momento**. El banco pareja contesta `202
 * Accepted` y su decisión vuelve después, por callback, o no vuelve. De ahí las
 * tres entradas de este caso de uso —el comando, el callback y el barrido— y de
 * ahí que el plazo sea una columna y no un temporizador.
 *
 * Qué decide y qué no: **nada**. Las transiciones las decide
 * `domain/interbank-send.ts`, que es puro; esto las persiste con un guardia de
 * estado, publica lo que corresponda y mide. Si la función pura y la base se
 * contradicen, gana la base: sus `CHECK` son la misma máquina escrita en SQL.
 */
export class SendInterbankDepositUseCase {
  readonly #repository: InterbankSendRepository;
  readonly #partner: PartnerBankClient;
  readonly #messenger: InterbankSendMessenger;
  readonly #telemetry: InterbankSendTelemetry;
  readonly #clock: () => Date;
  readonly #confirmationTimeoutMs: number;
  readonly #resendDelaysMs: readonly number[];
  readonly #log: {
    info(message: string, fields: Record<string, unknown>): void;
    warn(message: string, fields: Record<string, unknown>): void;
  };

  constructor(dependencies: {
    readonly repository: InterbankSendRepository;
    readonly partner: PartnerBankClient;
    readonly messenger: InterbankSendMessenger;
    readonly telemetry: InterbankSendTelemetry;
    readonly clock?: () => Date;
    readonly confirmationTimeoutMs: number;
    readonly resendDelaysMs: readonly number[];
    readonly log: {
      info(message: string, fields: Record<string, unknown>): void;
      warn(message: string, fields: Record<string, unknown>): void;
    };
  }) {
    this.#repository = dependencies.repository;
    this.#partner = dependencies.partner;
    this.#messenger = dependencies.messenger;
    this.#telemetry = dependencies.telemetry;
    this.#clock = dependencies.clock ?? ((): Date => new Date());
    this.#confirmationTimeoutMs = dependencies.confirmationTimeoutMs;
    this.#resendDelaysMs = dependencies.resendDelaysMs;
    this.#log = dependencies.log;
  }

  /**
   * La Saga ordenó el pago, y el pago es un depósito al banco pareja.
   *
   * Da de alta la fila y **entonces** intenta entregarla. En ese orden y no al
   * revés: si el proceso muere entre las dos cosas, lo que queda es un depósito
   * pendiente que el barrido reintentará — mientras que entregar primero y
   * guardar después dejaría dinero camino al otro banco sin constancia de que
   * salió.
   */
  public async requested(envelope: MessageEnvelope<PaymentRequestedV1>): Promise<void> {
    const { interbank } = envelope.payload;

    if (interbank === undefined) {
      return;
    }

    const now = this.#clock();
    const opened = await this.#repository.open({
      send: {
        interbankTransferId: interbank.interbankTransferId,
        paymentId: envelope.payload.paymentId,
        transactionId: envelope.payload.transactionId,
        idempotencyKey: interbank.idempotencyKey,
        destinationBankCode: interbank.bankCode,
        destinationAccount: interbank.account,
        amount: envelope.payload.amount,
        correlationId: envelope.correlationId,
        confirmationDueAt: new Date(now.getTime() + this.#confirmationTimeoutMs),
        createdAt: now,
        traceContext: null,
        origin: envelope,
      },
      now,
    });

    if (opened.kind === 'CREATED') {
      await this.#announce(opened.send, opened.send.state, null, null);
    }

    await this.#deliver(opened.send);
  }

  /**
   * El banco pareja respondió.
   *
   * Un callback repetido no es un problema: la transición desde un estado ya
   * resuelto es ilegal, se registra y no se aplica — que es exactamente lo que
   * tiene que pasar para que una decisión no se cuente dos veces.
   */
  public async callback(
    envelope: MessageEnvelope<PaymentInterbankCallbackReceivedV1>,
  ): Promise<void> {
    const send = await this.#repository.find(envelope.payload.interbankTransferId);

    if (send === null) {
      /*
       * Un callback para un depósito que este banco no mandó. No es un error de
       * este servicio y no se reencola: se registra, porque es información —
       * puede ser el otro banco confundiendo identificadores, y eso hay que
       * poder verlo.
       */
      this.#log.warn('callback interbancario de un deposito desconocido', {
        correlationId: envelope.correlationId,
        interbankTransferId: envelope.payload.interbankTransferId,
      });
      return;
    }

    const event: InterbankSendEvent =
      envelope.payload.status === 'ACCEPTED'
        ? { kind: 'CONFIRMED' }
        : { kind: 'REFUSED', reason: envelope.payload.reason };

    await this.#apply(send, event);
  }

  /**
   * El barrido: reintenta las entregas que vencieron y rinde los depósitos que
   * llevan demasiado esperando.
   *
   * Lee columnas, no memoria, así que un pod nuevo recoge lo que dejó el
   * anterior. El orden importa: primero los vencimientos, porque un depósito
   * que ya pasó su plazo no debe recibir otro intento de entrega — sería
   * mandarle dinero a un banco del que acabamos de dejar de esperar.
   */
  public async sweep(limit = 20): Promise<{ readonly expired: number; readonly resent: number }> {
    const now = this.#clock();
    let expired = 0;
    let resent = 0;

    for (const send of await this.#repository.claimExpired(now, limit)) {
      await this.#apply(send, { kind: 'EXPIRED' });
      expired += 1;
    }

    for (const send of await this.#repository.claimSendable(this.#clock(), limit)) {
      await this.#deliver(send);
      resent += 1;
    }

    return { expired, resent };
  }

  /**
   * El dinero volvió a la cuenta origen.
   *
   * Se entera por el evento de la compensación, y no lo da por hecho al
   * publicar `payment.failed.v1`: ahí la compensación está **ordenada**, no
   * ocurrida. `REVERSED` es constancia, y una constancia que se escribe antes
   * del hecho no es constancia.
   */
  public async compensated(transactionId: string): Promise<void> {
    const send = await this.#repository.findByTransaction(transactionId);

    if (send === null) {
      return;
    }

    await this.#apply(send, { kind: 'COMPENSATED' });
  }

  async #deliver(send: InterbankSend): Promise<void> {
    const result = await this.#partner.send(send);

    await this.#apply(
      send,
      result.acknowledged
        ? { kind: 'ACKNOWLEDGED' }
        : { kind: 'SEND_FAILED', detail: result.detail ?? 'SEND_FAILED' },
    );
  }

  async #apply(send: InterbankSend, event: InterbankSendEvent): Promise<void> {
    let transition: InterbankSendTransition;

    try {
      transition = applyInterbankSend(send.state, event);
    } catch (error) {
      if (error instanceof IllegalInterbankSendTransition) {
        /*
         * Invariante T-6, otra vez: se registra y no se aplica, y NO se
         * reencola. Un callback que llega dos veces, o que llega justo después
         * del vencimiento, es consecuencia normal de un sistema distribuido con
         * reintentos; tratarlo como avería llenaría la cola muerta de
         * comportamiento correcto.
         */
        this.#log.warn('transicion interbancaria ilegal, registrada y descartada', {
          correlationId: send.correlationId,
          interbankTransferId: send.interbankTransferId,
          from: error.from,
          event: error.event,
        });
        return;
      }
      throw error;
    }

    const now = this.#clock();
    const nextAttemptAt =
      transition.state === 'PENDING'
        ? new Date(now.getTime() + this.#resendDelay(send.attempts))
        : null;

    const moved = await this.#repository.advance({
      interbankTransferId: send.interbankTransferId,
      from: transition.from,
      to: transition.state,
      reason: transition.reason,
      nextAttemptAt,
      now,
    });

    if (!moved) {
      /*
       * Otro llegó primero — el callback y el barrido pueden coincidir. El que
       * pierde no publica nada: dos transiciones legales aplicadas a la vez
       * dejarían el depósito donde ninguna de las dos pidió, y la Saga vería
       * dos finales.
       */
      this.#log.info('otra transicion interbancaria llego primero', {
        correlationId: send.correlationId,
        interbankTransferId: send.interbankTransferId,
        from: transition.from,
        to: transition.state,
      });
      return;
    }

    await this.#announce(send, transition.state, transition.reason, now);

    if (transition.settle !== null) {
      await this.#settle(send, transition.settle, transition.reason, now);
    }
  }

  /** El cambio de estado, para la auditoría y para la métrica. */
  async #announce(
    send: InterbankSend,
    state: InterbankSend['state'],
    reason: string | null,
    at: Date | null,
  ): Promise<void> {
    const now = at ?? this.#clock();

    await this.#messenger.event(send.origin, paymentInterbankSentV1.name, {
      paymentId: send.paymentId,
      transactionId: send.transactionId,
      interbankTransferId: send.interbankTransferId,
      state,
      reason,
      occurredAt: now.toISOString(),
    });

    this.#telemetry.stateChanged({
      correlationId: send.correlationId,
      interbankTransferId: send.interbankTransferId,
      transactionId: send.transactionId,
      state,
      reason,
      // Desde que se pidió hasta que alguien decidió. `isSendDecided` vive en el
      // dominio: qué estados son un veredicto no lo decide esta capa.
      durationMs: isSendDecided(state) ? now.getTime() - send.createdAt.getTime() : null,
    });
  }

  /**
   * Lo que la Saga necesita oír, en su propio idioma.
   *
   * `TIMEOUT` viaja como `PAYMENT_RETRIES_EXHAUSTED` y no como
   * `PAYMENT_DECLINED`, que es la decisión incómoda de este archivo y conviene
   * dejarla escrita: el catálogo de `payment.failed.v1` tiene dos motivos y
   * ninguno dice «el otro banco no contestó». `PAYMENT_DECLINED` sería falso
   * —nadie declinó— y `PAYMENT_RETRIES_EXHAUSTED` es cierto en lo que importa
   * para la Saga: se dejó de intentar. La distinción que el enunciado pide
   * **no se pierde**: vive en el estado del depósito, en el evento
   * `payment.interbank.sent.v1` y en la métrica, que son los tres sitios donde
   * alguien pregunta si el banco pareja está caído o es estricto.
   */
  async #settle(
    send: InterbankSend,
    settlement: 'SUCCEEDED' | 'FAILED',
    reason: string | null,
    now: Date,
  ): Promise<void> {
    const attempt = Math.max(1, send.attempts);

    if (settlement === 'SUCCEEDED') {
      await this.#messenger.event(send.origin, paymentSucceededV1.name, {
        paymentId: send.paymentId,
        transactionId: send.transactionId,
        status: 'SUCCEEDED',
        attempt,
        succeededAt: now.toISOString(),
      });
      return;
    }

    await this.#messenger.event(send.origin, paymentFailedV1.name, {
      paymentId: send.paymentId,
      transactionId: send.transactionId,
      status: 'FAILED',
      attempt,
      failureReason:
        reason === 'CONFIRMATION_TIMEOUT' ? 'PAYMENT_RETRIES_EXHAUSTED' : 'PAYMENT_DECLINED',
      failedAt: now.toISOString(),
    });
  }

  #resendDelay(attempts: number): number {
    const index = Math.min(Math.max(attempts, 0), this.#resendDelaysMs.length - 1);

    return this.#resendDelaysMs[index] ?? 1_000;
  }
}
