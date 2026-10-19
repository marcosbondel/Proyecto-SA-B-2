import type {
  MessageEnvelope,
  V1ReasonCode,
  V1TransferRequest,
  V1TransferState,
} from '@bank/contracts';

import type { InterbankReceiptRejection, InterbankReceiptState } from '../domain/interbank-receipt';

/**
 * Lo que las siete operaciones del contrato oficial necesitan de la
 * persistencia (T-56).
 *
 * Aparte de `interbank.ports.ts` a propósito: ése describe **nuestro** flujo
 * interno —elegibilidad, crédito, callback— y esto describe lo que el contrato
 * ajeno pregunta. Mezclarlos haría que un cambio del contrato pareciera un
 * cambio de nuestro diseño.
 */

/** La fila de un depósito recibido, vista como el contrato la describe. */
export interface V1DepositRow {
  /** Nuestro identificador del depósito, el que llevan los eventos de auditoría. */
  readonly depositId: string;
  readonly interbankTransferId: string;
  /**
   * El estado **nuestro**, de los cinco. `status` es lo que el contrato ve y
   * funde `ELIGIBILITY` y `CREDIT` en `PROCESSING`; quien tiene que decidir si
   * se puede cancelar necesita la diferencia, porque desde `CREDIT` ya hay una
   * orden de crédito dada (B4).
   */
  readonly stage: InterbankReceiptState;
  /** El sobre que lo originó, o `null` en las filas anteriores a T-60. */
  readonly origin: MessageEnvelope<unknown> | null;
  /** El reverso cuyo reembolso podría ser este depósito, mientras se retiene; si no, `null`. */
  readonly heldForReversal: string | null;
  readonly originBankCode: string;
  readonly status: V1TransferState;
  readonly reasonCode: V1ReasonCode | null;
  readonly amountMinor: number;
  readonly updatedAt: Date;
  readonly createdAt: Date;
  readonly expiresAt: Date | null;
}

export interface V1Reversal {
  readonly reversalId: string;
  readonly originalTransferId: string;
  readonly requesterBankCode: string;
  readonly amountMinor: number;
  readonly status: 'PROCESSING' | 'COMPLETED' | 'FAILED';
  readonly refundTransferId: string | null;
  readonly reasonMessage: string | null;
}

/** Un reverso nuestro que espera un reembolso con este banco, monto y destino. */
export interface ExpectedRefundRow {
  /** El depósito que enviamos y cuyo reverso se pidió. */
  readonly sendId: string;
  readonly reversalId: string;
  readonly state: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
  readonly refundTransferId: string | null;
}

/** Un depósito retenido, con lo que dice hoy el reverso que lo retiene. */
export interface HeldRefundRow {
  readonly depositId: string;
  readonly interbankTransferId: string;
  readonly reversalId: string;
  readonly sendId: string;
  readonly reversal: ExpectedRefundRow;
  readonly traceContext: string | null;
  readonly correlationId: string;
}

export interface InterbankV1Repository {
  /**
   * El reverso abierto de un envío nuestro que podría estar esperando **este**
   * depósito: mismo banco, mismo monto y moneda, y destino igual a la cuenta
   * origen del envío (T-60, QA 13c). Incluye uno `COMPLETED` cuyo reembolso
   * todavía no se ha liquidado, y el que ya nombra este depósito por su id.
   */
  findExpectedRefund(input: {
    readonly callerBankCode: string;
    readonly interbankTransferId: string;
    readonly destinationAccount: string;
    readonly amountMinor: number;
    readonly currency: string;
  }): Promise<ExpectedRefundRow | null>;

  /** Los depósitos retenidos, con el estado actual de su reverso. */
  claimHeldRefunds(limit: number): Promise<readonly HeldRefundRow[]>;

  /**
   * Resuelve un depósito retenido **como reembolso**: se acredita a la cuenta de
   * liquidación y el reverso queda liquidado. `false` si otro depósito ya lo
   * liquidó o el depósito dejó de estar retenido.
   */
  settleHeld(input: {
    readonly depositId: string;
    readonly interbankTransferId: string;
    readonly reversalId: string;
    readonly sendId: string;
    readonly creditAccountRef: string;
    readonly now: Date;
  }): Promise<boolean>;

  /** Resuelve un depósito retenido **como depósito normal**: se acredita al cliente. */
  releaseHeld(input: { readonly depositId: string; readonly now: Date }): Promise<boolean>;

  /**
   * Abre un depósito del contrato, o dice que ya existía.
   *
   * La decisión de admisión la toma **la base**, con sus restricciones únicas, y
   * no una consulta previa: un «¿ya existe?» seguido de un `INSERT` es una
   * carrera cuyo premio es acreditar dos veces.
   */
  admit(input: {
    /** Lo genera quien llama, para poder construir el resultado antes de guardar. */
    readonly depositId: string;
    readonly transfer: V1TransferRequest;
    readonly callerBankCode: string;
    /** El sobre del Gateway: es la causa de todo lo que este servicio publique después. */
    readonly origin: MessageEnvelope<unknown>;
    /**
     * Si el depósito se rechaza **al entrar** (banco destino equivocado, moneda,
     * monto), con su motivo y el evento de resultado ya construido. El depósito
     * se guarda ya decidido y con su callback programado; no pasa por Account.
     */
    readonly rejection: {
      readonly reason: InterbankReceiptRejection;
      readonly result: MessageEnvelope<unknown>;
    } | null;
    /**
     * Si el depósito es (o podría ser) el reembolso de un reverso nuestro: se
     * acredita a `creditAccountRef` en vez de al cliente (`SETTLE`) o se retiene
     * hasta que el reverso se resuelva (`HOLD`).
     */
    readonly refund: {
      readonly decision: 'SETTLE' | 'HOLD';
      readonly reversalId: string;
      readonly sendId: string;
      readonly creditAccountRef: string;
    } | null;
    readonly now: Date;
  }): Promise<
    | { readonly admission: 'ACCEPTED_FOR_PROCESSING'; readonly depositId: string }
    | { readonly admission: 'DUPLICATE'; readonly row: V1DepositRow }
    | { readonly admission: 'CONFLICT' }
  >;

  /**
   * El estado de un depósito, **sólo si el banco que pregunta participa**.
   *
   * El filtro por banco está en la consulta y no en un `if` posterior: el
   * contrato dice que «un banco sólo puede consultar, cancelar o recibir
   * callbacks de transferencias en las que participa», y un `WHERE` no se
   * olvida de aplicarse.
   */
  findForBank(interbankTransferId: string, callerBankCode: string): Promise<V1DepositRow | null>;

  /** Los depósitos de un banco en un día (UTC), paginados. */
  reconcile(input: {
    readonly callerBankCode: string;
    readonly date: string;
    readonly page: number;
    readonly pageSize: number;
  }): Promise<{ readonly totalItems: number; readonly items: readonly V1DepositRow[] }>;

  /**
   * Cancela un depósito sin decidir. `false` si alguien lo decidió primero.
   *
   * El guardia de estado está en el `WHERE`, igual que en el resto de este
   * servicio: dos cancelaciones simultáneas, o una cancelación y un crédito
   * confirmado, no pueden ganar las dos.
   */
  cancel(input: {
    readonly interbankTransferId: string;
    readonly now: Date;
    /** El evento de auditoría, o `null` si no hay causa de la que construirlo. */
    readonly result: MessageEnvelope<unknown> | null;
  }): Promise<boolean>;

  /**
   * Deja constancia de la cancelación de un depósito **que nunca llegó**.
   *
   * El contrato lo pide explícitamente: el receptor «guarda el id y rechaza
   * cualquier llegada posterior del mensaje original». Sin esta fila, el
   * mensaje original llegaría tarde, no encontraría nada, y se acreditaría —
   * con el banco emisor ya convencido de que nunca se procesó.
   */
  admitCancellationOfUnknown(input: {
    readonly interbankTransferId: string;
    readonly callerBankCode: string;
    readonly now: Date;
  }): Promise<void>;

  /**
   * Los que pasaron de `expiresAt` sin decidirse **y sin orden de crédito**.
   *
   * Sólo `ELIGIBILITY` (B4): uno en `CREDIT` espera el veredicto de Account.
   */
  claimExpired(now: Date, limit: number): Promise<readonly V1DepositRow[]>;

  /** Cierra por vencimiento. `false` si alguien lo decidió primero. */
  expire(input: {
    readonly interbankTransferId: string;
    readonly now: Date;
    readonly result: MessageEnvelope<unknown> | null;
  }): Promise<boolean>;

  /** Registra un reverso, o devuelve el que ya había con ese identificador. */
  openReversal(input: {
    readonly reversalId: string;
    readonly originalTransferId: string;
    readonly requesterBankCode: string;
    readonly amountMinor: number;
    readonly origin: unknown;
    readonly now: Date;
  }): Promise<{ readonly created: boolean; readonly reversal: V1Reversal }>;

  findReversal(reversalId: string, callerBankCode: string): Promise<V1Reversal | null>;
}
