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
  settlementOf,
  type InterbankSendEvent,
  type InterbankSendTransition,
} from '../domain/interbank-send';
import type { OutboxMessage } from './ports';

/**
 * Cuánto espera la reconciliación antes de dar un veredicto por perdido.
 *
 * No es un plazo de negocio, es un margen contra sí misma: una fila recién
 * decidida puede tener su veredicto escrito en una transacción que todavía no
 * ha comitado, y reconciliarla publicaría dos veces lo mismo con dos
 * `messageId` distintos. Dos minutos es órdenes de magnitud más que cualquier
 * transacción de este servicio, y ni de lejos tanto como para que un veredicto
 * perdido tarde en recuperarse.
 */
const RECONCILE_GRACE_MS = 120_000;
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
      /*
       * Éste sí se publica directamente, y la asimetría con `#apply` es
       * deliberada (TD-093).
       *
       * El estado que anuncia es `PENDING`, y una fila `PENDING` **sigue dentro
       * del alcance de los dos barridos**: si este evento se pierde porque el
       * proceso muere, nada queda irrecuperable — el depósito se reintenta, se
       * decide, y el veredicto sale por el outbox. Lo que se perdería es una
       * línea de auditoría del alta, que es re-derivable de la propia fila.
       *
       * El veredicto no tiene esa red: una fila decidida no la recoge ningún
       * barrido, y ahí sí hay dinero en juego. Pagar el coste de una
       * transacción en el alta para proteger algo que ya está protegido sería
       * ceremonia.
       */
      await this.#announceOpened(opened.send, now);
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

    /*
     * Los eventos se construyen **antes** de tocar la base y viajan con el
     * `UPDATE` (TD-093). Construirlos aquí tiene una segunda virtud: validar el
     * contrato falla antes de que nada se haya escrito, en vez de dejar una
     * fila en el outbox que el relay no puede publicar nunca.
     */
    const outbound = [
      this.#stateChangeMessage(send, transition.state, transition.reason, now),
      ...(transition.settle === null
        ? []
        : [this.#settlementMessage(send, transition.settle, transition.reason, now)]),
    ];

    const moved = await this.#repository.advance({
      interbankTransferId: send.interbankTransferId,
      from: transition.from,
      to: transition.state,
      reason: transition.reason,
      nextAttemptAt,
      now,
      outbound,
    });

    if (!moved) {
      /*
       * Otro llegó primero — el callback y el barrido pueden coincidir. El que
       * pierde no publica nada: dos transiciones legales aplicadas a la vez
       * dejarían el depósito donde ninguna de las dos pidió, y la Saga vería
       * dos finales. Y ahora tampoco **escribe** nada: el repositorio hace el
       * `ROLLBACK` cuando el `UPDATE` no mueve ninguna fila, así que el outbox
       * no recibe el veredicto del que perdió.
       */
      this.#log.info('otra transicion interbancaria llego primero', {
        correlationId: send.correlationId,
        interbankTransferId: send.interbankTransferId,
        from: transition.from,
        to: transition.state,
      });
      return;
    }

    this.#measure(send, transition.state, transition.reason, now);
  }

  /**
   * La reconciliación: los veredictos que se perdieron antes de TD-093.
   *
   * No arregla el defecto —eso lo hace el outbox de `#apply`— sino que recupera
   * lo que el defecto ya se llevó. En régimen normal **no encuentra nada
   * nunca**, y eso es exactamente la señal de que la pieza (a) está puesta: una
   * fila sólo cae aquí si está decidida y su veredicto no llegó al outbox, y
   * desde la migración 014 las dos cosas se escriben juntas.
   *
   * El veredicto se reconstruye del estado de la fila, no de un evento
   * guardado, porque no hay ninguno que guardar: por eso lleva un `messageId`
   * nuevo. Es seguro porque la máquina de estados de `transaction-service`
   * rechaza toda transición fuera del diagrama — un veredicto que llega sobre
   * una transferencia ya compensada se descarta en vez de compensar dos veces.
   *
   * Se registra en `warn` y no en `info`: si esto encuentra algo, hubo una
   * caída entre decidir y encolar, y alguien debería verlo aunque el sistema se
   * haya recuperado solo.
   */
  public async reconcile(limit = 20): Promise<number> {
    const olderThan = new Date(this.#clock().getTime() - RECONCILE_GRACE_MS);
    let recovered = 0;

    for (const send of await this.#repository.claimUnreconciled(olderThan, limit)) {
      const settlement = settlementOf(send.state);

      if (settlement === null) {
        continue;
      }

      const now = this.#clock();
      const enqueued = await this.#repository.enqueueVerdict({
        interbankTransferId: send.interbankTransferId,
        outbound: [
          this.#stateChangeMessage(send, send.state, send.reason, now),
          this.#settlementMessage(send, settlement, send.reason, now),
        ],
        now,
      });

      if (!enqueued) {
        continue;
      }

      recovered += 1;
      this.#log.warn('veredicto interbancario reconciliado: se habia perdido al publicarlo', {
        correlationId: send.correlationId,
        interbankTransferId: send.interbankTransferId,
        transactionId: send.transactionId,
        state: send.state,
        reason: send.reason,
        decidedAgoMs: now.getTime() - send.createdAt.getTime(),
      });
    }

    return recovered;
  }

  /**
   * El cambio de estado, para la auditoría. Construido, no publicado.
   *
   * Lo publica el `OutboxRelay` después de que la transición haya comitado
   * (TD-093).
   */
  #stateChangeMessage(
    send: InterbankSend,
    state: InterbankSend['state'],
    reason: string | null,
    now: Date,
  ): OutboxMessage {
    return this.#messenger.envelopeFor(send.origin, paymentInterbankSentV1.name, {
      paymentId: send.paymentId,
      transactionId: send.transactionId,
      interbankTransferId: send.interbankTransferId,
      state,
      reason,
      occurredAt: now.toISOString(),
    });
  }

  /**
   * La métrica, **después** de que la transición haya comitado.
   *
   * Separada del evento por una razón que no es estética: una métrica se emite
   * en memoria y no se puede meter en una transacción de base de datos. Si se
   * midiera antes del `COMMIT`, un `ROLLBACK` dejaría medido un cambio de
   * estado que no ocurrió — y los paneles de T-50 mentirían en el único momento
   * en que hace falta que digan la verdad.
   */
  #measure(
    send: InterbankSend,
    state: InterbankSend['state'],
    reason: string | null,
    now: Date,
  ): void {
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

  /** El alta del depósito, que sí se publica directamente — ver `requested`. */
  async #announceOpened(send: InterbankSend, now: Date): Promise<void> {
    await this.#messenger.event(send.origin, paymentInterbankSentV1.name, {
      paymentId: send.paymentId,
      transactionId: send.transactionId,
      interbankTransferId: send.interbankTransferId,
      state: send.state,
      reason: send.reason,
      occurredAt: now.toISOString(),
    });

    this.#measure(send, send.state, send.reason, now);
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
  #settlementMessage(
    send: InterbankSend,
    settlement: 'SUCCEEDED' | 'FAILED',
    reason: string | null,
    now: Date,
  ): OutboxMessage {
    const attempt = Math.max(1, send.attempts);

    if (settlement === 'SUCCEEDED') {
      return this.#messenger.envelopeFor(send.origin, paymentSucceededV1.name, {
        paymentId: send.paymentId,
        transactionId: send.transactionId,
        status: 'SUCCEEDED',
        attempt,
        succeededAt: now.toISOString(),
      });
    }

    return this.#messenger.envelopeFor(send.origin, paymentFailedV1.name, {
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
