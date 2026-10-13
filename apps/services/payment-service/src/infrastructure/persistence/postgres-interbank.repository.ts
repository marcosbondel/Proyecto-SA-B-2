import type { MessageEnvelope, PaymentInterbankReceiveV1 } from '@bank/contracts';
import { continueTrace, currentTraceparent } from '@bank/observability';
import type { Pool } from 'pg';

import type {
  InterbankDeposit,
  InterbankRepository,
  InterbankStage,
} from '../../application/interbank.ports';

interface DepositRow {
  deposit_id: string;
  stage: InterbankStage;
  rejection_reason: string | null;
  origin_envelope: MessageEnvelope<PaymentInterbankReceiveV1>;
  callback_attempts: number;
  trace_context: string | null;
  created_at: Date;
}

const COLUMNS =
  'deposit_id, stage, rejection_reason, origin_envelope, callback_attempts, trace_context, created_at';

function fromRow(row: DepositRow): InterbankDeposit {
  return {
    depositId: row.deposit_id,
    stage: row.stage,
    reason: row.rejection_reason,
    origin: row.origin_envelope,
    callbackAttempts: row.callback_attempts,
    traceContext: row.trace_context,
    createdAt: row.created_at,
  };
}

/** The durable inbox and callback schedule for deposits from partner banks. */
export class PostgresInterbankRepository implements InterbankRepository {
  constructor(readonly pool: Pool) {}

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
        stage, rejection_reason, next_action_at, result_envelope, callback_due_at, decided_at, trace_context)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$12,$13::jsonb,$14,$15,$16)
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
      const rows = await client.query<{
        deposit_id: string;
        result_envelope: MessageEnvelope<unknown>;
        trace_context: string | null;
      }>(
        `SELECT deposit_id, result_envelope, trace_context FROM interbank_deposits
          WHERE result_envelope IS NOT NULL AND result_published_at IS NULL
          ORDER BY decided_at FOR UPDATE SKIP LOCKED LIMIT $1`,
        [limit],
      );
      for (const row of rows.rows) {
        await continueTrace(
          row.trace_context,
          'payment.interbank.result',
          { 'bank.correlation_id': row.result_envelope.correlationId },
          () => deliver(row.result_envelope),
        );
        await client.query(
          'UPDATE interbank_deposits SET result_published_at = now() WHERE deposit_id = $1',
          [row.deposit_id],
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

  async claimCallbacks(now: Date, limit: number): Promise<readonly InterbankDeposit[]> {
    const rows = await this.pool.query<DepositRow>(
      `UPDATE interbank_deposits SET callback_attempts = callback_attempts + 1,
           callback_due_at = $1::timestamptz +
             (LEAST(60, POWER(2, LEAST(callback_attempts, 6))::integer) * interval '1 second')
        WHERE deposit_id IN (
          SELECT deposit_id FROM interbank_deposits
           WHERE callback_due_at <= $1 AND callback_delivered_at IS NULL
           ORDER BY callback_due_at FOR UPDATE SKIP LOCKED LIMIT $2
        ) RETURNING ${COLUMNS}`,
      [now, limit],
    );
    return rows.rows.map(fromRow);
  }

  async markCallbackDelivered(depositId: string, now: Date): Promise<void> {
    await this.pool.query(
      `UPDATE interbank_deposits SET callback_delivered_at = $2, callback_due_at = NULL
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
             (LEAST(60, POWER(2, LEAST(callback_attempts, 6))::integer) * interval '1 second')
        WHERE message_id IN (
          SELECT message_id FROM interbank_conflicts
           WHERE callback_due_at <= $1 AND callback_delivered_at IS NULL
           ORDER BY callback_due_at FOR UPDATE SKIP LOCKED LIMIT $2
        ) RETURNING message_id, origin_envelope, callback_attempts, trace_context, created_at`,
      [now, limit],
    );
    return rows.rows.map((row) => ({
      messageId: row.message_id,
      deposit: {
        depositId: row.origin_envelope.payload.depositId,
        stage: 'REJECTED' as const,
        reason: 'IDEMPOTENCY_CONFLICT',
        origin: row.origin_envelope,
        callbackAttempts: row.callback_attempts,
        traceContext: row.trace_context,
        createdAt: row.created_at,
      },
    }));
  }

  async markConflictCallbackDelivered(messageId: string, now: Date): Promise<void> {
    await this.pool.query(
      `UPDATE interbank_conflicts SET callback_delivered_at = $2
        WHERE message_id = $1 AND callback_delivered_at IS NULL`,
      [messageId, now],
    );
  }
}
