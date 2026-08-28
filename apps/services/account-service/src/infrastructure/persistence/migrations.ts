import type { Pool } from 'pg';

/**
 * The schema, as ordered statements applied once each.
 *
 * Plain SQL at boot rather than a migration tool, matching `customer-service`
 * and for the same reason: this service owns four tables that no other service
 * may read (constitution II), and a tool would add a dependency, a CLI and a
 * second place where the schema is described.
 *
 * The money column is `NUMERIC(14,2)`, never a float. It is read as `TEXT` and
 * split on the decimal point rather than multiplied by a hundred in Node, which
 * would reintroduce exactly the binary-floating-point error that choosing
 * `NUMERIC` was meant to avoid.
 */
export interface Migration {
  readonly name: string;
  readonly statements: readonly string[];
}

export const MIGRATIONS: readonly Migration[] = [
  {
    name: '001_accounts',
    statements: [
      `CREATE TABLE IF NOT EXISTS accounts (
         account_id       UUID PRIMARY KEY,
         /*
          * A reference, deliberately with no foreign key: the customer lives in
          * another service's database and a constraint across that boundary is
          * the coupling constitution II exists to prevent (§8.2, 2.3).
          */
         customer_id      UUID          NOT NULL,
         account_type     VARCHAR(10)   NOT NULL,
         balance          NUMERIC(14,2) NOT NULL DEFAULT 0.00,
         status           VARCHAR(10)   NOT NULL DEFAULT 'ACTIVE',
         /* Last confirmed movement, not last read (A-4). */
         last_activity_at TIMESTAMPTZ   NOT NULL DEFAULT now(),
         /* Optimistic lock. Every accepted movement advances it by one. */
         version          INT           NOT NULL DEFAULT 0,
         created_at       TIMESTAMPTZ   NOT NULL DEFAULT now(),
         updated_at       TIMESTAMPTZ   NOT NULL DEFAULT now(),
         CONSTRAINT accounts_type_known
           CHECK (account_type IN ('MONETARIA', 'AHORRO')),
         CONSTRAINT accounts_status_known
           CHECK (status IN ('ACTIVE', 'INACTIVE')),
         /*
          * The last line of defence for the invariant this service exists to
          * protect. The domain refuses a negative balance and the row lock
          * makes that refusal hold under concurrency; this makes it hold even
          * if both of those are wrong.
          */
         CONSTRAINT accounts_balance_not_negative CHECK (balance >= 0)
       )`,
      `CREATE INDEX IF NOT EXISTS accounts_customer_idx ON accounts (customer_id)`,
      /*
       * The deactivation job's selecting predicate, in the order it filters:
       * active accounts first, then by how long they have been still. Without
       * it the job is a sequential scan of every account in the bank, run daily.
       */
      `CREATE INDEX IF NOT EXISTS accounts_inactivity_idx
         ON accounts (status, last_activity_at)`,
    ],
  },
  {
    name: '002_account_operations',
    statements: [
      `CREATE TABLE IF NOT EXISTS account_operations (
         operation_id    UUID PRIMARY KEY,
         account_id      UUID          NOT NULL REFERENCES accounts (account_id),
         type            VARCHAR(20)   NOT NULL,
         amount          NUMERIC(14,2) NOT NULL,
         /*
          * The balance as it stood after this movement, stored rather than
          * recomputed. A statement whose running total is derived at display
          * time disagrees with the ledger the moment two movements share a
          * timestamp, and the reader cannot tell which number is real.
          */
         balance_after   NUMERIC(14,2) NOT NULL,
         transaction_id  UUID,
         status          VARCHAR(20)   NOT NULL DEFAULT 'APPLIED',
         idempotency_key VARCHAR(200)  NOT NULL,
         created_at      TIMESTAMPTZ   NOT NULL DEFAULT now(),
         CONSTRAINT account_operations_type_known
           CHECK (type IN ('DEBIT', 'CREDIT', 'COMPENSATION')),
         CONSTRAINT account_operations_status_known
           CHECK (status IN ('APPLIED', 'COMPENSATED')),
         CONSTRAINT account_operations_amount_positive CHECK (amount > 0),
         /*
          * The ticket's rule, in one line: unique per (idempotency_key, type).
          * Per *type* and not per key alone, because a debit and its
          * compensation legitimately share the Saga's key while being two
          * different movements.
          */
         CONSTRAINT account_operations_once UNIQUE (idempotency_key, type)
       )`,
      `CREATE INDEX IF NOT EXISTS account_operations_account_idx
         ON account_operations (account_id, created_at DESC)`,
      `CREATE INDEX IF NOT EXISTS account_operations_transaction_idx
         ON account_operations (transaction_id)`,
    ],
  },
  {
    name: '003_processed_messages',
    statements: [
      `CREATE TABLE IF NOT EXISTS processed_messages (
         message_id      UUID PRIMARY KEY,
         idempotency_key VARCHAR(200) NOT NULL,
         message_type    VARCHAR(120) NOT NULL,
         result_summary  JSONB        NOT NULL,
         processed_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
         /*
          * The whole idempotency guarantee. Two deliveries of the same command
          * race to insert this row and exactly one wins — which is a fact about
          * the database, not a hope about timing.
          */
         CONSTRAINT processed_messages_once UNIQUE (idempotency_key, message_type)
       )`,
    ],
  },
  {
    name: '004_deactivation_runs',
    statements: [
      /*
       * The automatic process has to be auditable, which means "it ran and
       * deactivated nothing" must be distinguishable from "it did not run".
       * A count of zero is a row here; a missing night is a missing row.
       */
      `CREATE TABLE IF NOT EXISTS deactivation_runs (
         run_id             UUID PRIMARY KEY,
         executed_at        TIMESTAMPTZ NOT NULL,
         threshold_at       TIMESTAMPTZ NOT NULL,
         min_balance_minor  BIGINT      NOT NULL,
         deactivated_count  INT         NOT NULL,
         created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
       )`,
    ],
  },
  {
    /*
     * Business-identity dedup, behind the transport-level (idempotency_key,
     * type) guard. A transfer has exactly one DEBIT, one CREDIT and one
     * COMPENSATION, so at most one movement of each type may exist per
     * transaction. If a movement is re-published under a fresh envelope — the
     * PAYMENT_SUCCEEDED-twice bug this feature also fixes upstream — the second
     * insert violates this and its transaction rolls back, so the balance
     * cannot move twice for the same transfer even if the message-level guard
     * is bypassed. A backstop, not the primary guard.
     */
    name: '005_account_operations_transaction_once',
    statements: [
      `CREATE UNIQUE INDEX IF NOT EXISTS account_operations_transaction_type_once
         ON account_operations (transaction_id, type)
         WHERE transaction_id IS NOT NULL`,
    ],
  },
];

/** Applies whatever has not been applied yet. Safe to run on every boot. */
export async function migrate(pool: Pool): Promise<readonly string[]> {
  await pool.query(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
       name       VARCHAR(120) PRIMARY KEY,
       applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
     )`,
  );

  const applied: string[] = [];

  for (const migration of MIGRATIONS) {
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      /**
       * `ON CONFLICT DO NOTHING` plus `rowCount` is the lock: two instances
       * booting together both reach this line, one inserts and applies, the
       * other sees zero rows and skips. Without it they would both run the DDL
       * and the loser would fail on a duplicate index.
       */
      const claim = await client.query(
        'INSERT INTO schema_migrations (name) VALUES ($1) ON CONFLICT DO NOTHING',
        [migration.name],
      );

      if (claim.rowCount === 0) {
        await client.query('ROLLBACK');
        continue;
      }

      for (const statement of migration.statements) {
        await client.query(statement);
      }

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
