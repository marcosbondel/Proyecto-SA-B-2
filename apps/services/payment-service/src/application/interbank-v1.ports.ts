import type { V1ReasonCode, V1TransferRequest, V1TransferState } from '@bank/contracts';

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
  readonly interbankTransferId: string;
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

export interface InterbankV1Repository {
  /**
   * Abre un depósito del contrato, o dice que ya existía.
   *
   * La decisión de admisión la toma **la base**, con sus restricciones únicas, y
   * no una consulta previa: un «¿ya existe?» seguido de un `INSERT` es una
   * carrera cuyo premio es acreditar dos veces.
   */
  admit(input: {
    readonly transfer: V1TransferRequest;
    readonly callerBankCode: string;
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
  cancel(input: { readonly interbankTransferId: string; readonly now: Date }): Promise<boolean>;

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

  /** Los que pasaron de `expiresAt` sin decidirse. */
  claimExpired(now: Date, limit: number): Promise<readonly V1DepositRow[]>;

  /** Cierra por vencimiento. `false` si alguien lo decidió primero. */
  expire(input: { readonly interbankTransferId: string; readonly now: Date }): Promise<boolean>;

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
