import type { MessageEnvelope } from '@bank/contracts';

import type { InterbankSendState } from '../domain/interbank-send';
import type { PartnerCancel, PartnerProbe } from '../domain/interbank-timeout';
import type { OutboxMessage } from './ports';

/** Un depósito que este banco envía al banco pareja, como lo guarda este servicio. */
export interface InterbankSend {
  readonly interbankTransferId: string;
  readonly paymentId: string;
  readonly transactionId: string;
  readonly idempotencyKey: string;
  readonly destinationBankCode: string;
  readonly destinationAccount: string;
  /**
   * La cuenta de este banco de la que sale el dinero, con su número del contrato
   * (`02-NNNNNNNNN`). `null` en un depósito pedido antes de T-60: sin ella no se
   * puede formar un `TransferRequest`, y el depósito no se envía.
   */
  readonly originAccount: string | null;
  /** El cliente que lo pidió, para decidir quién puede ver el depósito. */
  readonly customerId: string | null;
  readonly amount: { readonly amountMinor: number; readonly currency: string };
  readonly correlationId: string;
  readonly state: InterbankSendState;
  readonly reason: string | null;
  readonly attempts: number;
  /**
   * Cuándo deja de esperarse la confirmación del banco pareja.
   *
   * Una **columna**, no un `setTimeout` (§4.1 pide el patrón y la razón es
   * operativa): un pod reprogramado a mitad de un depósito no puede olvidar que
   * lo tenía. El barrido lee esta columna; el proceso no recuerda nada.
   */
  readonly confirmationDueAt: Date;
  /** Cuándo se pidió. El principio del cronómetro que mide la confirmación. */
  readonly createdAt: Date;
  /**
   * Cuándo el veredicto de este depósito llegó al outbox, que no es cuándo se
   * decidió (TD-093). Nulo en un depósito sin decidir — y nulo en uno decidido
   * significa que su veredicto se perdió, que es lo que busca la
   * reconciliación.
   */
  readonly verdictEnqueuedAt: Date | null;
  /**
   * `expiresAt + 300 s` del contrato: **antes de esto no se libera nada a
   * ciegas** (TD-095).
   *
   * Es una columna y no un cálculo por la misma razón que el resto de los plazos
   * de este servicio: un pod que se reprograma no puede olvidarse de un depósito
   * a medio resolver, y un plazo que vive en memoria se olvida en cuanto el
   * proceso muere. Es también lo que hace auditable la decisión: queda escrito
   * desde cuándo se podía liberar, no sólo que se liberó.
   */
  readonly releaseNotBefore: Date;
  /** La última respuesta de `GET /transfers/{id}`, o `null` si no se ha preguntado. */
  readonly probe: PartnerProbe | null;
  /** La última respuesta de la cancelación, o `null` si no se ha pedido. */
  readonly cancel: PartnerCancel | null;
  /** Cuántas consultas y cuántas cancelaciones se han intentado (T-60). */
  readonly probeAttempts: number;
  readonly cancelAttempts: number;
  /**
   * El reverso pedido al banco pareja por un `ACCEPTED` tardío (paso 5 del
   * contrato), o `null` si no hizo falta.
   */
  readonly reversal: InterbankSendReversal | null;
  readonly decidedAt: Date | null;
  readonly sentAt: Date | null;
  readonly reversedAt: Date | null;
  /**
   * Cuándo toca el siguiente paso del protocolo.
   *
   * Los reintentos de la consulta y de la cancelación llevan su propio
   * calendario, separado del `next_attempt_at` de la entrega: son dos escaleras
   * distintas sobre la misma fila, y mezclarlas haría que un reintento de envío
   * reprogramara una consulta o al revés.
   */
  readonly resolveNotBefore: Date | null;
  /** El contexto W3C de la petición que lo originó, para continuar su traza. */
  readonly traceContext: string | null;
  /**
   * El comando que lo pidió, guardado entero.
   *
   * Lo necesita el barrido: cuando vence un plazo, nadie le ha mandado nada a
   * este servicio, así que no hay causa de la que heredar el `correlationId`.
   * Guardarla es lo que evita inventar una — que es lo que la constitución VIII
   * prohíbe.
   */
  readonly origin: MessageEnvelope<unknown>;
}

/** Lo que el banco pareja contestó sobre un reverso, o que no se le pudo preguntar. */
export type PartnerReversal =
  /** `202`/`200` con un cuerpo válido de `ReversalStatus`. */
  | {
      readonly kind: 'ANSWERED';
      readonly status: 'PROCESSING' | 'COMPLETED' | 'FAILED';
      readonly refundTransferId: string | null;
      readonly reasonMessage: string | null;
    }
  /**
   * `400`/`404`: el banco pareja **se niega** a hacer el reverso (no conoce el
   * depósito, o el cuerpo no le vale). No hay nada que reintentar: quien decide
   * es una persona, y queda registrado en ERROR.
   */
  | { readonly kind: 'REFUSED'; readonly detail: string }
  /** Red, `5xx`, tiempo límite: no se sabe. Se reintenta. */
  | { readonly kind: 'UNREACHABLE' };

export type InterbankSendReversalState = 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED';

export interface InterbankSendReversal {
  readonly reversalId: string;
  readonly state: InterbankSendReversalState;
  readonly attempts: number;
  readonly nextAt: Date | null;
  readonly refundTransferId: string | null;
  readonly message: string | null;
}

/** Un paso del historial de estados, tal como se guardó. */
export interface InterbankSendHistoryRow {
  readonly state: InterbankSendState;
  readonly reason: string | null;
  readonly at: Date;
}

export interface InterbankSendRepository {
  /**
   * Da de alta el depósito, o devuelve el que ya existe.
   *
   * `DUPLICATE` es el caso normal de una reentrega del comando, no un error: la
   * clave es el `interbankTransferId` que generó el Gateway, así que el mismo
   * depósito pedido dos veces es un depósito.
   */
  open(input: {
    readonly send: Omit<
      InterbankSend,
      | 'state'
      | 'reason'
      | 'attempts'
      | 'verdictEnqueuedAt'
      | 'probe'
      | 'cancel'
      | 'resolveNotBefore'
      | 'probeAttempts'
      | 'cancelAttempts'
      | 'reversal'
      | 'decidedAt'
      | 'sentAt'
      | 'reversedAt'
    >;
    readonly now: Date;
  }): Promise<{ readonly kind: 'CREATED' | 'DUPLICATE'; readonly send: InterbankSend }>;

  find(interbankTransferId: string): Promise<InterbankSend | null>;
  findByTransaction(transactionId: string): Promise<InterbankSend | null>;

  /**
   * Mueve el depósito, **sólo** si sigue en el estado desde el que se decidió.
   *
   * El `from` no es una comodidad: es lo que impide que dos consumidores —un
   * callback y el barrido del vencimiento, por ejemplo— apliquen a la vez dos
   * transiciones legales por separado y dejen el depósito en un estado que
   * ninguna de las dos pidió. Devuelve `false` cuando otro llegó primero, y
   * entonces el que perdió no publica nada.
   */
  advance(input: {
    readonly interbankTransferId: string;
    readonly from: InterbankSendState;
    readonly to: InterbankSendState;
    readonly reason: string | null;
    readonly nextAttemptAt: Date | null;
    readonly now: Date;
    /**
     * Los eventos que este cambio de estado produce, escritos en el outbox **en
     * la misma transacción** que el cambio (TD-093).
     *
     * Es el arreglo entero del defecto que costó Q1.00. Antes, el caso de uso
     * movía la fila y después publicaba contra el broker: si el proceso moría
     * en medio, el veredicto se perdía y la fila quedaba fuera del alcance de
     * los dos barridos — `claimSendable` busca `PENDING` y `claimExpired` busca
     * `PENDING` o `SENT`, y una fila decidida no es ninguno. Ahora o se
     * escriben las dos cosas o ninguna, y el `OutboxRelay` publica.
     *
     * Es el mismo patrón que `PaymentRepository.attempt` ya usa para el camino
     * del pago normal (TD-047), con el mismo contrato: el envelope se guarda
     * completo para que el relay lo republique **byte a byte** — un `messageId`
     * nuevo en el momento de publicar sería un mensaje nuevo para la
     * deduplicación de Transaction y de la auditoría, y el veredicto entregado
     * dos veces podría compensar un débito ya devuelto.
     */
    readonly outbound?: readonly OutboxMessage[];
  }): Promise<boolean>;

  /** Los pendientes cuyo reintento de entrega ya vence. */
  claimSendable(now: Date, limit: number): Promise<readonly InterbankSend[]>;

  /** Los que llevan demasiado tiempo esperando una confirmación que no llega. */
  claimExpired(now: Date, limit: number): Promise<readonly InterbankSend[]>;

  /**
   * Los vencidos que esperan un paso del protocolo (TD-095).
   *
   * Es el barrido que sustituye a la compensación automática: las filas en
   * `TIMEOUT` ya no son un final, son trabajo pendiente — consultar, cancelar, o
   * esperar al margen. Mientras estén aquí, **el dinero del cliente sigue
   * reservado**, y eso es deliberado.
   */
  claimAwaitingResolution(now: Date, limit: number): Promise<readonly InterbankSend[]>;

  /**
   * Guarda lo que el banco pareja contestó, y cuándo volver a intentarlo.
   *
   * Se escribe aunque la respuesta sea «no contesta»: es la diferencia entre un
   * depósito que no se ha consultado y uno que se consultó y no hubo nadie, y de
   * esa diferencia depende si el protocolo pregunta o cancela.
   */
  recordResolutionStep(input: {
    readonly interbankTransferId: string;
    readonly probe?: PartnerProbe;
    readonly cancel?: PartnerCancel;
    readonly resolveNotBefore: Date;
    readonly now: Date;
  }): Promise<void>;

  /**
   * Deja pedido el reverso de un depósito que el banco pareja acreditó después
   * de que lo liberáramos (paso 5, T-60). Idempotente: un depósito tiene un
   * solo reverso, `false` si ya lo tenía o si el depósito no está liberado.
   */
  requestReversal(input: {
    readonly interbankTransferId: string;
    readonly reversalId: string;
    readonly now: Date;
  }): Promise<boolean>;

  /** Los reversos que toca pedir o consultar ahora. */
  claimReversals(now: Date, limit: number): Promise<readonly InterbankSend[]>;

  /** Guarda lo que el banco pareja contestó sobre el reverso, y cuándo volver. */
  recordReversalStep(input: {
    readonly interbankTransferId: string;
    readonly state: InterbankSendReversalState;
    readonly refundTransferId: string | null;
    readonly message: string | null;
    /** `null` cuando el reverso terminó (`COMPLETED` o `FAILED`). */
    readonly nextAt: Date | null;
    readonly now: Date;
  }): Promise<void>;

  /**
   * Los depósitos visibles para quien pregunta (B10): los de `customerId`, o
   * todos cuando es `null` (personal).
   */
  list(input: {
    readonly customerId: string | null;
    readonly state?: InterbankSendState;
    readonly limit: number;
  }): Promise<readonly InterbankSend[]>;

  /** El historial de estados de un depósito, del más antiguo al más reciente. */
  history(interbankTransferId: string): Promise<readonly InterbankSendHistoryRow[]>;

  /**
   * Los depósitos **ya decididos cuyo veredicto nunca llegó al outbox**, que es
   * la pieza (b) de TD-093: la reconciliación.
   *
   * En régimen normal esto no devuelve nada nunca, y eso es la prueba de que
   * (a) funciona: desde la migración 014 el veredicto y su marca se escriben en
   * la misma transacción que el estado, así que ninguna fila nueva puede
   * cumplir la condición. Las que la cumplen son las decididas por una versión
   * anterior del código — y hay una, la del Q1.00 del 2026-10-15, que es como
   * se recupera sin tocar la base a mano.
   *
   * `olderThan` existe para no competir con el camino normal: una fila recién
   * decidida puede tener su veredicto escrito en una transacción que aún no ha
   * comitado, y reconciliarla sería publicar dos veces lo mismo con dos
   * `messageId` distintos. Dos minutos es mucho más que cualquier transacción
   * de este servicio.
   */
  claimUnreconciled(olderThan: Date, limit: number): Promise<readonly InterbankSend[]>;

  /**
   * Encola el veredicto de un depósito que se quedó sin él, y lo marca.
   *
   * La marca es lo que hace esto **de una sola vez** en vez de un bucle: la
   * condición de `claimUnreconciled` es precisamente que la marca falte.
   * Devuelve `false` si otro barrido llegó primero, por la misma razón que
   * `advance`.
   */
  enqueueVerdict(input: {
    readonly interbankTransferId: string;
    readonly outbound: readonly OutboxMessage[];
    readonly now: Date;
  }): Promise<boolean>;
}

/**
 * La única salida HTTP de este servicio, y del banco (T-46, ADR pendiente en
 * T-59). Devuelve si el banco pareja acusó recibo, no si aceptó el depósito:
 * eso llega después, por callback.
 */
export interface PartnerBankClient {
  send(
    send: InterbankSend,
  ): Promise<{ readonly acknowledged: boolean; readonly detail: string | null }>;

  /**
   * `GET /transfers/{id}` — preguntar qué pasó (TD-095, paso 2).
   *
   * Devuelve hechos, no decisiones: lo que se hace con la respuesta lo decide
   * `resolveTimeout`, que es puro y no sabe que existe HTTP.
   */
  probe(send: InterbankSend): Promise<PartnerProbe>;

  /** `POST /transfers/{id}/cancel` — pedir que no se acredite (TD-095, paso 3). */
  cancel(send: InterbankSend): Promise<PartnerCancel>;

  /** `POST /reversals` — pedir la devolución de un depósito acreditado tarde (paso 5). */
  requestReversal(send: InterbankSend, reversalId: string): Promise<PartnerReversal>;

  /** `GET /reversals/{id}` — en qué quedó el reverso pedido. */
  reversalStatus(reversalId: string): Promise<PartnerReversal>;
}

/** Lo que este caso de uso publica, con la causa que lo originó. */
export interface InterbankSendMessenger {
  event(
    cause: MessageEnvelope<unknown>,
    messageType: string,
    payload: unknown,
  ): Promise<void>;

  /**
   * Construye el evento —envelope validado, exchange y clave de enrutado—
   * **sin publicarlo**, para que el repositorio lo escriba en el outbox dentro
   * de su transacción (TD-093).
   *
   * Síncrono porque construir un envelope no toca el broker, y es justo eso lo
   * que lo hace seguro dentro de una transacción de base de datos: si validar
   * el contrato falla, falla antes de que nada se haya escrito.
   *
   * Es el gemelo de `EventPublisher.envelopeFor`, que el camino del pago normal
   * usa desde TD-047. Dos puertos y una misma idea: el caso de uso pide la
   * forma durable del evento, la capa de persistencia la guarda, y el relay la
   * publica.
   */
  envelopeFor(
    cause: MessageEnvelope<unknown>,
    messageType: string,
    payload: unknown,
  ): OutboxMessage;
}

export interface InterbankSendTelemetry {
  stateChanged(change: {
    readonly correlationId: string;
    readonly interbankTransferId: string;
    readonly transactionId: string;
    readonly state: InterbankSendState;
    /** De qué estado viene; `null` en el alta. Lo necesita la métrica de vencimientos. */
    readonly from: InterbankSendState | null;
    readonly reason: string | null;
    /** Milisegundos desde que se pidió, cuando el estado es final. */
    readonly durationMs: number | null;
  }): void;
}
