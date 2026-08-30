import type { Pool } from 'pg';

/**
 * The schema, as ordered statements applied once each.
 *
 * Migrations are plain SQL run at boot rather than a migration tool, and that
 * is a deliberate size decision: this service owns four tables that no other
 * service may read (constitution II), and a tool would add a dependency, a CLI
 * and a second place where the schema is described.
 *
 * Each migration is recorded by name in `schema_migrations`, so a restart
 * applies nothing and a new statement applies only itself.
 */
export interface Migration {
  readonly name: string;
  readonly statements: readonly string[];
}

export const MIGRATIONS: readonly Migration[] = [
  {
    name: '001_customers',
    statements: [
      `CREATE TABLE IF NOT EXISTS customers (
         customer_id       UUID PRIMARY KEY,
         full_name         VARCHAR(200) NOT NULL,
         document_number   VARCHAR(50)  NOT NULL UNIQUE,
         email             VARCHAR(320) NOT NULL UNIQUE,
         birth_date        DATE         NOT NULL,
         address           VARCHAR(300),
         username          VARCHAR(60)  NOT NULL UNIQUE,
         identity_status   VARCHAR(20)  NOT NULL DEFAULT 'PENDING',
         role              VARCHAR(20)  NOT NULL DEFAULT 'CLIENTE',
         status            VARCHAR(20)  NOT NULL DEFAULT 'PENDING_ACTIVATION',
         password_hash     VARCHAR(255) NOT NULL,
         email_verified_at TIMESTAMPTZ,
         created_at        TIMESTAMPTZ  NOT NULL DEFAULT now(),
         updated_at        TIMESTAMPTZ  NOT NULL DEFAULT now(),
         CONSTRAINT customers_role_known
           CHECK (role IN ('CLIENTE', 'CAJERO_RECEPTOR', 'ADMINISTRADOR')),
         CONSTRAINT customers_identity_status_known
           CHECK (identity_status IN ('PENDING', 'VALIDATED', 'REJECTED')),
         /*
          * C-4 in the database, not only in the entity: ACTIVE and a verified
          * email are the same fact, and a bug that set one without the other
          * would produce an account that can sign in with no verified address.
          */
         CONSTRAINT customers_active_iff_verified
           CHECK ((status = 'ACTIVE') = (email_verified_at IS NOT NULL))
       )`,
      /*
       * Lower-cased email uniqueness. The application normalises before it
       * writes, and this makes the normalisation unnecessary to trust.
       */
      `CREATE UNIQUE INDEX IF NOT EXISTS customers_email_lower_key
         ON customers (LOWER(email))`,
    ],
  },
  {
    name: '002_identity_documents',
    statements: [
      `CREATE TABLE IF NOT EXISTS identity_documents (
         document_id       UUID PRIMARY KEY,
         customer_id       UUID NOT NULL REFERENCES customers (customer_id) ON DELETE CASCADE,
         original_filename VARCHAR(255),
         mime_type         VARCHAR(100) NOT NULL,
         size_bytes        INTEGER      NOT NULL,
         sha256            CHAR(64)     NOT NULL,
         content           BYTEA        NOT NULL,
         validation_status VARCHAR(20)  NOT NULL,
         created_at        TIMESTAMPTZ  NOT NULL DEFAULT now(),
         CONSTRAINT identity_documents_size_within_ceiling
           CHECK (size_bytes > 0 AND size_bytes <= 5242880)
       )`,
      `CREATE INDEX IF NOT EXISTS identity_documents_customer_idx
         ON identity_documents (customer_id)`,
      /*
       * The same photograph cannot back two identities. Enforced here rather
       * than by a read-then-write, which two concurrent registrations would
       * both pass.
       */
      `CREATE UNIQUE INDEX IF NOT EXISTS identity_documents_sha256_key
         ON identity_documents (sha256)`,
    ],
  },
  {
    name: '003_email_activation_tokens',
    statements: [
      `CREATE TABLE IF NOT EXISTS email_activation_tokens (
         token_id    UUID PRIMARY KEY,
         customer_id UUID NOT NULL REFERENCES customers (customer_id) ON DELETE CASCADE,
         /* The digest, never the token. A dump of this table opens no account. */
         token_hash  CHAR(64)    NOT NULL UNIQUE,
         expires_at  TIMESTAMPTZ NOT NULL,
         used_at     TIMESTAMPTZ,
         created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
       )`,
      `CREATE INDEX IF NOT EXISTS email_activation_tokens_customer_idx
         ON email_activation_tokens (customer_id)`,
    ],
  },
  {
    name: '004_processed_messages',
    statements: [
      `CREATE TABLE IF NOT EXISTS processed_messages (
         message_id      UUID PRIMARY KEY,
         idempotency_key VARCHAR(200) NOT NULL,
         message_type    VARCHAR(120) NOT NULL,
         result_summary  JSONB        NOT NULL,
         processed_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
         /*
          * The whole idempotency guarantee, in one line. Two deliveries of the
          * same command race to insert this row and exactly one wins.
          */
         CONSTRAINT processed_messages_once UNIQUE (idempotency_key, message_type)
       )`,
    ],
  },
  {
    /*
     * Optimistic-concurrency version for the customers table. Two concurrent
     * updates to the same customer would otherwise read the same row and the
     * second write would silently revert the first (lost update). The update
     * now guards `WHERE version = <read>` and bumps it; a losing write matches
     * no row, rolls back and is retried by the broker against fresh data.
     */
    name: '005_customers_version',
    statements: [
      `ALTER TABLE customers ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 0`,
    ],
  },
  {
    /*
     * The password-recovery tokens, for the prototype's `P-07`.
     *
     * Deliberately a **second table** rather than a `purpose` column on
     * `email_activation_tokens`. The two tokens look alike and are not alike: an
     * activation token proves an address was reachable and makes an account
     * usable, a reset token replaces a credential. Sharing a table would mean a
     * bug in either lookup could spend the other kind, and the shorter life this
     * one gets — an hour, not a day — would have to be enforced by whoever
     * remembered to pass the right expiry.
     */
    name: '006_password_reset_tokens',
    statements: [
      `CREATE TABLE IF NOT EXISTS password_reset_tokens (
         token_id    UUID PRIMARY KEY,
         customer_id UUID NOT NULL REFERENCES customers (customer_id) ON DELETE CASCADE,
         /* The digest, never the token. A dump of this table changes no password. */
         token_hash  CHAR(64)    NOT NULL UNIQUE,
         expires_at  TIMESTAMPTZ NOT NULL,
         used_at     TIMESTAMPTZ,
         created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
       )`,
      /*
       * Issuing a new link invalidates the outstanding ones (the fix US7 made
       * for activation tokens, applied here from the start), and spending one
       * burns every live token for that customer. Both are a write over this
       * index.
       */
      `CREATE INDEX IF NOT EXISTS password_reset_tokens_customer_idx
         ON password_reset_tokens (customer_id) WHERE used_at IS NULL`,
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
       * other sees zero rows and skips. Without it they would both run the
       * DDL, and the loser would fail on a duplicate index.
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
