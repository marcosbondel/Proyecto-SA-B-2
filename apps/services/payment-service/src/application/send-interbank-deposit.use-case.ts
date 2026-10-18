import {
  paymentFailedV1,
  paymentInterbankSentV1,
  paymentSucceededV1,
  type MessageEnvelope,
  type PaymentInterbankCallbackReceivedV1,
  type PaymentInterbankV1ResultReceivedV1,
  type PaymentRequestedV1,
} from '@bank/contracts';

import {
  applyInterbankSend,
  IllegalInterbankSendTransition,
  isContradictoryRefusal,
  isLateAcceptAfterRelease,
  isSendDecided,
  settlementOf,
  type InterbankSendEvent,
  type InterbankSendTransition,
} from '../domain/interbank-send';
import {
  resolveBackoff,
  resolveTimeout,
  timeoutSchedule,
  type PartnerCancel,
  type PartnerProbe,
} from '../domain/interbank-timeout';
import { deterministicUuid } from './deterministic-uuid';
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

/** Techo de la espera entre dos intentos de un paso del protocolo que no obtuvo respuesta. */
const RESOLVE_BACKOFF_CAP_MS = 60_000;

/**
 * Cuántas veces se insiste con un reverso que el banco pareja no contesta antes
 * de dejarlo a una persona. Con el techo de abajo son varias horas: el reverso
 * no tiene prisa, pero tampoco se reintenta para siempre en silencio.
 */
const REVERSAL_MAX_ATTEMPTS = 120;
const REVERSAL_POLL_MS = 30_000;
const REVERSAL_BACKOFF_CAP_MS = 300_000;
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
/** La traza W3C que se guarda al crear el depósito y se continúa en cada paso del barrido. */
export interface TraceAdapter {
  /** El `traceparent` del span activo, o `null` si no hay. */
  current(): string | null;
  continue<T>(
    traceparent: string | null,
    spanName: string,
    correlationId: string,
    work: () => Promise<T>,
  ): Promise<T>;
}

export class SendInterbankDepositUseCase {
  readonly #repository: InterbankSendRepository;
  readonly #partner: PartnerBankClient;
  readonly #messenger: InterbankSendMessenger;
  readonly #telemetry: InterbankSendTelemetry;
  readonly #clock: () => Date;
  readonly #transferTtlMs: number;
  readonly #releaseMarginMs: number;
  readonly #resolveRetryMs: number;
  readonly #resendDelaysMs: readonly number[];
  readonly #maxProbeAttempts: number;
  readonly #maxAmountMinor: number;
  readonly #trace: TraceAdapter;
  readonly #log: {
    info(message: string, fields: Record<string, unknown>): void;
    warn(message: string, fields: Record<string, unknown>): void;
    error(message: string, fields: Record<string, unknown>): void;
  };

  constructor(dependencies: {
    readonly repository: InterbankSendRepository;
    readonly partner: PartnerBankClient;
    readonly messenger: InterbankSendMessenger;
    readonly telemetry: InterbankSendTelemetry;
    readonly clock?: () => Date;
    /** `V1_TRANSFER_TTL_MS` del contrato: 180 s. */
    readonly transferTtlMs: number;
    /** `V1_RELEASE_MARGIN_MS` del contrato: 300 s más. */
    readonly releaseMarginMs: number;
    /** Cada cuánto se reintenta un paso del protocolo que no obtuvo respuesta (la base de la espera creciente). */
    readonly resolveRetryMs: number;
    readonly resendDelaysMs: readonly number[];
    /** Cuántas consultas seguidas se hacen antes de pasar a cancelar si nadie contesta. */
    readonly maxProbeAttempts?: number;
    /**
     * El límite por operación, en centavos: **uno solo para recibir y para
     * enviar** (B7). Un envío por encima se declina sin tocar la red.
     */
    readonly maxAmountMinor: number;
    /**
     * Cómo se guarda y se continúa la traza W3C (B9). Es un puerto y no un
     * import de `@bank/observability` porque la capa de aplicación no conoce el
     * SDK.
     */
    readonly trace: TraceAdapter;
    readonly log: {
      info(message: string, fields: Record<string, unknown>): void;
      warn(message: string, fields: Record<string, unknown>): void;
      error(message: string, fields: Record<string, unknown>): void;
    };
  }) {
    this.#repository = dependencies.repository;
    this.#partner = dependencies.partner;
    this.#messenger = dependencies.messenger;
    this.#telemetry = dependencies.telemetry;
    this.#clock = dependencies.clock ?? ((): Date => new Date());
    this.#transferTtlMs = dependencies.transferTtlMs;
    this.#releaseMarginMs = dependencies.releaseMarginMs;
    this.#resolveRetryMs = dependencies.resolveRetryMs;
    this.#resendDelaysMs = dependencies.resendDelaysMs;
    this.#maxProbeAttempts = dependencies.maxProbeAttempts ?? 3;
    this.#maxAmountMinor = dependencies.maxAmountMinor;
    this.#trace = dependencies.trace;
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

    /*
     * Lo que impide hablar el contrato se resuelve **antes de tocar la red**, y
     * con un `payment.failed.v1` en vez de una fila: el dinero ya está debitado,
     * y la Saga lo devuelve con la maquinaria de siempre.
     *
     * - Sin `originAccount` (un pago pedido antes de T-60) no hay `TransferRequest`
     *   válido: el contrato exige la cuenta de origen.
     * - Un monto fuera del límite o una moneda que no es GTQ serían un
     *   `REJECTED` seguro del otro banco; declinarlo aquí ahorra el viaje y,
     *   sobre todo, no depende de que el otro banco aplique su propio límite.
     */
    const impedimento =
      interbank.originAccount === undefined
        ? 'ORIGIN_ACCOUNT_MISSING'
        : envelope.payload.amount.currency !== 'GTQ'
          ? 'CURRENCY_NOT_SUPPORTED'
          : envelope.payload.amount.amountMinor > this.#maxAmountMinor
            ? 'AMOUNT_LIMIT_EXCEEDED'
            : null;

    if (impedimento !== null) {
      this.#log.warn('deposito interbancario declinado antes de enviarse', {
        correlationId: envelope.correlationId,
        transactionId: envelope.payload.transactionId,
        outcome: impedimento,
      });
      await this.#messenger.event(envelope, paymentFailedV1.name, {
        paymentId: envelope.payload.paymentId,
        transactionId: envelope.payload.transactionId,
        status: 'FAILED',
        attempt: 1,
        failureReason: 'PAYMENT_DECLINED',
        failedAt: now.toISOString(),
      });
      return;
    }

    const horario = timeoutSchedule(now, this.#transferTtlMs, this.#releaseMarginMs);
    const opened = await this.#repository.open({
      send: {
        interbankTransferId: interbank.interbankTransferId,
        paymentId: envelope.payload.paymentId,
        transactionId: envelope.payload.transactionId,
        idempotencyKey: interbank.idempotencyKey,
        destinationBankCode: interbank.bankCode,
        destinationAccount: interbank.account,
        originAccount: interbank.originAccount ?? null,
        customerId: envelope.identity?.customerId ?? null,
        amount: envelope.payload.amount,
        correlationId: envelope.correlationId,
        /*
         * Los dos plazos del CONTRATO, no de una variable de entorno (TD-095).
         *
         * `INTERBANK_CONFIRMATION_TIMEOUT_MS` valía 30 s y el contrato manda
         * 180, más un margen de 300 antes de poder liberar a ciegas. Un plazo de
         * interoperabilidad que cada banco configura a su gusto no es un plazo:
         * el otro lado cumple el suyo y nosotros damos por muerto lo que para
         * ellos sigue vivo.
         */
        confirmationDueAt: horario.expiresAt,
        releaseNotBefore: horario.releaseNotBefore,
        createdAt: now,
        /*
         * La traza de la petición que lo originó, guardada con la fila (B9). El
         * barrido —los reenvíos, el vencimiento, la consulta, la cancelación y
         * la compensación tras un timeout— corre horas después en un proceso que
         * no tiene ningún span activo; sin esto cada paso abría una traza nueva y
         * la historia de un depósito quedaba rota en pedazos.
         */
        traceContext: this.#trace.current(),
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
   * El banco pareja respondió, por el camino provisional (T-47).
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
   * El callback **oficial** del banco pareja: `POST /transfers/{id}/result`
   * (T-60, B2).
   *
   * El Gateway lo publicaba —`payment.interbank.v1.result.received.v1`— y nadie
   * lo consumía: un `ACCEPTED` del banco pareja sólo se recuperaba si el sondeo
   * del TIMEOUT funcionaba, y si el sondeo fallaba **se liberaba un dinero que
   * el otro banco ya había acreditado**.
   *
   * Lo que garantiza que un callback repetido, tardío o desordenado no mueva
   * dinero dos veces no está aquí sino en dos sitios más profundos: la función
   * pura de transiciones, que rechaza todo evento fuera del diagrama, y el
   * `advance(from)` del repositorio, que sólo mueve la fila si sigue en el
   * estado desde el que se decidió.
   *
   * Antes de decidir comprueba que quien llama **participa**: «un banco solo
   * puede … recibir callbacks de transferencias en las que participa». La
   * identidad la dice la API key (el Gateway la puso en `callerBankCode`), no el
   * cuerpo, y el cuerpo además tiene que decir lo mismo.
   */
  public async v1Result(envelope: MessageEnvelope<PaymentInterbankV1ResultReceivedV1>): Promise<void> {
    const { result, callerBankCode } = envelope.payload;
    const send = await this.#repository.find(result.interbankTransferId);

    if (send === null) {
      this.#log.warn('callback interbancario v1 de un deposito desconocido', {
        correlationId: envelope.correlationId,
        interbankTransferId: result.interbankTransferId,
      });
      return;
    }

    if (callerBankCode !== send.destinationBankCode || result.destinationBankCode !== send.destinationBankCode) {
      this.#log.error('callback interbancario v1 de un banco que no participa; descartado', {
        correlationId: send.correlationId,
        interbankTransferId: send.interbankTransferId,
        outcome: 'CALLBACK_FROM_NON_PARTICIPANT',
      });
      return;
    }

    await this.#apply(
      send,
      result.status === 'ACCEPTED'
        ? { kind: 'CONFIRMED' }
        : { kind: 'REFUSED', reason: result.reasonCode ?? 'PROCESSING_ERROR' },
    );
  }

  /**
   * El barrido: reintenta las entregas que vencieron, rinde los depósitos que
   * llevan demasiado esperando, avanza el protocolo de TIMEOUT y los reversos.
   *
   * Lee columnas, no memoria, así que un pod nuevo recoge lo que dejó el
   * anterior. El orden importa: primero los vencimientos, porque un depósito
   * que ya pasó su plazo no debe recibir otro intento de entrega — sería
   * mandarle dinero a un banco del que acabamos de dejar de esperar.
   *
   * **Cada depósito falla por su cuenta y continúa su traza** (B9). Un depósito
   * cuyo paso lanza no deja sin atender a los demás, y cada paso corre dentro de
   * la traza que se guardó al crearlo: antes los reenvíos, el vencimiento, la
   * consulta, la cancelación y la compensación tras un timeout abrían trazas
   * nuevas, y la historia de un depósito que había tardado minutos quedaba rota.
   */
  public async sweep(
    limit = 20,
  ): Promise<{
    readonly expired: number;
    readonly resent: number;
    readonly resolved: number;
  }> {
    const now = this.#clock();
    let expired = 0;
    let resent = 0;

    for (const send of await this.#repository.claimExpired(now, limit)) {
      const done = await this.#guarded('expire', send, () =>
        this.#traced(send, 'payment.interbank.expire', () =>
          this.#apply(send, { kind: 'EXPIRED' }),
        ),
      );
      if (done) expired += 1;
    }

    for (const send of await this.#repository.claimSendable(this.#clock(), limit)) {
      const done = await this.#guarded('resend', send, () =>
        this.#traced(send, 'payment.interbank.resend', () => this.#deliver(send)),
      );
      if (done) resent += 1;
    }

    /*
     * Y el protocolo de TIMEOUT (TD-095): los vencidos a los que hay que
     * preguntar, cancelar o liberar. Va al final porque las filas que mira son
     * las que los dos barridos anteriores ya dejaron en `TIMEOUT`, así que un
     * depósito que acaba de vencer entra en su protocolo en el mismo barrido en
     * vez de esperar al siguiente.
     */
    const resolved = await this.#resolveTimedOut(limit);

    await this.#processReversals(limit);

    return { expired, resent, resolved };
  }

  /** Corre un paso de un depósito; si lanza, lo registra y deja seguir con los demás. */
  async #guarded(step: string, send: InterbankSend, work: () => Promise<void>): Promise<boolean> {
    try {
      await work();

      return true;
    } catch (error) {
      this.#log.error('un paso del barrido interbancario fallo; el resto continua', {
        correlationId: send.correlationId,
        interbankTransferId: send.interbankTransferId,
        outcome: step,
        error: error instanceof Error ? error.message : String(error),
      });

      return false;
    }
  }

  #traced<T>(send: InterbankSend, spanName: string, work: () => Promise<T>): Promise<T> {
    return this.#trace.continue(send.traceContext, spanName, send.correlationId, work);
  }

  /**
   * Un paso del protocolo de TIMEOUT por cada depósito vencido (TD-095).
   *
   * Un paso y no todos: cada barrido pregunta, o cancela, o resuelve, y el
   * siguiente sigue donde se quedó. Hacerlo en bucle dentro de una sola pasada
   * convertiría un banco pareja lento en un barrido que no termina y bloquea a
   * los demás depósitos.
   *
   * **Mientras un depósito está aquí, el dinero del cliente sigue reservado.**
   * Eso es el ticket entero: hasta ocho minutos de saldo retenido en el peor
   * caso, a cambio de no devolver dinero que el otro banco ya entregó.
   */
  async #resolveTimedOut(limit: number): Promise<number> {
    let resolved = 0;

    for (const send of await this.#repository.claimAwaitingResolution(this.#clock(), limit)) {
      const done = await this.#guarded('resolve', send, () =>
        this.#traced(send, 'payment.interbank.resolve', async () => {
          if (await this.#resolveOne(send)) resolved += 1;
        }),
      );

      void done;
    }

    return resolved;
  }

  /** Un paso para un depósito; `true` cuando lo cerró. */
  async #resolveOne(send: InterbankSend): Promise<boolean> {
    const action = resolveTimeout({
      now: this.#clock(),
      expiresAt: send.confirmationDueAt,
      releaseNotBefore: send.releaseNotBefore,
      probe: send.probe,
      cancel: send.cancel,
      probeAttempts: send.probeAttempts,
      maxProbeAttempts: this.#maxProbeAttempts,
    });

    switch (action.kind) {
      case 'PROBE': {
        const probe = await this.#partner.probe(send);
        await this.#recordStep(send, { probe });

        return false;
      }

      case 'CANCEL': {
        const cancel = await this.#partner.cancel(send);
        await this.#recordStep(send, { cancel });

        return false;
      }

      case 'CONFIRM':
        /*
         * El caso que justifica todo esto: hay constancia de que el otro
         * banco acreditó. Con el comportamiento anterior esta transferencia se
         * habría compensado — dinero devuelto aquí y entregado allá.
         */
        this.#log.info('deposito interbancario confirmado tras el vencimiento', {
          correlationId: send.correlationId,
          interbankTransferId: send.interbankTransferId,
        });
        await this.#apply(send, { kind: 'RESOLVED_ACCEPTED' });

        return true;

      case 'RELEASE':
        await this.#apply(send, { kind: 'RESOLVED_REJECTED', reason: action.reason });

        return true;

      case 'RELEASE_UNVERIFIED':
        /*
         * La única rama que devuelve dinero sin una respuesta del otro banco,
         * y **el contrato exige alertar**. Se registra en `error` y no en
         * `warn` a propósito: es lo que hace que la alerta de T-50 dispare, y
         * una liberación a ciegas que nadie mira es exactamente el descuadre
         * que este protocolo existe para evitar. La línea (mensaje y campos) no
         * cambió con T-60: la regla `InterbankReserveReleasedUnverified` la lee.
         */
        this.#log.error('reserva interbancaria liberada SIN confirmacion del banco pareja', {
          correlationId: send.correlationId,
          interbankTransferId: send.interbankTransferId,
          transactionId: send.transactionId,
          outcome: action.reason,
        });
        await this.#apply(send, { kind: 'RESOLVED_REJECTED', reason: action.reason });

        return true;
    }
  }

  /** Guarda un paso del protocolo y programa el siguiente. */
  async #recordStep(
    send: InterbankSend,
    step: { readonly probe?: PartnerProbe; readonly cancel?: PartnerCancel },
  ): Promise<void> {
    const now = this.#clock();

    /*
     * La espera crece **sólo con lo que no contestó**.
     *
     * El protocolo avanza por estado y no por tiempo: preguntar lleva a
     * cancelar, y cancelar lleva a decidir. Así que si el otro banco nos
     * contestó algo —aunque sea un `404`— esperar antes de usar esa respuesta es
     * latencia pura, y en el camino feliz del protocolo es tiempo de más con el
     * dinero del cliente retenido.
     *
     * Lo que la espera evita es el bucle apretado contra un banco que no está:
     * sin ella, un `UNREACHABLE` haría que el barrido volviera a intentarlo
     * dentro del mismo segundo, dos mil veces dentro del margen. Es creciente
     * (`base`, `2·base`, `4·base`… hasta un techo) y nunca pasa del margen:
     * a esa hora hay que volver a mirar para poder decidir.
     */
    const sinRespuesta =
      step.probe?.kind === 'UNREACHABLE' || step.cancel?.kind === 'UNREACHABLE';

    await this.#repository.recordResolutionStep({
      interbankTransferId: send.interbankTransferId,
      ...step,
      resolveNotBefore: sinRespuesta
        ? resolveBackoff({
            now,
            failures: send.probeAttempts + send.cancelAttempts + 1,
            baseMs: this.#resolveRetryMs,
            capMs: RESOLVE_BACKOFF_CAP_MS,
            releaseNotBefore: send.releaseNotBefore,
          })
        : now,
      now,
    });
  }

  /**
   * El paso 5 del contrato: pedir el reverso de un depósito que el banco pareja
   * acreditó **después** de que lo liberáramos (T-60).
   *
   * Un paso por reverso y por barrido, igual que el protocolo de TIMEOUT: se
   * pide (`PENDING` → `PROCESSING`/`COMPLETED`/`FAILED`) o se consulta
   * (`PROCESSING`), y lo que no contesta se reintenta con espera creciente. El
   * `reversalId` es siempre el mismo para el mismo depósito, así que reintentar
   * no devuelve dos veces.
   *
   * Qué es un reverso `COMPLETED`: el otro banco debitó a su cliente y nos mandó
   * un depósito de devolución por el flujo normal (`refundTransferId`). Ese
   * depósito entra como cualquier otro por `POST /transfers`; lo que este
   * servicio deja escrito es que la devolución se pidió y en qué quedó.
   */
  async #processReversals(limit: number): Promise<void> {
    for (const send of await this.#repository.claimReversals(this.#clock(), limit)) {
      await this.#guarded('reversal', send, () =>
        this.#traced(send, 'payment.interbank.reversal', () => this.#reverseOne(send)),
      );
    }
  }

  async #reverseOne(send: InterbankSend): Promise<void> {
    const reversal = send.reversal;

    if (reversal === null) return;

    const now = this.#clock();
    const answer =
      reversal.state === 'PENDING'
        ? await this.#partner.requestReversal(send, reversal.reversalId)
        : await this.#partner.reversalStatus(reversal.reversalId);
    const fields = {
      correlationId: send.correlationId,
      interbankTransferId: send.interbankTransferId,
      transactionId: send.transactionId,
    };

    if (answer.kind === 'ANSWERED') {
      if (answer.status === 'COMPLETED') {
        this.#log.warn('reverso interbancario completado: el banco pareja devolvio el deposito', {
          ...fields,
          outcome: 'REVERSAL_COMPLETED',
        });
      } else if (answer.status === 'FAILED') {
        this.#log.error('reverso interbancario FALLIDO: hay que resolverlo a mano', {
          ...fields,
          outcome: 'REVERSAL_FAILED',
        });
      }

      await this.#repository.recordReversalStep({
        interbankTransferId: send.interbankTransferId,
        state: answer.status,
        refundTransferId: answer.refundTransferId,
        message: answer.reasonMessage,
        nextAt: answer.status === 'PROCESSING' ? new Date(now.getTime() + REVERSAL_POLL_MS) : null,
        now,
      });

      return;
    }

    if (answer.kind === 'REFUSED') {
      this.#log.error('el banco pareja se niega al reverso interbancario: hay que resolverlo a mano', {
        ...fields,
        outcome: `REVERSAL_REFUSED_${answer.detail}`,
      });
      await this.#repository.recordReversalStep({
        interbankTransferId: send.interbankTransferId,
        state: 'FAILED',
        refundTransferId: null,
        message: answer.detail,
        nextAt: null,
        now,
      });

      return;
    }

    /* Nadie contesta. Se reintenta, y pasado cierto número se deja a una persona. */
    if (reversal.attempts + 1 >= REVERSAL_MAX_ATTEMPTS) {
      this.#log.error('el reverso interbancario no obtuvo respuesta: hay que resolverlo a mano', {
        ...fields,
        outcome: 'REVERSAL_UNANSWERED',
      });
      await this.#repository.recordReversalStep({
        interbankTransferId: send.interbankTransferId,
        state: 'FAILED',
        refundTransferId: null,
        message: 'SIN_RESPUESTA',
        nextAt: null,
        now,
      });

      return;
    }

    await this.#repository.recordReversalStep({
      interbankTransferId: send.interbankTransferId,
      state: reversal.state,
      refundTransferId: null,
      message: null,
      nextAt: resolveBackoff({
        now,
        failures: reversal.attempts + 1,
        baseMs: this.#resolveRetryMs,
        capMs: REVERSAL_BACKOFF_CAP_MS,
        releaseNotBefore: now,
      }),
      now,
    });
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
         * Un `ACCEPTED` sobre un depósito que YA se liberó. Es el paso 5 del
         * contrato y un incidente de nivel ERROR (TD-095).
         *
         * Pasa cuando el banco pareja acredita y su callback llega después de
         * que nosotros hayamos devuelto el dinero al cliente — lo que el margen
         * de 300 s hace improbable y no imposible, porque el contrato le da 24
         * horas para reintentar. El resultado es que el dinero está entregado
         * allá y devuelto aquí: **este banco lo ha perdido**, y la única salida
         * es pedirle al otro un reverso.
         *
         * Desde T-60 esa salida **se pide sola**: queda registrado el reverso
         * (un `reversalId` determinista por depósito, así que dos callbacks
         * tardíos piden uno solo) y el barrido hace el `POST /reversals`. La
         * línea de error se conserva tal cual para la alerta que la lee.
         */
        if (isLateAcceptAfterRelease(send.state, event.kind)) {
          this.#log.error('el banco pareja acredito un deposito que ya se habia liberado', {
            correlationId: send.correlationId,
            interbankTransferId: send.interbankTransferId,
            transactionId: send.transactionId,
            outcome: 'LATE_ACCEPT_AFTER_RELEASE',
          });
          await this.#repository.requestReversal({
            interbankTransferId: send.interbankTransferId,
            reversalId: deterministicUuid('bank-usac/interbank/reversal', send.interbankTransferId),
            now: this.#clock(),
          });
          return;
        }

        /*
         * El contrario: el banco pareja dijo `ACCEPTED` y ahora dice
         * `REJECTED`. El dinero ya salió de aquí y no se vuelve a mover —no hay
         * transición—, pero los dos bancos se contradicen y alguien tiene que
         * verlo.
         */
        if (isContradictoryRefusal(send.state, event.kind)) {
          this.#log.error('el banco pareja rechazo un deposito que ya habia aceptado', {
            correlationId: send.correlationId,
            interbankTransferId: send.interbankTransferId,
            transactionId: send.transactionId,
            outcome: 'CONTRADICTORY_REFUSAL',
          });
          return;
        }

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

    if (transition.resend) {
      /*
       * El detalle del fallo de entrega ya no cabe en la fila (el CHECK de la
       * tabla reserva el motivo a los estados que salieron mal), así que se
       * deja en el log: es lo que explica por qué un depósito sigue PENDING.
       */
      this.#log.warn('entrega interbancaria fallida; se reintentara', {
        correlationId: send.correlationId,
        interbankTransferId: send.interbankTransferId,
        outcome: transition.reason ?? 'SEND_FAILED',
      });
    }

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

    this.#measure(send, send.state, transition.state, transition.reason, now);
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
      const enqueued = await this.#traced(send, 'payment.interbank.reconcile', () =>
        this.#repository.enqueueVerdict({
          interbankTransferId: send.interbankTransferId,
          outbound: [
            this.#stateChangeMessage(send, send.state, send.reason, now),
            this.#settlementMessage(send, settlement, send.reason, now),
          ],
          now,
        }),
      );

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
    from: InterbankSend['state'] | null,
    state: InterbankSend['state'],
    reason: string | null,
    now: Date,
  ): void {
    this.#telemetry.stateChanged({
      correlationId: send.correlationId,
      interbankTransferId: send.interbankTransferId,
      transactionId: send.transactionId,
      state,
      from,
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

    this.#measure(send, null, send.state, send.reason, now);
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
