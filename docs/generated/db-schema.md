# Esquema físico acumulado de las cinco bases de datos

> Revisión documental T-61: 2026-10-21. Derivado de las migraciones versionadas, sin consultar ni modificar bases desplegadas. No certifica que una revisión de producción haya aplicado todas las migraciones.

La fuente de verdad es `apps/services/<servicio>/src/infrastructure/persistence/migrations.ts`. Este catálogo refleja el **resultado acumulado**, incluidos `ALTER TABLE`, sustituciones de restricciones e índices y la tabla técnica `schema_migrations` que crea `migrate(pool)` fuera de `MIGRATIONS`. Los [DBML y ER](../architecture/diagrams/er/README.md) describen el mismo modelo.

No hay claves foráneas entre servicios. Sólo se dibujan FK declaradas en SQL: un identificador con significado de negocio no crea una relación física. `NUMERIC(14,2)` y `BIGINT` en centavos preservan el dinero exacto; `DOUBLE PRECISION` aparece únicamente en porcentajes de simulación. Los puertos 5433–5437 son mapeos locales, no direcciones cloud.

| Servicio | Base local | Puerto host → PostgreSQL | Migraciones | Tablas de dominio/soporte + migrador |
| --- | --- | --- | --- | --- |
| Customer | `customer` | 5433 → 5432 | 9 | 5 + 1 |
| Account | `account` | 5434 → 5432 | 10 | 5 + 1 |
| Transaction | `transaction` | 5435 → 5432 | 12 | 6 + 1 |
| Payment | `payment` | 5436 → 5432 | 18 | 9 + 1 |
| Notification & Audit | `notification_audit` | 5437 → 5432 | 7 | 4 + 1 |

En cloud, el nombre de base y el sufijo de entorno proceden de la configuración de despliegue; no se deducen del título lógico `*_db` de los diagramas antiguos. Las credenciales no se incluyen aquí.

## Customer Service

Fuente: [`migrations.ts`](../../apps/services/customer-service/src/infrastructure/persistence/migrations.ts).

Migraciones aplicadas al modelo documental: `001_customers`, `002_identity_documents`, `003_email_activation_tokens`, `004_processed_messages`, `005_customers_version`, `006_password_reset_tokens`, `007_customers_kyc_status`, `008_customers_creation_trace`, `009_customers_room_for_rejection_suffix`.

### `customers`

Identidad, credencial scrypt, activación, KYC y contexto de la traza de creación. Límites físicos ampliados para el sufijo de rechazo; el DTO conserva límites de entrada.

Introducida por `001_customers`.

| Columna | Tipo SQL | Nulo | Default | Clave / relación |
| --- | --- | --- | --- | --- |
| `customer_id` | `UUID` | NO | — | PK |
| `full_name` | `VARCHAR(200)` | NO | — | — |
| `document_number` | `VARCHAR(100)` | NO | — | UNIQUE |
| `email` | `VARCHAR(400)` | NO | — | UNIQUE |
| `birth_date` | `DATE` | NO | — | — |
| `address` | `VARCHAR(300)` | SÍ | — | — |
| `username` | `VARCHAR(120)` | NO | — | UNIQUE |
| `identity_status` | `VARCHAR(20)` | NO | `'PENDING'` | — |
| `role` | `VARCHAR(20)` | NO | `'CLIENTE'` | — |
| `status` | `VARCHAR(20)` | NO | `'PENDING_ACTIVATION'` | — |
| `password_hash` | `VARCHAR(255)` | NO | — | — |
| `email_verified_at` | `TIMESTAMPTZ` | SÍ | — | — |
| `created_at` | `TIMESTAMPTZ` | NO | `now()` | — |
| `updated_at` | `TIMESTAMPTZ` | NO | `now()` | — |
| `version` | `INTEGER` | NO | `0` | — |
| `kyc_status` | `VARCHAR(20)` | NO | `'PENDING'` | — |
| `creation_trace` | `VARCHAR(80)` | SÍ | — | — |

**Restricciones de tabla y CHECK de columna** (la ausencia de un CHECK enum en SQL no se sustituye por una regla inventada):

```sql
CONSTRAINT customers_role_known CHECK (role IN ('CLIENTE', 'CAJERO_RECEPTOR', 'ADMINISTRADOR'));
CONSTRAINT customers_identity_status_known CHECK (identity_status IN ('PENDING', 'VALIDATED', 'REJECTED'));
CONSTRAINT customers_active_iff_verified CHECK ((status = 'ACTIVE') = (email_verified_at IS NOT NULL));
CONSTRAINT customers_kyc_status_known CHECK (kyc_status IN ('PENDING', 'VERIFIED', 'REJECTED'));
```

**Índices adicionales** (además de PK/UNIQUE declarados arriba):

```sql
CREATE UNIQUE INDEX customers_email_lower_key ON customers (LOWER(email));
```

### `identity_documents`

Fotografía verificada contra MinIO; bytes y digest privados de Customer.

Introducida por `002_identity_documents`.

| Columna | Tipo SQL | Nulo | Default | Clave / relación |
| --- | --- | --- | --- | --- |
| `document_id` | `UUID` | NO | — | PK |
| `customer_id` | `UUID` | NO | — | FK → `customers.customer_id`; DELETE CASCADE |
| `original_filename` | `VARCHAR(255)` | SÍ | — | — |
| `mime_type` | `VARCHAR(100)` | NO | — | — |
| `size_bytes` | `INTEGER` | NO | — | — |
| `sha256` | `CHAR(64)` | NO | — | — |
| `content` | `BYTEA` | NO | — | — |
| `validation_status` | `VARCHAR(20)` | NO | — | — |
| `created_at` | `TIMESTAMPTZ` | NO | `now()` | — |

**Restricciones de tabla y CHECK de columna** (la ausencia de un CHECK enum en SQL no se sustituye por una regla inventada):

```sql
CONSTRAINT identity_documents_size_within_ceiling CHECK (size_bytes > 0 AND size_bytes <= 5242880);
```

**Índices adicionales** (además de PK/UNIQUE declarados arriba):

```sql
CREATE INDEX identity_documents_customer_idx ON identity_documents (customer_id);
CREATE UNIQUE INDEX identity_documents_sha256_key ON identity_documents (sha256);
```

### `email_activation_tokens`

Digest de token de activación de un solo uso (24 h).

Introducida por `003_email_activation_tokens`.

| Columna | Tipo SQL | Nulo | Default | Clave / relación |
| --- | --- | --- | --- | --- |
| `token_id` | `UUID` | NO | — | PK |
| `customer_id` | `UUID` | NO | — | FK → `customers.customer_id`; DELETE CASCADE |
| `token_hash` | `CHAR(64)` | NO | — | UNIQUE |
| `expires_at` | `TIMESTAMPTZ` | NO | — | — |
| `used_at` | `TIMESTAMPTZ` | SÍ | — | — |
| `created_at` | `TIMESTAMPTZ` | NO | `now()` | — |

**Índices adicionales** (además de PK/UNIQUE declarados arriba):

```sql
CREATE INDEX email_activation_tokens_customer_idx ON email_activation_tokens (customer_id);
```

### `processed_messages`

Deduplicación local. La clave real depende del servicio: message_id, par con consumer o idempotency_key/message_type.

Introducida por `004_processed_messages`.

| Columna | Tipo SQL | Nulo | Default | Clave / relación |
| --- | --- | --- | --- | --- |
| `message_id` | `UUID` | NO | — | PK |
| `idempotency_key` | `VARCHAR(200)` | NO | — | — |
| `message_type` | `VARCHAR(120)` | NO | — | — |
| `result_summary` | `JSONB` | NO | — | — |
| `processed_at` | `TIMESTAMPTZ` | NO | `now()` | — |

**Restricciones de tabla y CHECK de columna** (la ausencia de un CHECK enum en SQL no se sustituye por una regla inventada):

```sql
CONSTRAINT processed_messages_once UNIQUE (idempotency_key, message_type);
```

### `password_reset_tokens`

Digest de recuperación de contraseña de un solo uso (1 h), separado de activación.

Introducida por `006_password_reset_tokens`.

| Columna | Tipo SQL | Nulo | Default | Clave / relación |
| --- | --- | --- | --- | --- |
| `token_id` | `UUID` | NO | — | PK |
| `customer_id` | `UUID` | NO | — | FK → `customers.customer_id`; DELETE CASCADE |
| `token_hash` | `CHAR(64)` | NO | — | UNIQUE |
| `expires_at` | `TIMESTAMPTZ` | NO | — | — |
| `used_at` | `TIMESTAMPTZ` | SÍ | — | — |
| `created_at` | `TIMESTAMPTZ` | NO | `now()` | — |

**Índices adicionales** (además de PK/UNIQUE declarados arriba):

```sql
CREATE INDEX password_reset_tokens_customer_idx ON password_reset_tokens (customer_id) WHERE used_at IS NULL;
```

### `schema_migrations`

Infraestructura del migrador, no entidad de dominio. Se crea fuera de MIGRATIONS antes de aplicarlas; una tabla en cada base.

Introducida por `migrate(pool), fuera de MIGRATIONS`.

| Columna | Tipo SQL | Nulo | Default | Clave / relación |
| --- | --- | --- | --- | --- |
| `name` | `VARCHAR(120)` | NO | — | PK |
| `applied_at` | `TIMESTAMPTZ` | NO | `now()` | — |

## Account Service

Fuente: [`migrations.ts`](../../apps/services/account-service/src/infrastructure/persistence/migrations.ts).

Migraciones aplicadas al modelo documental: `001_accounts`, `002_account_operations`, `003_processed_messages`, `004_deactivation_runs`, `005_account_operations_transaction_once`, `006_biller_accounts`, `007_account_operations_commission_type`, `008_account_anomalies`, `009_account_numbers`, `010_account_number_default`.

### Secuencias

La secuencia `account_number_seq` genera números públicos `02-NNNNNNNNN`; la migración 010 también sincroniza su posición con el backfill existente. No es una tabla ni una relación.

```sql
CREATE SEQUENCE IF NOT EXISTS account_number_seq AS BIGINT MINVALUE 1 START 1
```

### `accounts`

Único propietario de saldos; SELECT FOR UPDATE, versión optimista y CHECK balance >= 0. account_number público; customer_id es referencia opaca.

Introducida por `001_accounts`.

| Columna | Tipo SQL | Nulo | Default | Clave / relación |
| --- | --- | --- | --- | --- |
| `account_id` | `UUID` | NO | — | PK |
| `customer_id` | `UUID` | NO | — | — |
| `account_type` | `VARCHAR(10)` | NO | — | — |
| `balance` | `NUMERIC(14,2)` | NO | `0.00` | — |
| `status` | `VARCHAR(10)` | NO | `'ACTIVE'` | — |
| `last_activity_at` | `TIMESTAMPTZ` | NO | `now()` | — |
| `version` | `INTEGER` | NO | `0` | — |
| `created_at` | `TIMESTAMPTZ` | NO | `now()` | — |
| `updated_at` | `TIMESTAMPTZ` | NO | `now()` | — |
| `biller_code` | `VARCHAR(20)` | SÍ | — | — |
| `biller_name` | `VARCHAR(60)` | SÍ | — | — |
| `account_number` | `VARCHAR(34)` | NO | `'02-' || lpad(nextval('account_number_seq')::text, 9, '0')` | — |

**Restricciones de tabla y CHECK de columna** (la ausencia de un CHECK enum en SQL no se sustituye por una regla inventada):

```sql
CONSTRAINT accounts_type_known CHECK (account_type IN ('MONETARIA', 'AHORRO'));
CONSTRAINT accounts_status_known CHECK (status IN ('ACTIVE', 'INACTIVE'));
CONSTRAINT accounts_balance_not_negative CHECK (balance >= 0);
CONSTRAINT accounts_account_number_key UNIQUE (account_number);
CONSTRAINT accounts_account_number_format CHECK (account_number ~ '^[A-Za-z0-9-]{1,34}$');
```

**Índices adicionales** (además de PK/UNIQUE declarados arriba):

```sql
CREATE INDEX accounts_customer_idx ON accounts (customer_id);
CREATE INDEX accounts_inactivity_idx ON accounts (status, last_activity_at);
CREATE UNIQUE INDEX accounts_biller_code_once ON accounts (biller_code) WHERE biller_code IS NOT NULL;
```

### `account_operations`

Movimientos DEBIT, CREDIT, COMPENSATION y COMMISSION. La comisión se revierte junto al débito.

Introducida por `002_account_operations`.

| Columna | Tipo SQL | Nulo | Default | Clave / relación |
| --- | --- | --- | --- | --- |
| `operation_id` | `UUID` | NO | — | PK |
| `account_id` | `UUID` | NO | — | FK → `accounts.account_id`; DELETE NO ACTION |
| `type` | `VARCHAR(20)` | NO | — | — |
| `amount` | `NUMERIC(14,2)` | NO | — | — |
| `balance_after` | `NUMERIC(14,2)` | NO | — | — |
| `transaction_id` | `UUID` | SÍ | — | — |
| `status` | `VARCHAR(20)` | NO | `'APPLIED'` | — |
| `idempotency_key` | `VARCHAR(200)` | NO | — | — |
| `created_at` | `TIMESTAMPTZ` | NO | `now()` | — |

**Restricciones de tabla y CHECK de columna** (la ausencia de un CHECK enum en SQL no se sustituye por una regla inventada):

```sql
CONSTRAINT account_operations_status_known CHECK (status IN ('APPLIED', 'COMPENSATED'));
CONSTRAINT account_operations_amount_positive CHECK (amount > 0);
CONSTRAINT account_operations_once UNIQUE (idempotency_key, type);
CONSTRAINT account_operations_type_known CHECK (type IN ('DEBIT', 'CREDIT', 'COMPENSATION', 'COMMISSION'));
```

**Índices adicionales** (además de PK/UNIQUE declarados arriba):

```sql
CREATE INDEX account_operations_account_idx ON account_operations (account_id, created_at DESC);
CREATE INDEX account_operations_transaction_idx ON account_operations (transaction_id);
CREATE UNIQUE INDEX account_operations_transaction_type_once ON account_operations (transaction_id, type) WHERE transaction_id IS NOT NULL;
```

### `processed_messages`

Deduplicación local. La clave real depende del servicio: message_id, par con consumer o idempotency_key/message_type.

Introducida por `003_processed_messages`.

| Columna | Tipo SQL | Nulo | Default | Clave / relación |
| --- | --- | --- | --- | --- |
| `message_id` | `UUID` | NO | — | PK |
| `idempotency_key` | `VARCHAR(200)` | NO | — | — |
| `message_type` | `VARCHAR(120)` | NO | — | — |
| `result_summary` | `JSONB` | NO | — | — |
| `processed_at` | `TIMESTAMPTZ` | NO | `now()` | — |

**Restricciones de tabla y CHECK de columna** (la ausencia de un CHECK enum en SQL no se sustituye por una regla inventada):

```sql
CONSTRAINT processed_messages_once UNIQUE (idempotency_key, message_type);
```

### `deactivation_runs`

Evidencia del job: también registra cero cuentas desactivadas.

Introducida por `004_deactivation_runs`.

| Columna | Tipo SQL | Nulo | Default | Clave / relación |
| --- | --- | --- | --- | --- |
| `run_id` | `UUID` | NO | — | PK |
| `executed_at` | `TIMESTAMPTZ` | NO | — | — |
| `threshold_at` | `TIMESTAMPTZ` | NO | — | — |
| `min_balance_minor` | `BIGINT` | NO | — | — |
| `deactivated_count` | `INTEGER` | NO | — | — |
| `created_at` | `TIMESTAMPTZ` | NO | `now()` | — |

### `account_anomalies`

Alta frecuencia; reporta y no bloquea. Reclamo/publicación persistidos.

Introducida por `008_account_anomalies`.

| Columna | Tipo SQL | Nulo | Default | Clave / relación |
| --- | --- | --- | --- | --- |
| `anomaly_id` | `UUID` | NO | — | PK |
| `account_id` | `UUID` | NO | — | FK → `accounts.account_id`; DELETE NO ACTION |
| `rule` | `VARCHAR(40)` | NO | `'HIGH_FREQUENCY'` | — |
| `operation_count` | `INTEGER` | NO | — | — |
| `threshold` | `INTEGER` | NO | — | — |
| `window_minutes` | `INTEGER` | NO | — | — |
| `window_start` | `TIMESTAMPTZ` | NO | — | — |
| `detected_at` | `TIMESTAMPTZ` | NO | — | — |
| `claimed_at` | `TIMESTAMPTZ` | NO | — | — |
| `published_at` | `TIMESTAMPTZ` | SÍ | — | — |

**Restricciones de tabla y CHECK de columna** (la ausencia de un CHECK enum en SQL no se sustituye por una regla inventada):

```sql
CONSTRAINT account_anomalies_exceeds_limit CHECK (operation_count > threshold);
```

**Índices adicionales** (además de PK/UNIQUE declarados arriba):

```sql
CREATE INDEX account_anomalies_account_idx ON account_anomalies (account_id, detected_at DESC);
```

### `schema_migrations`

Infraestructura del migrador, no entidad de dominio. Se crea fuera de MIGRATIONS antes de aplicarlas; una tabla en cada base.

Introducida por `migrate(pool), fuera de MIGRATIONS`.

| Columna | Tipo SQL | Nulo | Default | Clave / relación |
| --- | --- | --- | --- | --- |
| `name` | `VARCHAR(120)` | NO | — | PK |
| `applied_at` | `TIMESTAMPTZ` | NO | `now()` | — |

## Transaction Service

Fuente: [`migrations.ts`](../../apps/services/transaction-service/src/infrastructure/persistence/migrations.ts).

Migraciones aplicadas al modelo documental: `001_transactions`, `002_transaction_events`, `003_processed_messages`, `004_transaction_aliases`, `005_outbox_messages`, `006_transactions_customer_id`, `007_transactions_reference`, `008_transaction_transitions`, `009_transactions_payment_scenario_timeout`, `010_transactions_observability`, `011_outbox_trace_context`, `012_transactions_interbank`.

### `transactions`

Saga de seis estados. customer_id, cuentas e interbank son referencias/contexto; no consulta saldos ajenos.

Introducida por `001_transactions`.

| Columna | Tipo SQL | Nulo | Default | Clave / relación |
| --- | --- | --- | --- | --- |
| `transaction_id` | `UUID` | NO | — | PK |
| `source_account` | `UUID` | NO | — | — |
| `target_account` | `UUID` | NO | — | — |
| `amount` | `NUMERIC(14,2)` | NO | — | — |
| `status` | `VARCHAR(20)` | NO | `'PENDING'` | — |
| `correlation_id` | `UUID` | NO | — | — |
| `idempotency_key` | `VARCHAR(200)` | NO | — | — |
| `failure_reason` | `TEXT` | SÍ | — | — |
| `payment_scenario` | `VARCHAR(20)` | SÍ | — | — |
| `created_at` | `TIMESTAMPTZ` | NO | `now()` | — |
| `updated_at` | `TIMESTAMPTZ` | NO | `now()` | — |
| `completed_at` | `TIMESTAMPTZ` | SÍ | — | — |
| `customer_id` | `UUID` | SÍ | — | — |
| `reference` | `VARCHAR(60)` | SÍ | — | — |
| `requested_at` | `TIMESTAMPTZ` | SÍ | — | — |
| `trace_context` | `VARCHAR(80)` | SÍ | — | — |
| `interbank` | `JSONB` | SÍ | — | — |

**Restricciones de tabla y CHECK de columna** (la ausencia de un CHECK enum en SQL no se sustituye por una regla inventada):

```sql
CONSTRAINT transactions_status_known CHECK (status IN ('PENDING','DEBITING','PAYMENT_PENDING','COMPLETED','FAILED','COMPENSATED'));
CONSTRAINT transactions_amount_positive CHECK (amount > 0);
CONSTRAINT transactions_accounts_differ CHECK (source_account <> target_account);
CONSTRAINT transactions_idempotency_once UNIQUE (idempotency_key);
CONSTRAINT transactions_scenario_known CHECK (payment_scenario IS NULL OR payment_scenario IN ('APPROVE','REJECT','TRANSIENT_FAILURE','TIMEOUT'));
```

**Índices adicionales** (además de PK/UNIQUE declarados arriba):

```sql
CREATE INDEX transactions_correlation_idx ON transactions (correlation_id);
CREATE INDEX transactions_source_idx ON transactions (source_account, created_at DESC);
CREATE INDEX transactions_target_idx ON transactions (target_account, created_at DESC);
CREATE INDEX transactions_customer_idx ON transactions (customer_id, created_at DESC);
```

### `transaction_events`

Registro local de Transaction Service.

Introducida por `002_transaction_events`.

| Columna | Tipo SQL | Nulo | Default | Clave / relación |
| --- | --- | --- | --- | --- |
| `id` | `BIGSERIAL` | NO | — | PK |
| `transaction_id` | `UUID` | NO | — | FK → `transactions.transaction_id`; DELETE NO ACTION |
| `event_type` | `VARCHAR(100)` | NO | — | — |
| `payload` | `JSONB` | NO | — | — |
| `received_at` | `TIMESTAMPTZ` | NO | `now()` | — |

**Índices adicionales** (además de PK/UNIQUE declarados arriba):

```sql
CREATE INDEX transaction_events_transaction_idx ON transaction_events (transaction_id, id);
```

### `processed_messages`

Deduplicación local. La clave real depende del servicio: message_id, par con consumer o idempotency_key/message_type.

Introducida por `003_processed_messages`.

| Columna | Tipo SQL | Nulo | Default | Clave / relación |
| --- | --- | --- | --- | --- |
| `message_id` | `UUID` | NO | — | PK |
| `message_type` | `VARCHAR(120)` | NO | — | — |
| `transaction_id` | `UUID` | NO | — | — |
| `outcome` | `VARCHAR(30)` | NO | — | — |
| `processed_at` | `TIMESTAMPTZ` | NO | `now()` | — |

### `transaction_aliases`

Registro local de Transaction Service.

Introducida por `004_transaction_aliases`.

| Columna | Tipo SQL | Nulo | Default | Clave / relación |
| --- | --- | --- | --- | --- |
| `requested_transaction_id` | `UUID` | NO | — | PK |
| `transaction_id` | `UUID` | NO | — | FK → `transactions.transaction_id`; DELETE NO ACTION |
| `created_at` | `TIMESTAMPTZ` | NO | `now()` | — |

**Índices adicionales** (además de PK/UNIQUE declarados arriba):

```sql
CREATE INDEX transaction_aliases_target_idx ON transaction_aliases (transaction_id);
```

### `outbox_messages`

Bandeja transaccional. En Payment, payment_id permite NULL para eventos interbancarios sin fila payments; la FK local sigue existiendo.

Introducida por `005_outbox_messages`.

| Columna | Tipo SQL | Nulo | Default | Clave / relación |
| --- | --- | --- | --- | --- |
| `id` | `BIGSERIAL` | NO | — | PK |
| `transaction_id` | `UUID` | NO | — | FK → `transactions.transaction_id`; DELETE NO ACTION |
| `exchange` | `VARCHAR(120)` | NO | — | — |
| `routing_key` | `VARCHAR(200)` | NO | — | — |
| `envelope` | `JSONB` | NO | — | — |
| `dispatch_status` | `VARCHAR(20)` | NO | `'PENDING'` | — |
| `created_at` | `TIMESTAMPTZ` | NO | `now()` | — |
| `published_at` | `TIMESTAMPTZ` | SÍ | — | — |
| `trace_context` | `VARCHAR(80)` | SÍ | — | — |

**Restricciones de tabla y CHECK de columna** (la ausencia de un CHECK enum en SQL no se sustituye por una regla inventada):

```sql
CONSTRAINT outbox_messages_status_known CHECK (dispatch_status IN ('PENDING','DISPATCHED'));
```

**Índices adicionales** (además de PK/UNIQUE declarados arriba):

```sql
CREATE INDEX outbox_messages_pending_idx ON outbox_messages (id) WHERE dispatch_status = 'PENDING';
```

### `transaction_transitions`

Registro local de Transaction Service.

Introducida por `008_transaction_transitions`.

| Columna | Tipo SQL | Nulo | Default | Clave / relación |
| --- | --- | --- | --- | --- |
| `id` | `BIGSERIAL` | NO | — | PK |
| `transaction_id` | `UUID` | NO | — | FK → `transactions.transaction_id`; DELETE NO ACTION |
| `from_status` | `VARCHAR(20)` | SÍ | — | — |
| `to_status` | `VARCHAR(20)` | NO | — | — |
| `event_type` | `VARCHAR(120)` | NO | — | — |
| `failure_reason` | `TEXT` | SÍ | — | — |
| `message_id` | `UUID` | SÍ | — | — |
| `occurred_at` | `TIMESTAMPTZ` | NO | `now()` | — |

**Restricciones de tabla y CHECK de columna** (la ausencia de un CHECK enum en SQL no se sustituye por una regla inventada):

```sql
CONSTRAINT transaction_transitions_to_known CHECK (to_status IN ('PENDING','DEBITING','PAYMENT_PENDING','COMPLETED','FAILED','COMPENSATED'));
CONSTRAINT transaction_transitions_from_known CHECK (from_status IS NULL OR from_status IN ('PENDING','DEBITING','PAYMENT_PENDING','COMPLETED','FAILED','COMPENSATED'));
```

**Índices adicionales** (además de PK/UNIQUE declarados arriba):

```sql
CREATE INDEX transaction_transitions_transaction_idx ON transaction_transitions (transaction_id, id);
CREATE UNIQUE INDEX transaction_transitions_message_once ON transaction_transitions (transaction_id, message_id) WHERE message_id IS NOT NULL;
```

### `schema_migrations`

Infraestructura del migrador, no entidad de dominio. Se crea fuera de MIGRATIONS antes de aplicarlas; una tabla en cada base.

Introducida por `migrate(pool), fuera de MIGRATIONS`.

| Columna | Tipo SQL | Nulo | Default | Clave / relación |
| --- | --- | --- | --- | --- |
| `name` | `VARCHAR(120)` | NO | — | PK |
| `applied_at` | `TIMESTAMPTZ` | NO | `now()` | — |

## Payment Service

Fuente: [`migrations.ts`](../../apps/services/payment-service/src/infrastructure/persistence/migrations.ts).

Migraciones aplicadas al modelo documental: `001_payments`, `002_payment_attempts`, `003_outbox_messages`, `004_payment_provider_simulation`, `005_payment_simulation_settings`, `006_trace_context`, `007_interbank_deposits`, `008_interbank_conflicts`, `009_interbank_trace_context`, `010_interbank_sends`, `011_interbank_deposits_partner_fields`, `012_interbank_deposits_contract_fields`, `013_interbank_reversals`, `014_interbank_verdict_outbox`, `015_interbank_timeout_protocol`, `016_interbank_sends_t60`, `017_interbank_refund_settlement`, `018_claim_leases`.

### `payments`

Registro local de Payment Service.

Introducida por `001_payments`.

| Columna | Tipo SQL | Nulo | Default | Clave / relación |
| --- | --- | --- | --- | --- |
| `payment_id` | `UUID` | NO | — | PK |
| `transaction_id` | `UUID` | NO | — | — |
| `amount` | `NUMERIC(14,2)` | NO | — | — |
| `status` | `VARCHAR(20)` | NO | `'PENDING'` | — |
| `attempt` | `INTEGER` | SÍ | — | — |
| `error_type` | `VARCHAR(20)` | SÍ | — | — |
| `failure_reason` | `TEXT` | SÍ | — | — |
| `provider_reference` | `VARCHAR(100)` | SÍ | — | — |
| `scenario` | `VARCHAR(20)` | SÍ | — | — |
| `origin_correlation_id` | `UUID` | SÍ | — | — |
| `next_attempt_at` | `TIMESTAMPTZ` | SÍ | — | — |
| `created_at` | `TIMESTAMPTZ` | NO | `now()` | — |
| `updated_at` | `TIMESTAMPTZ` | NO | `now()` | — |
| `decided_at` | `TIMESTAMPTZ` | SÍ | — | — |
| `trace_context` | `VARCHAR(80)` | SÍ | — | — |
| `claimed_until` | `TIMESTAMPTZ` | SÍ | — | — |

**Restricciones de tabla y CHECK de columna** (la ausencia de un CHECK enum en SQL no se sustituye por una regla inventada):

```sql
CONSTRAINT payments_status_known CHECK (status IN ('PENDING','SUCCEEDED','FAILED'));
CONSTRAINT payments_error_type_known CHECK (error_type IS NULL OR error_type IN ('TRANSIENT','PERMANENT'));
CONSTRAINT payments_failure_reason_known CHECK (failure_reason IS NULL OR failure_reason IN ('PAYMENT_DECLINED','PAYMENT_RETRIES_EXHAUSTED'));
CONSTRAINT payments_amount_positive CHECK (amount > 0);
CONSTRAINT payments_settled_has_decision CHECK ((status = 'PENDING') = (decided_at IS NULL));
CONSTRAINT payments_failed_has_reason CHECK ((status = 'FAILED') = (failure_reason IS NOT NULL));
CONSTRAINT payments_succeeded_has_reference CHECK ((status = 'SUCCEEDED') = (provider_reference IS NOT NULL));
CONSTRAINT payments_settled_is_not_due CHECK (status = 'PENDING' OR next_attempt_at IS NULL);
CONSTRAINT payments_scenario_known CHECK (scenario IS NULL OR scenario IN ('APPROVE','REJECT','TRANSIENT_FAILURE','TIMEOUT'));
```

**Índices adicionales** (además de PK/UNIQUE declarados arriba):

```sql
CREATE UNIQUE INDEX payments_transaction_key ON payments (transaction_id);
CREATE INDEX payments_due_idx ON payments (next_attempt_at) WHERE status = 'PENDING' AND next_attempt_at IS NOT NULL;
CREATE INDEX payments_status_idx ON payments (status);
```

### `payment_attempts`

Registro local de Payment Service.

Introducida por `002_payment_attempts`.

| Columna | Tipo SQL | Nulo | Default | Clave / relación |
| --- | --- | --- | --- | --- |
| `payment_id` | `UUID` | NO | — | FK → `payments.payment_id`; DELETE CASCADE |
| `attempt_number` | `INTEGER` | NO | — | — |
| `result` | `VARCHAR(20)` | NO | — | — |
| `error_type` | `VARCHAR(20)` | SÍ | — | — |
| `failure_reason` | `TEXT` | SÍ | — | — |
| `occurred_at` | `TIMESTAMPTZ` | NO | `now()` | — |
| `provider_result` | `VARCHAR(20)` | SÍ | — | — |

**Restricciones de tabla y CHECK de columna** (la ausencia de un CHECK enum en SQL no se sustituye por una regla inventada):

```sql
CONSTRAINT payment_attempts_pkey PRIMARY KEY (payment_id, attempt_number);
CONSTRAINT payment_attempts_result_known CHECK (result IN ('SUCCEEDED','FAILED'));
CONSTRAINT payment_attempts_error_type_known CHECK (error_type IS NULL OR error_type IN ('TRANSIENT','PERMANENT'));
CONSTRAINT payment_attempts_success_is_clean CHECK (result = 'FAILED' OR (error_type IS NULL AND failure_reason IS NULL));
CONSTRAINT payment_attempts_provider_result_known CHECK (provider_result IS NULL OR provider_result IN ('SUCCESS','FAILURE','TIMEOUT'));
```

### `outbox_messages`

Bandeja transaccional. En Payment, payment_id permite NULL para eventos interbancarios sin fila payments; la FK local sigue existiendo.

Introducida por `003_outbox_messages`.

| Columna | Tipo SQL | Nulo | Default | Clave / relación |
| --- | --- | --- | --- | --- |
| `id` | `BIGSERIAL` | NO | — | PK |
| `payment_id` | `UUID` | SÍ | — | FK → `payments.payment_id`; DELETE CASCADE |
| `exchange` | `VARCHAR(120)` | NO | — | — |
| `routing_key` | `VARCHAR(200)` | NO | — | — |
| `envelope` | `JSONB` | NO | — | — |
| `dispatch_status` | `VARCHAR(20)` | NO | `'PENDING'` | — |
| `created_at` | `TIMESTAMPTZ` | NO | `now()` | — |
| `published_at` | `TIMESTAMPTZ` | SÍ | — | — |
| `trace_context` | `VARCHAR(80)` | SÍ | — | — |

**Restricciones de tabla y CHECK de columna** (la ausencia de un CHECK enum en SQL no se sustituye por una regla inventada):

```sql
CONSTRAINT outbox_messages_status_known CHECK (dispatch_status IN ('PENDING','DISPATCHED'));
```

**Índices adicionales** (además de PK/UNIQUE declarados arriba):

```sql
CREATE INDEX outbox_messages_pending_idx ON outbox_messages (id) WHERE dispatch_status = 'PENDING';
```

### `payment_simulation_settings`

Una fila; porcentajes no monetarios DOUBLE PRECISION, suma <= 100; latencia entre 0 y 30000 ms.

Introducida por `005_payment_simulation_settings`.

| Columna | Tipo SQL | Nulo | Default | Clave / relación |
| --- | --- | --- | --- | --- |
| `id` | `SMALLINT` | NO | `1` | PK |
| `failure_rate_percent` | `DOUBLE PRECISION` | NO | — | — |
| `timeout_rate_percent` | `DOUBLE PRECISION` | NO | — | — |
| `latency_ms` | `INTEGER` | NO | — | — |
| `updated_at` | `TIMESTAMPTZ` | NO | `now()` | — |

**Restricciones de tabla y CHECK de columna** (la ausencia de un CHECK enum en SQL no se sustituye por una regla inventada):

```sql
CONSTRAINT payment_simulation_single_row CHECK (id = 1);
CONSTRAINT payment_simulation_rates_in_range CHECK (failure_rate_percent BETWEEN 0 AND 100 AND timeout_rate_percent BETWEEN 0 AND 100 AND failure_rate_percent + timeout_rate_percent <= 100);
CONSTRAINT payment_simulation_latency_in_range CHECK (latency_ms BETWEEN 0 AND 30000);
```

### `interbank_deposits`

Recepción v1: ELIGIBILITY, CREDIT, ACCEPTED, REJECTED, CANCELLED; callback y publicación persistidos. Retención de posibles reembolsos.

Introducida por `007_interbank_deposits`.

| Columna | Tipo SQL | Nulo | Default | Clave / relación |
| --- | --- | --- | --- | --- |
| `deposit_id` | `UUID` | NO | — | PK |
| `origin_bank_code` | `VARCHAR(32)` | NO | — | — |
| `external_transfer_id` | `VARCHAR(128)` | NO | — | — |
| `idempotency_key` | `VARCHAR(128)` | NO | — | — |
| `destination_account_id` | `VARCHAR(64)` | NO | — | — |
| `amount_minor` | `BIGINT` | NO | — | — |
| `currency` | `VARCHAR(3)` | NO | — | — |
| `correlation_id` | `UUID` | NO | — | — |
| `origin_envelope` | `JSONB` | NO | — | — |
| `stage` | `VARCHAR(20)` | NO | — | — |
| `rejection_reason` | `VARCHAR(40)` | SÍ | — | — |
| `next_action_at` | `TIMESTAMPTZ` | SÍ | — | — |
| `result_envelope` | `JSONB` | SÍ | — | — |
| `result_published_at` | `TIMESTAMPTZ` | SÍ | — | — |
| `callback_attempts` | `INTEGER` | NO | `0` | — |
| `callback_due_at` | `TIMESTAMPTZ` | SÍ | — | — |
| `callback_delivered_at` | `TIMESTAMPTZ` | SÍ | — | — |
| `created_at` | `TIMESTAMPTZ` | NO | `now()` | — |
| `decided_at` | `TIMESTAMPTZ` | SÍ | — | — |
| `trace_context` | `VARCHAR(80)` | SÍ | — | — |
| `partner_timestamp` | `TIMESTAMPTZ` | SÍ | — | — |
| `origin_account` | `VARCHAR(34)` | SÍ | — | — |
| `partner_created_at` | `TIMESTAMPTZ` | SÍ | — | — |
| `partner_expires_at` | `TIMESTAMPTZ` | SÍ | — | — |
| `description` | `VARCHAR(140)` | SÍ | — | — |
| `credit_account_ref` | `VARCHAR(64)` | SÍ | — | — |
| `hold_reversal_id` | `UUID` | SÍ | — | — |
| `refund_of_reversal_id` | `UUID` | SÍ | — | — |
| `claimed_until` | `TIMESTAMPTZ` | SÍ | — | — |

**Restricciones de tabla y CHECK de columna** (la ausencia de un CHECK enum en SQL no se sustituye por una regla inventada):

```sql
CONSTRAINT interbank_deposits_amount_minor_check CHECK (amount_minor > 0);
CONSTRAINT interbank_deposits_origin_bank_code_external_transfer_id_key UNIQUE (origin_bank_code, external_transfer_id);
CONSTRAINT interbank_deposits_origin_bank_code_idempotency_key_key UNIQUE (origin_bank_code, idempotency_key);
CONSTRAINT interbank_deposits_stage_check CHECK (stage IN ('ELIGIBILITY','CREDIT','ACCEPTED','REJECTED','CANCELLED'));
CONSTRAINT interbank_deposits_decided_at_check CHECK ((stage IN ('ACCEPTED','REJECTED','CANCELLED')) = (decided_at IS NOT NULL));
CONSTRAINT interbank_deposits_reason_check CHECK ((stage IN ('REJECTED','CANCELLED')) = (rejection_reason IS NOT NULL));
CONSTRAINT interbank_deposits_result_check CHECK ((stage IN ('ACCEPTED','REJECTED','CANCELLED')) = (result_envelope IS NOT NULL));
```

**Índices adicionales** (además de PK/UNIQUE declarados arriba):

```sql
CREATE INDEX interbank_action_due_idx ON interbank_deposits (next_action_at) WHERE next_action_at IS NOT NULL;
CREATE INDEX interbank_callback_due_idx ON interbank_deposits (callback_due_at) WHERE callback_due_at IS NOT NULL;
CREATE INDEX interbank_deposit_expiry_idx ON interbank_deposits (partner_expires_at) WHERE stage IN ('ELIGIBILITY','CREDIT');
CREATE INDEX interbank_deposit_reconciliation_idx ON interbank_deposits (origin_bank_code, created_at);
CREATE INDEX interbank_deposit_held_idx ON interbank_deposits (hold_reversal_id) WHERE hold_reversal_id IS NOT NULL;
```

### `interbank_conflicts`

Conflictos de recepción por contenido diferente; evidencia y callback independiente.

Introducida por `008_interbank_conflicts`.

| Columna | Tipo SQL | Nulo | Default | Clave / relación |
| --- | --- | --- | --- | --- |
| `message_id` | `UUID` | NO | — | PK |
| `origin_envelope` | `JSONB` | NO | — | — |
| `result_envelope` | `JSONB` | NO | — | — |
| `result_published_at` | `TIMESTAMPTZ` | SÍ | — | — |
| `callback_attempts` | `INTEGER` | NO | `0` | — |
| `callback_due_at` | `TIMESTAMPTZ` | NO | — | — |
| `callback_delivered_at` | `TIMESTAMPTZ` | SÍ | — | — |
| `created_at` | `TIMESTAMPTZ` | NO | `now()` | — |
| `trace_context` | `VARCHAR(80)` | SÍ | — | — |
| `claimed_until` | `TIMESTAMPTZ` | SÍ | — | — |

**Índices adicionales** (además de PK/UNIQUE declarados arriba):

```sql
CREATE INDEX interbank_conflict_callback_due_idx ON interbank_conflicts (callback_due_at) WHERE callback_delivered_at IS NULL;
```

### `interbank_sends`

Envío, reserva, sondeo, cancelación, reverso automático y liquidación de reembolso. TIMEOUT no decide ni compensa; decided_at se conserva como marca física de vencimiento.

Introducida por `010_interbank_sends`.

| Columna | Tipo SQL | Nulo | Default | Clave / relación |
| --- | --- | --- | --- | --- |
| `interbank_transfer_id` | `VARCHAR(128)` | NO | — | PK |
| `payment_id` | `UUID` | NO | — | UNIQUE |
| `transaction_id` | `UUID` | NO | — | — |
| `idempotency_key` | `VARCHAR(128)` | NO | — | UNIQUE |
| `destination_bank_code` | `VARCHAR(32)` | NO | — | — |
| `destination_account` | `VARCHAR(64)` | NO | — | — |
| `amount_minor` | `BIGINT` | NO | — | — |
| `currency` | `VARCHAR(3)` | NO | — | — |
| `correlation_id` | `UUID` | NO | — | — |
| `origin_envelope` | `JSONB` | NO | — | — |
| `state` | `VARCHAR(12)` | NO | — | — |
| `reason` | `VARCHAR(64)` | SÍ | — | — |
| `attempts` | `INTEGER` | NO | `0` | — |
| `next_attempt_at` | `TIMESTAMPTZ` | SÍ | — | — |
| `confirmation_due_at` | `TIMESTAMPTZ` | NO | — | — |
| `trace_context` | `VARCHAR(80)` | SÍ | — | — |
| `created_at` | `TIMESTAMPTZ` | NO | `now()` | — |
| `sent_at` | `TIMESTAMPTZ` | SÍ | — | — |
| `decided_at` | `TIMESTAMPTZ` | SÍ | — | — |
| `reversed_at` | `TIMESTAMPTZ` | SÍ | — | — |
| `verdict_enqueued_at` | `TIMESTAMPTZ` | SÍ | — | — |
| `release_not_before` | `TIMESTAMPTZ` | SÍ | — | — |
| `probe_kind` | `VARCHAR(12)` | SÍ | — | — |
| `probe_status` | `VARCHAR(12)` | SÍ | — | — |
| `probed_at` | `TIMESTAMPTZ` | SÍ | — | — |
| `cancel_kind` | `VARCHAR(12)` | SÍ | — | — |
| `cancel_result` | `VARCHAR(20)` | SÍ | — | — |
| `cancel_requested_at` | `TIMESTAMPTZ` | SÍ | — | — |
| `resolve_not_before` | `TIMESTAMPTZ` | SÍ | — | — |
| `origin_account` | `VARCHAR(34)` | SÍ | — | — |
| `customer_id` | `UUID` | SÍ | — | — |
| `probe_attempts` | `INTEGER` | NO | `0` | — |
| `cancel_attempts` | `INTEGER` | NO | `0` | — |
| `reversal_id` | `UUID` | SÍ | — | — |
| `reversal_state` | `VARCHAR(12)` | SÍ | — | — |
| `reversal_attempts` | `INTEGER` | NO | `0` | — |
| `reversal_next_at` | `TIMESTAMPTZ` | SÍ | — | — |
| `reversal_requested_at` | `TIMESTAMPTZ` | SÍ | — | — |
| `reversal_refund_transfer_id` | `UUID` | SÍ | — | — |
| `reversal_message` | `VARCHAR(200)` | SÍ | — | — |
| `refund_settled_at` | `TIMESTAMPTZ` | SÍ | — | — |
| `refund_inbound_id` | `VARCHAR(128)` | SÍ | — | — |
| `claimed_until` | `TIMESTAMPTZ` | SÍ | — | — |

**Restricciones de tabla y CHECK de columna** (la ausencia de un CHECK enum en SQL no se sustituye por una regla inventada):

```sql
CONSTRAINT interbank_sends_amount_minor_check CHECK (amount_minor > 0);
CONSTRAINT interbank_sends_state_check CHECK (state IN ('PENDING','SENT','ACCEPTED','REJECTED','TIMEOUT','REVERSED'));
CONSTRAINT interbank_sends_check CHECK ((state IN ('ACCEPTED','REJECTED','TIMEOUT','REVERSED')) = (decided_at IS NOT NULL));
CONSTRAINT interbank_sends_check1 CHECK ((state IN ('REJECTED','TIMEOUT','REVERSED')) = (reason IS NOT NULL));
CONSTRAINT interbank_sends_check2 CHECK ((state = 'REVERSED') = (reversed_at IS NOT NULL));
CONSTRAINT interbank_sends_check3 CHECK ((state = 'PENDING') = (next_attempt_at IS NOT NULL));
CONSTRAINT interbank_sends_probe_known CHECK (probe_kind IS NULL OR probe_kind IN ('ANSWERED','UNKNOWN','UNREACHABLE'));
CONSTRAINT interbank_sends_cancel_known CHECK (cancel_kind IS NULL OR cancel_kind IN ('ANSWERED','UNREACHABLE'));
CONSTRAINT interbank_sends_probe_coherent CHECK ((probe_kind = 'ANSWERED') IS NOT TRUE OR probe_status IS NOT NULL);
CONSTRAINT interbank_sends_cancel_coherent CHECK ((cancel_kind = 'ANSWERED') IS NOT TRUE OR cancel_result IS NOT NULL);
CONSTRAINT interbank_sends_reversal_known CHECK (reversal_state IS NULL OR reversal_state IN ('PENDING','PROCESSING','COMPLETED','FAILED'));
CONSTRAINT interbank_sends_reversal_coherent CHECK ((reversal_id IS NULL) = (reversal_state IS NULL));
CONSTRAINT interbank_sends_reversal_after_release CHECK (reversal_id IS NULL OR state IN ('REJECTED','REVERSED'));
CONSTRAINT interbank_sends_refund_coherent CHECK ((refund_settled_at IS NULL) = (refund_inbound_id IS NULL) AND (refund_settled_at IS NULL OR reversal_id IS NOT NULL));
```

**Índices adicionales** (además de PK/UNIQUE declarados arriba):

```sql
CREATE INDEX interbank_send_attempt_due_idx ON interbank_sends (next_attempt_at) WHERE state = 'PENDING';
CREATE INDEX interbank_send_confirmation_due_idx ON interbank_sends (confirmation_due_at) WHERE state IN ('PENDING','SENT');
CREATE INDEX interbank_send_transaction_idx ON interbank_sends (transaction_id);
CREATE INDEX interbank_sends_resolving_idx ON interbank_sends (resolve_not_before) WHERE state = 'TIMEOUT' AND release_not_before IS NOT NULL;
CREATE INDEX interbank_sends_unreconciled_idx ON interbank_sends (decided_at) WHERE state IN ('ACCEPTED','REJECTED') AND verdict_enqueued_at IS NULL;
CREATE INDEX interbank_sends_customer_idx ON interbank_sends (customer_id, created_at DESC);
CREATE INDEX interbank_sends_reversal_due_idx ON interbank_sends (reversal_next_at) WHERE reversal_state IN ('PENDING','PROCESSING');
CREATE UNIQUE INDEX interbank_sends_refund_once ON interbank_sends (refund_inbound_id) WHERE refund_inbound_id IS NOT NULL;
```

### `interbank_reversals`

Reversos solicitados a este receptor. original_transfer_id es referencia lógica sin FK.

Introducida por `013_interbank_reversals`.

| Columna | Tipo SQL | Nulo | Default | Clave / relación |
| --- | --- | --- | --- | --- |
| `reversal_id` | `UUID` | NO | — | PK |
| `original_transfer_id` | `UUID` | NO | — | UNIQUE |
| `requester_bank_code` | `VARCHAR(8)` | NO | — | — |
| `amount_minor` | `BIGINT` | NO | — | — |
| `status` | `VARCHAR(12)` | NO | — | — |
| `refund_transfer_id` | `UUID` | SÍ | — | — |
| `reason_message` | `VARCHAR(200)` | SÍ | — | — |
| `origin_envelope` | `JSONB` | NO | — | — |
| `trace_context` | `TEXT` | SÍ | — | — |
| `created_at` | `TIMESTAMPTZ` | NO | `now()` | — |
| `completed_at` | `TIMESTAMPTZ` | SÍ | — | — |

**Restricciones de tabla y CHECK de columna** (la ausencia de un CHECK enum en SQL no se sustituye por una regla inventada):

```sql
CONSTRAINT interbank_reversals_amount_minor_check CHECK (amount_minor > 0);
CONSTRAINT interbank_reversals_status_check CHECK (status IN ('PROCESSING','COMPLETED','FAILED'));
CONSTRAINT interbank_reversals_check CHECK ((status = 'COMPLETED') = (refund_transfer_id IS NOT NULL));
CONSTRAINT interbank_reversals_check1 CHECK ((status = 'COMPLETED') = (completed_at IS NOT NULL));
CONSTRAINT interbank_reversals_check2 CHECK ((status = 'FAILED') = (reason_message IS NOT NULL));
```

**Índices adicionales** (además de PK/UNIQUE declarados arriba):

```sql
CREATE INDEX interbank_reversal_pending_idx ON interbank_reversals (created_at) WHERE status = 'PROCESSING';
```

### `interbank_send_history`

Historial de estados del depósito enviado. Sin FK a interbank_sends por decisión explícita de migración016.

Introducida por `016_interbank_sends_t60`.

| Columna | Tipo SQL | Nulo | Default | Clave / relación |
| --- | --- | --- | --- | --- |
| `history_id` | `BIGSERIAL` | NO | — | PK |
| `interbank_transfer_id` | `VARCHAR(128)` | NO | — | — |
| `state` | `VARCHAR(12)` | NO | — | — |
| `reason` | `VARCHAR(64)` | SÍ | — | — |
| `at` | `TIMESTAMPTZ` | NO | — | — |

**Restricciones de tabla y CHECK de columna** (la ausencia de un CHECK enum en SQL no se sustituye por una regla inventada):

```sql
CONSTRAINT interbank_send_history_state_check CHECK (state IN ('PENDING','SENT','ACCEPTED','REJECTED','TIMEOUT','REVERSED'));
```

**Índices adicionales** (además de PK/UNIQUE declarados arriba):

```sql
CREATE INDEX interbank_send_history_idx ON interbank_send_history (interbank_transfer_id, history_id);
```

### `schema_migrations`

Infraestructura del migrador, no entidad de dominio. Se crea fuera de MIGRATIONS antes de aplicarlas; una tabla en cada base.

Introducida por `migrate(pool), fuera de MIGRATIONS`.

| Columna | Tipo SQL | Nulo | Default | Clave / relación |
| --- | --- | --- | --- | --- |
| `name` | `TEXT` | NO | — | PK |
| `applied_at` | `TIMESTAMPTZ` | NO | `now()` | — |

## Notification & Audit Service

Fuente: [`migrations.ts`](../../apps/services/notification-audit-service/src/infrastructure/persistence/migrations.ts).

Migraciones aplicadas al modelo documental: `001_audit_events`, `002_notifications`, `003_processed_messages`, `004_notifications_inbox`, `005_event_severity`, `006_trace_id_and_dedupe_key`, `007_slo_alert_notifications`.

### `audit_events`

Payload redactado antes de insertar. PK compuesta event_id/consumer; trace_id opcional sin inventar historia.

Introducida por `001_audit_events`.

| Columna | Tipo SQL | Nulo | Default | Clave / relación |
| --- | --- | --- | --- | --- |
| `event_id` | `UUID` | NO | — | — |
| `message_type` | `VARCHAR(100)` | NO | — | — |
| `message_version` | `INTEGER` | NO | — | — |
| `producer` | `VARCHAR(100)` | NO | — | — |
| `occurred_at` | `TIMESTAMPTZ` | NO | — | — |
| `received_at` | `TIMESTAMPTZ` | NO | `now()` | — |
| `correlation_id` | `UUID` | NO | — | — |
| `causation_id` | `UUID` | SÍ | — | — |
| `payload` | `JSONB` | NO | — | — |
| `processing_status` | `VARCHAR(20)` | NO | — | — |
| `consumer` | `VARCHAR(60)` | NO | — | — |
| `severity` | `VARCHAR(10)` | SÍ | — | — |
| `trace_id` | `VARCHAR(32)` | SÍ | — | — |

**Restricciones de tabla y CHECK de columna** (la ausencia de un CHECK enum en SQL no se sustituye por una regla inventada):

```sql
CONSTRAINT audit_events_once_per_consumer PRIMARY KEY (event_id, consumer);
CONSTRAINT audit_events_status_known CHECK (processing_status IN ('PROCESSED','INVALID','ERROR'));
CONSTRAINT audit_events_severity_known CHECK (severity IS NULL OR severity IN ('INFO','WARNING','ERROR'));
CONSTRAINT audit_events_trace_id_shape CHECK (trace_id IS NULL OR (trace_id ~ '^[0-9a-f]{32}$' AND trace_id <> repeat('0', 32)));
```

**Índices adicionales** (además de PK/UNIQUE declarados arriba):

```sql
CREATE INDEX audit_events_correlation_idx ON audit_events (correlation_id, occurred_at);
CREATE INDEX audit_events_type_idx ON audit_events (message_type, occurred_at DESC);
CREATE INDEX audit_events_severity_idx ON audit_events (severity, occurred_at DESC);
CREATE INDEX audit_events_trace_idx ON audit_events (trace_id, occurred_at) WHERE trace_id IS NOT NULL;
CREATE INDEX audit_events_producer_idx ON audit_events (producer, occurred_at DESC);
```

### `notifications`

Buzón por customer_id y entrega por canal simulado o Resend; dedupe_key separa recordatorios SLO.

Introducida por `002_notifications`.

| Columna | Tipo SQL | Nulo | Default | Clave / relación |
| --- | --- | --- | --- | --- |
| `notification_id` | `UUID` | NO | — | PK |
| `type` | `VARCHAR(50)` | NO | — | — |
| `channel` | `VARCHAR(20)` | NO | `'EMAIL'` | — |
| `recipient` | `VARCHAR(200)` | SÍ | — | — |
| `reference_id` | `UUID` | SÍ | — | — |
| `subject` | `VARCHAR(200)` | NO | — | — |
| `status` | `VARCHAR(20)` | NO | `'PENDING'` | — |
| `correlation_id` | `UUID` | NO | — | — |
| `caused_by` | `UUID` | SÍ | — | — |
| `created_at` | `TIMESTAMPTZ` | NO | `now()` | — |
| `processed_at` | `TIMESTAMPTZ` | SÍ | — | — |
| `customer_id` | `UUID` | SÍ | — | — |
| `read_at` | `TIMESTAMPTZ` | SÍ | — | — |
| `severity` | `VARCHAR(10)` | SÍ | — | — |
| `dedupe_key` | `VARCHAR(200)` | SÍ | — | — |

**Restricciones de tabla y CHECK de columna** (la ausencia de un CHECK enum en SQL no se sustituye por una regla inventada):

```sql
CONSTRAINT notifications_status_known CHECK (status IN ('PENDING','SENT','FAILED'));
CONSTRAINT notifications_channel_known CHECK (channel IN ('EMAIL'));
CONSTRAINT notifications_processed_when_settled CHECK ((status = 'PENDING') = (processed_at IS NULL));
CONSTRAINT notifications_severity_known CHECK (severity IS NULL OR severity IN ('INFO','WARNING','ERROR'));
```

**Índices adicionales** (además de PK/UNIQUE declarados arriba):

```sql
CREATE INDEX notifications_correlation_idx ON notifications (correlation_id, created_at);
CREATE INDEX notifications_recent_idx ON notifications (created_at DESC);
CREATE UNIQUE INDEX notifications_one_per_event_idx ON notifications (caused_by, type) WHERE caused_by IS NOT NULL;
CREATE INDEX notifications_customer_idx ON notifications (customer_id, created_at DESC);
CREATE UNIQUE INDEX notifications_one_per_dedupe_key_idx ON notifications (dedupe_key) WHERE dedupe_key IS NOT NULL;
```

### `processed_messages`

Deduplicación local. La clave real depende del servicio: message_id, par con consumer o idempotency_key/message_type.

Introducida por `003_processed_messages`.

| Columna | Tipo SQL | Nulo | Default | Clave / relación |
| --- | --- | --- | --- | --- |
| `message_id` | `UUID` | NO | — | — |
| `consumer` | `VARCHAR(60)` | NO | — | — |
| `message_type` | `VARCHAR(120)` | NO | — | — |
| `outcome` | `VARCHAR(30)` | NO | — | — |
| `deliveries` | `INTEGER` | NO | `1` | — |
| `first_seen_at` | `TIMESTAMPTZ` | NO | `now()` | — |
| `last_seen_at` | `TIMESTAMPTZ` | NO | `now()` | — |

**Restricciones de tabla y CHECK de columna** (la ausencia de un CHECK enum en SQL no se sustituye por una regla inventada):

```sql
CONSTRAINT processed_messages_pkey PRIMARY KEY (message_id, consumer);
```

### `slo_alert_notifications`

Control de repetición por alerta y firing/resolved; no altera la decisión de otros servicios.

Introducida por `007_slo_alert_notifications`.

| Columna | Tipo SQL | Nulo | Default | Clave / relación |
| --- | --- | --- | --- | --- |
| `alert_key` | `VARCHAR(200)` | NO | — | — |
| `status` | `VARCHAR(10)` | NO | — | — |
| `notified_at` | `TIMESTAMPTZ` | NO | — | — |

**Restricciones de tabla y CHECK de columna** (la ausencia de un CHECK enum en SQL no se sustituye por una regla inventada):

```sql
CONSTRAINT slo_alert_notifications_pk PRIMARY KEY (alert_key, status);
CONSTRAINT slo_alert_notifications_status_known CHECK (status IN ('firing','resolved'));
```

### `schema_migrations`

Infraestructura del migrador, no entidad de dominio. Se crea fuera de MIGRATIONS antes de aplicarlas; una tabla en cada base.

Introducida por `migrate(pool), fuera de MIGRATIONS`.

| Columna | Tipo SQL | Nulo | Default | Clave / relación |
| --- | --- | --- | --- | --- |
| `name` | `VARCHAR(120)` | NO | — | PK |
| `applied_at` | `TIMESTAMPTZ` | NO | `now()` | — |
