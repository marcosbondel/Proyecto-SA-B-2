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
  {
    name: '007_interbank_deposits',
    statements: [
      `CREATE TABLE IF NOT EXISTS interbank_deposits (
         deposit_id UUID PRIMARY KEY,
         origin_bank_code VARCHAR(32) NOT NULL,
         external_transfer_id VARCHAR(128) NOT NULL,
         idempotency_key VARCHAR(128) NOT NULL,
         destination_account_id UUID NOT NULL,
         amount_minor BIGINT NOT NULL CHECK (amount_minor > 0),
         currency VARCHAR(3) NOT NULL,
         correlation_id UUID NOT NULL,
         origin_envelope JSONB NOT NULL,
         stage VARCHAR(20) NOT NULL CHECK (stage IN ('ELIGIBILITY','CREDIT','ACCEPTED','REJECTED')),
         rejection_reason VARCHAR(40),
         next_action_at TIMESTAMPTZ,
         result_envelope JSONB,
         result_published_at TIMESTAMPTZ,
         callback_attempts INTEGER NOT NULL DEFAULT 0,
         callback_due_at TIMESTAMPTZ,
         callback_delivered_at TIMESTAMPTZ,
         created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
         decided_at TIMESTAMPTZ,
         UNIQUE (origin_bank_code, external_transfer_id),
         UNIQUE (origin_bank_code, idempotency_key),
         CHECK ((stage IN ('ACCEPTED','REJECTED')) = (decided_at IS NOT NULL)),
         CHECK ((stage = 'REJECTED') = (rejection_reason IS NOT NULL)),
         CHECK ((stage IN ('ACCEPTED','REJECTED')) = (result_envelope IS NOT NULL))
       )`,
      `CREATE INDEX IF NOT EXISTS interbank_action_due_idx ON interbank_deposits (next_action_at) WHERE next_action_at IS NOT NULL`,
      `CREATE INDEX IF NOT EXISTS interbank_callback_due_idx ON interbank_deposits (callback_due_at) WHERE callback_due_at IS NOT NULL`,
    ],
  },
  {
    name: '008_interbank_conflicts',
    statements: [
      `CREATE TABLE IF NOT EXISTS interbank_conflicts (
         message_id UUID PRIMARY KEY,
         origin_envelope JSONB NOT NULL,
         result_envelope JSONB NOT NULL,
         result_published_at TIMESTAMPTZ,
         callback_attempts INTEGER NOT NULL DEFAULT 0,
         callback_due_at TIMESTAMPTZ NOT NULL,
         callback_delivered_at TIMESTAMPTZ,
         created_at TIMESTAMPTZ NOT NULL DEFAULT now()
       )`,
      `CREATE INDEX IF NOT EXISTS interbank_conflict_callback_due_idx
         ON interbank_conflicts (callback_due_at) WHERE callback_delivered_at IS NULL`,
    ],
  },
  {
    name: '009_interbank_trace_context',
    statements: [
      `ALTER TABLE interbank_deposits ADD COLUMN IF NOT EXISTS trace_context VARCHAR(80)`,
      `ALTER TABLE interbank_conflicts ADD COLUMN IF NOT EXISTS trace_context VARCHAR(80)`,
    ],
  },
  /*
   * Los depósitos que este banco ENVÍA (T-47). Tabla aparte de
   * `interbank_deposits`, que es la de los que recibe: comparten el nombre del
   * dominio y nada más — distinto emisor, distinto ciclo de vida, distinta
   * clave natural y distintas invariantes. Una sola tabla con una columna
   * `direction` habría necesitado un `CHECK` por cada combinación de dirección
   * y estado, que es la forma de no tener ninguno.
   *
   * Los cuatro `CHECK` son la máquina de `domain/interbank-send.ts` escrita
   * otra vez en SQL, a propósito: la función pura decide, y la base se niega a
   * guardar un estado que la función no habría producido. Si las dos se
   * contradicen, la base gana y el defecto se ve al escribir, no tres días
   * después leyendo un saldo.
   */
  {
    name: '010_interbank_sends',
    statements: [
      `CREATE TABLE IF NOT EXISTS interbank_sends (
         interbank_transfer_id VARCHAR(128) PRIMARY KEY,
         payment_id UUID NOT NULL UNIQUE,
         transaction_id UUID NOT NULL,
         idempotency_key VARCHAR(128) NOT NULL UNIQUE,
         destination_bank_code VARCHAR(32) NOT NULL,
         destination_account VARCHAR(64) NOT NULL,
         amount_minor BIGINT NOT NULL CHECK (amount_minor > 0),
         currency VARCHAR(3) NOT NULL,
         correlation_id UUID NOT NULL,
         -- La envolvente del comando que lo pidió, igual que en la tabla de los
         -- entrantes. No es redundancia: el barrido del vencimiento publica sin
         -- que nadie le haya mandado nada, y sin esto tendría que inventar una
         -- correlación — que es exactamente lo que la constitución VIII prohíbe.
         origin_envelope JSONB NOT NULL,
         state VARCHAR(12) NOT NULL CHECK (state IN ('PENDING','SENT','ACCEPTED','REJECTED','TIMEOUT','REVERSED')),
         reason VARCHAR(64),
         attempts INTEGER NOT NULL DEFAULT 0,
         next_attempt_at TIMESTAMPTZ,
         confirmation_due_at TIMESTAMPTZ NOT NULL,
         trace_context VARCHAR(80),
         created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
         sent_at TIMESTAMPTZ,
         decided_at TIMESTAMPTZ,
         reversed_at TIMESTAMPTZ,
         -- Un depósito resuelto tiene fecha de decisión, y uno en vuelo no.
         CHECK ((state IN ('ACCEPTED','REJECTED','TIMEOUT','REVERSED')) = (decided_at IS NOT NULL)),
         -- Sólo lo que salió mal lleva motivo. Un ACCEPTED con motivo es una contradicción.
         CHECK ((state IN ('REJECTED','TIMEOUT','REVERSED')) = (reason IS NOT NULL)),
         -- REVERSED es la constancia de que el dinero volvió: sin fecha no es constancia.
         CHECK ((state = 'REVERSED') = (reversed_at IS NOT NULL)),
         -- Y SÓLO un depósito pendiente está programado para reintentarse. El
         -- vencimiento es una COLUMNA y no un timer (§4.1): un pod reprogramado
         -- a mitad de un depósito no olvida que lo tenía.
         CHECK ((state = 'PENDING') = (next_attempt_at IS NOT NULL))
       )`,
      `CREATE INDEX IF NOT EXISTS interbank_send_attempt_due_idx
         ON interbank_sends (next_attempt_at) WHERE state = 'PENDING'`,
      `CREATE INDEX IF NOT EXISTS interbank_send_confirmation_due_idx
         ON interbank_sends (confirmation_due_at) WHERE state IN ('PENDING','SENT')`,
      `CREATE INDEX IF NOT EXISTS interbank_send_transaction_idx
         ON interbank_sends (transaction_id)`,
    ],
  },
  /**
   * Lo que el enunciado pedía del depósito **recibido** y no estaba (T-56).
   *
   * Dos cambios, y los dos son de interoperabilidad y no de almacenamiento:
   *
   * 1. **`partner_timestamp`**, el sello de tiempo que §4.1 pide entre los
   *    datos mínimos del mensaje. Separado de `created_at`, que es cuándo lo
   *    recibimos nosotros: con uno solo no se puede distinguir un reloj
   *    desfasado de un depósito que tardó en llegar, y los dos se arreglan
   *    distinto. Nulable porque las filas anteriores a esta migración no lo
   *    tienen y no se puede inventar — un `DEFAULT now()` habría escrito la
   *    hora de la migración como si fuera la del otro banco.
   *
   * 2. **`destination_account_id` pasa de `UUID` a `VARCHAR(64)`.** Hasta aquí,
   *    un banco pareja que mandara un número de cuenta recibía un `400` del
   *    Gateway y su depósito no dejaba ni una fila: se quedaba esperando hasta
   *    que venciera *su* plazo, sin saber por qué. Con una cadena entra, se
   *    registra, se rechaza con `ACCOUNT_NOT_FOUND` y **se le contesta por
   *    callback**. Un rechazo explicado es interoperable; un `400` es un
   *    silencio.
   *
   *    El `USING` es explícito porque PostgreSQL no convierte `uuid` a
   *    `varchar` sin que se lo pidan, y el tipo **se ensancha**: ninguna fila
   *    existente deja de caber.
   */
  {
    name: '011_interbank_deposits_partner_fields',
    statements: [
      `ALTER TABLE interbank_deposits
         ADD COLUMN IF NOT EXISTS partner_timestamp TIMESTAMPTZ`,
      `ALTER TABLE interbank_deposits
         ALTER COLUMN destination_account_id TYPE VARCHAR(64)
         USING destination_account_id::text`,
    ],
  },
  /**
   * Lo que el **contrato oficial** exige del depósito recibido y la tabla no
   * tenía (T-56).
   *
   * Cuatro columnas y un estado. Las columnas son datos del contrato que antes
   * no existían o viajaban en otro formato; el estado es `CANCELLED`, que el
   * contrato trae y no es un rechazo con otro nombre — es el emisor diciendo
   * «ya no lo quiero» después de que su plazo venciera.
   *
   * `partner_expires_at` es la que cambia el comportamiento: el contrato prohíbe
   * acreditar después de ella «aunque el mensaje llegue tarde (reintento,
   * DLQ)», y dice que si se acredita «la responsabilidad y la devolución son
   * suyas». Guardarla es lo que permite que el barrido rechace por vencimiento
   * un depósito que se quedó a medias, en vez de acreditarlo cuando el otro
   * banco ya lo dio por perdido y liberó su reserva — que es la forma exacta de
   * que el mismo dinero exista dos veces.
   *
   * El `CHECK` del estado se reescribe en vez de ampliarse porque PostgreSQL no
   * sabe ampliar un `CHECK`: se tira y se vuelve a crear, y las dos cosas en la
   * misma transacción para que no exista un instante sin restricción.
   */
  {
    name: '012_interbank_deposits_contract_fields',
    statements: [
      `ALTER TABLE interbank_deposits
         ADD COLUMN IF NOT EXISTS origin_account VARCHAR(34)`,
      `ALTER TABLE interbank_deposits
         ADD COLUMN IF NOT EXISTS partner_created_at TIMESTAMPTZ`,
      `ALTER TABLE interbank_deposits
         ADD COLUMN IF NOT EXISTS partner_expires_at TIMESTAMPTZ`,
      `ALTER TABLE interbank_deposits
         ADD COLUMN IF NOT EXISTS description VARCHAR(140)`,
      `ALTER TABLE interbank_deposits
         DROP CONSTRAINT IF EXISTS interbank_deposits_stage_check`,
      `ALTER TABLE interbank_deposits
         ADD CONSTRAINT interbank_deposits_stage_check
         CHECK (stage IN ('ELIGIBILITY','CREDIT','ACCEPTED','REJECTED','CANCELLED'))`,
      /*
       * Los tres `CHECK` que relacionan el estado con las otras columnas también
       * mencionan los estados finales, así que crecen con `CANCELLED`. Si no,
       * cancelar un depósito fallaría por una restricción que nadie recordaría
       * haber escrito.
       */
      `ALTER TABLE interbank_deposits DROP CONSTRAINT IF EXISTS interbank_deposits_check`,
      `ALTER TABLE interbank_deposits
         ADD CONSTRAINT interbank_deposits_decided_at_check
         CHECK ((stage IN ('ACCEPTED','REJECTED','CANCELLED')) = (decided_at IS NOT NULL))`,
      `ALTER TABLE interbank_deposits DROP CONSTRAINT IF EXISTS interbank_deposits_check1`,
      `ALTER TABLE interbank_deposits
         ADD CONSTRAINT interbank_deposits_reason_check
         CHECK ((stage IN ('REJECTED','CANCELLED')) = (rejection_reason IS NOT NULL))`,
      `ALTER TABLE interbank_deposits DROP CONSTRAINT IF EXISTS interbank_deposits_check2`,
      `ALTER TABLE interbank_deposits
         ADD CONSTRAINT interbank_deposits_result_check
         CHECK ((stage IN ('ACCEPTED','REJECTED','CANCELLED')) = (result_envelope IS NOT NULL))`,
      /*
       * El barrido del vencimiento necesita encontrar los que ya pasaron de
       * plazo sin recorrer la tabla. Parcial, porque los decididos no vencen.
       */
      `CREATE INDEX IF NOT EXISTS interbank_deposit_expiry_idx
         ON interbank_deposits (partner_expires_at)
         WHERE stage IN ('ELIGIBILITY','CREDIT')`,
      /* La conciliación consulta por banco de origen y día. */
      `CREATE INDEX IF NOT EXISTS interbank_deposit_reconciliation_idx
         ON interbank_deposits (origin_bank_code, created_at)`,
    ],
  },
  /**
   * Los reversos (T-56, `POST /reversals`).
   *
   * El caso excepcional del contrato, y el que más fácil se omite por parecer
   * raro: el banco emisor ya liberó su reserva y **después** le llegó un
   * `ACCEPTED`. Nosotros tenemos el dinero acreditado y él no lo descontó, así
   * que hay que deshacerlo — y el contrato dice cómo, que es la parte
   * interesante: **no** con una operación mágica, sino debitando la cuenta y
   * **mandando un depósito nuevo** por el flujo normal de `POST /transfers`.
   *
   * Por eso esta tabla guarda `refund_transfer_id`: el reverso no acaba cuando
   * se debita, acaba cuando el depósito de devolución está enviado. `COMPLETED`
   * sin ese identificador sería decir que devolvimos el dinero sin poder
   * señalar por dónde salió.
   *
   * `original_transfer_id` es `UNIQUE` además de `reversal_id`: dos reversos del
   * mismo depósito son dos devoluciones del mismo dinero, y eso hay que
   * impedirlo en la base y no en un `if`.
   */
  {
    name: '013_interbank_reversals',
    statements: [
      `CREATE TABLE IF NOT EXISTS interbank_reversals (
         reversal_id          UUID PRIMARY KEY,
         original_transfer_id UUID        NOT NULL UNIQUE,
         requester_bank_code  VARCHAR(8)  NOT NULL,
         amount_minor         BIGINT      NOT NULL CHECK (amount_minor > 0),
         status               VARCHAR(12) NOT NULL
                              CHECK (status IN ('PROCESSING','COMPLETED','FAILED')),
         -- El depósito de devolución que se mandó. Obligatorio en COMPLETED y
         -- prohibido en los otros dos: un reverso completado sin él no se
         -- puede auditar.
         refund_transfer_id   UUID,
         reason_message       VARCHAR(200),
         origin_envelope      JSONB       NOT NULL,
         trace_context        TEXT,
         created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
         completed_at         TIMESTAMPTZ,
         CHECK ((status = 'COMPLETED') = (refund_transfer_id IS NOT NULL)),
         CHECK ((status = 'COMPLETED') = (completed_at IS NOT NULL)),
         CHECK ((status = 'FAILED') = (reason_message IS NOT NULL))
       )`,
      `CREATE INDEX IF NOT EXISTS interbank_reversal_pending_idx
         ON interbank_reversals (created_at) WHERE status = 'PROCESSING'`,
    ],
  },
  {
    /*
     * El veredicto de un depósito interbancario pasa por el outbox (TD-093).
     *
     * El defecto que esto cierra costó dinero de verdad. `send-interbank-deposit`
     * escribía el estado terminal con `advance(...)` y **después** publicaba el
     * veredicto contra el broker: dos escrituras sin una transacción común. El
     * 2026-10-15, durante la carga de T-51, el proceso de Payment murió entre
     * las dos — la transferencia `40dc1076-…` (Q1.00) quedó con su depósito en
     * `TIMEOUT`, `decided_at` escrito y el evento nunca publicado. La Saga no
     * supo que debía compensar y **Q1.00 salió de la cuenta del cliente y no
     * volvió**. Una fila entre 1.259: es la clase de fallo que el volumen
     * esconde.
     *
     * Peor que perderse: quedaba **irrecuperable**. `claimSendable` busca
     * `state = 'PENDING'` y `claimExpired` busca `state IN ('PENDING','SENT')`,
     * así que una fila ya decidida está fuera del alcance de los dos barridos
     * para siempre.
     *
     * La solución no se inventa aquí: este mismo servicio ya la tiene en
     * `outbox_messages` (migración 003, TD-047) para el camino del pago normal.
     * Esto es extenderla al camino interbancario, que es consistencia y no una
     * segunda idea.
     */
    name: '014_interbank_verdict_outbox',
    statements: [
      /*
       * `payment_id` deja de ser obligatorio.
       *
       * No es un relajamiento por comodidad: un depósito interbancario **no
       * crea fila en `payments`**. `ProcessPaymentHandler` ve el bloque
       * `interbank` en `payment.requested.v1` y deriva el comando entero a
       * `SendInterbankDepositUseCase`, que escribe en `interbank_sends` y en
       * ninguna otra tabla. Así que el `paymentId` del envelope existe como
       * identificador y **no** como fila a la que apuntar: la clave ajena lo
       * rechazaría.
       *
       * La columna sigue con su `REFERENCES` para los eventos del pago normal,
       * donde la fila sí está y el `ON DELETE CASCADE` es lo que limpia el
       * outbox de un pago borrado. Lo que se admite es el nulo, y el relay no
       * lee esa columna: publica `exchange`, `routing_key` y `envelope`, y los
       * identificadores viajan dentro del envelope de todas formas.
       */
      `ALTER TABLE outbox_messages ALTER COLUMN payment_id DROP NOT NULL`,

      /*
       * Cuándo se encoló el veredicto de este depósito, que es distinto de
       * cuándo se decidió.
       *
       * Existe para el barrido de reconciliación —la pieza (b) de TD-093— y lo
       * que lo hace **acotado** es justo esta columna: el barrido busca filas
       * decididas cuyo veredicto nunca llegó al outbox, y encolarlo la marca.
       * Una vez, no en bucle.
       *
       * Y se auto-desactiva. A partir de esta migración `advance` escribe el
       * veredicto y la marca en la misma transacción, así que ninguna fila
       * nueva puede cumplir la condición. Las únicas que la cumplen son las
       * decididas por una versión anterior del código — entre ellas la del
       * Q1.00, que es como se recupera sin tocarla a mano. El runbook del banco
       * pareja prohíbe acreditar a mano, y con razón: una corrección manual no
       * deja rastro de por qué el dinero apareció.
       */
      `ALTER TABLE interbank_sends ADD COLUMN IF NOT EXISTS verdict_enqueued_at TIMESTAMPTZ`,

      /*
       * Las filas que el barrido de reconciliación busca, y nada más.
       *
       * Parcial a propósito: en régimen normal este índice está **vacío**, que
       * es la forma de que un barrido cada pocos segundos no cueste nada. Si
       * alguna vez tiene filas, es que hubo una caída entre decidir y encolar
       * — y entonces lo que importa es que el barrido las encuentre rápido.
       */
      /*
       * Los **tres** veredictos, no los dos que TD-093 nombró.
       *
       * La fila de su remedio decía `state IN ('REJECTED','TIMEOUT') AND
       * reversed_at IS NULL`, porque el caso medido fue un `TIMEOUT`. Pero
       * perder un `ACCEPTED` es peor, no mejor: el dinero ya salió hacia el
       * otro banco y la Saga se queda en `PAYMENT_PENDING` **para siempre** —
       * sin compensar, porque compensar sería incorrecto, y sin completar,
       * porque nadie se lo dijo. Es un descuadre que sólo aparece en la
       * conciliación diaria.
       *
       * `reversed_at IS NULL` sobra, además: era el indicio de que la Saga
       * nunca actuó, y `verdict_enqueued_at IS NULL` lo dice exacto. `REVERSED`
       * queda fuera porque sólo se llega ahí por el evento de la compensación,
       * que **implica** que el veredicto se entregó.
       */
      `CREATE INDEX IF NOT EXISTS interbank_sends_unreconciled_idx
         ON interbank_sends (decided_at)
         WHERE state IN ('ACCEPTED','REJECTED','TIMEOUT')
           AND verdict_enqueued_at IS NULL`,
    ],
  },
  {
    /*
     * El protocolo de TIMEOUT del emisor (TD-095).
     *
     * Lo que estas columnas cambian no es una estructura, es una regla sobre el
     * dinero: **un depósito que vence ya no se compensa**. El contrato oficial le
     * da al banco pareja 24 horas para reintentar su callback, así que a los
     * 180 s no sabemos nada — y devolver el dinero ahí es arriesgarse a que
     * ellos acrediten y nosotros hayamos reembolsado. Es el «monto perdido sin
     * compensación» que §8.3 penaliza con un 50 %, en su variante invisible: los
     * dos bancos creen haber hecho lo correcto y el descuadre sólo aparece en la
     * conciliación diaria.
     *
     * Los plazos son **columnas y no temporizadores**, por lo mismo que el resto
     * de este servicio: un pod que se reprograma no puede olvidarse de un
     * depósito a medio resolver. Y además los hace auditables — queda escrito
     * desde cuándo se podía liberar, no sólo que se liberó.
     */
    name: '015_interbank_timeout_protocol',
    statements: [
      /*
       * `expires_at + 300 s`. Nulo en las filas que ya existen: su protocolo es
       * el viejo y no se reescribe hacia atrás — una fila a medio camino entre
       * dos versiones del código es peor que una fila con el comportamiento
       * anterior. `claimAwaitingResolution` las ignora por eso mismo.
       */
      `ALTER TABLE interbank_sends ADD COLUMN IF NOT EXISTS release_not_before TIMESTAMPTZ`,

      /*
       * Lo que el otro banco contestó, y cuándo.
       *
       * Se guarda incluso cuando la respuesta es «no contesta», porque la
       * diferencia entre «no se ha consultado» y «se consultó y no había nadie»
       * es la que decide si el protocolo pregunta o cancela. Un `NULL` que
       * significara las dos cosas haría al protocolo preguntar para siempre.
       */
      `ALTER TABLE interbank_sends ADD COLUMN IF NOT EXISTS probe_kind VARCHAR(12)`,
      `ALTER TABLE interbank_sends ADD COLUMN IF NOT EXISTS probe_status VARCHAR(12)`,
      `ALTER TABLE interbank_sends ADD COLUMN IF NOT EXISTS probed_at TIMESTAMPTZ`,
      `ALTER TABLE interbank_sends ADD COLUMN IF NOT EXISTS cancel_kind VARCHAR(12)`,
      `ALTER TABLE interbank_sends ADD COLUMN IF NOT EXISTS cancel_result VARCHAR(20)`,
      `ALTER TABLE interbank_sends ADD COLUMN IF NOT EXISTS cancel_requested_at TIMESTAMPTZ`,

      /*
       * El calendario del protocolo, separado de `next_attempt_at`.
       *
       * Son dos escaleras distintas sobre la misma fila —la de la entrega y la
       * de la resolución— y compartir una columna haría que un reintento de
       * envío reprogramara una consulta, o al revés. Un `CHECK` no las puede
       * separar; la única forma es que sean dos columnas.
       */
      `ALTER TABLE interbank_sends ADD COLUMN IF NOT EXISTS resolve_not_before TIMESTAMPTZ`,

      /*
       * Los dos vocabularios, cerrados. Un `probe_kind` que no sea uno de los
       * tres es una traducción de HTTP que alguien añadió sin pasar por el
       * dominio, y es mejor que falle al escribir que al decidir.
       */
      `ALTER TABLE interbank_sends DROP CONSTRAINT IF EXISTS interbank_sends_probe_known`,
      `ALTER TABLE interbank_sends ADD CONSTRAINT interbank_sends_probe_known
         CHECK (probe_kind IS NULL OR probe_kind IN ('ANSWERED','UNKNOWN','UNREACHABLE'))`,
      `ALTER TABLE interbank_sends DROP CONSTRAINT IF EXISTS interbank_sends_cancel_known`,
      `ALTER TABLE interbank_sends ADD CONSTRAINT interbank_sends_cancel_known
         CHECK (cancel_kind IS NULL OR cancel_kind IN ('ANSWERED','UNREACHABLE'))`,
      /*
       * Y la coherencia que de verdad protege: un `ANSWERED` sin su valor sería
       * una respuesta vacía que el dominio leería como «contestaron» sin saber
       * qué, y de ahí sale una decisión sobre dinero.
       */
      `ALTER TABLE interbank_sends DROP CONSTRAINT IF EXISTS interbank_sends_probe_coherent`,
      `ALTER TABLE interbank_sends ADD CONSTRAINT interbank_sends_probe_coherent
         CHECK ((probe_kind = 'ANSWERED') IS NOT TRUE OR probe_status IS NOT NULL)`,
      `ALTER TABLE interbank_sends DROP CONSTRAINT IF EXISTS interbank_sends_cancel_coherent`,
      `ALTER TABLE interbank_sends ADD CONSTRAINT interbank_sends_cancel_coherent
         CHECK ((cancel_kind = 'ANSWERED') IS NOT TRUE OR cancel_result IS NOT NULL)`,

      /*
       * El barrido de la resolución. Parcial: sólo las filas en `TIMEOUT` con el
       * calendario nuevo, que son las únicas que el protocolo gobierna.
       */
      `CREATE INDEX IF NOT EXISTS interbank_sends_resolving_idx
         ON interbank_sends (resolve_not_before)
         WHERE state = 'TIMEOUT' AND release_not_before IS NOT NULL`,

      /*
       * Y el índice de TD-093 pierde el `TIMEOUT`.
       *
       * Desde aquí un `TIMEOUT` **no es un veredicto**: no lleva ningún final
       * para la Saga, así que no hay nada que reconciliar y
       * `claimUnreconciled` lo devolvería en cada barrido para descartarlo acto
       * seguido. Las dos deudas se tocan justo en este punto, y la que manda es
       * ésta: TD-093 garantiza que un veredicto no se pierda, y TD-095 decide
       * que el vencimiento no lo es.
       */
      `DROP INDEX IF EXISTS interbank_sends_unreconciled_idx`,
      `CREATE INDEX IF NOT EXISTS interbank_sends_unreconciled_idx
         ON interbank_sends (decided_at)
         WHERE state IN ('ACCEPTED','REJECTED')
           AND verdict_enqueued_at IS NULL`,
    ],
  },
  /**
   * Lo que el contrato v1 y el protocolo completo de TIMEOUT piden del depósito
   * enviado (T-60).
   *
   * - **`origin_account`**: el `originAccount` del `TransferRequest`. Nulo en las
   *   filas anteriores: no se puede inventar, y un depósito sin ella no se envía.
   * - **`customer_id`**: quién lo pidió, extraído de la identidad del sobre que
   *   ya se guardaba. Es lo que permite que un cliente vea *sus* depósitos y no
   *   los de otro (B10) sin que Payment lea la tabla de nadie.
   * - **Contadores de la consulta y de la cancelación**: «consulta … con
   *   reintentos» necesita saber cuántos van.
   * - **El reverso** (paso 5): su identificador —uno por depósito, determinista—,
   *   su estado y su calendario, en columnas y no en un temporizador, como todo
   *   lo demás de este servicio.
   * - **El historial de estados**: una fila por cambio, escrita en la misma
   *   transacción que el cambio. `decided_at` solo recuerda la *primera*
   *   decisión, así que el historial no se puede reconstruir de las columnas; se
   *   siembra con lo que sí se sabe para las filas que ya existen.
   */
  {
    name: '016_interbank_sends_t60',
    statements: [
      `ALTER TABLE interbank_sends ADD COLUMN IF NOT EXISTS origin_account VARCHAR(34)`,
      `ALTER TABLE interbank_sends ADD COLUMN IF NOT EXISTS customer_id UUID`,
      `UPDATE interbank_sends
          SET customer_id = (origin_envelope #>> '{identity,customerId}')::uuid
        WHERE customer_id IS NULL
          AND (origin_envelope #>> '{identity,customerId}') ~*
              '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'`,
      `CREATE INDEX IF NOT EXISTS interbank_sends_customer_idx
         ON interbank_sends (customer_id, created_at DESC)`,
      `ALTER TABLE interbank_sends ADD COLUMN IF NOT EXISTS probe_attempts INTEGER NOT NULL DEFAULT 0`,
      `ALTER TABLE interbank_sends ADD COLUMN IF NOT EXISTS cancel_attempts INTEGER NOT NULL DEFAULT 0`,
      `ALTER TABLE interbank_sends ADD COLUMN IF NOT EXISTS reversal_id UUID`,
      `ALTER TABLE interbank_sends ADD COLUMN IF NOT EXISTS reversal_state VARCHAR(12)`,
      `ALTER TABLE interbank_sends ADD COLUMN IF NOT EXISTS reversal_attempts INTEGER NOT NULL DEFAULT 0`,
      `ALTER TABLE interbank_sends ADD COLUMN IF NOT EXISTS reversal_next_at TIMESTAMPTZ`,
      `ALTER TABLE interbank_sends ADD COLUMN IF NOT EXISTS reversal_requested_at TIMESTAMPTZ`,
      `ALTER TABLE interbank_sends ADD COLUMN IF NOT EXISTS reversal_refund_transfer_id UUID`,
      `ALTER TABLE interbank_sends ADD COLUMN IF NOT EXISTS reversal_message VARCHAR(200)`,
      `ALTER TABLE interbank_sends DROP CONSTRAINT IF EXISTS interbank_sends_reversal_known`,
      `ALTER TABLE interbank_sends ADD CONSTRAINT interbank_sends_reversal_known
         CHECK (reversal_state IS NULL
                OR reversal_state IN ('PENDING','PROCESSING','COMPLETED','FAILED'))`,
      /* Un reverso tiene identificador y estado, o ninguno de los dos. */
      `ALTER TABLE interbank_sends DROP CONSTRAINT IF EXISTS interbank_sends_reversal_coherent`,
      `ALTER TABLE interbank_sends ADD CONSTRAINT interbank_sends_reversal_coherent
         CHECK ((reversal_id IS NULL) = (reversal_state IS NULL))`,
      /*
       * Sólo se pide el reverso de un depósito que ya se liberó: pedírselo al
       * banco pareja por uno que seguimos teniendo como suyo sería pedir que
       * devuelvan dinero que nunca perdimos.
       */
      `ALTER TABLE interbank_sends DROP CONSTRAINT IF EXISTS interbank_sends_reversal_after_release`,
      `ALTER TABLE interbank_sends ADD CONSTRAINT interbank_sends_reversal_after_release
         CHECK (reversal_id IS NULL OR state IN ('REJECTED','REVERSED'))`,
      `CREATE INDEX IF NOT EXISTS interbank_sends_reversal_due_idx
         ON interbank_sends (reversal_next_at)
         WHERE reversal_state IN ('PENDING','PROCESSING')`,

      `CREATE TABLE IF NOT EXISTS interbank_send_history (
         history_id BIGSERIAL PRIMARY KEY,
         -- Sin FOREIGN KEY a propósito: es un registro que se escribe junto al
         -- cambio de estado, y una referencia impediría vaciar \`interbank_sends\`
         -- (TRUNCATE) sin arrastrar esta tabla, como hacen las suites de este servicio.
         interbank_transfer_id VARCHAR(128) NOT NULL,
         state VARCHAR(12) NOT NULL
           CHECK (state IN ('PENDING','SENT','ACCEPTED','REJECTED','TIMEOUT','REVERSED')),
         reason VARCHAR(64),
         at TIMESTAMPTZ NOT NULL
       )`,
      `CREATE INDEX IF NOT EXISTS interbank_send_history_idx
         ON interbank_send_history (interbank_transfer_id, history_id)`,
      /* Lo que se sabe de las filas anteriores: el alta, el acuse y el estado actual. */
      `INSERT INTO interbank_send_history (interbank_transfer_id, state, reason, at)
         SELECT interbank_transfer_id, 'PENDING', NULL, created_at FROM interbank_sends`,
      `INSERT INTO interbank_send_history (interbank_transfer_id, state, reason, at)
         SELECT interbank_transfer_id, 'SENT', NULL, sent_at
           FROM interbank_sends WHERE sent_at IS NOT NULL`,
      `INSERT INTO interbank_send_history (interbank_transfer_id, state, reason, at)
         SELECT interbank_transfer_id, state, reason, decided_at
           FROM interbank_sends WHERE decided_at IS NOT NULL AND state <> 'REVERSED'`,
      `INSERT INTO interbank_send_history (interbank_transfer_id, state, reason, at)
         SELECT interbank_transfer_id, 'REVERSED', reason, reversed_at
           FROM interbank_sends WHERE reversed_at IS NOT NULL`,
    ],
  },
  /**
   * El reembolso de un reverso no es un depósito para el cliente (T-60, QA 13c).
   *
   * Cuando el banco pareja acredita tarde y se le pide el reverso, devuelve el
   * dinero con un `POST /transfers` dirigido a la cuenta origen del envío — la
   * del cliente, que ya recibió su compensación. Acreditarlo ahí es pagarle dos
   * veces. Estas columnas permiten reconocerlo y desviarlo:
   *
   * - **`hold_reversal_id`** (depósito): el depósito se aceptó pero se *retiene*
   *   porque podría ser el reembolso de ese reverso; el barrido no lo manda a
   *   Account hasta que el reverso se resuelva.
   * - **`credit_account_ref`** (depósito): a qué cuenta se acredita en lugar de
   *   la que dice `destination_account_id`. `destination_account_id` no se toca
   *   a propósito: es lo que se compara para reconocer una repetición idéntica
   *   (si cambiara, la repetición saldría como `409`).
   * - **`refund_of_reversal_id`** (depósito): de qué reverso es reembolso.
   * - **`refund_settled_at` / `refund_inbound_id`** (envío): que el reembolso ya
   *   llegó y a qué depósito entrante corresponde; un reverso se liquida una vez.
   */
  {
    name: '017_interbank_refund_settlement',
    statements: [
      `ALTER TABLE interbank_deposits ADD COLUMN IF NOT EXISTS credit_account_ref VARCHAR(64)`,
      `ALTER TABLE interbank_deposits ADD COLUMN IF NOT EXISTS hold_reversal_id UUID`,
      `ALTER TABLE interbank_deposits ADD COLUMN IF NOT EXISTS refund_of_reversal_id UUID`,
      `CREATE INDEX IF NOT EXISTS interbank_deposit_held_idx
         ON interbank_deposits (hold_reversal_id) WHERE hold_reversal_id IS NOT NULL`,
      `ALTER TABLE interbank_sends ADD COLUMN IF NOT EXISTS refund_settled_at TIMESTAMPTZ`,
      `ALTER TABLE interbank_sends ADD COLUMN IF NOT EXISTS refund_inbound_id VARCHAR(128)`,
      `ALTER TABLE interbank_sends DROP CONSTRAINT IF EXISTS interbank_sends_refund_coherent`,
      `ALTER TABLE interbank_sends ADD CONSTRAINT interbank_sends_refund_coherent
         CHECK ((refund_settled_at IS NULL) = (refund_inbound_id IS NULL)
                AND (refund_settled_at IS NULL OR reversal_id IS NOT NULL))`,
      /* Un reverso se liquida con un solo depósito entrante. */
      `CREATE UNIQUE INDEX IF NOT EXISTS interbank_sends_refund_once
         ON interbank_sends (refund_inbound_id) WHERE refund_inbound_id IS NOT NULL`,
    ],
  },
  /*
   * 018: el arrendamiento de los reclamos (T-60, visto en producción el
   * 2026-10-19).
   *
   * Los barridos reclamaban con `SELECT … FOR UPDATE SKIP LOCKED` fuera de una
   * transacción: el candado se soltaba al volver el `SELECT`, y dos réplicas (el
   * HPA escala este servicio) o dos barridos solapados tomaban **las mismas
   * filas** y repetían cada llamada al banco pareja — cada envío salía ~4 veces.
   * El dinero no corría riesgo (`advance(from)` y el número de intento lo
   * impiden), pero el ruido sí era real.
   *
   * `claimed_until` es el arrendamiento: reclamar es, en **una sola sentencia**,
   * elegir las filas vencidas sin arrendar y arrendarlas. Nulo, o ya pasado,
   * significa libre. Quien termina el paso lo suelta (`claimed_until = NULL`) en
   * el mismo `UPDATE` que programa el siguiente, y si el pod muere a medias el
   * arrendamiento caduca solo y otra réplica recoge la fila.
   *
   * Una columna por tabla y no una por tipo de reclamo: «alguien trabaja esta
   * fila» es una sola afirmación. Sin índice: el filtro viaja detrás de la
   * condición de vencimiento, que ya tiene el suyo.
   */
  {
    name: '018_claim_leases',
    statements: [
      `ALTER TABLE interbank_sends ADD COLUMN IF NOT EXISTS claimed_until TIMESTAMPTZ`,
      `ALTER TABLE payments ADD COLUMN IF NOT EXISTS claimed_until TIMESTAMPTZ`,
      `ALTER TABLE interbank_deposits ADD COLUMN IF NOT EXISTS claimed_until TIMESTAMPTZ`,
      `ALTER TABLE interbank_conflicts ADD COLUMN IF NOT EXISTS claimed_until TIMESTAMPTZ`,
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
