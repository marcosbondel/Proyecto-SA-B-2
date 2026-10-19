import { randomUUID } from 'node:crypto';

import { currentTraceparent } from '@bank/observability';
import { v1AmountToMinor } from '@bank/contracts';
import type {
  MessageEnvelope,
  V1ReasonCode,
  V1TransferRequest,
  V1TransferState,
} from '@bank/contracts';
import type { Pool } from 'pg';

import { v1ReasonOf, v1StateOf } from '../../domain/interbank-receipt';
import type { InterbankReceiptState } from '../../domain/interbank-receipt';
import type {
  ExpectedRefundRow,
  HeldRefundRow,
  InterbankV1Repository,
  V1DepositRow,
  V1Reversal,
} from '../../application/interbank-v1.ports';

interface Fila {
  readonly hold_reversal_id: string | null;
  readonly deposit_id: string;
  readonly origin_envelope: unknown;
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
  hold_reversal_id, deposit_id, origin_envelope, external_transfer_id, origin_bank_code, stage, rejection_reason,
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
    depositId: string;
    transfer: V1TransferRequest;
    callerBankCode: string;
    origin: MessageEnvelope<unknown>;
    rejection: { reason: string; result: MessageEnvelope<unknown> } | null;
    refund: {
      decision: 'SETTLE' | 'HOLD';
      reversalId: string;
      sendId: string;
      creditAccountRef: string;
    } | null;
    now: Date;
  }): Promise<
    | { admission: 'ACCEPTED_FOR_PROCESSING'; depositId: string }
    | { admission: 'DUPLICATE'; row: V1DepositRow }
    | { admission: 'CONFLICT' }
  > {
    const { transfer, depositId, rejection, refund } = input;
    const amountMinor = v1AmountToMinor(transfer.amount);

    if (amountMinor === null) {
      throw new Error('El monto llegó al repositorio sin validar.');
    }

    /*
     * `ON CONFLICT DO NOTHING` y después mirar: la idempotencia la decide la
     * restricción única, no una consulta previa. Un «¿ya existe?» seguido de un
     * `INSERT` es una carrera cuyo premio es acreditar dos veces.
     *
     * Un depósito rechazado al entrar (`rejection`) se guarda **ya decidido**,
     * con su resultado y su callback programado: no pasa por Account, y el
     * contrato pide que el rechazo se cuente por callback y no se devuelva
     * como un `4xx` que no explica nada.
     */
    const insertado = await this.pool.query<{ deposit_id: string }>(
      `INSERT INTO interbank_deposits
         (deposit_id, origin_bank_code, external_transfer_id, idempotency_key,
          destination_account_id, origin_account, amount_minor, currency,
          correlation_id, origin_envelope, stage, rejection_reason, next_action_at,
          result_envelope, callback_due_at, decided_at,
          partner_created_at, partner_expires_at, description, trace_context,
          credit_account_ref, hold_reversal_id, refund_of_reversal_id,
          -- Explícito y no por DEFAULT now(): es «cuándo lo recibimos», y el
          -- Gateway ya selló ese momento como receivedAt. Dejarlo al reloj de
          -- la base los haría diferir por la latencia del broker, y la
          -- conciliación —que se filtra por este campo— empezaría a discrepar
          -- de lo que el otro banco cree que nos mandó y cuándo.
          created_at)
       VALUES ($1,$2,$3,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$12,$13::jsonb,$14,$15,
               $16,$17,$18,$19,$20,$21,$22,$23)
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
        /* La correlación del Gateway: la misma que verá el emisor en sus trazas. */
        input.origin.correlationId,
        JSON.stringify(input.origin),
        rejection === null ? 'ELIGIBILITY' : 'REJECTED',
        rejection?.reason ?? null,
        /*
         * Un depósito retenido no se programa: `next_action_at` nulo es lo que
         * hace que el barrido no se lo mande a Account hasta que se resuelva.
         */
        rejection === null && refund?.decision !== 'HOLD' ? input.now : null,
        rejection === null ? null : JSON.stringify(rejection.result),
        rejection === null ? null : input.now,
        rejection === null ? null : input.now,
        transfer.createdAt,
        transfer.expiresAt,
        transfer.description ?? null,
        currentTraceparent(),
        // Un rechazado al entrar no es reembolso de nada: se cuenta como rechazo.
        rejection === null && refund?.decision === 'SETTLE' ? refund.creditAccountRef : null,
        rejection === null && refund?.decision === 'HOLD' ? refund.reversalId : null,
        rejection === null && refund?.decision === 'SETTLE' ? refund.reversalId : null,
        input.now,
      ],
    );

    if (insertado.rowCount === 1) {
      if (rejection === null && refund !== null) {
        await this.#enlazarReembolso({
          decision: refund.decision,
          sendId: refund.sendId,
          interbankTransferId: transfer.interbankTransferId,
          now: input.now,
        });
      }

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

  async findExpectedRefund(input: {
    callerBankCode: string;
    interbankTransferId: string;
    destinationAccount: string;
    amountMinor: number;
    currency: string;
  }): Promise<ExpectedRefundRow | null> {
    /*
     * Mismo banco, monto y moneda, y destino igual a la cuenta origen del envío —
     * o el reverso que ya nombra a **este** depósito como su reembolso, aunque
     * llegue a otra cuenta. Primero el que lo nombra por identificador; después
     * los reversos **abiertos**.
     *
     * Un reverso `COMPLETED` que nombra a OTRO depósito no es candidato: ese
     * reverso ya sabe cuál fue su reembolso. Antes entraba en la búsqueda y,
     * por ser el más antiguo, tapaba al reverso abierto del mismo cliente y
     * monto: la decisión salía NORMAL y el reembolso nuevo se le acreditaba al
     * cliente ya compensado. Visto en kind el 2026-10-19 con dos envíos de
     * Q150.00 de la misma cuenta, uno de ellos con su reverso ya cerrado.
     */
    const { rows } = await this.pool.query<{
      interbank_transfer_id: string;
      reversal_id: string;
      reversal_state: ExpectedRefundRow['state'];
      reversal_refund_transfer_id: string | null;
    }>(
      `SELECT interbank_transfer_id, reversal_id, reversal_state, reversal_refund_transfer_id
         FROM interbank_sends
        WHERE destination_bank_code = $1
          AND reversal_id IS NOT NULL
          AND refund_settled_at IS NULL
          AND reversal_state IN ('PENDING','PROCESSING','COMPLETED')
          AND amount_minor = $3 AND currency = $4
          AND (
                reversal_refund_transfer_id::text = $5
             OR (origin_account = $2 AND reversal_state IN ('PENDING','PROCESSING'))
             OR (origin_account = $2 AND reversal_state = 'COMPLETED'
                 AND reversal_refund_transfer_id IS NULL)
          )
        ORDER BY (reversal_refund_transfer_id::text = $5) IS TRUE DESC,
                 (reversal_state IN ('PENDING','PROCESSING')) DESC,
                 reversal_requested_at
        LIMIT 1`,
      [
        input.callerBankCode,
        input.destinationAccount,
        input.amountMinor,
        input.currency,
        input.interbankTransferId,
      ],
    );
    const fila = rows[0];

    return fila === undefined
      ? null
      : {
          sendId: fila.interbank_transfer_id,
          reversalId: fila.reversal_id,
          state: fila.reversal_state,
          refundTransferId: fila.reversal_refund_transfer_id,
        };
  }

  async claimHeldRefunds(limit: number): Promise<readonly HeldRefundRow[]> {
    const { rows } = await this.pool.query<{
      deposit_id: string;
      external_transfer_id: string;
      hold_reversal_id: string;
      trace_context: string | null;
      correlation_id: string;
      send_id: string;
      reversal_state: ExpectedRefundRow['state'];
      reversal_refund_transfer_id: string | null;
    }>(
      `SELECT d.deposit_id, d.external_transfer_id, d.hold_reversal_id, d.trace_context,
              d.correlation_id, s.interbank_transfer_id AS send_id, s.reversal_state,
              s.reversal_refund_transfer_id
         FROM interbank_deposits d
         JOIN interbank_sends s ON s.reversal_id = d.hold_reversal_id
        WHERE d.hold_reversal_id IS NOT NULL AND d.stage = 'ELIGIBILITY'
        ORDER BY d.created_at
        LIMIT $1`,
      [limit],
    );

    return rows.map((fila) => ({
      depositId: fila.deposit_id,
      interbankTransferId: fila.external_transfer_id,
      reversalId: fila.hold_reversal_id,
      sendId: fila.send_id,
      traceContext: fila.trace_context,
      correlationId: fila.correlation_id,
      reversal: {
        sendId: fila.send_id,
        reversalId: fila.hold_reversal_id,
        state: fila.reversal_state,
        refundTransferId: fila.reversal_refund_transfer_id,
      },
    }));
  }

  async settleHeld(input: {
    depositId: string;
    interbankTransferId: string;
    reversalId: string;
    sendId: string;
    creditAccountRef: string;
    now: Date;
  }): Promise<boolean> {
    const client = await this.pool.connect();

    try {
      await client.query('BEGIN');
      /*
       * Un reverso se liquida con **un** depósito: el `UPDATE` con su guardia
       * (`refund_settled_at IS NULL`) y el índice único de `refund_inbound_id`
       * hacen que, si dos depósitos retenidos se parecieran al reembolso, sólo
       * el primero gane; el otro se acredita como normal.
       */
      const liquidado = await client.query(
        `UPDATE interbank_sends
            SET refund_settled_at = $2, refund_inbound_id = $3
          WHERE interbank_transfer_id = $1 AND refund_settled_at IS NULL`,
        [input.sendId, input.now, input.interbankTransferId],
      );
      const movido =
        liquidado.rowCount === 1
          ? await client.query(
              `UPDATE interbank_deposits
                  SET credit_account_ref = $2, refund_of_reversal_id = $3,
                      hold_reversal_id = NULL, next_action_at = $4
                WHERE deposit_id = $1 AND hold_reversal_id IS NOT NULL AND stage = 'ELIGIBILITY'`,
              [input.depositId, input.creditAccountRef, input.reversalId, input.now],
            )
          : null;

      if (movido?.rowCount !== 1) {
        await client.query('ROLLBACK');

        return false;
      }

      await client.query('COMMIT');

      return true;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);

      throw error;
    } finally {
      client.release();
    }
  }

  async releaseHeld(input: { depositId: string; now: Date }): Promise<boolean> {
    const { rowCount } = await this.pool.query(
      `UPDATE interbank_deposits
          SET hold_reversal_id = NULL, next_action_at = $2
        WHERE deposit_id = $1 AND hold_reversal_id IS NOT NULL AND stage = 'ELIGIBILITY'`,
      [input.depositId, input.now],
    );

    return rowCount === 1;
  }

  /**
   * Lo que el reembolso le hace al envío cuyo reverso lo espera, en cuanto el
   * depósito entra: si ya es el reembolso, el reverso queda liquidado; si se
   * retiene, se adelanta la próxima consulta del reverso para resolverlo con
   * prisa (el depósito vence a los 180 s y no puede esperar el ritmo normal).
   */
  async #enlazarReembolso(input: {
    decision: 'SETTLE' | 'HOLD';
    sendId: string;
    interbankTransferId: string;
    now: Date;
  }): Promise<void> {
    if (input.decision === 'SETTLE') {
      await this.pool.query(
        `UPDATE interbank_sends
            SET refund_settled_at = $2, refund_inbound_id = $3
          WHERE interbank_transfer_id = $1 AND refund_settled_at IS NULL`,
        [input.sendId, input.now, input.interbankTransferId],
      );

      return;
    }

    await this.pool.query(
      `UPDATE interbank_sends
          SET reversal_next_at = LEAST(COALESCE(reversal_next_at, $2), $2)
        WHERE interbank_transfer_id = $1 AND reversal_state IN ('PENDING','PROCESSING')`,
      [input.sendId, input.now],
    );
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

  async cancel(input: {
    interbankTransferId: string;
    now: Date;
    result: MessageEnvelope<unknown> | null;
  }): Promise<boolean> {
    /*
     * Sólo desde `ELIGIBILITY` (B4): en `CREDIT` hay una orden de crédito dada y
     * Account acredita incondicionalmente, así que cancelar ahí es dejar al
     * cliente acreditado y al emisor convencido de que puede liberar.
     *
     * Sin resultado que publicar (una fila anterior a T-60, sin sobre del que
     * construirlo) el marcador `'{}'` que exige el `CHECK` se deja ya publicado,
     * para que `publishResults` no intente enviar algo que no es un mensaje.
     */
    const { rowCount } = await this.pool.query(
      `UPDATE interbank_deposits
          SET stage = 'CANCELLED',
              rejection_reason = 'CANCELLED',
              decided_at = $2,
              next_action_at = NULL,
              hold_reversal_id = NULL,
              callback_due_at = NULL,
              result_envelope = COALESCE($3::jsonb, '{}'::jsonb),
              result_published_at = CASE WHEN $3::jsonb IS NULL THEN $2 ELSE result_published_at END
        WHERE external_transfer_id = $1
          AND stage = 'ELIGIBILITY'`,
      [
        input.interbankTransferId,
        input.now,
        input.result === null ? null : JSON.stringify(input.result),
      ],
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
          origin_envelope, stage, rejection_reason, decided_at, result_envelope,
          result_published_at, trace_context)
       VALUES ($1,$2,$3,$3,'(cancelado-antes-de-llegar)',1,'GTQ',$4,
               $5::jsonb,'CANCELLED','CANCELLED',$6,'{}'::jsonb,$6,$7)
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
        WHERE stage = 'ELIGIBILITY'
          AND partner_expires_at IS NOT NULL
          AND partner_expires_at <= $1
        ORDER BY partner_expires_at
        LIMIT $2`,
      [now, limit],
    );

    return rows.map(aFila);
  }

  async expire(input: {
    interbankTransferId: string;
    now: Date;
    result: MessageEnvelope<unknown> | null;
  }): Promise<boolean> {
    const { rowCount } = await this.pool.query(
      `UPDATE interbank_deposits
          SET stage = 'REJECTED',
              rejection_reason = 'EXPIRED',
              decided_at = $2,
              next_action_at = NULL,
              hold_reversal_id = NULL,
              -- El callback sale: el contrato pide responder REJECTED con
              -- reasonCode EXPIRED, no quedarse callado.
              callback_due_at = $2,
              result_envelope = COALESCE($3::jsonb, '{}'::jsonb),
              result_published_at = CASE WHEN $3::jsonb IS NULL THEN $2 ELSE result_published_at END
        WHERE external_transfer_id = $1
          AND stage = 'ELIGIBILITY'`,
      [
        input.interbankTransferId,
        input.now,
        input.result === null ? null : JSON.stringify(input.result),
      ],
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
    depositId: fila.deposit_id,
    heldForReversal: fila.hold_reversal_id,
    stage: fila.stage,
    origin: esSobre(fila.origin_envelope) ? fila.origin_envelope : null,
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

/** ¿Lo guardado como origen es un sobre del broker, o la forma anterior a T-60? */
function esSobre(valor: unknown): valor is MessageEnvelope<unknown> {
  if (typeof valor !== 'object' || valor === null) return false;
  const candidato = valor as Record<string, unknown>;

  return (
    typeof candidato.messageId === 'string' &&
    typeof candidato.messageType === 'string' &&
    typeof candidato.correlationId === 'string' &&
    'payload' in candidato
  );
}
