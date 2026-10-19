import { createEnvelope } from '@bank/contracts';
import type { MessageEnvelope, PaymentInterbankReceiveV1 } from '@bank/contracts';
import { continueTrace, currentTraceparent } from '@bank/observability';
import type { Pool } from 'pg';

import type {
  InterbankDeposit,
  InterbankRepository,
  InterbankStage,
} from '../../application/interbank.ports';
import { CALLBACK_LEASE_MS } from './claim-lease';

interface DepositRow {
  deposit_id: string;
  stage: InterbankStage;
  rejection_reason: string | null;
  origin_envelope: unknown;
  callback_attempts: number;
  trace_context: string | null;
  created_at: Date;
  decided_at: Date | null;
  correlation_id: string;
  external_transfer_id: string;
  origin_bank_code: string;
  destination_account_id: string;
  credit_account_ref: string | null;
  amount_minor: string;
  currency: string;
  partner_expires_at: Date | null;
}

const COLUMNS = `deposit_id, stage, rejection_reason, origin_envelope, callback_attempts,
  trace_context, created_at, decided_at, correlation_id, external_transfer_id,
  origin_bank_code, destination_account_id, credit_account_ref, amount_minor, currency,
  partner_expires_at`;

/** ¿Lo guardado en `origin_envelope` es de verdad un sobre del broker? */
function isEnvelope(value: unknown): value is MessageEnvelope<unknown> {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;

  return (
    typeof candidate.messageId === 'string' &&
    typeof candidate.messageType === 'string' &&
    typeof candidate.correlationId === 'string' &&
    'payload' in candidate
  );
}

/**
 * El sobre que causó el depósito, **siempre un sobre**.
 *
 * Las filas que el contrato oficial abrió antes de T-60 guardaban
 * `{transfer, callerBankCode}` en esta columna. Entregarlas tal cual hacía que
 * el barrido leyera `origin.payload.accountId` de algo que no tiene `payload`,
 * lanzara, y dejara sin atender el resto de la vuelta (B3). Aquí se fabrica uno
 * con la correlación y la clave de idempotencia de la propia fila, que es lo
 * único que un sobre de causa tiene que aportar.
 */
function originOf(row: DepositRow): MessageEnvelope<unknown> {
  if (isEnvelope(row.origin_envelope)) return row.origin_envelope;

  return createEnvelope(
    {},
    {
      messageType: 'payment.interbank.v1.transfer.query.v1',
      producer: 'gateway',
      identity: null,
      correlationId: row.correlation_id,
      idempotencyKey: row.external_transfer_id,
    },
  );
}

function fromRow(row: DepositRow): InterbankDeposit {
  return {
    depositId: row.deposit_id,
    stage: row.stage,
    reason: row.rejection_reason,
    origin: originOf(row),
    correlationId: row.correlation_id,
    externalTransferId: row.external_transfer_id,
    originBankCode: row.origin_bank_code,
    /*
     * La cuenta a la que se acredita **de verdad**: la de liquidación cuando el
     * depósito resultó ser el reembolso de un reverso (QA 13c), la que nombró el
     * otro banco en cualquier otro caso. Lo que se comprueba contra la respuesta
     * de Account es esta, no la que dice el contrato.
     */
    accountRef: row.credit_account_ref ?? row.destination_account_id,
    amount: { amountMinor: Number(row.amount_minor), currency: row.currency },
    callbackAttempts: row.callback_attempts,
    traceContext: row.trace_context,
    createdAt: row.created_at,
    decidedAt: row.decided_at,
    expiresAt: row.partner_expires_at,
  };
}

/**
 * The durable inbox and callback schedule for deposits from partner banks.
 *
 * Every `claim*` here was already one statement (`UPDATE … WHERE id IN (SELECT
 * … FOR UPDATE SKIP LOCKED) RETURNING`), so two claims never took the same row
 * *at the same instant*. What they lacked was a lease long enough to outlive the
 * batch: `claimCallbacks` pushes `callback_due_at` by the backoff (2 s the
 * first time) while delivering twenty callbacks takes up to twenty times the
 * 3 s HTTP timeout, so a second replica claiming 2 s later re-delivered the
 * rows the first was still working through (T-60).
 *
 * The callback claims therefore also set `claimed_until`, and the use case
 * releases it as soon as the delivery attempt is over — success or failure —
 * so the backoff stays the retry schedule and the lease only covers the
 * attempt itself. `claimActions` is left as it was: its work is publishing a
 * command to the broker, which finishes long inside its 5 s push.
 */
export class PostgresInterbankRepository implements InterbankRepository {
  constructor(
    readonly pool: Pool,
    readonly leaseMs: number = CALLBACK_LEASE_MS,
  ) {}

  async open(input: {
    origin: MessageEnvelope<PaymentInterbankReceiveV1>;
    stage: 'ELIGIBILITY' | 'REJECTED';
    reason: string | null;
    result: MessageEnvelope<unknown> | null;
    now: Date;
  }): Promise<{ kind: 'CREATED' | 'DUPLICATE' | 'CONFLICT'; depositId: string }> {
    const p = input.origin.payload;
    const inserted = await this.pool.query(
      `INSERT INTO interbank_deposits
       (deposit_id, origin_bank_code, external_transfer_id, idempotency_key,
        destination_account_id, amount_minor, currency, correlation_id, origin_envelope,
        stage, rejection_reason, next_action_at, result_envelope, callback_due_at, decided_at,
        trace_context, partner_timestamp)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$12,$13::jsonb,$14,$15,$16,$17)
       ON CONFLICT DO NOTHING RETURNING deposit_id`,
      [
        p.depositId,
        p.originBankCode,
        p.interbankTransferId,
        p.idempotencyKey,
        p.accountId,
        p.amount.amountMinor,
        p.amount.currency,
        input.origin.correlationId,
        JSON.stringify(input.origin),
        input.stage,
        input.reason,
        input.stage === 'ELIGIBILITY' ? input.now : null,
        input.result === null ? null : JSON.stringify(input.result),
        input.stage === 'REJECTED' ? input.now : null,
        input.stage === 'REJECTED' ? input.now : null,
        currentTraceparent(),
        // El sello del otro banco, no el nuestro (T-56).
        p.partnerTimestamp,
      ],
    );
    if (inserted.rowCount === 1) return { kind: 'CREATED', depositId: p.depositId };

    const existing = await this.pool.query<{
      deposit_id: string;
      origin_bank_code: string;
      external_transfer_id: string;
      idempotency_key: string;
      destination_account_id: string;
      amount_minor: string;
      currency: string;
    }>(
      `SELECT deposit_id, origin_bank_code, external_transfer_id, idempotency_key,
              destination_account_id, amount_minor, currency
         FROM interbank_deposits
        WHERE deposit_id = $1 OR (origin_bank_code = $2 AND external_transfer_id = $3)
           OR (origin_bank_code = $2 AND idempotency_key = $4)
        LIMIT 1`,
      [p.depositId, p.originBankCode, p.interbankTransferId, p.idempotencyKey],
    );
    const row = existing.rows[0];
    if (row === undefined) throw new Error('Conflicting interbank deposit disappeared');
    const same =
      row.origin_bank_code === p.originBankCode &&
      row.external_transfer_id === p.interbankTransferId &&
      row.idempotency_key === p.idempotencyKey &&
      row.destination_account_id === p.accountId &&
      Number(row.amount_minor) === p.amount.amountMinor &&
      row.currency === p.amount.currency;
    return { kind: same ? 'DUPLICATE' : 'CONFLICT', depositId: row.deposit_id };
  }

  async replayCallback(depositId: string, now: Date): Promise<void> {
    await this.pool.query(
      `UPDATE interbank_deposits SET callback_delivered_at = NULL, callback_due_at = $2
        WHERE deposit_id = $1 AND stage IN ('ACCEPTED','REJECTED')`,
      [depositId, now],
    );
  }

  async recordConflict(
    origin: MessageEnvelope<PaymentInterbankReceiveV1>,
    result: MessageEnvelope<unknown>,
    now: Date,
  ): Promise<boolean> {
    const inserted = await this.pool.query(
      `INSERT INTO interbank_conflicts (message_id, origin_envelope, result_envelope, callback_due_at, trace_context)
       VALUES ($1, $2::jsonb, $3::jsonb, $4, $5) ON CONFLICT DO NOTHING`,
      [origin.messageId, JSON.stringify(origin), JSON.stringify(result), now, currentTraceparent()],
    );
    return inserted.rowCount === 1;
  }

  async find(depositId: string): Promise<InterbankDeposit | null> {
    const result = await this.pool.query<DepositRow>(
      `SELECT ${COLUMNS} FROM interbank_deposits WHERE deposit_id = $1`,
      [depositId],
    );
    return result.rows[0] === undefined ? null : fromRow(result.rows[0]);
  }

  async advance(input: {
    depositId: string;
    from: 'ELIGIBILITY' | 'CREDIT';
    to: 'CREDIT' | 'ACCEPTED' | 'REJECTED';
    reason: string | null;
    result: MessageEnvelope<unknown> | null;
    now: Date;
  }): Promise<boolean> {
    const settled = input.to === 'ACCEPTED' || input.to === 'REJECTED';
    const changed = await this.pool.query(
      `UPDATE interbank_deposits SET stage = $2, rejection_reason = $3,
          next_action_at = $4, result_envelope = $5::jsonb,
          callback_due_at = $6, decided_at = $7
        WHERE deposit_id = $1 AND stage = $8`,
      [
        input.depositId,
        input.to,
        input.reason,
        settled ? null : input.now,
        input.result === null ? null : JSON.stringify(input.result),
        settled ? input.now : null,
        settled ? input.now : null,
        input.from,
      ],
    );
    return changed.rowCount === 1;
  }

  async claimActions(now: Date, limit: number): Promise<readonly InterbankDeposit[]> {
    const rows = await this.pool.query<DepositRow>(
      `UPDATE interbank_deposits SET next_action_at = $1::timestamptz + interval '5 seconds'
        WHERE deposit_id IN (
          SELECT deposit_id FROM interbank_deposits
           WHERE next_action_at <= $1 AND stage IN ('ELIGIBILITY','CREDIT')
           ORDER BY next_action_at FOR UPDATE SKIP LOCKED LIMIT $2
        ) RETURNING ${COLUMNS}`,
      [now, limit],
    );
    return rows.rows.map(fromRow);
  }

  async publishResults(
    deliver: (envelope: MessageEnvelope<unknown>) => Promise<void>,
    limit: number,
  ): Promise<number> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      /*
       * `result_envelope ->> 'messageId' IS NOT NULL` descarta los marcadores
       * `'{}'` que el contrato oficial dejaba al cancelar o vencer un depósito
       * (el `CHECK` de la tabla exige un resultado en un estado decidido). Esas
       * filas no son un sobre, `deliver` lanzaba con ellas, y como todo ocurre
       * en una transacción, **una sola bastaba para que ningún resultado
       * posterior se publicara jamás** (B3).
       */
      const rows = await client.query<{
        deposit_id: string;
        result_envelope: MessageEnvelope<unknown>;
        trace_context: string | null;
      }>(
        `SELECT deposit_id, result_envelope, trace_context FROM interbank_deposits
          WHERE result_envelope IS NOT NULL AND result_published_at IS NULL
            AND result_envelope ->> 'messageId' IS NOT NULL
          ORDER BY decided_at FOR UPDATE SKIP LOCKED LIMIT $1`,
        [limit],
      );
      let published = 0;
      for (const row of rows.rows) {
        /*
         * Cada fila por su cuenta: la que no se puede publicar se queda sin
         * marcar para el siguiente barrido, y las demás salen. Un fallo del
         * broker en una no puede dejar sin resultado a las otras diecinueve.
         */
        try {
          await continueTrace(
            row.trace_context,
            'payment.interbank.result',
            { 'bank.correlation_id': row.result_envelope.correlationId },
            () => deliver(row.result_envelope),
          );
        } catch {
          continue;
        }
        await client.query(
          'UPDATE interbank_deposits SET result_published_at = now() WHERE deposit_id = $1',
          [row.deposit_id],
        );
        published += 1;
      }
      await client.query('COMMIT');
      return published;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async claimCallbacks(now: Date, limit: number): Promise<readonly InterbankDeposit[]> {
    /*
     * Espera creciente —2 s, 4 s, 8 s…— con techo de 15 minutos, y **no más de
     * 24 horas desde la decisión**: es lo que el contrato pide del receptor. El
     * techo anterior era de 60 s para siempre, que insiste sin parar contra un
     * emisor caído y nunca se rinde; el contrato fija las dos cosas.
     * `abandonStaleCallbacks` recoge después los que cruzaron las 24 horas.
     */
    const rows = await this.pool.query<DepositRow>(
      `UPDATE interbank_deposits SET callback_attempts = callback_attempts + 1,
           callback_due_at = $1::timestamptz +
             (LEAST(900, POWER(2, LEAST(callback_attempts, 9) + 1)::integer) * interval '1 second'),
           claimed_until = $1::timestamptz + ($3::double precision * interval '1 millisecond')
        WHERE deposit_id IN (
          SELECT deposit_id FROM interbank_deposits
           WHERE callback_due_at <= $1 AND callback_delivered_at IS NULL
             AND stage IN ('ACCEPTED','REJECTED')
             AND (claimed_until IS NULL OR claimed_until <= $1)
           ORDER BY callback_due_at FOR UPDATE SKIP LOCKED LIMIT $2
        ) RETURNING ${COLUMNS}`,
      [now, limit, this.leaseMs],
    );
    return rows.rows.map(fromRow);
  }

  async releaseCallbackClaim(depositId: string): Promise<void> {
    await this.pool.query(
      'UPDATE interbank_deposits SET claimed_until = NULL WHERE deposit_id = $1',
      [depositId],
    );
  }

  async abandonStaleCallbacks(now: Date, maxAgeMs: number): Promise<readonly InterbankDeposit[]> {
    const rows = await this.pool.query<DepositRow>(
      `UPDATE interbank_deposits SET callback_due_at = NULL
        WHERE callback_delivered_at IS NULL AND callback_due_at IS NOT NULL
          AND decided_at IS NOT NULL
          AND decided_at <= $1::timestamptz - ($2::double precision * interval '1 millisecond')
        RETURNING ${COLUMNS}`,
      [now, maxAgeMs],
    );
    return rows.rows.map(fromRow);
  }

  async markCallbackDelivered(depositId: string, now: Date): Promise<void> {
    await this.pool.query(
      `UPDATE interbank_deposits
          SET callback_delivered_at = $2, callback_due_at = NULL, claimed_until = NULL
        WHERE deposit_id = $1 AND callback_delivered_at IS NULL`,
      [depositId, now],
    );
  }

  async publishConflictResults(
    deliver: (envelope: MessageEnvelope<unknown>) => Promise<void>,
    limit: number,
  ): Promise<number> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const rows = await client.query<{
        message_id: string;
        result_envelope: MessageEnvelope<unknown>;
        trace_context: string | null;
      }>(
        `SELECT message_id, result_envelope, trace_context FROM interbank_conflicts
          WHERE result_published_at IS NULL ORDER BY created_at
          FOR UPDATE SKIP LOCKED LIMIT $1`,
        [limit],
      );
      for (const row of rows.rows) {
        await continueTrace(
          row.trace_context,
          'payment.interbank.conflict.result',
          { 'bank.correlation_id': row.result_envelope.correlationId },
          () => deliver(row.result_envelope),
        );
        await client.query(
          'UPDATE interbank_conflicts SET result_published_at = now() WHERE message_id = $1',
          [row.message_id],
        );
      }
      await client.query('COMMIT');
      return rows.rowCount ?? 0;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async claimConflictCallbacks(
    now: Date,
    limit: number,
  ): Promise<readonly { messageId: string; deposit: InterbankDeposit }[]> {
    const rows = await this.pool.query<{
      message_id: string;
      origin_envelope: MessageEnvelope<PaymentInterbankReceiveV1>;
      callback_attempts: number;
      trace_context: string | null;
      created_at: Date;
    }>(
      `UPDATE interbank_conflicts SET callback_attempts = callback_attempts + 1,
           callback_due_at = $1::timestamptz +
             (LEAST(900, POWER(2, LEAST(callback_attempts, 9) + 1)::integer) * interval '1 second'),
           claimed_until = $1::timestamptz + ($3::double precision * interval '1 millisecond')
        WHERE message_id IN (
          SELECT message_id FROM interbank_conflicts
           WHERE callback_due_at <= $1 AND callback_delivered_at IS NULL
             AND (claimed_until IS NULL OR claimed_until <= $1)
           ORDER BY callback_due_at FOR UPDATE SKIP LOCKED LIMIT $2
        ) RETURNING message_id, origin_envelope, callback_attempts, trace_context, created_at`,
      [now, limit, this.leaseMs],
    );
    return rows.rows.map((row) => {
      const payload = row.origin_envelope.payload;

      return {
        messageId: row.message_id,
        deposit: {
          depositId: payload.depositId,
          stage: 'REJECTED' as const,
          reason: 'IDEMPOTENCY_CONFLICT',
          origin: row.origin_envelope,
          correlationId: row.origin_envelope.correlationId,
          externalTransferId: payload.interbankTransferId,
          originBankCode: payload.originBankCode,
          accountRef: payload.accountId,
          amount: payload.amount,
          callbackAttempts: row.callback_attempts,
          traceContext: row.trace_context,
          createdAt: row.created_at,
          decidedAt: row.created_at,
          expiresAt: null,
        },
      };
    });
  }

  async markConflictCallbackDelivered(messageId: string, now: Date): Promise<void> {
    await this.pool.query(
      `UPDATE interbank_conflicts SET callback_delivered_at = $2, claimed_until = NULL
        WHERE message_id = $1 AND callback_delivered_at IS NULL`,
      [messageId, now],
    );
  }

  async releaseConflictCallbackClaim(messageId: string): Promise<void> {
    await this.pool.query('UPDATE interbank_conflicts SET claimed_until = NULL WHERE message_id = $1', [
      messageId,
    ]);
  }
}
