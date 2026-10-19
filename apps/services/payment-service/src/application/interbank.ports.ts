import type { MessageEnvelope, PaymentInterbankReceiveV1 } from '@bank/contracts';
import type { InterbankReceiptLanding, InterbankReceiptState } from '../domain/interbank-receipt';

/**
 * Los cinco estados del depósito recibido. `CANCELLED` llegó con el contrato
 * oficial (T-56) y lo define `domain/interbank-receipt.ts`, que es quien decide
 * las transiciones; esto es sólo el alias que usan los puertos.
 */
export type InterbankStage = InterbankReceiptState;

export interface InterbankDeposit {
  readonly depositId: string;
  readonly stage: InterbankStage;
  readonly reason: string | null;
  /**
   * El sobre que originó el depósito: **la causa** de todo lo que este
   * servicio publica sobre él.
   *
   * Siempre un sobre real. Las filas del contrato oficial anteriores a T-60
   * guardaban `{transfer, callerBankCode}` en su lugar, y el barrido las leía
   * como si fueran un sobre — `origin.payload.accountId` reventaba y, con el
   * `catch` del barrido, dejaba sin atender los pasos siguientes de la vuelta.
   * El repositorio ya no entrega la columna cruda: la normaliza, y fabrica un
   * sobre con la correlación de la fila cuando lo guardado no lo es.
   */
  readonly origin: MessageEnvelope<unknown>;
  readonly correlationId: string;
  /**
   * Lo que el contrato necesita del depósito, **leído de las columnas** y no del
   * sobre: las columnas existen en las dos formas de entrada y el sobre no es
   * lo mismo en una y otra.
   */
  readonly externalTransferId: string;
  readonly originBankCode: string;
  /** Cómo nombró el otro banco la cuenta: un número `02-…` o, en el camino provisional, un UUID. */
  readonly accountRef: string;
  readonly amount: { readonly amountMinor: number; readonly currency: string };
  readonly callbackAttempts: number;
  readonly traceContext: string | null;
  readonly createdAt: Date;
  readonly decidedAt: Date | null;
  /** `expiresAt` del contrato, o `null` en un depósito del camino provisional. */
  readonly expiresAt: Date | null;
}

export interface InterbankRepository {
  open(input: {
    readonly origin: MessageEnvelope<PaymentInterbankReceiveV1>;
    readonly stage: 'ELIGIBILITY' | 'REJECTED';
    readonly reason: string | null;
    readonly result: MessageEnvelope<unknown> | null;
    readonly now: Date;
  }): Promise<{ readonly kind: 'CREATED' | 'DUPLICATE' | 'CONFLICT'; readonly depositId: string }>;
  find(depositId: string): Promise<InterbankDeposit | null>;
  replayCallback(depositId: string, now: Date): Promise<void>;
  recordConflict(
    origin: MessageEnvelope<PaymentInterbankReceiveV1>,
    result: MessageEnvelope<unknown>,
    now: Date,
  ): Promise<boolean>;
  advance(input: {
    readonly depositId: string;
    readonly from: 'ELIGIBILITY' | 'CREDIT';
    readonly to: InterbankReceiptLanding;
    readonly reason: string | null;
    readonly result: MessageEnvelope<unknown> | null;
    readonly now: Date;
  }): Promise<boolean>;
  claimActions(now: Date, limit: number): Promise<readonly InterbankDeposit[]>;
  publishResults(
    deliver: (envelope: MessageEnvelope<unknown>) => Promise<void>,
    limit: number,
  ): Promise<number>;
  claimCallbacks(now: Date, limit: number): Promise<readonly InterbankDeposit[]>;
  markCallbackDelivered(depositId: string, now: Date): Promise<void>;
  publishConflictResults(
    deliver: (envelope: MessageEnvelope<unknown>) => Promise<void>,
    limit: number,
  ): Promise<number>;
  claimConflictCallbacks(
    now: Date,
    limit: number,
  ): Promise<readonly { readonly messageId: string; readonly deposit: InterbankDeposit }[]>;
  markConflictCallbackDelivered(messageId: string, now: Date): Promise<void>;
  /**
   * Deja de reintentar los callbacks que llevan más de `maxAgeMs` decididos.
   *
   * «El receptor reintenta el callback con espera creciente durante un máximo
   * de 24 horas»: pasado ese tiempo el contrato libera al receptor de seguir
   * insistiendo. Devuelve cuántos se abandonaron, para que quien llama los
   * registre en nivel ERROR — un callback abandonado es un emisor que nunca se
   * enteró, y eso se concilia a mano.
   */
  abandonStaleCallbacks(now: Date, maxAgeMs: number): Promise<readonly InterbankDeposit[]>;
}

export interface InterbankMessenger {
  command(cause: MessageEnvelope<unknown>, messageType: string, payload: unknown): Promise<void>;
  result(
    cause: MessageEnvelope<unknown>,
    messageType: string,
    payload: unknown,
  ): MessageEnvelope<unknown>;
  publishStored(envelope: MessageEnvelope<unknown>): Promise<void>;
}

export interface PartnerCallback {
  /** `POST {base del emisor}/transfers/{id}/result`; lanza si el emisor no lo registró. */
  deliver(deposit: InterbankDeposit): Promise<void>;
}

export interface InterbankTelemetry {
  stateChanged(change: {
    readonly depositId: string;
    readonly correlationId: string;
    readonly stage: InterbankStage;
    readonly reason: string | null;
    readonly durationMs: number | null;
  }): void;
  callbackAttempt(attempt: {
    readonly correlationId: string;
    readonly result: 'delivered' | 'failed';
    /** Por qué falló, para el log; nunca una etiqueta de métrica. */
    readonly detail?: string;
  }): void;
  /**
   * Un paso del barrido que falló, o un callback abandonado (B3).
   *
   * Al log y en nivel ERROR: el barrido sigue con lo demás, así que lo que
   * falló sólo se ve si alguien lo dice, y una fila que se queda atrás sin
   * rastro es el modo de fallo que este cambio existe para quitar.
   */
  sweepFailed(failure: {
    readonly step: string;
    readonly correlationId: string;
    readonly error: string;
  }): void;
  /**
   * Una transición que el diagrama no tiene (T-56).
   *
   * Se registra en vez de escribirse. No lleva etiquetas de métrica con el
   * identificador del depósito: es un suceso raro y específico, así que su
   * sitio es el log, no una serie por depósito.
   */
  illegalTransition(attempt: {
    readonly correlationId: string;
    readonly from: InterbankStage;
    readonly event: string;
  }): void;
}
