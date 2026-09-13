import type { Pool } from 'pg';

/**
 * The schema, as ordered statements applied once each.
 *
 * Plain SQL at boot rather than a migration tool, matching the three services
 * built before this one and for the same reason: this service owns three tables
 * that no other service may read (constitution II), and a tool would add a
 * dependency, a CLI and a second place where the schema is described.
 *
 * Nothing here holds money. This is the one service in the bank whose tables
 * carry no balance and no amount — by the time a payload reaches `payload`, the
 * redaction in `domain/redaction.ts` has already replaced every amount with a
 * marker. That is deliberate: a database that hears every event in the system
 * is the last one that should also be a ledger.
 */
export interface Migration {
  readonly name: string;
  readonly statements: readonly string[];
}

export const MIGRATIONS: readonly Migration[] = [
  {
    name: '001_audit_events',
    statements: [
      /*
       * The trail. **Append-only**: nothing in this service updates a row here
       * and nothing deletes one. An audit record that can be edited is not
       * evidence, and the whole value of this table is that it is the one place
       * in the bank where the record of what happened cannot be revised by the
       * service that made it happen.
       */
      `CREATE TABLE IF NOT EXISTS audit_events (
         /* The envelope's messageId. This system's eventId. */
         event_id          UUID         NOT NULL,
         message_type      VARCHAR(100) NOT NULL,
         message_version   INT          NOT NULL,
         producer          VARCHAR(100) NOT NULL,
         /* The producer's clock, and ours. They differ, and both matter. */
         occurred_at       TIMESTAMPTZ  NOT NULL,
         received_at       TIMESTAMPTZ  NOT NULL DEFAULT now(),
         /* Originated by the Gateway, propagated end to end, never regenerated. */
         correlation_id    UUID         NOT NULL,
         causation_id      UUID,
         /*
          * Already redacted when it gets here. The raw payload is never stored:
          * five services keep personal and financial data apart on purpose, and
          * a trail of verbatim payloads would reassemble all of it in the one
          * database every administrator can read.
          */
         payload           JSONB        NOT NULL,
         processing_status VARCHAR(20)  NOT NULL,
         /* Which family queue delivered it. Half of the deduplication key. */
         consumer          VARCHAR(60)  NOT NULL,
         /*
          * Criterion 2, as a constraint rather than a check-then-insert. Two
          * replicas draining the same queue can both find nothing and both
          * insert; only the database can arbitrate that. Keyed by the pair the
          * ticket names, so a message legitimately delivered to two family
          * queues is recorded twice — once per consumer — and the redelivery
          * that matters is still refused.
          */
         CONSTRAINT audit_events_once_per_consumer PRIMARY KEY (event_id, consumer),
         CONSTRAINT audit_events_status_known
           CHECK (processing_status IN ('PROCESSED','INVALID','ERROR'))
       )`,
      /* The one index that matters: every read of this table is by correlation. */
      `CREATE INDEX IF NOT EXISTS audit_events_correlation_idx
         ON audit_events (correlation_id, occurred_at)`,
      /* For the operator asking "what has customer-service been publishing". */
      `CREATE INDEX IF NOT EXISTS audit_events_type_idx
         ON audit_events (message_type, occurred_at DESC)`,
    ],
  },
  {
    name: '002_notifications',
    statements: [
      /*
       * What the bank told somebody. Simulated: no mail leaves this system
       * (§4.1), and `status` records what the simulated adapter decided rather
       * than what a mail server confirmed.
       */
      `CREATE TABLE IF NOT EXISTS notifications (
         notification_id UUID PRIMARY KEY,
         type            VARCHAR(50)  NOT NULL,
         channel         VARCHAR(20)  NOT NULL DEFAULT 'EMAIL',
         /* Derived, never copied from an email field. See domain/notification.ts. */
         recipient       VARCHAR(200),
         /* The transaction, account or customer. A reference, never a foreign key. */
         reference_id    UUID,
         subject         VARCHAR(200) NOT NULL,
         status          VARCHAR(20)  NOT NULL DEFAULT 'PENDING',
         correlation_id  UUID         NOT NULL,
         /*
          * The event that caused it. Not null in practice and nullable in the
          * schema: audit_events is keyed by a pair rather than a single column,
          * so a foreign key here would buy a composite constraint for no
          * additional guarantee.
          */
         caused_by       UUID,
         created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
         processed_at    TIMESTAMPTZ,
         CONSTRAINT notifications_status_known
           CHECK (status IN ('PENDING','SENT','FAILED')),
         CONSTRAINT notifications_channel_known CHECK (channel IN ('EMAIL')),
         /*
          * A settled notification has a timestamp and a pending one does not.
          * Without this, a row could claim to have been sent at no particular
          * moment, which is the kind of record that makes an audit useless.
          */
         CONSTRAINT notifications_processed_when_settled
           CHECK ((status = 'PENDING') = (processed_at IS NULL))
       )`,
      `CREATE INDEX IF NOT EXISTS notifications_correlation_idx
         ON notifications (correlation_id, created_at)`,
      `CREATE INDEX IF NOT EXISTS notifications_recent_idx
         ON notifications (created_at DESC)`,
      /*
       * Criterion 2 again, for the other half. The unique key on
       * `audit_events` already stops a redelivery from reaching the insert, but
       * that is an argument about control flow and this is a fact about the
       * table: one event causes at most one notification, whatever any future
       * handler believes.
       */
      `CREATE UNIQUE INDEX IF NOT EXISTS notifications_one_per_event_idx
         ON notifications (caused_by, type) WHERE caused_by IS NOT NULL`,
    ],
  },
  {
    name: '003_processed_messages',
    statements: [
      /*
       * The consumption log the ticket asks for, and it is **not** the
       * deduplication key — `audit_events` is, because that table is the thing
       * a duplicate must not appear in twice. This one answers the operational
       * question the other cannot: how many times did we see this message, and
       * when did we last see it. A redelivery that was correctly refused leaves
       * no trace in an append-only trail, and "the retry ladder is climbing"
       * then looks exactly like "nothing is happening".
       */
      `CREATE TABLE IF NOT EXISTS processed_messages (
         message_id   UUID         NOT NULL,
         consumer     VARCHAR(60)  NOT NULL,
         message_type VARCHAR(120) NOT NULL,
         outcome      VARCHAR(30)  NOT NULL,
         deliveries   INT          NOT NULL DEFAULT 1,
         first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
         last_seen_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
         PRIMARY KEY (message_id, consumer)
       )`,
    ],
  },
  {
    /*
     * The two columns `N-01` needed, and the two TD-041 said did not exist.
     *
     * The prototype's notification centre is a **customer's inbox** with a
     * read state; what this service had was a staff console. Neither piece was
     * a small omission: no row said whose notification it was, and nothing
     * anywhere recorded that somebody had read something.
     *
     * `customer_id` was not missing information — it was information this
     * service was already computing and throwing away. `RecordEventUseCase`
     * derives the subject to build the simulated recipient; it now writes it
     * down too. Nullable, because a notification with no subject is a real
     * case: the nightly deactivation job has nobody in its envelope.
     *
     * `read_at` is a timestamp rather than a boolean so "when" survives, which
     * is the only version of this column worth having in a service whose job is
     * to record what happened.
     */
    name: '004_notifications_inbox',
    statements: [
      `ALTER TABLE notifications ADD COLUMN IF NOT EXISTS customer_id UUID`,
      `ALTER TABLE notifications ADD COLUMN IF NOT EXISTS read_at TIMESTAMPTZ`,
      /*
       * The inbox's own query: one person's notifications, newest first. A
       * partial index on the unread ones would not help — an inbox shows both —
       * so this is the whole listing, ordered the way it is read.
       */
      `CREATE INDEX IF NOT EXISTS notifications_customer_idx
         ON notifications (customer_id, created_at DESC)`,
    ],
  },
  {
    /*
     * §4.1's classification (T-30): INFO/WARNING/ERROR, computed once by
     * `domain/classification.ts` and written down rather than recomputed on
     * read.
     *
     * **Nullable, with no `DEFAULT` and no backfill.** A `DEFAULT 'INFO'`
     * would assert a classification nobody computed over rows that predate
     * this column — some of which may have been compensations, i.e. exactly
     * the events this axis calls `ERROR`. And an `UPDATE` to backfill it would
     * break the one guarantee `audit_events` exists to keep: this table is
     * append-only, and nothing in this service updates a row in it (see the
     * top of this file). `NULL` on an old row means "recorded before this
     * classification existed", which is the honest answer; every row inserted
     * from here on always supplies one.
     */
    name: '005_event_severity',
    statements: [
      `ALTER TABLE audit_events ADD COLUMN IF NOT EXISTS severity VARCHAR(10)`,
      `ALTER TABLE audit_events ADD CONSTRAINT audit_events_severity_known
         CHECK (severity IS NULL OR severity IN ('INFO','WARNING','ERROR'))`,
      `CREATE INDEX IF NOT EXISTS audit_events_severity_idx
         ON audit_events (severity, occurred_at DESC)`,
      `ALTER TABLE notifications ADD COLUMN IF NOT EXISTS severity VARCHAR(10)`,
      `ALTER TABLE notifications ADD CONSTRAINT notifications_severity_known
         CHECK (severity IS NULL OR severity IN ('INFO','WARNING','ERROR'))`,
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
