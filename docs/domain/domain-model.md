# Modelo de Dominio — Bank USAC

Este documento define las **entidades principales del negocio bancario**, sus atributos, relaciones de cardinalidad, invariantes de consistencia y diagramas Entidad-Relación (ER) por microservicio.

---

## 1. Entidades Principales del Negocio Bancario

### A. Cliente (`Customer`)
* **Microservicio Dueño**: Customer Service.
* **Atributos Clave**: `customerId` (UUID), `fullName`, `documentNumber` (DPI único), `email` (único, identificador de login), `birthDate`, `username` (generado determinísticamente con sufijo numérico ante colisiones), `role` (`CLIENTE`, `CAJERO_RECEPTOR`, `ADMINISTRADOR`), `status` (`PENDING_ACTIVATION`, `ACTIVE`), `identityStatus` (`PENDING`, `VALIDATED`, `REJECTED`).
* **Invariantes**:
  * Unicidad estricta de DPI, email y username a nivel de índice de base de datos.
  * C-4: `status = ACTIVE` si y solo si `emailVerifiedAt` no es nulo.
  * C-6: Únicamente los usuarios con rol `CLIENTE` pueden poseer cuentas bancarias y requieren validación de fotografía de DPI.

---

### B. Cuenta Bancaria (`Account`)
* **Microservicio Dueño**: Account Service.
* **Atributos Clave**: `accountId` (UUID), `customerId` (referencia opaca al cliente), `accountType` (`MONETARIA`, `AHORRO`), `balance` (`NUMERIC(14,2)` en Quetzales), `status` (`ACTIVE`, `INACTIVE`), `version` (entero para control de concurrencia optimista), `lastActivityAt`.
* **Invariantes**:
  * Saldo no negativo protegido por constraint `CHECK (balance >= 0)`.
  * Toda modificación de saldo se serializa mediante `SELECT ... FOR UPDATE` y avance de `version`.
  * Inactividad: cuentas sin movimientos confirmados por más de 6 meses y saldo < Q50.00 son desactivadas automáticamente por el scheduler.
  * Un depósito en ventanilla reactiva automáticamente una cuenta inactiva.

---

### C. Transacción / Transferencia (`Transaction`)
* **Microservicio Dueño**: Transaction Service.
* **Atributos Clave**: `transactionId` (UUID), `sourceAccount` (UUID), `targetAccount` (UUID), `amount` (`NUMERIC(14,2)` > 0), `status` (máquina de 6 estados: `PENDING`, `DEBITING`, `PAYMENT_PENDING`, `COMPLETED`, `FAILED`, `COMPENSATED`), `correlationId`, `idempotencyKey`.
* **Invariantes**:
  * Las cuentas de origen y destino deben ser estrictamente distintas (`sourceAccount <> targetAccount`).
  * Idempotencia garantizada por constraint único sobre `idempotencyKey`.
  * La disponibilidad de fondos nunca se adivina en Transaction Service: se recibe como evento desde Account Service.

---

### D. Pago (`Payment`)
* **Microservicio Dueño**: Payment Service.
* **Atributos Clave**: `paymentId` (UUID), `transactionId` (UUID), `amount`, `status` (`PENDING`, `SUCCEEDED`, `FAILED`), `attempt` (número de intento actual), `nextAttemptAt`, `providerReference`.
* **Invariantes**:
  * Unicidad estricta de pago por transferencia (`UNIQUE(transaction_id)`).
  * Escalera de reintentos: backoff exponencial programado en columna de base de datos (inmune a reinicios de pods).
  * Los intentos fallidos intermedios emiten `payment.attempt.failed.v1` y solo el desenlace terminal cierra la Saga.

---

### E. Evento de Auditoría y Notificación (`AuditEvent` & `Notification`)
* **Microservicio Dueño**: Notification & Audit Service.
* **Atributos Clave**: `eventId`, `consumer`, `messageType`, `correlationId`, `payload` (redactado sin contraseñas ni DPIs), `recipient`, `subject`, `status` (`PENDING`, `SENT`, `FAILED`), `readAt`.
* **Invariantes**:
  * Append-only inmutable: no existen operaciones de `UPDATE` ni `DELETE` sobre la tabla de auditoría.
  * Deduplicación por clave compuesta primaria `(event_id, consumer)`.

---

## 2. Diagramas Entidad-Relación (ER) por Microservicio

El diseño físico de cada base de datos se encuentra especificado en formato **DBML**, **Mermaid** y **PNG** en [`docs/architecture/diagrams/er/`](../architecture/diagrams/er/README.md):

1. **Customer Service DB**: [Diagrama ER](../architecture/diagrams/er/customer-er.png) · [DBML](../architecture/diagrams/er/customer-er.dbml)
2. **Account Service DB**: [Diagrama ER](../architecture/diagrams/er/account-er.png) · [DBML](../architecture/diagrams/er/account-er.dbml)
3. **Transaction Service DB**: [Diagrama ER](../architecture/diagrams/er/transaction-er.png) · [DBML](../architecture/diagrams/er/transaction-er.dbml)
4. **Payment Service DB**: [Diagrama ER](../architecture/diagrams/er/payment-er.png) · [DBML](../architecture/diagrams/er/payment-er.dbml)
5. **Notification & Audit Service DB**: [Diagrama ER](../architecture/diagrams/er/notification-audit-er.png) · [DBML](../architecture/diagrams/er/notification-audit-er.dbml)
