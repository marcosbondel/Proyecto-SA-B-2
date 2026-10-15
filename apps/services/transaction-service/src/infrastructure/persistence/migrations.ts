import type { Pool } from 'pg';

/**
 * The schema, as ordered statements applied once each.
 *
 * Plain SQL at boot rather than a migration tool, matching `customer-service`
 * and `account-service` and for the same reason: this service owns four tables
 * that no other service may read (constitution II), and a tool would add a
 * dependency, a CLI and a second place where the schema is described.
 *
 * The money column is `NUMERIC(14,2)`, never a float, and it is read back as
 * text and split on the decimal point rather than multiplied by a hundred in
 * Node — which would reintroduce exactly the binary-floating-point error that
 * choosing `NUMERIC` was meant to avoid.
 */
export interface Migration {
  readonly name: string;
  readonly statements: readonly string[];
}

export const MIGRATIONS: readonly Migration[] = [
  {
    name: '001_transactions',
    statements: [
      `CREATE TABLE IF NOT EXISTS transactions (
         transaction_id   UUID PRIMARY KEY,
         /*
          * References, deliberately with no foreign key: both accounts live in
          * another service's database and a constraint across that boundary is
          * the coupling constitution II exists to prevent (§8.2, 2.3). This
          * service never resolves them and never reads a balance.
          */
         source_account   UUID          NOT NULL,
         target_account   UUID          NOT NULL,
         amount           NUMERIC(14,2) NOT NULL,
         status           VARCHAR(20)   NOT NULL DEFAULT 'PENDING',
         /* Originated by the Gateway, propagated end to end, never regenerated. */
         correlation_id   UUID          NOT NULL,
         idempotency_key  VARCHAR(200)  NOT NULL,
         failure_reason   TEXT,
         /* Demonstration only. Carried to Payment Service, obeyed by nobody here. */
         payment_scenario VARCHAR(20),
         created_at       TIMESTAMPTZ   NOT NULL DEFAULT now(),
         updated_at       TIMESTAMPTZ   NOT NULL DEFAULT now(),
         completed_at     TIMESTAMPTZ,
         /*
          * The six states of the machine, and nothing else. The domain refuses
          * an illegal transition and this refuses a status the domain does not
          * know — both, because the domain must be arguable without a database
          * and the database must hold without the domain.
          */
         CONSTRAINT transactions_status_known
           CHECK (status IN ('PENDING','DEBITING','PAYMENT_PENDING','COMPLETED','FAILED','COMPENSATED')),
         CONSTRAINT transactions_amount_positive CHECK (amount > 0),
         CONSTRAINT transactions_accounts_differ CHECK (source_account <> target_account),
         CONSTRAINT transactions_scenario_known
           CHECK (payment_scenario IS NULL OR payment_scenario IN ('APPROVE','REJECT','TRANSIENT_FAILURE')),
         /*
          * Invariants T-3 and T-4 in one line. Two deliveries of one intention
          * race to insert and exactly one wins, which is a fact about the
          * database rather than a hope about timing.
          */
         CONSTRAINT transactions_idempotency_once UNIQUE (idempotency_key)
       )`,
      `CREATE INDEX IF NOT EXISTS transactions_correlation_idx
         ON transactions (correlation_id)`,
      /* The two account columns are what an operator searches by. */
      `CREATE INDEX IF NOT EXISTS transactions_source_idx
         ON transactions (source_account, created_at DESC)`,
      `CREATE INDEX IF NOT EXISTS transactions_target_idx
         ON transactions (target_account, created_at DESC)`,
    ],
  },
  {
    name: '002_transaction_events',
    statements: [
      /*
       * The local trail: every event this service acted on and every command it
       * ordered, in the order it happened. It is not a copy of the audit
       * service's record and does not try to be — that one spans the system,
       * this one explains one transaction without leaving this database.
       *
       * Illegal transitions are written here too. T-6 says an out-of-order
       * event is discarded *and recorded*, and a discard nobody can see is
       * indistinguishable from a message that never arrived.
       */
      `CREATE TABLE IF NOT EXISTS transaction_events (
         id             BIGSERIAL PRIMARY KEY,
         transaction_id UUID        NOT NULL REFERENCES transactions (transaction_id),
         event_type     VARCHAR(100) NOT NULL,
         payload        JSONB        NOT NULL,
         received_at    TIMESTAMPTZ  NOT NULL DEFAULT now()
       )`,
      `CREATE INDEX IF NOT EXISTS transaction_events_transaction_idx
         ON transaction_events (transaction_id, id)`,
    ],
  },
  {
    name: '003_processed_messages',
    statements: [
      /*
       * Invariant T-5, as a primary key. The envelope's `messageId` is this
       * system's `eventId`: it survives the retry ladder unchanged, so a
       * redelivery loses the insert and produces no second transition and no
       * second compensation.
       */
      `CREATE TABLE IF NOT EXISTS processed_messages (
         message_id     UUID PRIMARY KEY,
         message_type   VARCHAR(120) NOT NULL,
         transaction_id UUID         NOT NULL,
         outcome        VARCHAR(30)  NOT NULL,
         processed_at   TIMESTAMPTZ  NOT NULL DEFAULT now()
       )`,
    ],
  },
  {
    name: '004_transaction_aliases',
    statements: [
      /*
       * The identifiers handed to callers whose retry was honoured.
       *
       * The Gateway mints a fresh `transactionId` per HTTP request and returns
       * it in the `202`, so a retry carrying the same idempotency key gets an
       * identifier that names no row. Without this table that caller is left
       * holding a receipt for a transfer they cannot look up — the failure
       * recorded as TD-025 on the customer side. With it, their identifier
       * resolves to the transfer that actually exists.
       */
      `CREATE TABLE IF NOT EXISTS transaction_aliases (
         requested_transaction_id UUID PRIMARY KEY,
         transaction_id           UUID        NOT NULL REFERENCES transactions (transaction_id),
         created_at               TIMESTAMPTZ NOT NULL DEFAULT now()
       )`,
      `CREATE INDEX IF NOT EXISTS transaction_aliases_target_idx
         ON transaction_aliases (transaction_id)`,
    ],
  },
  {
    name: '005_outbox_messages',
    statements: [
      /*
       * The transactional outbox (TD-031). Every command and event the Saga
       * orders is written **here, in the same transaction as the state change
       * that implies it** — never published straight to the broker after the
       * commit. That window, between committing a transition and publishing its
       * command, is where a crash used to leave a transfer stuck in a state it
       * legitimately reached, with the money already moved and nothing on its
       * way to finish the job. Now the row and its message commit together or
       * not at all, and a relay (`OutboxRelay`) sweeps `PENDING` rows and
       * publishes them.
       *
       * The **whole envelope** is stored, not the payload — so the relay
       * republishes it byte-for-byte, `messageId` and `idempotencyKey` intact. A
       * message rebuilt at relay time would carry a fresh `messageId`, and a
       * fresh `messageId` is a new message to every consumer's deduplication:
       * the relay would defeat the very idempotency the Saga depends on. Storing
       * the envelope is what makes a redelivered relay harmless.
       */
      `CREATE TABLE IF NOT EXISTS outbox_messages (
         id              BIGSERIAL    PRIMARY KEY,
         transaction_id  UUID         NOT NULL REFERENCES transactions (transaction_id),
         exchange        VARCHAR(120) NOT NULL,
         routing_key     VARCHAR(200) NOT NULL,
         envelope        JSONB        NOT NULL,
         dispatch_status VARCHAR(20)  NOT NULL DEFAULT 'PENDING',
         created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
         published_at    TIMESTAMPTZ,
         CONSTRAINT outbox_messages_status_known
           CHECK (dispatch_status IN ('PENDING','DISPATCHED'))
       )`,
      /*
       * The relay reads only what it has not sent, oldest first. A partial index
       * on the pending rows keeps that sweep cheap even once the dispatched rows
       * have accumulated — the ones it never has to look at again.
       */
      `CREATE INDEX IF NOT EXISTS outbox_messages_pending_idx
         ON outbox_messages (id) WHERE dispatch_status = 'PENDING'`,
    ],
  },
  {
    /*
     * Who asked for the transfer, recorded at request time from the envelope's
     * verified identity — the column that closes TD-033 and TD-035.
     *
     * This service could not answer "which transfers are mine" and could not
     * check ownership on a status query, because a transaction holds two
     * account references and resolving either to a person means reading Account
     * Service's database (§8.2, 2.3). The identity was in the envelope the
     * whole time; nothing was missing but a place to put it.
     *
     * **Nullable, and it has to be.** Rows written before this migration have
     * no identity to recover, and the Saga's own follow-up commands carry the
     * identity of whoever started the transfer rather than of a person — so a
     * transfer opened by a process rather than a person is a real, if rare,
     * case. A `NOT NULL` here would have made the migration fail on any
     * existing database, which is the worst possible time to find out.
     */
    name: '006_transactions_customer_id',
    statements: [
      `ALTER TABLE transactions ADD COLUMN IF NOT EXISTS customer_id UUID`,
      `CREATE INDEX IF NOT EXISTS transactions_customer_idx
         ON transactions (customer_id, created_at DESC)`,
    ],
  },
  {
    /*
     * What a service payment is *for* — a contract number, a meter number, a
     * phone line — carried on the transfer that pays it.
     *
     * A service payment is a transfer to an account the biller holds at this
     * bank, so it needed no new table and no new state. The one thing a
     * transfer could not carry was the number that tells the biller whose bill
     * was paid, and this is that number.
     *
     * Nullable: an ordinary transfer between two people has no reference, and
     * making one up would be worse than leaving the column empty.
     */
    name: '007_transactions_reference',
    statements: [
      `ALTER TABLE transactions ADD COLUMN IF NOT EXISTS reference VARCHAR(60)`,
    ],
  },
  {
    /*
     * The real history (T-28), as opposed to `transaction_events`: that table
     * records *what message arrived*, this one records *what state change it
     * produced*. One row per legal transition `applyEvent` actually applied —
     * self-transitions on PAYMENT_PENDING included, since those are the ones
     * that order the payment, the credit and the compensation — plus one
     * opening row per transaction, written by `start()` with `from_status`
     * NULL. Illegal transitions are not here: they moved nothing, and T-6
     * already records them in `transaction_events` and in
     * `processed_messages.outcome`.
     *
     * No foreign statuses and no foreign tables, same as every table above:
     * criterion 8 applies to this one exactly as it does to `transactions`.
     */
    name: '008_transaction_transitions',
    statements: [
      `CREATE TABLE IF NOT EXISTS transaction_transitions (
         id             BIGSERIAL    PRIMARY KEY,
         transaction_id UUID         NOT NULL REFERENCES transactions (transaction_id),
         from_status    VARCHAR(20),
         to_status      VARCHAR(20)  NOT NULL,
         event_type     VARCHAR(120) NOT NULL,
         failure_reason TEXT,
         /* NULL only on the opening row, which no message caused. */
         message_id     UUID,
         occurred_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
         CONSTRAINT transaction_transitions_to_known
           CHECK (to_status IN ('PENDING','DEBITING','PAYMENT_PENDING','COMPLETED','FAILED','COMPENSATED')),
         CONSTRAINT transaction_transitions_from_known
           CHECK (from_status IS NULL
                  OR from_status IN ('PENDING','DEBITING','PAYMENT_PENDING','COMPLETED','FAILED','COMPENSATED'))
       )`,
      `CREATE INDEX IF NOT EXISTS transaction_transitions_transaction_idx
         ON transaction_transitions (transaction_id, id)`,
      /*
       * T-5 as a fact about the table, not only as trust in
       * `processed_messages`'s own primary key: two writers racing to record
       * the same delivery's effect can insert at most one row for it. Partial
       * so the single opening row (message_id NULL) never collides with
       * another transaction's opening row.
       */
      `CREATE UNIQUE INDEX IF NOT EXISTS transaction_transitions_message_once
         ON transaction_transitions (transaction_id, message_id)
         WHERE message_id IS NOT NULL`,
    ],
  },
  {
    /*
     * T-29: Payment Service's simulated provider gains a third answer,
     * `TIMEOUT`. This service only carries the value to `payment.requested.v1`
     * and decides nothing from it, but the column's own CHECK still has to
     * admit it or a transfer requested with `TIMEOUT` is refused here before
     * Payment Service ever sees it.
     */
    name: '009_transactions_payment_scenario_timeout',
    statements: [
      `ALTER TABLE transactions DROP CONSTRAINT IF EXISTS transactions_scenario_known`,
      `ALTER TABLE transactions ADD CONSTRAINT transactions_scenario_known
         CHECK (payment_scenario IS NULL
                OR payment_scenario IN ('APPROVE','REJECT','TRANSIENT_FAILURE','TIMEOUT'))`,
    ],
  },
  {
    /*
     * T-43: what the telemetry needs that the state machine does not.
     *
     * `requested_at` is the `occurredAt` of `transfer.requested.v1` — the start
     * SLI-3 measures the Saga's duration from — and differs from `created_at`
     * by however long the message waited in the broker. `trace_context` is the
     * W3C `traceparent` of the span that opened the transfer's trace, so that a
     * step arriving as a different message, possibly on a different pod, joins
     * the same trace. Both nullable: a row from before this migration has
     * neither, and the telemetry falls back to `created_at` and to no link.
     */
    name: '010_transactions_observability',
    statements: [
      `ALTER TABLE transactions ADD COLUMN IF NOT EXISTS requested_at TIMESTAMPTZ`,
      `ALTER TABLE transactions ADD COLUMN IF NOT EXISTS trace_context VARCHAR(80)`,
    ],
  },
  {
    /*
     * T-48: the W3C `traceparent` active when an outbox row was written. The
     * relay publishes each command inside it, so the hop from this service to
     * the next is a continuation of the Saga's trace rather than the start of a
     * new one opened by the relay's timer. Nullable: `NULL` means no SDK was
     * recording when the row was written, and the relay publishes as before.
     */
    name: '011_outbox_trace_context',
    statements: [`ALTER TABLE outbox_messages ADD COLUMN IF NOT EXISTS trace_context VARCHAR(80)`],
  },
  {
    /*
     * El destino real de un depósito interbancario (T-47).
     *
     * JSONB y no cuatro columnas, por la misma razón que `reference` es una
     * cadena opaca: **este servicio no lo interpreta**. Lo recibe de
     * `transfer.requested.v1`, lo guarda y lo copia tal cual en
     * `payment.requested.v1`, donde Payment —el único que habla con el banco
     * pareja— sí lo entiende. Validar aquí su forma sería un orquestador
     * opinando sobre un contrato ajeno, y rechazaría un destino válido el día
     * que el otro banco cambie el suyo.
     *
     * `NULL` para una transferencia interna, que son casi todas.
     */
    name: '012_transactions_interbank',
    statements: [`ALTER TABLE transactions ADD COLUMN IF NOT EXISTS interbank JSONB`],
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
