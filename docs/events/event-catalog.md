# Catálogo de Eventos y Comandos — Bank USAC

Este documento cataloga la totalidad de **mensajes, comandos y eventos de dominio** que circulan a través del broker RabbitMQ, organizados por familia funcional.

---

## 1. Familias de Mensajes

El sistema segmenta el tráfico en cinco familias de eventos y comandos:

### A. Familia Clientes (`customer.*`)
* `customer.register.v1` (Comando): Solicitud de registro de cliente con credenciales y datos personales.
* `customer.registered.v1` (Evento): Cliente registrado con éxito en estado `PENDING_ACTIVATION`.
* `customer.activated.v1` (Evento): Cliente verificado mediante token de correo, pasando a estado `ACTIVE`.
* `customer.identity.validated.v1` (Evento): Documento de identidad DPI verificado por el cajero/admin.
* `customer.identity.rejected.v1` (Evento): Documento de identidad rechazado con motivo explicativo.

### B. Familia Cuentas (`account.*`)
* `account.create.v1` (Comando): Apertura de cuenta bancaria.
* `account.opened.v1` (Evento): Cuenta creada exitosamente con saldo inicial Q 0.00.
* `account.debit.v1` (Comando): Solicitud de débito para transferencia o pago.
* `account.debited.v1` (Evento): Débito aplicado y saldo descontado.
* `account.credit.v1` (Comando): Solicitud de crédito a cuenta destino.
* `account.credited.v1` (Evento): Crédito aplicado y saldo incrementado.
* `account.compensate.v1` (Comando): Solicitud de reversa contable ante fallo en la Saga.
* `account.compensated.v1` (Evento): Fondos restituidos a la cuenta origen.
* `account.deactivated.v1` (Evento): Cuenta desactivada por el scheduler de inactividad.

### C. Familia Transacciones (`transaction.*`)
* `transaction.initiate.v1` (Comando): Solicitud de inicio de transferencia.
* `transaction.started.v1` (Evento): Transacción registrada en estado `PENDING`.
* `transaction.completed.v1` (Evento): Saga completada con éxito (`COMPLETED`).
* `transaction.failed.v1` (Evento): Transferencia fallida permanentemente (`FAILED`).
* `transaction.compensated.v1` (Evento): Saga compensada contablemente (`COMPENSATED`).

### D. Familia Pagos (`payment.*`)
* `payment.process.v1` (Comando): Solicitud de cobro a facturador externo.
* `payment.attempt.failed.v1` (Evento): Intento fallido con indicación de reintento programado.
* `payment.succeeded.v1` (Evento terminal): Pago cobrado con éxito ante el proveedor.
* `payment.failed.v1` (Evento terminal): Escalera de reintentos agotada o rechazo permanente.

### E. Familia Auditoría y Notificaciones (`audit.*`)
* `audit.record.v1` (Comando): Registro de evento en bitácora inmutable.
* `notification.send.v1` (Comando): Despacho de notificación hacia el buzón del usuario.
* `notification.sent.v1` (Evento): Notificación entregada y disponible para lectura.

Para una especificación exhaustiva de cada campo y schema JSON, consultar el [Catálogo Completo de Eventos](catalog.md).
