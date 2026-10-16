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
  {
    /*
     * The billers' collection accounts — what makes `G-01` "pago de servicios"
     * possible without a second kind of money movement.
     *
     * A service payment **is a transfer**, to an account the biller holds at
     * this bank. That is how the product works in the world and it is why this
     * feature needed no new Saga, no nullable target account and no change to a
     * message T-05 closed: EEGSA's account is an account, the transfer to it is
     * a transfer, and the state machine never learns that anything is different.
     *
     * The alternative — a `SERVICE_PAYMENT` kind with a null target and a
     * branch in the state machine — would have put a second shape through every
     * consumer of `transaction.completed.v1`, for a distinction the ledger does
     * not have.
     *
     * `customer_id` is synthetic and stays `NOT NULL`: a biller is not a
     * customer of this bank, but the column is a plain reference with no
     * foreign key, and a nullable one would have to be handled by every read
     * path for the sake of three rows.
     */
    name: '006_biller_accounts',
    statements: [
      `ALTER TABLE accounts ADD COLUMN IF NOT EXISTS biller_code VARCHAR(20)`,
      `ALTER TABLE accounts ADD COLUMN IF NOT EXISTS biller_name VARCHAR(60)`,
      /* One account per biller, and the index the catalogue query reads. */
      `CREATE UNIQUE INDEX IF NOT EXISTS accounts_biller_code_once
         ON accounts (biller_code) WHERE biller_code IS NOT NULL`,
    ],
  },
  {
    /*
     * T-27: the per-transaction commission an account type may charge
     * (`account-type-rules.ts`), recorded as its own row alongside the DEBIT
     * it accompanies — same `idempotency_key`, different `type`, which
     * `account_operations_once UNIQUE (idempotency_key, type)` from
     * `002_account_operations` already deduplicates without change.
     */
    name: '007_account_operations_commission_type',
    statements: [
      `ALTER TABLE account_operations DROP CONSTRAINT IF EXISTS account_operations_type_known`,
      `ALTER TABLE account_operations ADD CONSTRAINT account_operations_type_known
         CHECK (type IN ('DEBIT', 'CREDIT', 'COMPENSATION', 'COMMISSION'))`,
    ],
  },
  {
    /*
     * T-42: the anomalies the high-frequency rule has detected.
     *
     * A table and not a counter in memory because "exactly one event per
     * account per window" has to hold across replicas and across restarts, and
     * only a row every replica can see can promise that. The row is written
     * **before** the event is published, so a crash in between leaves a record
     * that says "detected, never announced" (`published_at IS NULL`) rather than
     * an announcement nobody can account for.
     *
     * `claimed_at` is a lease on the right to publish: a detector that crashed
     * after writing the row cannot hold it for ever, and one that is merely slow
     * is not duplicated while it holds it.
     */
    name: '008_account_anomalies',
    statements: [
      `CREATE TABLE IF NOT EXISTS account_anomalies (
         anomaly_id      UUID PRIMARY KEY,
         account_id      UUID         NOT NULL REFERENCES accounts (account_id),
         rule            VARCHAR(40)  NOT NULL DEFAULT 'HIGH_FREQUENCY',
         operation_count INTEGER      NOT NULL,
         threshold       INTEGER      NOT NULL,
         window_minutes  INTEGER      NOT NULL,
         window_start    TIMESTAMPTZ  NOT NULL,
         detected_at     TIMESTAMPTZ  NOT NULL,
         claimed_at      TIMESTAMPTZ  NOT NULL,
         published_at    TIMESTAMPTZ,
         CONSTRAINT account_anomalies_exceeds_limit CHECK (operation_count > threshold)
       )`,
      `CREATE INDEX IF NOT EXISTS account_anomalies_account_idx
         ON account_anomalies (account_id, detected_at DESC)`,
    ],
  },
  /**
   * El número de cuenta que el contrato interbancario exige (T-56).
   *
   * **Un UUID no cabe.** El contrato oficial define `AccountNumber` como
   * `^[A-Za-z0-9-]{1,34}$`, y un UUID v4 con guiones son **36** caracteres. No
   * es una preferencia de estilo: es un límite del contrato, y hasta que
   * existiera este número **ninguna operación interbancaria podía completarse**.
   *
   * El formato es `02-NNNNNNNNN`: `02` es nuestro banco (`BANK02`) y los nueve
   * dígitos salen de una secuencia. Doce caracteres, y se publica en el acuerdo
   * de integración — un número de cuenta no es un secreto, es lo que un cliente
   * le dicta por teléfono a quien le va a depositar.
   *
   * Tres decisiones que vale la pena justificar:
   *
   * 1. **Una columna y no una derivación del UUID.** Un hash del UUID cabría y
   *    no necesitaría esta migración, pero no se puede recorrer al revés: dado
   *    un número habría que escanear la tabla entera para encontrar su cuenta.
   *    Un banco busca por número de cuenta todo el tiempo.
   * 2. **Una secuencia y no el UUID truncado.** Truncar invita a la colisión y
   *    la colisión aquí es acreditarle a otro. La secuencia la garantiza
   *    PostgreSQL, y el `UNIQUE` la vigila.
   * 3. **`NOT NULL` desde el principio**, rellenando las filas que ya existen en
   *    la misma transacción. Una columna nulable habría dejado cuentas sin
   *    número a las que la pareja no puede depositar, y el fallo aparecería el
   *    día de la integración y no hoy.
   */
  {
    name: '009_account_numbers',
    statements: [
      `CREATE SEQUENCE IF NOT EXISTS account_number_seq AS BIGINT MINVALUE 1 START 1`,
      `ALTER TABLE accounts ADD COLUMN IF NOT EXISTS account_number VARCHAR(34)`,
      /*
       * El orden del relleno es determinista (`created_at`, y `account_id` para
       * desempatar) para que dos entornos sembrados igual reciban los mismos
       * números. Si no, las cuentas de prueba del acuerdo de integración
       * cambiarían de número en cada despliegue nuevo.
       */
      `UPDATE accounts AS a
          SET account_number = '02-' || lpad(numerada.posicion::text, 9, '0')
         FROM (
           SELECT account_id,
                  row_number() OVER (ORDER BY created_at, account_id) AS posicion
             FROM accounts
            WHERE account_number IS NULL
         ) AS numerada
        WHERE a.account_id = numerada.account_id`,
      `SELECT setval(
         'account_number_seq',
         GREATEST((SELECT count(*) FROM accounts), 1),
         true
       )`,
      `ALTER TABLE accounts ALTER COLUMN account_number SET NOT NULL`,
      `ALTER TABLE accounts
         ADD CONSTRAINT accounts_account_number_key UNIQUE (account_number)`,
      /*
       * El formato, en SQL además de en el código: es el campo que viaja a otro
       * banco, y un número que no cumpla el patrón del contrato es un depósito
       * que la pareja rechaza sin poder explicarnos por qué.
       */
      `ALTER TABLE accounts
         ADD CONSTRAINT accounts_account_number_format
         CHECK (account_number ~ '^[A-Za-z0-9-]{1,34}$')`,
    ],
  },
  /**
   * Que el número lo ponga la **base** y no cada `INSERT` (T-56).
   *
   * La migración anterior dejó la columna `NOT NULL` y puso la expresión de la
   * secuencia en el `INSERT` del repositorio. Parecía suficiente y no lo era:
   * hay **cuatro** caminos que insertan cuentas —el repositorio, los billers,
   * la cuenta de liquidación y los datos de demostración— y los tres últimos
   * son SQL propio que no sabía del campo nuevo. El despliegue local lo dijo
   * en la primera línea de su log:
   *
   *     null value in column "account_number" of relation "accounts"
   *     violates not-null constraint
   *
   * El pod se quedó `Running` y **no `Ready`**, que es exactamente lo que las
   * dos sondas separadas existen para hacer. Ninguna prueba unitaria lo habría
   * visto: los dobles no tienen restricciones.
   *
   * Con un `DEFAULT`, **ningún camino puede olvidarlo** — ni los cuatro de hoy
   * ni el quinto que alguien añada mañana. Es una migración aparte y no un
   * arreglo de la 009 porque las migraciones son de sólo añadir: la 009 ya
   * corrió en los entornos locales, y editarla los habría dejado distintos de
   * un clon nuevo.
   */
  {
    name: '010_account_number_default',
    statements: [
      `ALTER TABLE accounts
         ALTER COLUMN account_number
         SET DEFAULT '02-' || lpad(nextval('account_number_seq')::text, 9, '0')`,
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
