import type { MessageEnvelope } from '@bank/contracts';

import type { InterbankSendState } from '../domain/interbank-send';

/** Un depósito que este banco envía al banco pareja, como lo guarda este servicio. */
export interface InterbankSend {
  readonly interbankTransferId: string;
  readonly paymentId: string;
  readonly transactionId: string;
  readonly idempotencyKey: string;
  readonly destinationBankCode: string;
  readonly destinationAccount: string;
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

export interface InterbankSendRepository {
  /**
   * Da de alta el depósito, o devuelve el que ya existe.
   *
   * `DUPLICATE` es el caso normal de una reentrega del comando, no un error: la
   * clave es el `interbankTransferId` que generó el Gateway, así que el mismo
   * depósito pedido dos veces es un depósito.
   */
  open(input: {
    readonly send: Omit<InterbankSend, 'state' | 'reason' | 'attempts'>;
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
  }): Promise<boolean>;

  /** Los pendientes cuyo reintento de entrega ya vence. */
  claimSendable(now: Date, limit: number): Promise<readonly InterbankSend[]>;

  /** Los que llevan demasiado tiempo esperando una confirmación que no llega. */
  claimExpired(now: Date, limit: number): Promise<readonly InterbankSend[]>;
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
}

/** Lo que este caso de uso publica, con la causa que lo originó. */
export interface InterbankSendMessenger {
  event(
    cause: MessageEnvelope<unknown>,
    messageType: string,
    payload: unknown,
  ): Promise<void>;
}

export interface InterbankSendTelemetry {
  stateChanged(change: {
    readonly correlationId: string;
    readonly interbankTransferId: string;
    readonly transactionId: string;
    readonly state: InterbankSendState;
    readonly reason: string | null;
    /** Milisegundos desde que se pidió, cuando el estado es final. */
    readonly durationMs: number | null;
  }): void;
}
