import type { Pool, PoolClient } from 'pg';

import { IllegalTransition } from '../../domain/transaction';
import type {
  FailureReason,
  PaymentScenario,
  Transaction,
  TransactionStatus,
  Transition,
} from '../../domain/transaction';
import { minorUnitsFromNumeric, numericFromMinorUnits, quetzales } from '../../domain/money';
import type {
  EventOutcome,
  PaymentOutcome,
  StartOutcome,
  TransactionRepository,
} from '../../application/ports';

/**
 * This service's own database, and the place where "an event cannot corrupt the
 * state" stops being a claim and becomes a mechanism.
 *
 * Three of them, and they are not interchangeable:
 *
 * - **`SELECT ... FOR UPDATE` before anything is decided.** The domain judges
 *   the row the write is about to overwrite, not a copy read a moment earlier.
 *   Without it, `payment.failed.v1` and `account.credited.v1` arriving together
 *   would both read `PAYMENT_PENDING`, and one transfer would be both completed
 *   and compensated.
 * - **The previous status in the `WHERE` of the `UPDATE`.** Redundant while the
 *   lock holds, and deliberately kept: it turns a future refactor that loses
 *   the lock into zero updated rows — a loud failure — instead of into a
 *   silently overwritten state.
 * - **`CHECK (status IN (...))` on the column.** The last line, for when the
 *   first two are wrong.
 *
 * The order inside `applyEvent` is itself a guarantee: the row is found, then
 * the message is claimed, and only then is anything written. Claiming first
 * would mark an event processed for a transaction that turned out to belong to
 * somebody else.
 */
export class PostgresTransactionRepository implements TransactionRepository {
  readonly #pool: Pool;

  constructor(pool: Pool) {
    this.#pool = pool;
  }

  public async start(input: { readonly transaction: Transaction }): Promise<StartOutcome> {
    const { transaction } = input;

    return await this.#inTransaction(async (client) => {
      const inserted = await client.query<TransactionRow>(
        `INSERT INTO transactions
           (transaction_id, source_account, target_account, amount, status,
            correlation_id, idempotency_key, failure_reason, payment_scenario,
            created_at, updated_at, completed_at)
         VALUES ($1, $2, $3, $4::NUMERIC, $5, $6, $7, NULL, $8, $9, $9, NULL)
         ON CONFLICT (idempotency_key) DO NOTHING
         RETURNING ${COLUMNS}`,
        [
          transaction.transactionId,
          transaction.sourceAccount,
          transaction.targetAccount,
          numericFromMinorUnits(transaction.amount.amountMinor),
          transaction.status,
          transaction.correlationId,
          transaction.idempotencyKey,
          transaction.paymentScenario,
          transaction.createdAt,
        ],
      );

      if (inserted.rowCount === 1) {
        return { kind: 'CREATED', transaction: transactionFrom(inserted.rows[0]!) };
      }

      /**
       * The key was already there. Whether that is a retry to honour or a
       * conflict to refuse is a domain judgement about the *content*, and it is
       * made by the caller — the two fields it compares never change after the
       * insert, so reading them outside the lock is safe.
       */
      const existing = await client.query<TransactionRow>(
        `SELECT ${COLUMNS} FROM transactions WHERE idempotency_key = $1`,
        [transaction.idempotencyKey],
      );

      return { kind: 'EXISTS', transaction: transactionFrom(existing.rows[0]!) };
    });
  }

  public async recordAlias(input: {
    readonly requestedTransactionId: string;
    readonly transactionId: string;
  }): Promise<void> {
    // The identity case — a redelivery of the very first request — is not an
    // alias and would fail the foreign key's own row against itself.
    if (input.requestedTransactionId === input.transactionId) {
      return;
    }

    await this.#pool.query(
      `INSERT INTO transaction_aliases (requested_transaction_id, transaction_id)
       VALUES ($1, $2)
       ON CONFLICT (requested_transaction_id) DO NOTHING`,
      [input.requestedTransactionId, input.transactionId],
    );
  }

  public async findById(transactionId: string): Promise<Transaction | null> {
    const result = await this.#pool.query<TransactionRow>(
      `SELECT ${COLUMNS}
         FROM transactions
        WHERE transaction_id = $1
           OR transaction_id = (
                SELECT transaction_id FROM transaction_aliases
                 WHERE requested_transaction_id = $1
              )
        LIMIT 1`,
      [transactionId],
    );

    return result.rows[0] === undefined ? null : transactionFrom(result.rows[0]);
  }

  public async findByCorrelationId(correlationId: string): Promise<Transaction | null> {
    /**
     * Oldest first. One correlation names one transfer today, but a flow that
     * ever produced two would have the first as its subject, and answering with
     * whichever the planner happened to return is not an answer.
     */
    const result = await this.#pool.query<TransactionRow>(
      `SELECT ${COLUMNS} FROM transactions
        WHERE correlation_id = $1
        ORDER BY created_at, transaction_id
        LIMIT 1`,
      [correlationId],
    );

    return result.rows[0] === undefined ? null : transactionFrom(result.rows[0]);
  }

  public async applyEvent(input: {
    readonly transactionId: string;
    readonly messageId: string;
    readonly messageType: string;
    readonly payload: unknown;
    readonly decide: (transaction: Transaction) => Transition;
    readonly now: Date;
  }): Promise<EventOutcome> {
    const client = await this.#pool.connect();

    try {
      await client.query('BEGIN');

      const locked = await client.query<TransactionRow>(
        `SELECT ${COLUMNS} FROM transactions WHERE transaction_id = $1 FOR UPDATE`,
        [input.transactionId],
      );

      if (locked.rows[0] === undefined) {
        await client.query('ROLLBACK');

        /**
         * Nothing is recorded, deliberately. An event about a transfer this
         * database does not hold is not this service's to remember, and
         * claiming its `messageId` would silently drop a legitimate redelivery
         * if the row ever did appear.
         */
        return { kind: 'UNKNOWN_TRANSACTION' };
      }

      const claimed = await client.query(
        `INSERT INTO processed_messages (message_id, message_type, transaction_id, outcome)
         VALUES ($1, $2, $3, 'APPLIED')
         ON CONFLICT (message_id) DO NOTHING`,
        [input.messageId, input.messageType, input.transactionId],
      );

      if (claimed.rowCount === 0) {
        await client.query('ROLLBACK');

        // T-5: seen before. No second transition and no second compensation.
        return { kind: 'DUPLICATE' };
      }

      const transaction = transactionFrom(locked.rows[0]);

      let transition: Transition;

      try {
        transition = input.decide(transaction);
      } catch (error) {
        if (!(error instanceof IllegalTransition)) {
          await client.query('ROLLBACK');

          throw error;
        }

        /**
         * T-6: discarded **and recorded**. The record commits along with the
         * claim on the message, because a discard nobody can see is
         * indistinguishable from a message that never arrived — and "the events
         * arrived out of order" is exactly the incident somebody will be trying
         * to reconstruct.
         */
        await client.query(
          `UPDATE processed_messages SET outcome = 'ILLEGAL_TRANSITION' WHERE message_id = $1`,
          [input.messageId],
        );
        await recordEvent(client, input.transactionId, `${input.messageType}#discarded`, {
          reason: 'ILLEGAL_TRANSITION',
          from: error.from,
          event: error.event,
          messageId: input.messageId,
        });
        await client.query('COMMIT');

        return { kind: 'ILLEGAL', from: error.from, event: error.event };
      }

      const updated = await client.query<TransactionRow>(
        `UPDATE transactions
            SET status = $2,
                failure_reason = $3,
                updated_at = $4,
                completed_at = COALESCE(completed_at, $5)
          WHERE transaction_id = $1
            AND status = $6
        RETURNING ${COLUMNS}`,
        [
          input.transactionId,
          transition.status,
          transition.failureReason,
          input.now,
          TERMINAL.has(transition.status) ? input.now : null,
          transition.from,
        ],
      );

      if (updated.rows[0] === undefined) {
        await client.query('ROLLBACK');

        /**
         * Unreachable while the lock above holds, which is why it throws rather
         * than returning an outcome. If it ever fires, the lock was lost and
         * this is the loud failure that says so.
         */
        throw new Error(
          `Transaction ${input.transactionId} moved out of ${transition.from} while it was locked.`,
        );
      }

      await recordEvent(client, input.transactionId, input.messageType, input.payload);
      await client.query('COMMIT');

      return {
        kind: 'APPLIED',
        transaction: transactionFrom(updated.rows[0]),
        transition,
      };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);

      throw error;
    } finally {
      client.release();
    }
  }

  public async recordCommand(input: {
    readonly transactionId: string;
    readonly messageType: string;
    readonly payload: unknown;
  }): Promise<void> {
    await recordEvent(this.#pool, input.transactionId, input.messageType, input.payload);
  }

  /**
   * The payment half of the trail, folded into one answer.
   *
   * Read from what this service itself wrote down, in the order it wrote it.
   * The last decision wins, which matters when Payment Service reports several
   * attempts: `attempt: 3, FAILED` is the outcome, and the two attempts before
   * it are history rather than contradictions.
   */
  public async paymentOutcomeOf(transactionId: string): Promise<PaymentOutcome | null> {
    const result = await this.#pool.query<{ event_type: string; payload: PaymentEventPayload }>(
      `SELECT event_type, payload
         FROM transaction_events
        WHERE transaction_id = $1
          AND event_type IN ('payment.requested.v1', 'payment.succeeded.v1', 'payment.failed.v1')
        ORDER BY id`,
      [transactionId],
    );

    let outcome: PaymentOutcome | null = null;

    for (const row of result.rows) {
      if (row.event_type === 'payment.requested.v1') {
        outcome = {
          paymentId: row.payload.paymentId,
          status: 'PENDING',
          attempt: null,
          reason: null,
          decidedAt: null,
        };

        continue;
      }

      const succeeded = row.event_type === 'payment.succeeded.v1';
      const decided = succeeded ? row.payload.succeededAt : row.payload.failedAt;

      outcome = {
        paymentId: row.payload.paymentId,
        status: succeeded ? 'SUCCEEDED' : 'FAILED',
        attempt: row.payload.attempt ?? null,
        reason: succeeded ? null : (row.payload.failureReason ?? null),
        decidedAt: decided === undefined ? null : new Date(decided),
      };
    }

    return outcome;
  }

  public async isReachable(): Promise<boolean> {
    try {
      await this.#pool.query('SELECT 1');

      return true;
    } catch {
      return false;
    }
  }

  async #inTransaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.#pool.connect();

    try {
      await client.query('BEGIN');
      const result = await work(client);
      await client.query('COMMIT');

      return result;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);

      throw error;
    } finally {
      client.release();
    }
  }
}

/** The three states nothing follows, repeated here for the `completed_at` stamp. */
const TERMINAL: ReadonlySet<TransactionStatus> = new Set<TransactionStatus>([
  'COMPLETED',
  'FAILED',
  'COMPENSATED',
]);

const COLUMNS = `transaction_id, source_account, target_account, amount::TEXT AS amount,
                 status, correlation_id, idempotency_key, failure_reason, payment_scenario,
                 created_at, updated_at, completed_at`;

interface TransactionRow {
  transaction_id: string;
  source_account: string;
  target_account: string;
  /** `NUMERIC` cast to text by the projection, never parsed by the driver. */
  amount: string;
  status: TransactionStatus;
  correlation_id: string;
  idempotency_key: string;
  failure_reason: string | null;
  payment_scenario: string | null;
  created_at: Date;
  updated_at: Date;
  completed_at: Date | null;
}

interface PaymentEventPayload {
  paymentId: string;
  attempt?: number;
  failureReason?: 'PAYMENT_DECLINED' | 'PAYMENT_RETRIES_EXHAUSTED';
  succeededAt?: string;
  failedAt?: string;
}

function transactionFrom(row: TransactionRow): Transaction {
  return {
    transactionId: row.transaction_id,
    sourceAccount: row.source_account,
    targetAccount: row.target_account,
    /**
     * The column carries no currency, because the system moves one. The domain
     * refuses any other before the insert, so reading it back as quetzales is a
     * fact rather than an assumption.
     */
    amount: quetzales(minorUnitsFromNumeric(row.amount)),
    status: row.status,
    correlationId: row.correlation_id,
    idempotencyKey: row.idempotency_key,
    failureReason: row.failure_reason as FailureReason | null,
    paymentScenario: row.payment_scenario as PaymentScenario | null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
  };
}

async function recordEvent(
  executor: Pick<Pool, 'query'> | PoolClient,
  transactionId: string,
  eventType: string,
  payload: unknown,
): Promise<void> {
  await executor.query(
    `INSERT INTO transaction_events (transaction_id, event_type, payload)
     VALUES ($1, $2, $3::JSONB)`,
    [transactionId, eventType, JSON.stringify(payload ?? {})],
  );
}
