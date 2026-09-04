# Esquema Integral de Bases de Datos — Bank USAC

Este documento consolida el catálogo técnico completo, fidedigno y sincronizado de las **cinco bases de datos relacionales independientes** (PostgreSQL 18.4) que implementan el principio de arquitectura **Database-per-Service** ([ADR-005](../architecture/adr/ADR-005-database-engine.md)).

Ningún microservicio puede acceder, leer ni modificar las tablas de otro microservicio de forma directa. La consistencia inter-servicios se garantiza exclusivamente mediante el bus de mensajería asíncrono RabbitMQ y el patrón Saga Coreografiada ([ADR-004](../architecture/adr/ADR-004-message-broker.md), [ADR-009](../architecture/adr/ADR-009-distributed-transactions.md)).

---

## Índice General

1. [Customer Service (`customer_db`)](#1-customer-service-customer_db)
2. [Account Service (`account_db`)](#2-account-service-account_db)
3. [Transaction Service (`transaction_db`)](#3-transaction-service-transaction_db)
4. [Payment Service (`payment_db`)](#4-payment-service-payment_db)
5. [Notification & Audit Service (`notification_audit_db`)](#5-notification--audit-service-notification_audit_db)
6. [Reglas de Opacidad y Fronteras Arquitectónicas](#6-reglas-de-opacidad-y-fronteras-arquitectónicas)

---

## 1. Customer Service (`customer_db`)

* **Puerto Host / Docker**: `5433` / `5432`
* **Usuario**: `customer_app`
* **Base de Datos**: `customer`
* **Propósito**: Gestión de identidades, credenciales cifradas con scrypt, flujo de verificación de correo, recuperación de contraseñas y validación de fotografías de DPI.

### 1.1. Tabla `customers`
Entidad principal del usuario (clientes, cajeros y administradores).

| Columna | Tipo de Dato | Nulo | Default | Restricciones / Notas |
|---|---|---|---|---|
| `customer_id` | `UUID` | NO | — | **PRIMARY KEY** |
| `full_name` | `VARCHAR(200)` | NO | — | Nombre completo del usuario |
| `document_number`| `VARCHAR(50)` | NO | — | **UNIQUE** (CUI/DPI de 13 dígitos) |
| `email` | `VARCHAR(320)` | NO | — | **UNIQUE** (Identificador de inicio de sesión) |
| `birth_date` | `DATE` | NO | — | Validación de edad y coherencia cronológica |
| `address` | `VARCHAR(300)` | SÍ | `NULL` | Dirección física de residencia |
| `username` | `VARCHAR(60)` | NO | — | **UNIQUE** (Generado determinísticamente) |
| `identity_status`| `VARCHAR(20)` | NO | `'PENDING'` | `CHECK (identity_status IN ('PENDING', 'VALIDATED', 'REJECTED'))` |
| `role` | `VARCHAR(20)` | NO | `'CLIENTE'` | `CHECK (role IN ('CLIENTE', 'CAJERO_RECEPTOR', 'ADMINISTRADOR'))` |
| `status` | `VARCHAR(20)` | NO | `'PENDING_ACTIVATION'` | `CHECK ((status = 'ACTIVE') = (email_verified_at IS NOT NULL))` |
| `password_hash` | `VARCHAR(255)` | NO | — | Hash scrypt con sal criptográfica |
| `email_verified_at` | `TIMESTAMPTZ` | SÍ | `NULL` | Fecha/hora de confirmación por token |
| `version` | `INTEGER` | NO | `0` | Control de concurrencia optimista |
| `created_at` | `TIMESTAMPTZ` | NO | `now()` | Timestamp de registro |
| `updated_at` | `TIMESTAMPTZ` | NO | `now()` | Timestamp de última modificación |

**Índices**:
* `customers_pkey`: `PRIMARY KEY (customer_id)`
* `customers_document_number_key`: `UNIQUE (document_number)`
* `customers_email_key`: `UNIQUE (email)`
* `customers_email_lower_key`: `UNIQUE (LOWER(email))`
* `customers_username_key`: `UNIQUE (username)`

---

### 1.2. Tabla `identity_documents`
Digitalización y hash de la imagen del documento de identificación DPI.

| Columna | Tipo de Dato | Nulo | Default | Restricciones / Notas |
|---|---|---|---|---|
| `document_id` | `UUID` | NO | — | **PRIMARY KEY** |
| `customer_id` | `UUID` | NO | — | **FOREIGN KEY** $\rightarrow$ `customers(customer_id) ON DELETE CASCADE` |
| `original_filename` | `VARCHAR(255)` | SÍ | `NULL` | Nombre original del archivo |
| `mime_type` | `VARCHAR(100)` | NO | — | `image/jpeg`, `image/png`, `application/pdf` |
| `size_bytes` | `INTEGER` | NO | — | `CHECK (size_bytes > 0 AND size_bytes <= 5242880)` (Máx 5MB) |
| `sha256` | `CHAR(64)` | NO | — | **UNIQUE** (Digest SHA-256 inmutable de la foto) |
| `content` | `BYTEA` | NO | — | Binario de respaldo o miniatura |
| `validation_status` | `VARCHAR(20)` | NO | — | Estado de revisión por el cajero |
| `created_at` | `TIMESTAMPTZ` | NO | `now()` | Timestamp de carga |

**Índices**:
* `identity_documents_pkey`: `PRIMARY KEY (document_id)`
* `identity_documents_sha256_key`: `UNIQUE (sha256)`
* `identity_documents_customer_idx`: `INDEX (customer_id)`

---

### 1.3. Tabla `email_activation_tokens`
Tokens criptográficos de un solo uso para activación de cuenta vía correo electrónico.

| Columna | Tipo de Dato | Nulo | Default | Restricciones / Notas |
|---|---|---|---|---|
| `token_id` | `UUID` | NO | — | **PRIMARY KEY** |
| `customer_id` | `UUID` | NO | — | **FOREIGN KEY** $\rightarrow$ `customers(customer_id) ON DELETE CASCADE` |
| `token_hash` | `CHAR(64)` | NO | — | **UNIQUE** (Digest SHA-256 del token plano) |
| `expires_at` | `TIMESTAMPTZ` | NO | — | Vigencia del token (24 horas) |
| `used_at` | `TIMESTAMPTZ` | SÍ | `NULL` | Timestamp de consumo |
| `created_at` | `TIMESTAMPTZ` | NO | `now()` | Timestamp de emisión |

**Índices**:
* `email_activation_tokens_pkey`: `PRIMARY KEY (token_id)`
* `email_activation_tokens_token_hash_key`: `UNIQUE (token_hash)`
* `email_activation_tokens_customer_idx`: `INDEX (customer_id)`

---

### 1.4. Tabla `password_reset_tokens`
Tokens de recuperación de credenciales de acceso (vida corta, 1 hora).

| Columna | Tipo de Dato | Nulo | Default | Restricciones / Notas |
|---|---|---|---|---|
| `token_id` | `UUID` | NO | — | **PRIMARY KEY** |
| `customer_id` | `UUID` | NO | — | **FOREIGN KEY** $\rightarrow$ `customers(customer_id) ON DELETE CASCADE` |
| `token_hash` | `CHAR(64)` | NO | — | **UNIQUE** (Digest SHA-256 del token plano) |
| `expires_at` | `TIMESTAMPTZ` | NO | — | Vigencia del token (1 hora) |
| `used_at` | `TIMESTAMPTZ` | SÍ | `NULL` | Timestamp de consumo |
| `created_at` | `TIMESTAMPTZ` | NO | `now()` | Timestamp de emisión |

**Índices**:
* `password_reset_tokens_pkey`: `PRIMARY KEY (token_id)`
* `password_reset_tokens_token_hash_key`: `UNIQUE (token_hash)`
* `password_reset_tokens_customer_idx`: `INDEX (customer_id) WHERE used_at IS NULL`

---

### 1.5. Tabla `processed_messages`
Garantía de idempotencia a nivel de transporte y deduplicación de comandos.

| Columna | Tipo de Dato | Nulo | Default | Restricciones / Notas |
|---|---|---|---|---|
| `message_id` | `UUID` | NO | — | **PRIMARY KEY** |
| `idempotency_key`| `VARCHAR(200)` | NO | — | Clave de idempotencia del comando |
| `message_type` | `VARCHAR(120)` | NO | — | Tipo de mensaje (`customer.register.v1`, etc.) |
| `result_summary` | `JSONB` | NO | — | Respuesta resumida del procesamiento |
| `processed_at` | `TIMESTAMPTZ` | NO | `now()` | Timestamp de ejecución |

**Índices**:
* `processed_messages_pkey`: `PRIMARY KEY (message_id)`
* `processed_messages_once`: `UNIQUE (idempotency_key, message_type)`

---

## 2. Account Service (`account_db`)

* **Puerto Host / Docker**: `5434` / `5432`
* **Usuario**: `account_app`
* **Base de Datos**: `account`
* **Propósito**: Cuentas bancarias monetarias y de ahorro, saldos exactos en `NUMERIC(14,2)`, libro contable inmutable, control de concurrencia pesimista/optimista, cuentas colectoras de facturadores y desactivación automática.

### 2.1. Tabla `accounts`
Registro maestro de cuentas de clientes y cuentas colectoras de facturadores.

| Columna | Tipo de Dato | Nulo | Default | Restricciones / Notas |
|---|---|---|---|---|
| `account_id` | `UUID` | NO | — | **PRIMARY KEY** |
| `customer_id` | `UUID` | NO | — | Referencia opaca a `customers` (sin FK externa) |
| `account_type` | `VARCHAR(10)` | NO | — | `CHECK (account_type IN ('MONETARIA', 'AHORRO'))` |
| `balance` | `NUMERIC(14,2)`| NO | `0.00` | `CHECK (balance >= 0)` (Invariante A-1) |
| `status` | `VARCHAR(10)` | NO | `'ACTIVE'` | `CHECK (status IN ('ACTIVE', 'INACTIVE'))` |
| `last_activity_at` | `TIMESTAMPTZ`| NO | `now()` | Marca de tiempo del último movimiento contable |
| `version` | `INTEGER` | NO | `0` | Bloqueo optimista para concurrencia |
| `biller_code` | `VARCHAR(20)` | SÍ | `NULL` | Código único de facturador (`EEGSA`, `CLARO`, etc.) |
| `biller_name` | `VARCHAR(60)` | SÍ | `NULL` | Nombre descriptivo del facturador |
| `created_at` | `TIMESTAMPTZ` | NO | `now()` | Timestamp de apertura |
| `updated_at` | `TIMESTAMPTZ` | NO | `now()` | Timestamp de actualización |

**Índices**:
* `accounts_pkey`: `PRIMARY KEY (account_id)`
* `accounts_customer_idx`: `INDEX (customer_id)`
* `accounts_inactivity_idx`: `INDEX (status, last_activity_at)`
* `accounts_biller_code_once`: `UNIQUE (biller_code) WHERE biller_code IS NOT NULL`

---

### 2.2. Tabla `account_operations`
Libro mayor contable inmutable (append-only) de movimientos de fondos.

| Columna | Tipo de Dato | Nulo | Default | Restricciones / Notas |
|---|---|---|---|---|
| `operation_id` | `UUID` | NO | — | **PRIMARY KEY** |
| `account_id` | `UUID` | NO | — | **FOREIGN KEY** $\rightarrow$ `accounts(account_id)` |
| `type` | `VARCHAR(20)` | NO | — | `CHECK (type IN ('DEBIT', 'CREDIT', 'COMPENSATION'))` |
| `amount` | `NUMERIC(14,2)`| NO | — | `CHECK (amount > 0)` |
| `balance_after` | `NUMERIC(14,2)`| NO | — | Saldo exacto posterior al movimiento |
| `transaction_id`| `UUID` | SÍ | `NULL` | ID de la transferencia o pago asociado |
| `status` | `VARCHAR(20)` | NO | `'APPLIED'` | `CHECK (status IN ('APPLIED', 'COMPENSATED'))` |
| `idempotency_key`| `VARCHAR(200)`| NO | — | Clave de idempotencia del movimiento |
| `created_at` | `TIMESTAMPTZ` | NO | `now()` | Timestamp inmutable del apunte |

**Índices**:
* `account_operations_pkey`: `PRIMARY KEY (operation_id)`
* `account_operations_once`: `UNIQUE (idempotency_key, type)`
* `account_operations_account_idx`: `INDEX (account_id, created_at DESC)`
* `account_operations_transaction_idx`: `INDEX (transaction_id)`
* `account_operations_transaction_type_once`: `UNIQUE (transaction_id, type) WHERE transaction_id IS NOT NULL`

---

### 2.3. Tabla `deactivation_runs`
Bitácora auditable del proceso programado de desactivación de cuentas inactivas.

| Columna | Tipo de Dato | Nulo | Default | Restricciones / Notas |
|---|---|---|---|---|
| `run_id` | `UUID` | NO | — | **PRIMARY KEY** |
| `executed_at` | `TIMESTAMPTZ` | NO | — | Momento de ejecución del proceso |
| `threshold_at` | `TIMESTAMPTZ` | NO | — | Umbral temporal de inactividad (6 meses) |
| `min_balance_minor` | `BIGINT` | NO | — | Saldo menor a Q50.00 expresado en centavos |
| `deactivated_count` | `INTEGER` | NO | — | Total de cuentas pasadas a `INACTIVE` |
| `created_at` | `TIMESTAMPTZ` | NO | `now()` | Timestamp de registro |

---

### 2.4. Tabla `processed_messages`
Deduplicación idempotente de mensajes RabbitMQ procesados por `account-service`.

| Columna | Tipo de Dato | Nulo | Default | Restricciones / Notas |
|---|---|---|---|---|
| `message_id` | `UUID` | NO | — | **PRIMARY KEY** |
| `idempotency_key`| `VARCHAR(200)`| NO | — | Clave de idempotencia |
| `message_type` | `VARCHAR(120)`| NO | — | Tipo de mensaje de comando |
| `result_summary` | `JSONB` | NO | — | Resumen del resultado contable |
| `processed_at` | `TIMESTAMPTZ` | NO | `now()` | Timestamp de procesamiento |

**Índices**:
* `processed_messages_once`: `UNIQUE (idempotency_key, message_type)`

---

## 3. Transaction Service (`transaction_db`)

* **Puerto Host / Docker**: `5435` / `5432`
* **Usuario**: `transaction_app`
* **Base de Datos**: `transaction`
* **Propósito**: Máquina de estados finitos de transferencias monetarias, orquestación del patrón Saga, resolución de alias de reintento y Transactional Outbox.

### 3.1. Tabla `transactions`
Instancias maestras de transferencias entre cuentas.

| Columna | Tipo de Dato | Nulo | Default | Restricciones / Notas |
|---|---|---|---|---|
| `transaction_id` | `UUID` | NO | — | **PRIMARY KEY** |
| `source_account` | `UUID` | NO | — | Cuenta origen (referencia opaca) |
| `target_account` | `UUID` | NO | — | Cuenta destino (referencia opaca) |
| `amount` | `NUMERIC(14,2)`| NO | — | `CHECK (amount > 0)` |
| `status` | `VARCHAR(20)` | NO | `'PENDING'` | `CHECK (status IN ('PENDING', 'DEBITING', 'PAYMENT_PENDING', 'COMPLETED', 'FAILED', 'COMPENSATED'))` |
| `correlation_id` | `UUID` | NO | — | Identificador de trazabilidad distribuida |
| `idempotency_key`| `VARCHAR(200)`| NO | — | **UNIQUE** (Invariantes T-3 y T-4) |
| `failure_reason` | `TEXT` | SÍ | `NULL` | Motivo de rechazo o compensación |
| `payment_scenario`| `VARCHAR(20)`| SÍ | `NULL` | `CHECK (payment_scenario IN ('APPROVE', 'REJECT', 'TRANSIENT_FAILURE'))` |
| `customer_id` | `UUID` | SÍ | `NULL` | Identidad del cliente autenticado que inició el flujo |
| `reference` | `VARCHAR(60)` | SÍ | `NULL` | Referencia de contrato/contador en pagos de servicios |
| `created_at` | `TIMESTAMPTZ` | NO | `now()` | Timestamp de solicitud |
| `updated_at` | `TIMESTAMPTZ` | NO | `now()` | Timestamp de última transición |
| `completed_at` | `TIMESTAMPTZ` | SÍ | `NULL` | Timestamp de cierre de la Saga |

**Restricciones Adicionales**:
* `transactions_accounts_differ`: `CHECK (source_account <> target_account)`

**Índices**:
* `transactions_pkey`: `PRIMARY KEY (transaction_id)`
* `transactions_idempotency_once`: `UNIQUE (idempotency_key)`
* `transactions_correlation_idx`: `INDEX (correlation_id)`
* `transactions_source_idx`: `INDEX (source_account, created_at DESC)`
* `transactions_target_idx`: `INDEX (target_account, created_at DESC)`
* `transactions_customer_idx`: `INDEX (customer_id, created_at DESC)`

---

### 3.2. Tabla `transaction_events`
Bitácora inmutable de transiciones y eventos locales procesados.

| Columna | Tipo de Dato | Nulo | Default | Restricciones / Notas |
|---|---|---|---|---|
| `id` | `BIGSERIAL` | NO | — | **PRIMARY KEY** |
| `transaction_id` | `UUID` | NO | — | **FOREIGN KEY** $\rightarrow$ `transactions(transaction_id)` |
| `event_type` | `VARCHAR(100)`| NO | — | Tipo de evento recibido |
| `payload` | `JSONB` | NO | — | Cuerpo JSON del evento |
| `received_at` | `TIMESTAMPTZ` | NO | `now()` | Timestamp de registro |

**Índices**:
* `transaction_events_transaction_idx`: `INDEX (transaction_id, id)`

---

### 3.3. Tabla `transaction_aliases`
Mapeo de identificadores generados en reintentos HTTP 202 a la transacción canónica existente.

| Columna | Tipo de Dato | Nulo | Default | Restricciones / Notas |
|---|---|---|---|---|
| `requested_transaction_id` | `UUID` | NO | — | **PRIMARY KEY** (ID temporal devuelto al cliente) |
| `transaction_id` | `UUID` | NO | — | **FOREIGN KEY** $\rightarrow$ `transactions(transaction_id)` |
| `created_at` | `TIMESTAMPTZ` | NO | `now()` | Timestamp de mapeo |

**Índices**:
* `transaction_aliases_target_idx`: `INDEX (transaction_id)`

---

### 3.4. Tabla `outbox_messages`
Patrón Transactional Outbox para publicación atómica de comandos y eventos hacia RabbitMQ.

| Columna | Tipo de Dato | Nulo | Default | Restricciones / Notas |
|---|---|---|---|---|
| `id` | `BIGSERIAL` | NO | — | **PRIMARY KEY** |
| `transaction_id` | `UUID` | NO | — | **FOREIGN KEY** $\rightarrow$ `transactions(transaction_id)` |
| `exchange` | `VARCHAR(120)`| NO | — | Exchange RabbitMQ de destino |
| `routing_key` | `VARCHAR(200)`| NO | — | Routing key del mensaje |
| `envelope` | `JSONB` | NO | — | Envolvente completa del mensaje |
| `dispatch_status`| `VARCHAR(20)` | NO | `'PENDING'`| `CHECK (dispatch_status IN ('PENDING', 'DISPATCHED'))` |
| `created_at` | `TIMESTAMPTZ` | NO | `now()` | Timestamp de encolado transaccional |
| `published_at` | `TIMESTAMPTZ` | SÍ | `NULL` | Timestamp de confirmación de publicación |

**Índices**:
* `outbox_messages_pending_idx`: `INDEX (id) WHERE dispatch_status = 'PENDING'`

---

### 3.5. Tabla `processed_messages`
Deduplicación de mensajes entrantes mediante el `messageId` del envelope.

| Columna | Tipo de Dato | Nulo | Default | Restricciones / Notas |
|---|---|---|---|---|
| `message_id` | `UUID` | NO | — | **PRIMARY KEY** |
| `message_type` | `VARCHAR(120)`| NO | — | Tipo de mensaje recibido |
| `transaction_id`| `UUID` | NO | — | ID de la transacción afectada |
| `outcome` | `VARCHAR(30)` | NO | — | Resultado del procesamiento |
| `processed_at` | `TIMESTAMPTZ` | NO | `now()` | Timestamp de procesamiento |

---

## 4. Payment Service (`payment_db`)

* **Puerto Host / Docker**: `5436` / `5432`
* **Usuario**: `payment_app`
* **Base de Datos**: `payment`
* **Propósito**: Ejecución y simulación de pagos a facturadores y pasarelas externas, escalera de reintentos determinista y Transactional Outbox.

### 4.1. Tabla `payments`
Registro de pagos solicitados por la Saga.

| Columna | Tipo de Dato | Nulo | Default | Restricciones / Notas |
|---|---|---|---|---|
| `payment_id` | `UUID` | NO | — | **PRIMARY KEY** (originado por Transaction Service) |
| `transaction_id` | `UUID` | NO | — | **UNIQUE** (referencia opaca a la transferencia) |
| `amount` | `NUMERIC(14,2)`| NO | — | `CHECK (amount > 0)` |
| `status` | `VARCHAR(20)` | NO | `'PENDING'`| `CHECK (status IN ('PENDING', 'SUCCEEDED', 'FAILED'))` |
| `attempt` | `INTEGER` | SÍ | `NULL` | Número del último intento ejecutado |
| `error_type` | `VARCHAR(20)` | SÍ | `NULL` | `CHECK (error_type IN ('TRANSIENT', 'PERMANENT'))` |
| `failure_reason` | `TEXT` | SÍ | `NULL` | Motivo terminal de rechazo |
| `provider_reference` | `VARCHAR(100)`| SÍ | `NULL` | Referencia entregada por el proveedor externo |
| `scenario` | `VARCHAR(20)` | SÍ | `NULL` | `CHECK (scenario IN ('APPROVE', 'REJECT', 'TRANSIENT_FAILURE'))` |
| `origin_correlation_id`| `UUID` | SÍ | `NULL` | Trazabilidad del flujo original |
| `next_attempt_at` | `TIMESTAMPTZ` | SÍ | `NULL` | Próximo intento programado en la escalera |
| `created_at` | `TIMESTAMPTZ` | NO | `now()` | Timestamp de solicitud |
| `updated_at` | `TIMESTAMPTZ` | NO | `now()` | Timestamp de actualización |
| `decided_at` | `TIMESTAMPTZ` | SÍ | `NULL` | Timestamp de resolución final |

**Índices**:
* `payments_pkey`: `PRIMARY KEY (payment_id)`
* `payments_transaction_key`: `UNIQUE (transaction_id)`
* `payments_due_idx`: `INDEX (next_attempt_at) WHERE status = 'PENDING' AND next_attempt_at IS NOT NULL`
* `payments_status_idx`: `INDEX (status)`

---

### 4.2. Tabla `payment_attempts`
Historial inmutable de cada intento de cobro en la escalera de reintentos.

| Columna | Tipo de Dato | Nulo | Default | Restricciones / Notas |
|---|---|---|---|---|
| `payment_id` | `UUID` | NO | — | **PRIMARY KEY** / **FOREIGN KEY** $\rightarrow$ `payments(payment_id) ON DELETE CASCADE` |
| `attempt_number` | `INTEGER` | NO | — | **PRIMARY KEY** (Número de intento secuencial) |
| `result` | `VARCHAR(20)` | NO | — | `CHECK (result IN ('SUCCEEDED', 'FAILED'))` |
| `error_type` | `VARCHAR(20)` | SÍ | `NULL` | `CHECK (error_type IN ('TRANSIENT', 'PERMANENT'))` |
| `failure_reason` | `TEXT` | SÍ | `NULL` | Causa técnica del fallo en este intento |
| `occurred_at` | `TIMESTAMPTZ` | NO | `now()` | Timestamp del intento |

---

### 4.3. Tabla `outbox_messages`
Transactional Outbox para publicación confiable de eventos de pago hacia el broker.

| Columna | Tipo de Dato | Nulo | Default | Restricciones / Notas |
|---|---|---|---|---|
| `id` | `BIGSERIAL` | NO | — | **PRIMARY KEY** |
| `payment_id` | `UUID` | NO | — | **FOREIGN KEY** $\rightarrow$ `payments(payment_id) ON DELETE CASCADE` |
| `exchange` | `VARCHAR(120)`| NO | — | Exchange RabbitMQ (`payment.events`) |
| `routing_key` | `VARCHAR(200)`| NO | — | Routing key (`payment.attempt.failed.v1`, etc.) |
| `envelope` | `JSONB` | NO | — | Envolvente completa del evento |
| `dispatch_status`| `VARCHAR(20)` | NO | `'PENDING'`| `CHECK (dispatch_status IN ('PENDING', 'DISPATCHED'))` |
| `created_at` | `TIMESTAMPTZ` | NO | `now()` | Timestamp de creación |
| `published_at` | `TIMESTAMPTZ` | SÍ | `NULL` | Timestamp de publicación al broker |

**Índices**:
* `outbox_messages_pending_idx`: `INDEX (id) WHERE dispatch_status = 'PENDING'`

---

## 5. Notification & Audit Service (`notification_audit_db`)

* **Puerto Host / Docker**: `5437` / `5432`
* **Usuario**: `notification_audit_app`
* **Base de Datos**: `notification_audit`
* **Propósito**: Bitácora inmutable transversal de eventos (redactada de datos sensibles y montos), buzón de notificaciones de clientes y métricas de consumo RabbitMQ.

### 5.1. Tabla `audit_events`
Pista de auditoría append-only de todos los eventos del sistema financiero.

| Columna | Tipo de Dato | Nulo | Default | Restricciones / Notas |
|---|---|---|---|---|
| `event_id` | `UUID` | NO | — | **PRIMARY KEY** (envelope `messageId`) |
| `consumer` | `VARCHAR(60)` | NO | — | **PRIMARY KEY** (Cola familiar que consumió el evento) |
| `message_type` | `VARCHAR(100)`| NO | — | Tipo de evento de dominio |
| `message_version`| `INTEGER` | NO | — | Versión del contrato del mensaje |
| `producer` | `VARCHAR(100)`| NO | — | Microservicio emisor |
| `occurred_at` | `TIMESTAMPTZ` | NO | — | Timestamp según el reloj del productor |
| `received_at` | `TIMESTAMPTZ` | NO | `now()` | Timestamp de llegada al servicio de auditoría |
| `correlation_id` | `UUID` | NO | — | Identificador de correlación transversal |
| `causation_id` | `UUID` | SÍ | `NULL` | Identificador del evento causal |
| `payload` | `JSONB` | NO | — | **Payload previamente redactado** (sin contraseñas ni montos) |
| `processing_status`| `VARCHAR(20)`| NO | — | `CHECK (processing_status IN ('PROCESSED', 'INVALID', 'ERROR'))` |

**Índices**:
* `audit_events_once_per_consumer`: `PRIMARY KEY (event_id, consumer)`
* `audit_events_correlation_idx`: `INDEX (correlation_id, occurred_at)`
* `audit_events_type_idx`: `INDEX (message_type, occurred_at DESC)`

---

### 5.2. Tabla `notifications`
Buzón de notificaciones emitidas y canal simulado de correo.

| Columna | Tipo de Dato | Nulo | Default | Restricciones / Notas |
|---|---|---|---|---|
| `notification_id`| `UUID` | NO | — | **PRIMARY KEY** |
| `customer_id` | `UUID` | SÍ | `NULL` | Cliente dueño de la notificación en su buzón personal |
| `type` | `VARCHAR(50)` | NO | — | Tipo de notificación (`customer.activation`, etc.) |
| `channel` | `VARCHAR(20)` | NO | `'EMAIL'` | `CHECK (channel IN ('EMAIL'))` |
| `recipient` | `VARCHAR(200)`| SÍ | `NULL` | Destinatario derivado/simulado para privacidad |
| `reference_id` | `UUID` | SÍ | `NULL` | Referencia a la entidad de negocio |
| `subject` | `VARCHAR(200)`| NO | — | Asunto de la comunicación |
| `status` | `VARCHAR(20)` | NO | `'PENDING'`| `CHECK (status IN ('PENDING', 'SENT', 'FAILED'))` |
| `correlation_id` | `UUID` | NO | — | Identificador de trazabilidad de la operación |
| `caused_by` | `UUID` | SÍ | `NULL` | ID del evento causante de la notificación |
| `read_at` | `TIMESTAMPTZ` | SÍ | `NULL` | Fecha/hora en que el cliente leyó la notificación |
| `created_at` | `TIMESTAMPTZ` | NO | `now()` | Timestamp de generación |
| `processed_at` | `TIMESTAMPTZ` | SÍ | `NULL` | Timestamp de resolución/despacho simulado |

**Índices**:
* `notifications_pkey`: `PRIMARY KEY (notification_id)`
* `notifications_correlation_idx`: `INDEX (correlation_id, created_at)`
* `notifications_recent_idx`: `INDEX (created_at DESC)`
* `notifications_one_per_event_idx`: `UNIQUE (caused_by, type) WHERE caused_by IS NOT NULL`
* `notifications_customer_idx`: `INDEX (customer_id, created_at DESC)`

---

### 5.3. Tabla `processed_messages`
Monitoreo y observabilidad de consumo y reintentos en las colas de auditoría.

| Columna | Tipo de Dato | Nulo | Default | Restricciones / Notas |
|---|---|---|---|---|
| `message_id` | `UUID` | NO | — | **PRIMARY KEY** (envelope `messageId`) |
| `consumer` | `VARCHAR(60)` | NO | — | **PRIMARY KEY** (familia de consumo) |
| `message_type` | `VARCHAR(120)`| NO | — | Tipo de mensaje recibido |
| `outcome` | `VARCHAR(30)` | NO | — | Resultado del procesamiento |
| `deliveries` | `INTEGER` | NO | `1` | Contador de entregas / redelivery |
| `first_seen_at` | `TIMESTAMPTZ` | NO | `now()` | Timestamp de primera recepción |
| `last_seen_at` | `TIMESTAMPTZ` | NO | `now()` | Timestamp de última recepción |

---

## 6. Reglas de Opacidad y Fronteras Arquitectónicas

1. **Aislamiento Categórico de Datos**:
   * Ninguna tabla en una base de datos contiene claves foráneas (`FOREIGN KEY`) apuntando a tablas de otra base de datos.
   * Los identificadores como `customer_id` en `accounts` o `source_account` en `transactions` son tratados como identificadores opacos sin resolución directa SQL inter-bases.
2. **Representación Monetaria**:
   * En `Account Service`, `Transaction Service` y `Payment Service`, el dinero se modela estrictamente como `NUMERIC(14,2)` con restricciones de positividad `CHECK (amount > 0)`. Nunca se utilizan tipos de coma flotante (`REAL`, `FLOAT`, `DOUBLE PRECISION`) para evitar pérdidas de precisión en cálculos bancarios.
3. **Privacidad de Auditoría**:
   * `notification-audit-service` es el único servicio que escucha eventos de todos los dominios. Por diseño normativo, los payloads son **redactados antes del insert**, asegurando que credenciales, documentos de identidad y montos monetarios exactos nunca se almacenen en la bitácora transversal.
