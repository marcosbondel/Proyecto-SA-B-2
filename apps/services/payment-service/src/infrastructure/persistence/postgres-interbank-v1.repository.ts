import { randomUUID } from 'node:crypto';

import { currentTraceparent } from '@bank/observability';
import { v1AmountToMinor } from '@bank/contracts';
import type { V1ReasonCode, V1TransferRequest, V1TransferState } from '@bank/contracts';
import type { Pool } from 'pg';

import { v1ReasonOf, v1StateOf } from '../../domain/interbank-receipt';
import type { InterbankReceiptState } from '../../domain/interbank-receipt';
import type {
  InterbankV1Repository,
  V1DepositRow,
  V1Reversal,
} from '../../application/interbank-v1.ports';

interface Fila {
  readonly external_transfer_id: string;
  readonly origin_bank_code: string;
  readonly stage: InterbankReceiptState;
  readonly rejection_reason: string | null;
  readonly amount_minor: string;
  readonly created_at: Date;
  readonly decided_at: Date | null;
  readonly partner_expires_at: Date | null;
}

const COLUMNAS = `
  external_transfer_id, origin_bank_code, stage, rejection_reason,
  amount_minor, created_at, decided_at, partner_expires_at
`;

/**
 * Las siete operaciones del contrato oficial, contra PostgreSQL (T-56).
 *
 * Tres reglas que se repiten en casi todas las consultas y que son del
 * contrato, no del estilo:
 *
 * 1. **`origin_bank_code` está en el `WHERE`, siempre.** «Un banco sólo puede
 *    consultar, cancelar o recibir callbacks de transferencias en las que
 *    participa.» Un filtro en la consulta no se olvida de aplicarse; un `if`
 *    después de leer, sí.
 * 2. **Los cambios de estado llevan su guardia en el `WHERE`.** `UPDATE … WHERE
 *    stage IN ('ELIGIBILITY','CREDIT')` es lo que hace que dos operaciones
 *    simultáneas no ganen las dos, y es la misma técnica que el resto de este
 *    servicio.
 * 3. **El identificador del contrato es `external_transfer_id`**, no nuestro
 *    `deposit_id`. El `interbankTransferId` lo elige el emisor y es el único
 *    identificador que las dos partes comparten.
 */
export class PostgresInterbankV1Repository implements InterbankV1Repository {
  constructor(private readonly pool: Pool) {}

  async admit(input: {
    transfer: V1TransferRequest;
    callerBankCode: string;
    now: Date;
  }): Promise<
    | { admission: 'ACCEPTED_FOR_PROCESSING'; depositId: string }
    | { admission: 'DUPLICATE'; row: V1DepositRow }
    | { admission: 'CONFLICT' }
  > {
    const { transfer } = input;
    const amountMinor = v1AmountToMinor(transfer.amount);

    if (amountMinor === null) {
      throw new Error('El monto llegó al repositorio sin validar.');
    }

    const depositId = randomUUID();
    /*
     * `ON CONFLICT DO NOTHING` y después mirar: la idempotencia la decide la
     * restricción única, no una consulta previa. Un «¿ya existe?» seguido de un
     * `INSERT` es una carrera cuyo premio es acreditar dos veces.
     */
    const insertado = await this.pool.query<{ deposit_id: string }>(
      `INSERT INTO interbank_deposits
         (deposit_id, origin_bank_code, external_transfer_id, idempotency_key,
          destination_account_id, origin_account, amount_minor, currency,
          correlation_id, origin_envelope, stage, next_action_at,
          partner_created_at, partner_expires_at, description, trace_context,
          -- Explícito y no por DEFAULT now(): es «cuándo lo recibimos», y el
          -- Gateway ya selló ese momento como receivedAt. Dejarlo al reloj de
          -- la base los haría diferir por la latencia del broker, y la
          -- conciliación —que se filtra por este campo— empezaría a discrepar
          -- de lo que el otro banco cree que nos mandó y cuándo.
          created_at)
       VALUES ($1,$2,$3,$3,$4,$5,$6,$7,$8,$9::jsonb,'ELIGIBILITY',$10,$11,$12,$13,$14,$10)
       ON CONFLICT DO NOTHING
       RETURNING deposit_id`,
      [
        depositId,
        input.callerBankCode,
        transfer.interbankTransferId,
        transfer.destinationAccount,
        transfer.originAccount,
        amountMinor,
        transfer.currency,
        /*
         * La correlación del envoltorio del Gateway sería lo natural, pero el
         * repositorio no lo recibe; se genera una propia y el `origin_envelope`
         * guarda la petición completa, que es de donde sale la trazabilidad.
         */
        randomUUID(),
        JSON.stringify({ transfer, callerBankCode: input.callerBankCode }),
        input.now,
        transfer.createdAt,
        transfer.expiresAt,
        transfer.description ?? null,
        currentTraceparent(),
      ],
    );

    if (insertado.rowCount === 1) {
      return { admission: 'ACCEPTED_FOR_PROCESSING', depositId };
    }

    const existente = await this.pool.query<
      Fila & { destination_account_id: string; origin_account: string | null; currency: string }
    >(
      `SELECT ${COLUMNAS}, destination_account_id, origin_account, currency
         FROM interbank_deposits
        WHERE origin_bank_code = $1 AND external_transfer_id = $2`,
      [input.callerBankCode, transfer.interbankTransferId],
    );
    const fila = existente.rows[0];

    if (fila === undefined) {
      /*
       * El `INSERT` no entró y la fila no es de este banco: el identificador
       * está tomado por **otro** banco. Para el contrato eso es un conflicto de
       * idempotencia, y responderlo como un duplicado le confirmaría a quien
       * pregunta la existencia de una transferencia ajena.
       */
      return { admission: 'CONFLICT' };
    }

    /*
     * «Repetir una solicitud con el mismo id y el **mismo contenido** nunca
     * acredita dos veces: se responde con el estado actual. Repetir el mismo id
     * con contenido distinto se responde con 409.» Así que el contenido se
     * compara campo por campo — y el monto en centavos, no como texto, para que
     * `"150.00"` y `"150.00"` no dependan de cómo los escribió el otro.
     */
    const igual =
      fila.destination_account_id === transfer.destinationAccount &&
      fila.origin_account === transfer.originAccount &&
      Number(fila.amount_minor) === amountMinor &&
      fila.currency === transfer.currency;

    return igual ? { admission: 'DUPLICATE', row: aFila(fila) } : { admission: 'CONFLICT' };
  }

  async findForBank(
    interbankTransferId: string,
    callerBankCode: string,
  ): Promise<V1DepositRow | null> {
    const { rows } = await this.pool.query<Fila>(
      `SELECT ${COLUMNAS} FROM interbank_deposits
        WHERE external_transfer_id = $1 AND origin_bank_code = $2`,
      [interbankTransferId, callerBankCode],
    );

    return rows[0] === undefined ? null : aFila(rows[0]);
  }

  async cancel(input: { interbankTransferId: string; now: Date }): Promise<boolean> {
    const { rowCount } = await this.pool.query(
      `UPDATE interbank_deposits
          SET stage = 'CANCELLED',
              rejection_reason = 'CANCELLED',
              decided_at = $2,
              next_action_at = NULL,
              callback_due_at = NULL,
              result_envelope = coalesce(result_envelope, '{}'::jsonb)
        WHERE external_transfer_id = $1
          AND stage IN ('ELIGIBILITY','CREDIT')`,
      [input.interbankTransferId, input.now],
    );

    return rowCount === 1;
  }

  async admitCancellationOfUnknown(input: {
    interbankTransferId: string;
    callerBankCode: string;
    now: Date;
  }): Promise<void> {
    /*
     * Una fila `CANCELLED` para un depósito que nunca llegó. Es lo que el
     * contrato pide —«guarda el id y rechaza cualquier llegada posterior»— y la
     * razón de que el monto sea 1: la columna tiene un `CHECK (amount_minor >
     * 0)` y aquí no hay monto que conocer. Un cero habría sido más honesto y la
     * restricción no lo admite, así que el valor no significa nada y el estado
     * sí.
     */
    await this.pool.query(
      `INSERT INTO interbank_deposits
         (deposit_id, origin_bank_code, external_transfer_id, idempotency_key,
          destination_account_id, amount_minor, currency, correlation_id,
          origin_envelope, stage, rejection_reason, decided_at, result_envelope, trace_context)
       VALUES ($1,$2,$3,$3,'(cancelado-antes-de-llegar)',1,'GTQ',$4,
               $5::jsonb,'CANCELLED','CANCELLED',$6,'{}'::jsonb,$7)
       ON CONFLICT DO NOTHING`,
      [
        randomUUID(),
        input.callerBankCode,
        input.interbankTransferId,
        randomUUID(),
        JSON.stringify({ cancelledBeforeArrival: true, callerBankCode: input.callerBankCode }),
        input.now,
        currentTraceparent(),
      ],
    );
  }

  async claimExpired(now: Date, limit: number): Promise<readonly V1DepositRow[]> {
    const { rows } = await this.pool.query<Fila>(
      `SELECT ${COLUMNAS} FROM interbank_deposits
        WHERE stage IN ('ELIGIBILITY','CREDIT')
          AND partner_expires_at IS NOT NULL
          AND partner_expires_at <= $1
        ORDER BY partner_expires_at
        LIMIT $2`,
      [now, limit],
    );

    return rows.map(aFila);
  }

  async expire(input: { interbankTransferId: string; now: Date }): Promise<boolean> {
    const { rowCount } = await this.pool.query(
      `UPDATE interbank_deposits
          SET stage = 'REJECTED',
              rejection_reason = 'EXPIRED',
              decided_at = $2,
              next_action_at = NULL,
              -- El callback sale: el contrato pide responder REJECTED con
              -- reasonCode EXPIRED, no quedarse callado.
              callback_due_at = $2,
              result_envelope = coalesce(result_envelope, '{}'::jsonb)
        WHERE external_transfer_id = $1
          AND stage IN ('ELIGIBILITY','CREDIT')`,
      [input.interbankTransferId, input.now],
    );

    return rowCount === 1;
  }

  async reconcile(input: {
    callerBankCode: string;
    date: string;
    page: number;
    pageSize: number;
  }): Promise<{ totalItems: number; items: readonly V1DepositRow[] }> {
    /*
     * El día es **UTC**, que es lo que el contrato dice («en la fecha indicada
     * (UTC)»). Usar el día local del contenedor haría que la conciliación de
     * dos bancos en husos distintos no cuadrara nunca, y el desajuste sería de
     * unas pocas filas en los bordes del día — el peor tipo de error, porque
     * parece un descuadre real.
     */
    const desde = `${input.date}T00:00:00.000Z`;
    const hasta = `${input.date}T23:59:59.999Z`;

    const total = await this.pool.query<{ total: string }>(
      `SELECT count(*)::text AS total FROM interbank_deposits
        WHERE origin_bank_code = $1 AND created_at >= $2 AND created_at <= $3`,
      [input.callerBankCode, desde, hasta],
    );
    const { rows } = await this.pool.query<Fila>(
      `SELECT ${COLUMNAS} FROM interbank_deposits
        WHERE origin_bank_code = $1 AND created_at >= $2 AND created_at <= $3
        ORDER BY created_at, external_transfer_id
        LIMIT $4 OFFSET $5`,
      [input.callerBankCode, desde, hasta, input.pageSize, (input.page - 1) * input.pageSize],
    );

    return { totalItems: Number(total.rows[0]?.total ?? '0'), items: rows.map(aFila) };
  }

  async openReversal(input: {
    reversalId: string;
    originalTransferId: string;
    requesterBankCode: string;
    amountMinor: number;
    origin: unknown;
    now: Date;
  }): Promise<{ created: boolean; reversal: V1Reversal }> {
    const insertado = await this.pool.query<{ reversal_id: string }>(
      `INSERT INTO interbank_reversals
         (reversal_id, original_transfer_id, requester_bank_code, amount_minor,
          status, origin_envelope, trace_context, created_at)
       VALUES ($1,$2,$3,$4,'PROCESSING',$5::jsonb,$6,$7)
       ON CONFLICT DO NOTHING
       RETURNING reversal_id`,
      [
        input.reversalId,
        input.originalTransferId,
        input.requesterBankCode,
        input.amountMinor,
        JSON.stringify(input.origin),
        currentTraceparent(),
        input.now,
      ],
    );

    const reversal = await this.findReversal(input.reversalId, input.requesterBankCode);

    if (reversal === null) {
      /*
       * No entró y tampoco existe con ese `reversalId`: es la otra restricción
       * única, `original_transfer_id`. Ya hay un reverso de ese depósito con
       * otro identificador, y devolver el mismo dinero dos veces es lo que esa
       * restricción existe para impedir.
       */
      const existente = await this.pool.query<{ reversal_id: string }>(
        `SELECT reversal_id FROM interbank_reversals WHERE original_transfer_id = $1`,
        [input.originalTransferId],
      );
      const otro = existente.rows[0];

      if (otro === undefined) throw new Error('El reverso desapareció tras insertarlo.');

      return {
        created: false,
        reversal: {
          reversalId: input.reversalId,
          originalTransferId: input.originalTransferId,
          requesterBankCode: input.requesterBankCode,
          amountMinor: input.amountMinor,
          status: 'FAILED',
          refundTransferId: null,
          reasonMessage: `Ese depósito ya tiene un reverso (${otro.reversal_id}).`,
        },
      };
    }

    return { created: insertado.rowCount === 1, reversal };
  }

  async findReversal(reversalId: string, callerBankCode: string): Promise<V1Reversal | null> {
    const { rows } = await this.pool.query<{
      reversal_id: string;
      original_transfer_id: string;
      requester_bank_code: string;
      amount_minor: string;
      status: 'PROCESSING' | 'COMPLETED' | 'FAILED';
      refund_transfer_id: string | null;
      reason_message: string | null;
    }>(
      `SELECT reversal_id, original_transfer_id, requester_bank_code, amount_minor,
              status, refund_transfer_id, reason_message
         FROM interbank_reversals
        WHERE reversal_id = $1 AND requester_bank_code = $2`,
      [reversalId, callerBankCode],
    );
    const fila = rows[0];

    return fila === undefined
      ? null
      : {
          reversalId: fila.reversal_id,
          originalTransferId: fila.original_transfer_id,
          requesterBankCode: fila.requester_bank_code,
          amountMinor: Number(fila.amount_minor),
          status: fila.status,
          refundTransferId: fila.refund_transfer_id,
          reasonMessage: fila.reason_message,
        };
  }
}

/** La fila, traducida a lo que el contrato nombra. */
function aFila(fila: Fila): V1DepositRow {
  return {
    interbankTransferId: fila.external_transfer_id,
    originBankCode: fila.origin_bank_code,
    status: v1StateOf(fila.stage) as V1TransferState,
    reasonCode:
      fila.rejection_reason === null
        ? null
        : (v1ReasonOf(fila.rejection_reason as Parameters<typeof v1ReasonOf>[0]) as V1ReasonCode),
    amountMinor: Number(fila.amount_minor),
    /* El contrato pide «cuándo cambió», y antes de decidirse eso es cuándo llegó. */
    updatedAt: fila.decided_at ?? fila.created_at,
    createdAt: fila.created_at,
    expiresAt: fila.partner_expires_at,
  };
}
