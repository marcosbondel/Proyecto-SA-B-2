# Catálogo Canónico de Eventos y Comandos — Bank USAC

Este documento cataloga la totalidad de **mensajes, comandos, eventos de dominio y consultas (Request/Reply)** que circulan a través del broker RabbitMQ, organizados por familia funcional y en estricta sincronía con `@bank/contracts` y los diagramas arquitectónicos y de secuencia.

---

## 1. Familias de Mensajes

El sistema segmenta el tráfico en cinco familias de eventos y comandos:

### A. Familia Clientes (`customer.*`)
* `customer.register.v1` (Comando): Solicitud de registro de cliente con credenciales y datos personales.
* `customer.registered.v1` (Evento): Cliente registrado con éxito en estado `PENDING_ACTIVATION`.
* `customer.register.rejected.v1` (Evento): Solicitud de registro rechazada (correo o documento duplicado).
* `customer.email.verified.v1` (Evento): Cliente verificado mediante token criptográfico de correo, pasando a estado `ACTIVE`.
* `customer.identity.validated.v1` (Evento): Documento de identidad DPI verificado y aprobado por personal bancario (cajero/admin).
* `customer.identity.rejected.v1` (Evento): Documento de identidad rechazado con motivo explicativo.
* `customer.authenticate.v1` (Comando / Request): Solicitud de autenticación de credenciales (email y contraseña scrypt).
* `customer.authenticate.replied.v1` (Reply): Resultado de autenticación con perfil, rol y estado.
* `customer.update.v1` (Comando) / `customer.updated.v1` (Evento): Actualización de datos personales del perfil.
* `customer.password-reset.requested.v1` (Evento): Solicitud de restablecimiento de contraseña generada.
* `customer.password-reset.completed.v1` (Evento): Contraseña restablecida con éxito mediante token.
* `customer.password.changed.v1` (Evento): Cambio de contraseña voluntario desde la sesión autenticada.
* `customer.details.query.v1` / `customer.details.replied.v1`: Consulta y respuesta de ficha técnica de cliente.
* `customer.list.query.v1` / `customer.list.replied.v1`: Consulta y respuesta paginada del directorio de usuarios para administración.
* `customer.identity-document.query.v1` / `customer.identity-document.replied.v1`: Consulta de documento fotográfico DPI desde MinIO.

### B. Familia Cuentas (`account.*`)
* `account.create.v1` (Comando): Solicitud de apertura de cuenta bancaria (`MONETARIA` o `AHORRO`).
* `account.opened.v1` (Evento): Cuenta creada exitosamente en estado `ACTIVE` con saldo inicial Q 0.00.
* `account.open.rejected.v1` (Evento): Apertura de cuenta rechazada por falta de elegibilidad (rol o identidad no verificada). *Nota: En diagramas de secuencia referenciado como `account.open-rejected.v1`, alias soportado.*
* `account.debit.requested.v1` (Comando): Solicitud de débito atómico de fondos bajo bloqueo de fila `SELECT ... FOR UPDATE`.
* `account.debited.v1` (Evento): Débito aplicado con éxito y saldo descontado del libro mayor.
* `account.debit.rejected.v1` (Evento): Débito rechazado (saldo insuficiente `INSUFFICIENT_FUNDS` o cuenta `ACCOUNT_INACTIVE`).
* `account.credit.requested.v1` (Comando): Solicitud de crédito a cuenta destino.
* `account.credited.v1` (Evento): Crédito aplicado con éxito y saldo incrementado (reactiva cuentas inactivas si aplica).
* `account.credit.rejected.v1` (Evento): Crédito rechazado ante cuenta inexistente.
* `account.debit.compensation.requested.v1` (Comando): Solicitud de compensación contable tras fallo en la Saga.
* `account.debit.compensated.v1` (Evento): Fondos restituidos formalmente a la cuenta origen como movimiento compensatorio.
* `account.deposit.v1` (Comando): Depósito en efectivo por ventanilla.
* `account.deposited.v1` (Evento): Depósito acreditado en la cuenta del cliente.
* `account.deposit.rejected.v1` (Evento): Depósito rechazado por monto o estado de cuenta inválido.
* `account.deactivated.v1` (Evento): Cuenta desactivada por el scheduler de inactividad (6 meses sin movimientos y saldo < Q 50.00).
* `account.reactivated.v1` (Evento): Cuenta reactivada automáticamente tras recibir un crédito o depósito.
* `account.set-status.v1` (Comando): Cambio de estado manual administrativo.
* `account.balance.query.v1` / `account.balance.replied.v1`: Consulta y respuesta de saldo y metadatos de cuenta.
* `account.operations.query.v1` / `account.operations.replied.v1`: Consulta y respuesta del libro mayor de movimientos contables.
* `account.list.query.v1` / `account.list.replied.v1`: Consulta de directorio de cuentas por titular o para cajero.
* `account.billers.query.v1` / `account.billers.replied.v1`: Catálogo de facturadores de servicios (EEGSA, EMPAGUA, CLARO) con sus cuentas recaudadoras.

### C. Familia Transacciones (`transaction.*` y `transfer.*`)
* `transfer.requested.v1` (Comando): Solicitud inicial de transferencia entre cuentas o pago de servicio.
* `transaction.initiated.v1` (Evento): Transacción registrada en la máquina de estados en estado `PENDING`.
* `transaction.completed.v1` (Evento): Saga completada con éxito (`COMPLETED`) tras confirmar crédito.
* `transaction.failed.v1` (Evento): Transferencia fallida permanentemente (`FAILED`) sin movimiento o por rechazo inicial.
* `transaction.compensated.v1` (Evento): Saga finalizada con restitución de fondos (`COMPENSATED`).
* `transaction.status.requested.v1` / `transaction.status.replied.v1`: Consulta y respuesta del estado de la transacción / Saga.
* `transaction.list.query.v1` / `transaction.list.replied.v1`: Listado de transferencias con alcance por cliente o global para administración.
* `transaction.stats.query.v1` / `transaction.stats.replied.v1`: Métricas agregadas de transacciones para el tablero.

### D. Familia Pagos (`payment.*`)
* `payment.requested.v1` (Comando): Solicitud de procesamiento de cobro ante el simulador de pasarela externa.
* `payment.attempt.failed.v1` (Evento): Intento de pago fallido con indicación de reintento programado en la columna `next_attempt_at`.
* `payment.succeeded.v1` (Evento terminal): Cobro aprobado con éxito ante el proveedor, permitiendo avanzar la Saga hacia el crédito.
* `payment.failed.v1` (Evento terminal): Cobro rechazado permanentemente o escalera de reintentos agotada (dispara compensación).
* `payment.history.query.v1` / `payment.history.replied.v1`: Historial de pagos de servicios e intentos ejecutados.

### E. Familia Auditoría y Notificaciones (`audit.*` y `notification.*`)
* **Auditoría Pasiva (Event Sourcing):** No utiliza comandos de inserción; `Notification & Audit Service` suscribe colas dedicadas a los eventos del bus (`audit.customer`, `audit.account`, `audit.transaction`, `audit.payment`). Aplica `pre-insert redaction` para proteger datos sensibles de forma inmutable.
* `audit.query.requested.v1` / `audit.query.replied.v1`: Consulta forense de eventos vinculados a un `correlationId`.
* `audit.events.list.query.v1` / `audit.events.list.replied.v1`: Consulta administrativa de los eventos más recientes del sistema para la consola forense.
* `audit.stats.query.v1` / `audit.stats.replied.v1`: Métricas agregadas de eventos auditados para el tablero.
* `notification.list.query.v1` / `notification.list.replied.v1`: Consulta del buzón personal de notificaciones del cliente.
* `notification.inbox.query.v1` / `notification.inbox.replied.v1`: Consulta paginada con filtrado de no leídas.
* `notification.mark-read.v1` (Comando): Marca de lectura (`read_at`) de notificaciones por su titular.

Para una especificación exhaustiva de cada campo, schema Zod y pruebas formales, consultar el [Catálogo Completo de Eventos](catalog.md) y el código en [`@bank/contracts`](../../apps/packages/contracts/src/events/).
