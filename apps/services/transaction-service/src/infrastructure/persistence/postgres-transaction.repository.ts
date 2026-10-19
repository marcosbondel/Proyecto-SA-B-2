import type { MessageEnvelope } from '@bank/contracts';
import { currentTraceparent } from '@bank/observability';
import type { Pool, PoolClient } from 'pg';

import { IllegalTransition } from '../../domain/transaction';
import type {
  FailureReason,
  PaymentScenario,
  Transaction,
  TransactionStatus,
  Transition,
  TransitionRecord,
} from '../../domain/transaction';
import { minorUnitsFromNumeric, numericFromMinorUnits, quetzales } from '../../domain/money';
import type {
  AppliedEffects,
  EventOutcome,
  OutboxMessage,
  PaymentAttemptOutcome,
  PaymentOutcome,
  StartOutcome,
  TransactionRepository,
  TransferObservation,
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

  public async start(input: {
    readonly transaction: Transaction;
    readonly outbound?: (transaction: Transaction) => OutboxMessage;
    readonly requestedAt?: Date;
    readonly traceContext?: string | null;
  }): Promise<StartOutcome> {
    const { transaction } = input;

    return await this.#inTransaction(async (client) => {
      const inserted = await client.query<TransactionRow>(
        `INSERT INTO transactions
           (transaction_id, source_account, target_account, amount, status,
            correlation_id, idempotency_key, customer_id, reference, interbank, failure_reason,
            payment_scenario, created_at, updated_at, completed_at,
            requested_at, trace_context)
         VALUES ($1, $2, $3, $4::NUMERIC, $5, $6, $7, $8, $9, $10::jsonb, NULL, $11, $12, $12, NULL, $13, $14)
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
          transaction.customerId,
          transaction.reference,
          transaction.interbank === null ? null : JSON.stringify(transaction.interbank),
          transaction.paymentScenario,
          transaction.createdAt,
          input.requestedAt ?? transaction.createdAt,
          input.traceContext ?? null,
        ],
      );

      if (inserted.rowCount === 1) {
        const created = transactionFrom(inserted.rows[0]!);

        /**
         * The opening row of the real history (T-28): `from_status` NULL,
         * because nothing preceded PENDING. Written only for the delivery that
         * actually won the insert, same as the outbox line below — a delivery
         * that loses the race and reads the row back never gets here, so a
         * retry of the request never writes a second opening row.
         */
        await this.#recordTransition(client, created.transactionId, {
          from: null,
          to: created.status,
          eventType: 'transfer.requested.v1',
          failureReason: null,
          messageId: null,
        });

        /**
         * The outbox, written in the same transaction as the insert (TD-031's
         * gap, closed for the one publish that used to skip it). A crash
         * between this commit and the broker publish now leaves
         * `transaction.initiated.v1` `PENDING` in the outbox rather than lost:
         * the relay sweeps it on the next tick, and the redelivery that would
         * otherwise land here again is deduplicated by `idempotency_key`
         * before this branch is even reached.
         */
        if (input.outbound !== undefined) {
          await this.#writeOutbox(client, created.transactionId, input.outbound(created));
        }

        return { kind: 'CREATED', transaction: created };
      }

      /**
       * The key was already there. Whether that is a retry to honour or a
       * conflict to refuse is a domain judgement about the *content*, and it is
       * made by the caller — the two fields it compares never change after the
       * insert, so reading them outside the lock is safe.
       *
       * No outbox row here, deliberately: the delivery that lost the race did
       * not create anything, and enqueuing `transaction.initiated.v1` again
       * would announce a transfer's start twice for one transfer.
       */
      const existing = await client.query<TransactionRow>(
        `SELECT ${COLUMNS} FROM transactions WHERE idempotency_key = $1`,
        [transaction.idempotencyKey],
      );

      return { kind: 'EXISTS', transaction: transactionFrom(existing.rows[0]!) };
    });
  }

  public async list(input: {
    readonly ownerId: string | null;
    readonly customerId?: string;
    readonly accountId?: string;
    readonly statuses?: readonly TransactionStatus[];
    readonly from?: Date;
    readonly to?: Date;
    readonly limit: number;
  }): Promise<{ readonly transactions: readonly Transaction[]; readonly total: number }> {
    const where: string[] = [];
    const values: unknown[] = [];

    /**
     * The scope, first and non-negotiable. It is a separate clause from the
     * `customerId` *filter* below on purpose: the filter is what the caller
     * asked for and the scope is what they are allowed, so a client naming
     * somebody else's id ends up with two contradictory conditions and an empty
     * result — never a widened one.
     */
    if (input.ownerId !== null) {
      values.push(input.ownerId);
      where.push(`customer_id = $${String(values.length)}`);
    }

    if (input.customerId !== undefined) {
      values.push(input.customerId);
      where.push(`customer_id = $${String(values.length)}`);
    }

    if (input.accountId !== undefined) {
      values.push(input.accountId);
      where.push(
        `(source_account = $${String(values.length)} OR target_account = $${String(values.length)})`,
      );
    }

    /**
     * A list, not a single value: this is what lets `phaseStatus` (three
     * coarse states resolved to their member statuses in the use case) and
     * `status` (one exact state) share one SQL clause instead of two.
     */
    if (input.statuses !== undefined) {
      values.push(input.statuses);
      where.push(`status = ANY($${String(values.length)}::TEXT[])`);
    }

    /**
     * Both ends inclusive, both against `created_at`: "transfers from March"
     * means the ones requested in March, not the ones that last moved in
     * March, and `updated_at` would answer a different question.
     */
    if (input.from !== undefined) {
      values.push(input.from);
      where.push(`created_at >= $${String(values.length)}`);
    }

    if (input.to !== undefined) {
      values.push(input.to);
      where.push(`created_at <= $${String(values.length)}`);
    }

    const clause = where.length === 0 ? '' : `WHERE ${where.join(' AND ')}`;

    const [rows, count] = await Promise.all([
      this.#pool.query<TransactionRow>(
        `SELECT ${COLUMNS} FROM transactions ${clause}
          ORDER BY created_at DESC, transaction_id
          LIMIT $${String(values.length + 1)}`,
        [...values, input.limit],
      ),
      this.#pool.query<{ total: string }>(
        `SELECT COUNT(*)::TEXT AS total FROM transactions ${clause}`,
        values,
      ),
    ]);

    return {
      transactions: rows.rows.map(transactionFrom),
      total: Number(count.rows[0]?.total ?? '0'),
    };
  }

  public async stats(): Promise<{
    readonly today: number;
    readonly completedToday: number;
    readonly failedToday: number;
    readonly compensatedToday: number;
    readonly inFlight: number;
  }> {
    const counted = await this.#pool.query<{
      today: string;
      completed_today: string;
      failed_today: string;
      compensated_today: string;
      in_flight: string;
    }>(
      `SELECT COUNT(*) FILTER (WHERE created_at::date = CURRENT_DATE)::TEXT AS today,
              COUNT(*) FILTER (WHERE created_at::date = CURRENT_DATE
                                AND status = 'COMPLETED')::TEXT AS completed_today,
              COUNT(*) FILTER (WHERE created_at::date = CURRENT_DATE
                                AND status = 'FAILED')::TEXT AS failed_today,
              COUNT(*) FILTER (WHERE created_at::date = CURRENT_DATE
                                AND status = 'COMPENSATED')::TEXT AS compensated_today,
              /* Not scoped to today: a transfer stuck since yesterday is the
                 one worth seeing, and midnight must not hide it. */
              COUNT(*) FILTER (WHERE status IN ('PENDING','DEBITING','PAYMENT_PENDING'))::TEXT
                AS in_flight
         FROM transactions`,
    );

    const row = counted.rows[0];

    return {
      today: Number(row?.today ?? '0'),
      completedToday: Number(row?.completed_today ?? '0'),
      failedToday: Number(row?.failed_today ?? '0'),
      compensatedToday: Number(row?.compensated_today ?? '0'),
      inFlight: Number(row?.in_flight ?? '0'),
    };
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
        WHERE transaction_id::text = $1
           OR idempotency_key = $1
           OR correlation_id::text = $1
           OR transaction_id IN (
                SELECT transaction_id FROM transaction_aliases
                 WHERE requested_transaction_id::text = $1
              )
           OR transaction_id IN (
                SELECT transaction_id FROM transaction_events
                 WHERE payload->>'paymentId' = $1
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
    readonly outbound?: (transaction: Transaction, transition: Transition) => AppliedEffects;
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

      /**
       * The real history row for this transition (T-28), including
       * self-transitions on PAYMENT_PENDING — those are the ones that order
       * the payment, the credit and the compensation, and a history that
       * skipped them could not explain why a transfer ended up compensated.
       * Written here rather than from `transition` alone because `applied`
       * carries the transaction's own updated `updated_at`, and this row's
       * `occurred_at` should read the same moment.
       */
      await this.#recordTransition(client, input.transactionId, {
        from: transition.from,
        to: transition.status,
        eventType: input.messageType,
        failureReason: transition.failureReason,
        messageId: input.messageId,
      });

      const applied = transactionFrom(updated.rows[0]);

      /**
       * The outbox, written here alongside the state change that decided it —
       * `start` is the only other writer, and it writes only the one event
       * (`transaction.initiated.v1`) that exists before any transition has run.
       * Whatever this transition implies — the command it orders, the ending it
       * announces, the extra trail row a payment leaves — commits in this
       * transaction with the state change, or not at all. This is the
       * atomicity TD-031 was missing: there is no moment where the status
       * advanced but the message it demands was lost to a crash.
       */
      if (input.outbound !== undefined) {
        const effects = input.outbound(applied, transition);

        for (const entry of effects.trail) {
          await recordEvent(client, input.transactionId, entry.messageType, entry.payload);
        }

        for (const message of effects.dispatch) {
          await this.#writeOutbox(client, input.transactionId, message);
        }
      }

      await client.query('COMMIT');

      return {
        kind: 'APPLIED',
        transaction: applied,
        transition,
        observation: observationFrom(updated.rows[0]),
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

  public async recordPaymentAttempt(input: {
    readonly transactionId: string;
    readonly messageId: string;
    readonly messageType: string;
    readonly payload: unknown;
  }): Promise<PaymentAttemptOutcome> {
    const client = await this.#pool.connect();

    try {
      await client.query('BEGIN');

      /**
       * No `FOR UPDATE` here, unlike `applyEvent`: nothing about this write
       * depends on the row not changing between the check and the insert. The
       * check exists only so an attempt for a transaction this replica has not
       * committed yet fails closed as `UNKNOWN_TRANSACTION`, exactly as
       * `applyEvent` does for every other Saga event, rather than tripping the
       * foreign key on `transaction_events`.
       */
      const found = await client.query<TransactionRow>(
        `SELECT ${COLUMNS} FROM transactions WHERE transaction_id = $1`,
        [input.transactionId],
      );

      if (found.rowCount === 0) {
        await client.query('ROLLBACK');

        return { kind: 'UNKNOWN_TRANSACTION' };
      }

      const claimed = await client.query(
        `INSERT INTO processed_messages (message_id, message_type, transaction_id, outcome)
         VALUES ($1, $2, $3, 'RECORDED')
         ON CONFLICT (message_id) DO NOTHING`,
        [input.messageId, input.messageType, input.transactionId],
      );

      if (claimed.rowCount === 0) {
        await client.query('ROLLBACK');

        // T-5: seen before. No second row for the same rung of the ladder.
        return { kind: 'DUPLICATE' };
      }

      await recordEvent(client, input.transactionId, input.messageType, input.payload);

      await client.query('COMMIT');

      return { kind: 'RECORDED', observation: observationFrom(found.rows[0]!) };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);

      throw error;
    } finally {
      client.release();
    }
  }

  public async dispatchPendingOutbox(
    deliver: (message: OutboxMessage) => Promise<void>,
    limit: number,
  ): Promise<number> {
    const client = await this.#pool.connect();

    try {
      await client.query('BEGIN');

      /**
       * `FOR UPDATE SKIP LOCKED` is what lets two replicas sweep the same table
       * without sending anything twice: each claims a disjoint set of rows and
       * neither waits on the other. `ORDER BY id` keeps a transfer's messages in
       * the order they were written, which for the Saga is the order they must
       * arrive in.
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
         * The publish is inside the transaction on purpose. If it throws — the
         * broker is away — the whole batch rolls back, the rows stay `PENDING`,
         * and the next sweep tries again; the failure surfaces to the relay
         * rather than being swallowed. If it succeeds but this process dies
         * before the mark commits, the row is still `PENDING` and is sent again,
         * which is harmless because the envelope's `messageId` is unchanged and
         * every consumer deduplicates on it.
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
   * The payment half of the trail, folded into one answer.
   *
   * Read from what this service itself wrote down, in the order it wrote it.
   * The last decision wins, which matters when Payment Service reports several
   * attempts: `attempt: 3, FAILED` is the outcome, and the two attempts before
   * it are history rather than contradictions.
   *
   * `payment.attempt.failed.v1` folds in the same way but never *closes* the
   * outcome — a redelivery quirk that let one arrive after the terminal event
   * must not un-decide a payment that already has a verdict, so a row that
   * would regress a settled outcome back to `PENDING` is skipped rather than
   * applied. Ordinary ordering never triggers this guard: the ladder's own
   * attempts always precede the terminal event that follows them.
   */
  public async paymentOutcomeOf(transactionId: string): Promise<PaymentOutcome | null> {
    const result = await this.#pool.query<{ event_type: string; payload: PaymentEventPayload }>(
      `SELECT event_type, payload
         FROM transaction_events
        WHERE transaction_id = $1
          AND event_type IN ('payment.requested.v1', 'payment.attempt.failed.v1',
                              'payment.succeeded.v1', 'payment.failed.v1')
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
          errorType: null,
          decidedAt: null,
        };

        continue;
      }

      if (row.event_type === 'payment.attempt.failed.v1') {
        if (outcome !== null && outcome.status !== 'PENDING') {
          continue;
        }

        outcome = {
          paymentId: row.payload.paymentId,
          status: 'PENDING',
          attempt: row.payload.attempt ?? null,
          reason: row.payload.failureReason ?? null,
          errorType: row.payload.errorType ?? null,
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
        errorType: null,
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

  /**
   * The real history, newest last — the order a trace is read in.
   *
   * Read-only and unguarded, same as `paymentOutcomeOf`: a caller who may not
   * read the transaction never reaches this (`mayReadTransaction` runs first,
   * in the use case), and one who may is owed the whole trail.
   */
  public async transitionsOf(transactionId: string): Promise<readonly TransitionRecord[]> {
    const result = await this.#pool.query<TransitionRow>(
      `SELECT from_status, to_status, event_type, failure_reason, occurred_at
         FROM transaction_transitions
        WHERE transaction_id = $1
        ORDER BY id`,
      [transactionId],
    );

    return result.rows.map((row) => ({
      from: row.from_status,
      to: row.to_status,
      event: row.event_type,
      failureReason: row.failure_reason as FailureReason | null,
      occurredAt: row.occurred_at,
    }));
  }

  /** The one insert both `start` and `applyEvent` make into `transaction_transitions`. */
  async #recordTransition(
    client: PoolClient,
    transactionId: string,
    row: {
      readonly from: TransactionStatus | null;
      readonly to: TransactionStatus;
      readonly eventType: string;
      readonly failureReason: FailureReason | null;
      readonly messageId: string | null;
    },
  ): Promise<void> {
    await client.query(
      `INSERT INTO transaction_transitions
         (transaction_id, from_status, to_status, event_type, failure_reason, message_id)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [transactionId, row.from, row.to, row.eventType, row.failureReason, row.messageId],
    );
  }

  /** The one insert both `start` and `applyEvent` make into the outbox — kept in one place. */
  async #writeOutbox(
    client: PoolClient,
    transactionId: string,
    message: OutboxMessage,
  ): Promise<void> {
    await client.query(
      `INSERT INTO outbox_messages (transaction_id, exchange, routing_key, envelope, trace_context)
       VALUES ($1, $2, $3, $4::JSONB, $5)`,
      [
        transactionId,
        message.exchange,
        message.routingKey,
        JSON.stringify(message.envelope),
        // The Saga step's trace, so the relay publishes inside it (T-48).
        currentTraceparent(),
      ],
    );
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
                 status, correlation_id, idempotency_key, customer_id, reference, interbank, failure_reason,
                 payment_scenario, created_at, updated_at, completed_at,
                 requested_at, trace_context`;

interface TransactionRow {
  transaction_id: string;
  source_account: string;
  target_account: string;
  /** `NUMERIC` cast to text by the projection, never parsed by the driver. */
  amount: string;
  status: TransactionStatus;
  correlation_id: string;
  idempotency_key: string;
  customer_id: string | null;
  reference: string | null;
  interbank: {
    bankCode: string;
    account: string;
    interbankTransferId: string;
    idempotencyKey: string;
  } | null;
  failure_reason: string | null;
  payment_scenario: string | null;
  created_at: Date;
  updated_at: Date;
  completed_at: Date | null;
  /** T-43. `null` for a row from before migration 010. */
  requested_at: Date | null;
  trace_context: string | null;
}

interface TransitionRow {
  from_status: TransactionStatus | null;
  to_status: TransactionStatus;
  event_type: string;
  failure_reason: string | null;
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

interface PaymentEventPayload {
  paymentId: string;
  attempt?: number;
  failureReason?: 'PAYMENT_DECLINED' | 'PAYMENT_RETRIES_EXHAUSTED';
  /** Only `payment.attempt.failed.v1` carries this. */
  errorType?: 'TRANSIENT' | 'PERMANENT';
  succeededAt?: string;
  failedAt?: string;
}

/**
 * What the telemetry needs beyond the state. A row from before migration 010
 * has neither column, and falls back to when it was created and to no trace.
 */
function observationFrom(row: TransactionRow): TransferObservation {
  return { requestedAt: row.requested_at ?? row.created_at, traceContext: row.trace_context };
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
    customerId: row.customer_id,
    reference: row.reference,
    interbank: row.interbank,
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
