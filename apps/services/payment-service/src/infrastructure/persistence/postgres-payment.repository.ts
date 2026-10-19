import type { MessageEnvelope } from '@bank/contracts';
import { currentTraceparent } from '@bank/observability';
import type { Pool, PoolClient } from 'pg';

import type {
  AttemptRecord,
  AttemptResult,
  OpenOutcome,
  OutboxMessage,
  PaymentFilter,
  PaymentRepository,
  StoredSimulation,
} from '../../application/ports';
import { minorUnitsFromNumeric, numericFromMinorUnits, quetzales } from '../../domain/money';
import type { Payment, PaymentAttempt } from '../../domain/payment';
import type { SimulationSettings } from '../../domain/simulation';
import { PAYMENT_LEASE_MS } from './claim-lease';

/** The one row of `payment_simulation_settings`. */
interface SimulationRow {
  failure_rate_percent: number;
  timeout_rate_percent: number;
  latency_ms: number;
  updated_at: Date;
}

function simulationOf(row: SimulationRow): StoredSimulation {
  return {
    settings: {
      failureRatePercent: row.failure_rate_percent,
      timeoutRatePercent: row.timeout_rate_percent,
      latencyMs: row.latency_ms,
    },
    updatedAt: row.updated_at,
  };
}

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
  provider_result: string | null;
  occurred_at: Date;
}

interface OutboxRow {
  id: string;
  exchange: string;
  routing_key: string;
  /** JSONB, parsed by the driver back into the envelope it was stored as. */
  envelope: MessageEnvelope<unknown>;
  trace_context: string | null;
}

/** Whether a thrown error is a PostgreSQL unique violation on a named constraint. */
function isUniqueViolation(error: unknown, constraint: string): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: string }).code === '23505' &&
    (error as { constraint?: string }).constraint === constraint
  );
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
  readonly #leaseMs: number;

  constructor(pool: Pool, leaseMs: number = PAYMENT_LEASE_MS) {
    this.#pool = pool;
    this.#leaseMs = leaseMs;
  }

  public async stats(): Promise<{
    readonly today: number;
    readonly succeededToday: number;
    readonly failedToday: number;
    readonly retrying: number;
  }> {
    const counted = await this.#pool.query<{
      today: string;
      succeeded_today: string;
      failed_today: string;
      retrying: string;
    }>(
      `SELECT COUNT(*) FILTER (WHERE created_at::date = CURRENT_DATE)::TEXT AS today,
              COUNT(*) FILTER (WHERE created_at::date = CURRENT_DATE
                                AND status = 'SUCCEEDED')::TEXT AS succeeded_today,
              COUNT(*) FILTER (WHERE created_at::date = CURRENT_DATE
                                AND status = 'FAILED')::TEXT AS failed_today,
              /* Climbing the ladder right now: still PENDING and already due
                 another attempt. Not scoped to today — it is a thing that is
                 happening, not a thing that happened. */
              COUNT(*) FILTER (WHERE status = 'PENDING' AND next_attempt_at IS NOT NULL)::TEXT
                AS retrying
         FROM payments`,
    );

    const row = counted.rows[0];

    return {
      today: Number(row?.today ?? '0'),
      succeededToday: Number(row?.succeeded_today ?? '0'),
      failedToday: Number(row?.failed_today ?? '0'),
      retrying: Number(row?.retrying ?? '0'),
    };
  }

  public async open(input: { readonly payment: Payment }): Promise<OpenOutcome> {
    const { payment } = input;

    /**
     * `ON CONFLICT DO NOTHING` and then a read, rather than a read and then an
     * insert. The second is a race: two deliveries both find nothing and both
     * insert, and one of them gets a primary-key violation it has to interpret.
     * This way the database decides, once.
     *
     * `ON CONFLICT (payment_id)` handles the ordinary redelivery, but this table
     * carries a *second* unique key — one payment per transfer
     * (`payments_transaction_key`) — that the clause cannot also name. A command
     * bearing a fresh `paymentId` for a transfer already being paid would raise
     * it as an error and land in the dead-letter queue for a race that is not a
     * fault. So that specific violation is caught and read as "already open",
     * exactly as a `payment_id` conflict is (TD-047 hardening).
     */
    let inserted;

    try {
      inserted = await this.#pool.query<PaymentRow>(
        `INSERT INTO payments (payment_id, transaction_id, amount, status, scenario,
                               origin_correlation_id, next_attempt_at, created_at, updated_at,
                               trace_context, claimed_until)
         VALUES ($1, $2, $3, 'PENDING', $4, $5, $6, $7, $7, $8, $9)
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
          // The Saga's trace, so the retry sweep can rejoin it (T-48).
          currentTraceparent(),
          /*
           * Nace arrendado: quien lo abre hace el primer intento en línea, y el
           * barrido —que ve un `PENDING` con `next_attempt_at` ya vencido—
           * competiría con él. `attempt` suelta el arrendamiento al terminar.
           */
          new Date(payment.createdAt.getTime() + this.#leaseMs),
        ],
      );
    } catch (error) {
      if (!isUniqueViolation(error, 'payments_transaction_key')) {
        throw error;
      }

      const byTransaction = await this.#pool.query<PaymentRow>(
        `SELECT ${COLUMNS} FROM payments WHERE transaction_id = $1`,
        [payment.transactionId],
      );

      return { kind: 'EXISTS', payment: paymentOf(byTransaction.rows[0]!) };
    }

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
    readonly outbound?: (payment: Payment, attempt: number) => readonly OutboxMessage[];
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
                decided_at         = $9,
                -- The attempt is over and its next due time is written above:
                -- release the sweeper's lease so that time is honoured at once.
                claimed_until      = NULL
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
           (payment_id, attempt_number, result, error_type, failure_reason, provider_result, occurred_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          input.paymentId,
          input.expectedAttempt,
          result.attemptResult,
          result.attemptResult === 'FAILED' ? result.errorType : null,
          result.attemptResult === 'FAILED' ? result.failureReason : null,
          result.providerResult,
          input.now,
        ],
      );

      const recorded = paymentOf(updated.rows[0]!);

      /**
       * The outbox, written here with the attempt that produced it (TD-047).
       * The `payment.attempt.failed` for this rung, and the terminal event when
       * the ladder is spent, commit in this transaction or not at all — so there
       * is no moment where the attempt is recorded but the event the Saga needs
       * was lost to a crash.
       */
      if (input.outbound !== undefined) {
        for (const message of input.outbound(recorded, input.expectedAttempt)) {
          await client.query(
            `INSERT INTO outbox_messages (payment_id, exchange, routing_key, envelope,
                                         trace_context)
             VALUES ($1, $2, $3, $4::JSONB, $5)`,
            [
              input.paymentId,
              message.exchange,
              message.routingKey,
              JSON.stringify(message.envelope),
              // The attempt's trace, so the relay publishes inside it (T-48).
              currentTraceparent(),
            ],
          );
        }
      }

      return {
        kind: 'RECORDED',
        payment: recorded,
        attempt: input.expectedAttempt,
      };
    });
  }

  public async dispatchPendingOutbox(
    deliver: (message: OutboxMessage) => Promise<void>,
    limit: number,
  ): Promise<number> {
    const client = await this.#pool.connect();

    try {
      await client.query('BEGIN');

      /**
       * `FOR UPDATE SKIP LOCKED` lets more than one replica sweep the outbox
       * without sending anything twice: each claims a disjoint set of rows.
       * `ORDER BY id` keeps a payment's events in the order they were written —
       * an `attempt.failed` never overtakes the terminal event that followed it.
       */
      const pending = await client.query<OutboxRow>(
        `SELECT id, exchange, routing_key, envelope, trace_context
           FROM outbox_messages
          WHERE dispatch_status = 'PENDING'
          ORDER BY id
          FOR UPDATE SKIP LOCKED
          LIMIT $1`,
        [limit],
      );

      for (const row of pending.rows) {
        /**
         * The publish is inside the transaction. If it throws — the broker is
         * away — the batch rolls back, the rows stay `PENDING`, and the failure
         * surfaces to the relay. If it succeeds but this process dies before the
         * mark commits, the row is still `PENDING` and is sent again, which is
         * harmless: the envelope's `messageId` is unchanged and every consumer
         * deduplicates on it.
         */
        await deliver({
          exchange: row.exchange,
          routingKey: row.routing_key,
          envelope: row.envelope,
          traceparent: row.trace_context,
        });

        await client.query(
          `UPDATE outbox_messages
              SET dispatch_status = 'DISPATCHED', published_at = now()
            WHERE id = $1`,
          [row.id],
        );
      }

      await client.query('COMMIT');

      return pending.rowCount ?? 0;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);

      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * The trace the payment was opened in, for the retry sweep to rejoin (T-48).
   * Not on the port: only the composition root uses it, to wrap a retry, and
   * nothing in the application decides anything from a trace.
   */
  public async traceContextOf(paymentId: string): Promise<string | null> {
    const found = await this.#pool.query<{ trace_context: string | null }>(
      'SELECT trace_context FROM payments WHERE payment_id = $1',
      [paymentId],
    );

    return found.rows[0]?.trace_context ?? null;
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
      `SELECT attempt_number, result, error_type, failure_reason, provider_result, occurred_at
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
      providerResult: row.provider_result as PaymentAttempt['providerResult'],
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
   * Claims the payments the ladder owes, and **leases** them in the same
   * statement (T-60).
   *
   * This used to be a bare `SELECT … FOR UPDATE SKIP LOCKED` through the pool.
   * Outside a transaction the row lock is gone the instant the `SELECT`
   * returns, so two replicas (the HPA scales this service) read the same due
   * payments, both asked the provider, and one then lost the race into the lock
   * in `attempt`. Money was never at risk — `attempt` checks the attempt number
   * against the row — but every duplicate claim was a wasted provider call.
   *
   * `SKIP LOCKED` in the sub-select splits the rows between claims running at
   * the same moment; `claimed_until` keeps them split afterwards, until
   * `attempt` finishes and clears it or the lease lapses because the pod died.
   */
  public async due(now: Date, limit: number): Promise<readonly Payment[]> {
    const found = await this.#pool.query<PaymentRow>(
      `WITH claimed AS (
         UPDATE payments
            SET claimed_until = $1::timestamptz + ($3::double precision * interval '1 millisecond')
          WHERE payment_id IN (
            SELECT payment_id FROM payments
             WHERE status = 'PENDING'
               AND next_attempt_at IS NOT NULL
               AND next_attempt_at <= $1
               AND (claimed_until IS NULL OR claimed_until <= $1)
             ORDER BY next_attempt_at
             FOR UPDATE SKIP LOCKED
             LIMIT $2
          )
          RETURNING ${COLUMNS}
       )
       SELECT ${COLUMNS} FROM claimed ORDER BY next_attempt_at`,
      [now, limit, this.#leaseMs],
    );

    return found.rows.map(paymentOf);
  }

  public async loadSimulation(): Promise<StoredSimulation | null> {
    const found = await this.#pool.query<SimulationRow>(
      `SELECT failure_rate_percent, timeout_rate_percent, latency_ms, updated_at
         FROM payment_simulation_settings
        WHERE id = 1`,
    );
    const row = found.rows[0];

    return row === undefined ? null : simulationOf(row);
  }

  public async saveSimulation(settings: SimulationSettings, now: Date): Promise<StoredSimulation> {
    const saved = await this.#pool.query<SimulationRow>(
      `INSERT INTO payment_simulation_settings
         (id, failure_rate_percent, timeout_rate_percent, latency_ms, updated_at)
       VALUES (1, $1, $2, $3, $4)
       ON CONFLICT (id) DO UPDATE
         SET failure_rate_percent = EXCLUDED.failure_rate_percent,
             timeout_rate_percent = EXCLUDED.timeout_rate_percent,
             latency_ms           = EXCLUDED.latency_ms,
             updated_at           = EXCLUDED.updated_at
       RETURNING failure_rate_percent, timeout_rate_percent, latency_ms, updated_at`,
      [settings.failureRatePercent, settings.timeoutRatePercent, settings.latencyMs, now],
    );

    return simulationOf(saved.rows[0]!);
  }

  public async clearSimulation(): Promise<void> {
    await this.#pool.query('DELETE FROM payment_simulation_settings WHERE id = 1');
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
