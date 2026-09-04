# Diagramas Entidad-Relación (ER) por Microservicio — Bank USAC

Este directorio contiene los diagramas Entidad-Relación (ER) de cada una de las **cinco bases de datos independientes** del sistema bancario, garantizando el principio de arquitectura **Database-per-Service** ([ADR-005](../../adr/ADR-005-persistence.md)).

Cada microservicio cuenta con:
1. **Código fuente DBML** (`.dbml`): Especificación declarativa en Database Markup Language.
2. **Exportación gráfica PNG** (`.png`): Generada con alta resolución a través de [databasediagram.com](https://databasediagram.com/app).

---

## Índice de Microservicios

| # | Microservicio | Base de Datos | Tablas Principales | Fuentes | Diagrama |
|---|---------------|---------------|-------------------|---------|----------|
| 1 | **Customer Service** | `customer_db` | `customers`, `identity_documents`, `email_activation_tokens`, `password_reset_tokens`, `processed_messages` | [`.dbml`](customer-er.dbml) | [Ver](#1-customer-service-customer_db) |
| 2 | **Account Service** | `account_db` | `accounts`, `account_operations`, `deactivation_runs`, `processed_messages` | [`.dbml`](account-er.dbml) | [Ver](#2-account-service-account_db) |
| 3 | **Transaction Service** | `transaction_db` | `transactions`, `transaction_events`, `transaction_aliases`, `outbox_messages`, `processed_messages` | [`.dbml`](transaction-er.dbml) | [Ver](#3-transaction-service-transaction_db) |
| 4 | **Payment Service** | `payment_db` | `payments`, `payment_attempts`, `outbox_messages` | [`.dbml`](payment-er.dbml) | [Ver](#4-payment-service-payment_db) |
| 5 | **Notification & Audit Service** | `notification_audit_db` | `audit_events`, `notifications`, `processed_messages` | [`.dbml`](notification-audit-er.dbml) | [Ver](#5-notification--audit-service-notification_audit_db) |

Para consultar el catálogo técnico exhaustivo de tipos de datos, restricciones de integridad, índices y defaults a nivel de columna, consulte el [Esquema Integral de Bases de Datos](../../../generated/db-schema.md).

---

## 1. Customer Service (`customer_db`)
Gestiona la identidad, credenciales scrypt, activación por token y validación de fotografía de documento DPI.

![Diagrama ER - Customer Service](customer-er.png)

* **`customers`**: Almacena clientes, roles (`CLIENTE`, `CAJERO_RECEPTOR`, `ADMINISTRADOR`), estado de activación, hash scrypt y versión para bloqueo optimista. Índice único insensible a mayúsculas sobre `LOWER(email)`.
* **`identity_documents`**: Fotografía del DPI con hash SHA-256 único, tamaño y validación para la mesa de control del cajero.
* **`email_activation_tokens`**: Tokens criptográficos hasheados (24h) para verificación obligatoria de correo electrónico.
* **`password_reset_tokens`**: Tokens hasheados de un solo uso (1h) con invalidación atómica para recuperación de contraseña.
* **`processed_messages`**: Deduplicación idempotente de comandos entrantes por `(idempotency_key, message_type)`.

---

## 2. Account Service (`account_db`)
Gestiona las cuentas bancarias monetarias y de ahorro, saldos exactos en `NUMERIC(14,2)`, operaciones contables inmutables, recaudación de facturadores y desactivación automática.

![Diagrama ER - Account Service](account-er.png)

* **`accounts`**: Cuentas con saldo, tipo (`MONETARIA`, `AHORRO`), versión optimista, restricción `CHECK (balance >= 0)` y columnas colectoras de facturadores (`biller_code`, `biller_name`).
* **`account_operations`**: Libro mayor contable con movimientos de `DEBIT`, `CREDIT` y `COMPENSATION`, saldo posterior garantizado e índice de negocio único por `(transaction_id, type)`.
* **`deactivation_runs`**: Registro auditable de ejecuciones del proceso automático de desactivación de cuentas inactivas con saldo < Q50.00.
* **`processed_messages`**: Idempotencia garantizada por `(idempotency_key, type)`.

---

## 3. Transaction Service (`transaction_db`)
Orquesta la máquina de estados de transferencias monetarias y pagos mediante el patrón Saga Coreografiada.

![Diagrama ER - Transaction Service](transaction-er.png)

* **`transactions`**: Instancias de transferencia con estados finitos (`PENDING`, `DEBITING`, `PAYMENT_PENDING`, `COMPLETED`, `FAILED`, `COMPENSATED`), identidad del solicitante (`customer_id`), referencia de contrato de servicio (`reference`) y escenario simulado.
* **`transaction_events`**: Bitácora inmutable de eventos recibidos y transiciones efectuadas localmente.
* **`transaction_aliases`**: Resolución de reintentos idempotentes que asocian identificadores solicitados (202) con la transferencia canónica.
* **`outbox_messages`**: Patrón Transactional Outbox para publicación confiable y atómica hacia RabbitMQ.
* **`processed_messages`**: Deduplicación por `message_id` del envelope.

---

## 4. Payment Service (`payment_db`)
Procesa pagos a facturadores externos y servicios internos, gestionando la escalera de reintentos y estados de liquidación.

![Diagrama ER - Payment Service](payment-er.png)

* **`payments`**: Pagos solicitados con referencia a la transferencia de origen, montos, escenarios de prueba, próximo intento programado (`next_attempt_at`) e índices de barrido.
* **`payment_attempts`**: Registro auditable e inmutable de cada intento de cobro (ladder de reintentos).
* **`outbox_messages`**: Publicación transaccional de eventos de intento fallido y desenlaces terminales.

---

## 5. Notification & Audit Service (`notification_audit_db`)
Concentra la bitácora transversal inmutable del sistema (con datos personales redactados) y el buzón de notificaciones.

![Diagrama ER - Notification & Audit Service](notification-audit-er.png)

* **`audit_events`**: Registro append-only de eventos de todos los servicios, deduplicado por `(event_id, consumer)` y con payload sensible redactado previamente al insert.
* **`notifications`**: Buzón de notificaciones con control de destinatario, vinculación por cliente (`customer_id`), control de lectura (`read_at`) y despacho simulado.
* **`processed_messages`**: Registro de métricas de entrega y conteo de redelivery para observabilidad operativa.

