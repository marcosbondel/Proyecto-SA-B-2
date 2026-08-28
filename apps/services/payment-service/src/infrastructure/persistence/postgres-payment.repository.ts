import type { Pool, PoolClient } from 'pg';

import type {
  AttemptRecord,
  AttemptResult,
  OpenOutcome,
  PaymentFilter,
  PaymentRepository,
} from '../../application/ports';
import { minorUnitsFromNumeric, numericFromMinorUnits, quetzales } from '../../domain/money';
import type { Payment, PaymentAttempt } from '../../domain/payment';

/** One row of `payments`, as `pg` hands it over. */
interface PaymentRow {
  payment_id: string;
  transaction_id: string;
  amount: string;
  status: string;
  attempt: number | null;
  error_type: string | null;
  failure_reason: string | null;
  provider_reference: string | null;
  scenario: string | null;
  origin_correlation_id: string | null;
  next_attempt_at: Date | null;
  created_at: Date;
  updated_at: Date;
  decided_at: Date | null;
}

interface AttemptRow {
  attempt_number: number;
  result: string;
  error_type: string | null;
  failure_reason: string | null;
  occurred_at: Date;
}

const COLUMNS = `payment_id, transaction_id, amount, status, attempt, error_type,
                 failure_reason, provider_reference, scenario, origin_correlation_id,
                 next_attempt_at, created_at, updated_at, decided_at`;

/**
 * The only code in the system that reads or writes the `payments` table.
 *
 * Two things here are load-bearing rather than incidental.
 *
 * **`attempt` locks before it decides.** `SELECT … FOR UPDATE` and then the
 * caller's `decide`, both inside one transaction. Without the lock, the message
 * handler making attempt 1 and the sweeper waking for attempt 2 can both read
 * `PENDING`, both ask the provider and both write — a double charge for one
 * transfer, which is the single worst thing this service could do.
 *
 * **`expectedAttempt` is checked against the row.** The lock alone makes them
 * serial; this makes the second one a no-op instead of an attempt with a stale
 * number.
 */
export class PostgresPaymentRepository implements PaymentRepository {
  readonly #pool: Pool;

  constructor(pool: Pool) {
    this.#pool = pool;
  }

  public async open(input: { readonly payment: Payment }): Promise<OpenOutcome> {
    const { payment } = input;

    /**
     * `ON CONFLICT DO NOTHING` and then a read, rather than a read and then an
     * insert. The second is a race: two deliveries both find nothing and both
     * insert, and one of them gets a primary-key violation it has to interpret.
     * This way the database decides, once.
     */
    const inserted = await this.#pool.query<PaymentRow>(
      `INSERT INTO payments (payment_id, transaction_id, amount, status, scenario,
                             origin_correlation_id, next_attempt_at, created_at, updated_at)
       VALUES ($1, $2, $3, 'PENDING', $4, $5, $6, $7, $7)
       ON CONFLICT (payment_id) DO NOTHING
       RETURNING ${COLUMNS}`,
      [
        payment.paymentId,
        payment.transactionId,
        numericFromMinorUnits(payment.amount.amountMinor),
        payment.scenario,
        payment.originCorrelationId,
        payment.nextAttemptAt,
        payment.createdAt,
      ],
    );

    if (inserted.rows.length > 0) {
      return { kind: 'CREATED', payment: paymentOf(inserted.rows[0]!) };
    }

    const existing = await this.#pool.query<PaymentRow>(
      `SELECT ${COLUMNS} FROM payments WHERE payment_id = $1`,
      [payment.paymentId],
    );

    return { kind: 'EXISTS', payment: paymentOf(existing.rows[0]!) };
  }

  public async attempt(input: {
    readonly paymentId: string;
    readonly expectedAttempt: number;
    readonly decide: (payment: Payment, attempt: number) => AttemptResult;
    readonly now: Date;
  }): Promise<AttemptRecord> {
    return await this.#inTransaction(async (client) => {
      const locked = await client.query<PaymentRow>(
        `SELECT ${COLUMNS} FROM payments WHERE payment_id = $1 FOR UPDATE`,
        [input.paymentId],
      );

      if (locked.rows.length === 0) {
        return { kind: 'UNKNOWN' };
      }

      const found = paymentOf(locked.rows[0]!);

      /**
       * Two ways to be too late, and both are ordinary. The payment is already
       * settled — another replica finished it — or somebody already made this
       * attempt number. Neither is an error and neither may become a charge.
       */
      if (found.status !== 'PENDING' || (found.attempt ?? 0) + 1 !== input.expectedAttempt) {
        return { kind: 'SUPERSEDED', payment: found };
      }

      const result = input.decide(found, input.expectedAttempt);

      const updated = await client.query<PaymentRow>(
        `UPDATE payments
            SET status             = $2,
                attempt            = $3,
                error_type         = $4,
                failure_reason     = $5,
                provider_reference = $6,
                next_attempt_at    = $7,
                updated_at         = $8,
                /*
                 * Computed in TypeScript and passed as its own parameter, not
                 * derived in SQL from $2.
                 *
                 * The obvious form is a CASE over the status parameter, and
                 * Postgres refuses it: it infers a parameter's type from its
                 * uses, and a $2 that is both assigned to a VARCHAR column and
                 * compared against a literal deduces two types. The error is
                 * "inconsistent types deduced for parameter $2", it happens at
                 * execution rather than at compile time, and every attempt
                 * fails on it -- which is a transfer stalled with the money
                 * already debited. One more parameter is cheaper than one more
                 * cast to get wrong.
                 */
                decided_at         = $9
          WHERE payment_id = $1
        RETURNING ${COLUMNS}`,
        [
          input.paymentId,
          result.status,
          input.expectedAttempt,
          result.errorType,
          result.failureReason,
          result.providerReference,
          result.nextAttemptAt,
          input.now,
          result.status === 'PENDING' ? null : input.now,
        ],
      );

      await client.query(
        `INSERT INTO payment_attempts
           (payment_id, attempt_number, result, error_type, failure_reason, occurred_at)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          input.paymentId,
          input.expectedAttempt,
          result.attemptResult,
          result.attemptResult === 'FAILED' ? result.errorType : null,
          result.attemptResult === 'FAILED' ? result.failureReason : null,
          input.now,
        ],
      );

      return {
        kind: 'RECORDED',
        payment: paymentOf(updated.rows[0]!),
        attempt: input.expectedAttempt,
      };
    });
  }

  public async findById(paymentId: string): Promise<Payment | null> {
    const found = await this.#pool.query<PaymentRow>(
      `SELECT ${COLUMNS} FROM payments WHERE payment_id = $1`,
      [paymentId],
    );

    return found.rows.length === 0 ? null : paymentOf(found.rows[0]!);
  }

  public async attemptsOf(paymentId: string): Promise<readonly PaymentAttempt[]> {
    const found = await this.#pool.query<AttemptRow>(
      `SELECT attempt_number, result, error_type, failure_reason, occurred_at
         FROM payment_attempts
        WHERE payment_id = $1
        ORDER BY attempt_number`,
      [paymentId],
    );

    return found.rows.map((row) => ({
      attemptNumber: row.attempt_number,
      result: row.result as PaymentAttempt['result'],
      errorType: row.error_type as PaymentAttempt['errorType'],
      failureReason: row.failure_reason as PaymentAttempt['failureReason'],
      occurredAt: row.occurred_at,
    }));
  }

  public async list(filter: PaymentFilter): Promise<readonly Payment[]> {
    /**
     * Built by appending, never by interpolating. Every value reaches the
     * database as a bound parameter, so a filter that arrived from an HTTP
     * query string cannot become SQL.
     */
    const where: string[] = [];
    const values: unknown[] = [];

    if (filter.transactionId !== undefined) {
      values.push(filter.transactionId);
      where.push(`transaction_id = $${String(values.length)}`);
    }

    if (filter.status !== undefined) {
      values.push(filter.status);
      where.push(`status = $${String(values.length)}`);
    }

    if (filter.errorType !== undefined) {
      values.push(filter.errorType);
      where.push(`error_type = $${String(values.length)}`);
    }

    const found = await this.#pool.query<PaymentRow>(
      `SELECT ${COLUMNS} FROM payments
       ${where.length === 0 ? '' : `WHERE ${where.join(' AND ')}`}
       ORDER BY created_at DESC
       LIMIT 200`,
      values,
    );

    return found.rows.map(paymentOf);
  }

  /**
   * `FOR UPDATE SKIP LOCKED` is what makes more than one replica safe.
   *
   * Without it two sweepers read the same due payments and race into the lock
   * in `attempt`; one wins and the other blocks for the length of a provider
   * call before discovering it was superseded. With it, the second sweeper
   * simply picks different rows.
   */
  public async due(now: Date, limit: number): Promise<readonly Payment[]> {
    const found = await this.#pool.query<PaymentRow>(
      `SELECT ${COLUMNS} FROM payments
        WHERE status = 'PENDING'
          AND next_attempt_at IS NOT NULL
          AND next_attempt_at <= $1
        ORDER BY next_attempt_at
        LIMIT $2
        FOR UPDATE SKIP LOCKED`,
      [now, limit],
    );

    return found.rows.map(paymentOf);
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
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}

function paymentOf(row: PaymentRow): Payment {
  return {
    paymentId: row.payment_id,
    transactionId: row.transaction_id,
    status: row.status as Payment['status'],
    amount: quetzales(minorUnitsFromNumeric(row.amount)),
    attempt: row.attempt,
    errorType: row.error_type as Payment['errorType'],
    failureReason: row.failure_reason as Payment['failureReason'],
    providerReference: row.provider_reference,
    scenario: row.scenario as Payment['scenario'],
    originCorrelationId: row.origin_correlation_id,
    nextAttemptAt: row.next_attempt_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    decidedAt: row.decided_at,
  };
}
