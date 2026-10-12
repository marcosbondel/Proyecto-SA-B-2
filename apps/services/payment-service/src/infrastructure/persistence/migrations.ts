import type { Pool } from 'pg';

/**
 * The schema, as ordered statements applied once each.
 *
 * Plain SQL at boot rather than a migration tool, matching the other four
 * services and for the same reason: this service owns two tables that no other
 * service may read (constitution II), and a tool would add a dependency, a CLI
 * and a second place where the schema is described.
 *
 * The money column is `NUMERIC(14,2)`, never a float, and it is read back as
 * text and split on the decimal point rather than multiplied by a hundred in
 * Node — see `domain/money.ts`.
 */
export interface Migration {
  readonly name: string;
  readonly statements: readonly string[];
}

export const MIGRATIONS: readonly Migration[] = [
  {
    name: '001_payments',
    statements: [
      `CREATE TABLE IF NOT EXISTS payments (
         /*
          * Minted by Transaction Service and carried in the command. That is
          * what makes the primary key the deduplication: two deliveries of one
          * payment.requested.v1 race to insert and exactly one wins, so a
          * redelivery cannot become a second charge. Generating it here would
          * mean a redelivery produced a second payment for one transfer.
          */
         payment_id           UUID PRIMARY KEY,
         /*
          * A reference, deliberately with no foreign key: the transaction lives
          * in another service's database and a constraint across that boundary
          * is the coupling constitution II exists to prevent (§8.2, 2.3).
          */
         transaction_id       UUID          NOT NULL,
         amount               NUMERIC(14,2) NOT NULL,
         status               VARCHAR(20)   NOT NULL DEFAULT 'PENDING',
         /* The number of the last attempt made. NULL before the first one. */
         attempt              INTEGER,
         error_type           VARCHAR(20),
         failure_reason       TEXT,
         provider_reference   VARCHAR(100),
         /* Demonstration only. Chosen by whoever requested the transfer. */
         scenario             VARCHAR(20),
         /* The correlation the transfer began under, kept for the audit trail. */
         origin_correlation_id UUID,
         /* When the next attempt is owed. NULL when none is. */
         next_attempt_at      TIMESTAMPTZ,
         created_at           TIMESTAMPTZ   NOT NULL DEFAULT now(),
         updated_at           TIMESTAMPTZ   NOT NULL DEFAULT now(),
         decided_at           TIMESTAMPTZ,

         CONSTRAINT payments_status_known
           CHECK (status IN ('PENDING','SUCCEEDED','FAILED')),
         CONSTRAINT payments_error_type_known
           CHECK (error_type IS NULL OR error_type IN ('TRANSIENT','PERMANENT')),
         CONSTRAINT payments_failure_reason_known
           CHECK (failure_reason IS NULL
                  OR failure_reason IN ('PAYMENT_DECLINED','PAYMENT_RETRIES_EXHAUSTED')),
         CONSTRAINT payments_scenario_known
           CHECK (scenario IS NULL OR scenario IN ('APPROVE','REJECT','TRANSIENT_FAILURE')),
         CONSTRAINT payments_amount_positive CHECK (amount > 0),
         /*
          * The three invariants the domain also enforces, written here so the
          * database holds without it — and so a bug in the use case surfaces as
          * a refused write rather than as a payment that says two things at
          * once.
          */
         CONSTRAINT payments_settled_has_decision
           CHECK ((status = 'PENDING') = (decided_at IS NULL)),
         CONSTRAINT payments_failed_has_reason
           CHECK ((status = 'FAILED') = (failure_reason IS NOT NULL)),
         CONSTRAINT payments_succeeded_has_reference
           CHECK ((status = 'SUCCEEDED') = (provider_reference IS NOT NULL)),
         /* Nothing settled is owed another attempt. */
         CONSTRAINT payments_settled_is_not_due
           CHECK (status = 'PENDING' OR next_attempt_at IS NULL)
       )`,

      /*
       * One payment per transfer. The Saga orders exactly one payment per
       * transaction, and a second row for the same transfer would mean either a
       * duplicated Saga step or a `paymentId` collision — both worth refusing
       * at the column rather than discovering in a listing.
       */
      `CREATE UNIQUE INDEX IF NOT EXISTS payments_transaction_key
         ON payments (transaction_id)`,

      /*
       * The sweeper's index. Partial, because only PENDING rows are ever due
       * and an index over settled payments would grow forever while answering
       * nothing.
       */
      `CREATE INDEX IF NOT EXISTS payments_due_idx
         ON payments (next_attempt_at)
         WHERE status = 'PENDING' AND next_attempt_at IS NOT NULL`,

      `CREATE INDEX IF NOT EXISTS payments_status_idx ON payments (status)`,
    ],
  },
  {
    name: '002_payment_attempts',
    statements: [
      /*
       * Every attempt, written down whether it worked or not.
       *
       * Append-only by discipline: nothing updates a row here. It is what lets
       * the interface draw the ladder that was actually climbed rather than the
       * one the counter implies — four rows and a count of four look the same
       * until a replica retried out of order.
       */
      `CREATE TABLE IF NOT EXISTS payment_attempts (
         payment_id     UUID        NOT NULL REFERENCES payments (payment_id) ON DELETE CASCADE,
         attempt_number INTEGER     NOT NULL,
         result         VARCHAR(20) NOT NULL,
         error_type     VARCHAR(20),
         failure_reason TEXT,
         occurred_at    TIMESTAMPTZ NOT NULL DEFAULT now(),

         PRIMARY KEY (payment_id, attempt_number),
         CONSTRAINT payment_attempts_result_known
           CHECK (result IN ('SUCCEEDED','FAILED')),
         CONSTRAINT payment_attempts_error_type_known
           CHECK (error_type IS NULL OR error_type IN ('TRANSIENT','PERMANENT')),
         /* A successful attempt has nothing to explain. */
         CONSTRAINT payment_attempts_success_is_clean
           CHECK (result = 'FAILED' OR (error_type IS NULL AND failure_reason IS NULL))
       )`,
    ],
  },
  {
    name: '003_outbox_messages',
    statements: [
      /*
       * The transactional outbox (TD-047). Every event this service publishes —
       * the terminal `payment.succeeded`/`payment.failed`, and the
       * `payment.attempt.failed` for each rung of the ladder — is written here,
       * in the same transaction as the attempt that produced it, rather than
       * published straight to the broker afterwards. That window, between
       * committing an attempt and publishing its event, is where a crash used to
       * leave a payment settled in this database and a Saga that never heard —
       * the money debited and nothing on its way to finish or refund it. Now the
       * event and the attempt commit together, and a relay sweeps `PENDING` rows.
       *
       * The whole envelope is stored, so the relay republishes it byte-for-byte:
       * a `messageId` minted afresh at relay time would be a new message to
       * Transaction Service's and the audit's deduplication, and the terminal
       * event delivered twice could compensate a debit that had already been
       * credited. Storing the envelope is what keeps a redelivered relay safe.
       */
      `CREATE TABLE IF NOT EXISTS outbox_messages (
         id              BIGSERIAL    PRIMARY KEY,
         payment_id      UUID         NOT NULL REFERENCES payments (payment_id) ON DELETE CASCADE,
         exchange        VARCHAR(120) NOT NULL,
         routing_key     VARCHAR(200) NOT NULL,
         envelope        JSONB        NOT NULL,
         dispatch_status VARCHAR(20)  NOT NULL DEFAULT 'PENDING',
         created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
         published_at    TIMESTAMPTZ,
         CONSTRAINT outbox_messages_status_known
           CHECK (dispatch_status IN ('PENDING','DISPATCHED'))
       )`,
      `CREATE INDEX IF NOT EXISTS outbox_messages_pending_idx
         ON outbox_messages (id) WHERE dispatch_status = 'PENDING'`,
    ],
  },
  {
    /*
     * T-29: the simulated provider gains a third answer, `TIMEOUT`, alongside
     * `APPROVE` and `REJECT`/`TRANSIENT_FAILURE`. Widening `payments_scenario_known`
     * needs DROP + ADD rather than an edit to `001_payments`, because the
     * migration ledger (`schema_migrations`) makes `001` a no-op on a database
     * that already applied it — the constraint it created would never change.
     *
     * `payment_attempts` gains its own column: what the provider answered on
     * that rung, distinct from `result` (which only says whether the *policy*
     * treated the attempt as settled or retryable) and from `error_type` (which
     * says nothing when the attempt succeeded). Nullable, because an attempt
     * recorded before this migration has no such answer to report.
     */
    name: '004_payment_provider_simulation',
    statements: [
      `ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_scenario_known`,
      `ALTER TABLE payments ADD CONSTRAINT payments_scenario_known
         CHECK (scenario IS NULL OR scenario IN ('APPROVE','REJECT','TRANSIENT_FAILURE','TIMEOUT'))`,
      `ALTER TABLE payment_attempts ADD COLUMN IF NOT EXISTS provider_result VARCHAR(20)`,
      `ALTER TABLE payment_attempts DROP CONSTRAINT IF EXISTS payment_attempts_provider_result_known`,
      `ALTER TABLE payment_attempts ADD CONSTRAINT payment_attempts_provider_result_known
         CHECK (provider_result IS NULL OR provider_result IN ('SUCCESS','FAILURE','TIMEOUT'))`,
    ],
  },
  {
    /*
     * The administrator's override of the simulated provider (T-44).
     *
     * **At most one row**, which `id = 1` enforces rather than hopes for: there
     * is one simulation per bank, and a second row would be two answers to "how
     * is the provider set up". It lives here, and not in memory, because the HPA
     * can run up to five replicas and a value held by one of them is a value the
     * other four do not have. No row means the ConfigMap's values are in force,
     * which is why a reset is a `DELETE` and not an `UPDATE` back to defaults
     * this table would have to know.
     *
     * `DOUBLE PRECISION` and not `NUMERIC`: a rate of 12.5 % must come back as
     * 12.5, and the two-decimal rounding of a fixed scale could push two rates
     * that add up to exactly 100 over it.
     */
    name: '005_payment_simulation_settings',
    statements: [
      `CREATE TABLE IF NOT EXISTS payment_simulation_settings (
         id                   SMALLINT PRIMARY KEY DEFAULT 1,
         failure_rate_percent DOUBLE PRECISION NOT NULL,
         timeout_rate_percent DOUBLE PRECISION NOT NULL,
         latency_ms           INTEGER NOT NULL,
         updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),

         CONSTRAINT payment_simulation_single_row CHECK (id = 1),
         CONSTRAINT payment_simulation_rates_in_range
           CHECK (failure_rate_percent BETWEEN 0 AND 100
              AND timeout_rate_percent BETWEEN 0 AND 100
              AND failure_rate_percent + timeout_rate_percent <= 100),
         CONSTRAINT payment_simulation_latency_in_range
           CHECK (latency_ms BETWEEN 0 AND 30000)
       )`,
    ],
  },
  {
    /*
     * T-48: the W3C `traceparent` that was active when a row was written, so
     * work that happens later, from a timer, continues the trace that caused it
     * instead of starting a new one.
     *
     * - `outbox_messages.trace_context`: the relay publishes each event inside
     *   the context of the attempt that wrote it.
     * - `payments.trace_context`: the retry sweep runs each later rung of the
     *   1 s / 5 s / 30 s ladder as a step of the trace in which the payment
     *   was opened — the Saga's trace.
     *
     * Nullable, and `NULL` means what it always meant: no SDK was recording
     * when the row was written, so there is no trace to continue.
     * `VARCHAR(80)` holds a version-00 traceparent (55 characters) with room.
     */
    name: '006_trace_context',
    statements: [
      `ALTER TABLE payments ADD COLUMN IF NOT EXISTS trace_context VARCHAR(80)`,
      `ALTER TABLE outbox_messages ADD COLUMN IF NOT EXISTS trace_context VARCHAR(80)`,
    ],
  },
];

/**
 * Applies whatever has not been applied, and reports what it did.
 *
 * The ledger is a table of its own so a redeploy is a no-op rather than a
 * failed `CREATE`. `IF NOT EXISTS` alone would not be enough: a statement that
 * alters an existing table has no such clause, and the ledger is what stops it
 * running twice.
 */
export async function migrate(pool: Pool): Promise<readonly string[]> {
  await pool.query(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
       name       TEXT PRIMARY KEY,
       applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
     )`,
  );

  const applied: string[] = [];

  for (const migration of MIGRATIONS) {
    const seen = await pool.query('SELECT 1 FROM schema_migrations WHERE name = $1', [
      migration.name,
    ]);

    if (seen.rowCount !== null && seen.rowCount > 0) {
      continue;
    }

    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      for (const statement of migration.statements) {
        await client.query(statement);
      }

      await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [migration.name]);
      await client.query('COMMIT');
      applied.push(migration.name);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  return applied;
}
