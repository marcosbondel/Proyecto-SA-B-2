# Catálogo de conversaciones de dominio

> Inventario T-61, 2026-10-21: 134 contratos actuales (58 comandos, 43 eventos, 33 respuestas), contrastados con `@bank/contracts` compilado. Los 35 mensajes originales de T-02 y las extensiones de T-05 se conservan en el historial; sus antiguos recuentos ya no representan el sistema actual.

Un comando tiene un servicio responsable; un evento tiene uno o más consumidores; una respuesta responde al solicitante. El callback oficial se traduce a `payment.interbank.v1.result.received.v1`, **categoría command**, aunque su nombre describa algo recibido. La categoría ejecutable determina el exchange.

El catálogo de [payloads](../events/catalog.md) muestra los campos derivados de Zod. La [topología](../events/topology.md) describe las colas y las copias de transporte; consumidores declarados y bindings de observación no son la misma cosa. Gateway escucha algunos eventos para cerrar peticiones HTTP y Payment escucha la compensación para registrar REVERSED.

## Conversaciones añadidas en Fase III

| Área | Conversación y responsabilidad |
| --- | --- |
| Identidad | Validación y KYC enlazan trazas sin exportar credenciales o DPI a eventos. |
| Uso de cuentas | `account.anomaly.detected.v1`: Account detecta más de N débitos/créditos en M minutos; auditoría registra WARNING, no bloquea. |
| Simulación | `payment.simulation.update/query/replied.v1`: operador administrador cambia porcentajes/latencia por broker, persistido. |
| Auditoría | `audit.events.list.query.v1` admite correlationId, traceId, servicio y nivel; respuestas conservan traceId cuando existe. |
| Alertas | `alert.slo.received.v1`: Gateway recibe webhook protegido; Audit clasifica, deduplica y notifica sin decidir sobre dinero. |
| Recepción interbancaria | `payment.interbank.v1.*` traduce las siete operaciones protegidas; Account decide elegibilidad y crédito por mensajería. |
| Envío interbancario | Saga habitual y `payment.interbank.sent.v1`; TIMEOUT conserva reserva hasta consultar/cancelar o agotar margen. |
| Consultas del producto | `payment.interbank.send*` expone listado/detalle por identidad, historial y destino enmascarado. |

Los nombres abreviados en esta tabla se desarrollan en el inventario literal siguiente. [INTERBANK](../operations/INTERBANK.md) y [ADR-021](../architecture/adr/ADR-021-interbank-protocol-v1.md) fijan los tres vocabularios de estado: Saga, envío y recepción/reverso.

## Comandos (58)

| Nombre versionado | Productor | Consumidores declarados |
| --- | --- | --- |
| `customer.authenticate.v1` | gateway | customer-service |
| `customer.register.v1` | gateway | customer-service |
| `customer.update.v1` | gateway | customer-service |
| `customer.validate-identity.v1` | gateway | customer-service |
| `customer.get.query.v1` | gateway | customer-service |
| `customer.identity-document.query.v1` | gateway | customer-service |
| `customer.change-password.v1` | gateway | customer-service |
| `customer.password-reset.confirm.v1` | gateway | customer-service |
| `customer.password-reset.requested.v1` | gateway | customer-service |
| `customer.names.query.v1` | gateway | customer-service |
| `customer.pending-validation.query.v1` | gateway | customer-service |
| `customer.list.query.v1` | gateway | customer-service |
| `customer.set-identity-verdict.v1` | gateway | customer-service |
| `customer.set-kyc-status.v1` | gateway | customer-service |
| `customer.kyc.check.requested.v1` | transaction-service | customer-service |
| `customer.verify-email.v1` | gateway | customer-service |
| `account.balance.query.v1` | gateway | account-service |
| `account.create.v1` | gateway | account-service |
| `account.credit.requested.v1` | transaction-service | account-service |
| `customer.stats.query.v1` | gateway | customer-service |
| `account.stats.query.v1` | gateway | account-service |
| `transaction.stats.query.v1` | gateway | transaction-service |
| `payment.stats.query.v1` | gateway | payment-service |
| `audit.stats.query.v1` | gateway | notification-audit-service |
| `account.billers.query.v1` | gateway | account-service |
| `account.deposit.v1` | gateway | account-service |
| `account.debit.compensation.requested.v1` | transaction-service | account-service |
| `account.debit.requested.v1` | transaction-service | account-service |
| `account.list.query.v1` | gateway | account-service |
| `account.operations.query.v1` | gateway | account-service |
| `account.set-status.v1` | gateway | account-service |
| `transaction.list.query.v1` | gateway | transaction-service |
| `transaction.status.requested.v1` | gateway | transaction-service |
| `transfer.requested.v1` | gateway | transaction-service |
| `payment.list.query.v1` | gateway | payment-service |
| `payment.requested.v1` | transaction-service | payment-service |
| `payment.status.query.v1` | gateway | payment-service |
| `payment.simulation.query.v1` | gateway | payment-service |
| `payment.simulation.update.v1` | gateway | payment-service |
| `notification.inbox.query.v1` | gateway | notification-audit-service |
| `notification.mark-read.v1` | gateway | notification-audit-service |
| `notification.list.query.v1` | gateway | notification-audit-service |
| `audit.query.requested.v1` | gateway | notification-audit-service |
| `audit.events.list.query.v1` | gateway | notification-audit-service |
| `alert.slo.received.v1` | gateway | notification-audit-service |
| `payment.interbank.receive.v1` | gateway | payment-service |
| `account.interbank.eligibility.query.v1` | payment-service | account-service |
| `account.interbank.credit.requested.v1` | payment-service | account-service |
| `payment.interbank.callback.received.v1` | gateway | payment-service |
| `payment.interbank.v1.transfer.query.v1` | gateway | payment-service |
| `payment.interbank.send.query.v1` | gateway | payment-service |
| `payment.interbank.send.list.query.v1` | gateway | payment-service |
| `payment.interbank.v1.status.query.v1` | gateway | payment-service |
| `payment.interbank.v1.cancel.query.v1` | gateway | payment-service |
| `payment.interbank.v1.result.received.v1` | gateway | payment-service |
| `payment.interbank.v1.reversal.requested.v1` | gateway | payment-service |
| `payment.interbank.v1.reversal.query.v1` | gateway | payment-service |
| `payment.interbank.v1.reconciliation.query.v1` | gateway | payment-service |

## Eventos (43)

| Nombre versionado | Productor | Consumidores declarados |
| --- | --- | --- |
| `customer.activation.requested.v1` | customer-service | notification-audit-service |
| `customer.email.verification.rejected.v1` | customer-service | notification-audit-service |
| `customer.email.verified.v1` | customer-service | notification-audit-service |
| `customer.identity.rejected.v1` | customer-service | notification-audit-service |
| `customer.identity.validated.v1` | customer-service | notification-audit-service |
| `customer.login.rejected.v1` | customer-service | notification-audit-service |
| `customer.login.succeeded.v1` | customer-service | notification-audit-service |
| `customer.register.rejected.v1` | customer-service | notification-audit-service |
| `customer.registered.v1` | customer-service | notification-audit-service |
| `customer.updated.v1` | customer-service | notification-audit-service |
| `customer.password-changed.v1` | customer-service | notification-audit-service |
| `customer.password-change.rejected.v1` | customer-service | notification-audit-service |
| `customer.password-reset.completed.v1` | customer-service | notification-audit-service |
| `customer.password-reset.issued.v1` | customer-service | notification-audit-service |
| `customer.password-reset.rejected.v1` | customer-service | notification-audit-service |
| `customer.kyc.rejected.v1` | customer-service | notification-audit-service |
| `customer.kyc.verified.v1` | customer-service | notification-audit-service |
| `customer.kyc.checked.v1` | customer-service | transaction-service, notification-audit-service |
| `account.credit.rejected.v1` | account-service | transaction-service, notification-audit-service |
| `account.credited.v1` | account-service | transaction-service, notification-audit-service |
| `account.anomaly.detected.v1` | account-service | notification-audit-service |
| `account.commission.charged.v1` | account-service | notification-audit-service |
| `account.deposited.v1` | account-service | notification-audit-service |
| `account.deposit.rejected.v1` | account-service | notification-audit-service |
| `account.deactivated.v1` | account-service | notification-audit-service |
| `account.debit.compensated.v1` | account-service | transaction-service, notification-audit-service |
| `account.debit.rejected.v1` | account-service | transaction-service, notification-audit-service |
| `account.debited.v1` | account-service | transaction-service, notification-audit-service |
| `account.open.rejected.v1` | account-service | notification-audit-service |
| `account.opened.v1` | account-service | notification-audit-service |
| `account.reactivated.v1` | account-service | notification-audit-service |
| `transaction.compensated.v1` | transaction-service | notification-audit-service |
| `transaction.completed.v1` | transaction-service | notification-audit-service |
| `transaction.failed.v1` | transaction-service | notification-audit-service |
| `transaction.initiated.v1` | transaction-service | notification-audit-service |
| `payment.attempt.failed.v1` | payment-service | transaction-service, notification-audit-service |
| `payment.failed.v1` | payment-service | transaction-service, notification-audit-service |
| `payment.succeeded.v1` | payment-service | transaction-service, notification-audit-service |
| `account.interbank.credited.v1` | account-service | payment-service, notification-audit-service |
| `account.interbank.credit.rejected.v1` | account-service | payment-service, notification-audit-service |
| `payment.interbank.accepted.v1` | payment-service | notification-audit-service |
| `payment.interbank.rejected.v1` | payment-service | notification-audit-service |
| `payment.interbank.sent.v1` | payment-service | notification-audit-service |

## Respuestas (33)

| Nombre versionado | Productor | Consumidores declarados |
| --- | --- | --- |
| `customer.authenticate.replied.v1` | customer-service | gateway |
| `customer.get.replied.v1` | customer-service | gateway |
| `customer.identity-document.replied.v1` | customer-service | gateway |
| `customer.names.replied.v1` | customer-service | gateway |
| `customer.pending-validation.replied.v1` | customer-service | gateway |
| `customer.list.replied.v1` | customer-service | gateway |
| `account.balance.replied.v1` | account-service | gateway |
| `customer.stats.replied.v1` | customer-service | gateway |
| `account.stats.replied.v1` | account-service | gateway |
| `transaction.stats.replied.v1` | transaction-service | gateway |
| `payment.stats.replied.v1` | payment-service | gateway |
| `audit.stats.replied.v1` | notification-audit-service | gateway |
| `account.billers.replied.v1` | account-service | gateway |
| `account.list.replied.v1` | account-service | gateway |
| `account.operations.replied.v1` | account-service | gateway |
| `transaction.list.replied.v1` | transaction-service | gateway |
| `transaction.status.replied.v1` | transaction-service | gateway |
| `payment.list.replied.v1` | payment-service | gateway |
| `payment.status.replied.v1` | payment-service | gateway |
| `payment.simulation.replied.v1` | payment-service | gateway |
| `notification.inbox.replied.v1` | notification-audit-service | gateway |
| `notification.read.replied.v1` | notification-audit-service | gateway |
| `notification.list.replied.v1` | notification-audit-service | gateway |
| `audit.query.replied.v1` | notification-audit-service | gateway |
| `audit.events.list.replied.v1` | notification-audit-service | gateway |
| `account.interbank.eligibility.replied.v1` | account-service | payment-service |
| `payment.interbank.v1.transfer.replied.v1` | payment-service | gateway |
| `payment.interbank.send.replied.v1` | payment-service | gateway |
| `payment.interbank.send.list.replied.v1` | payment-service | gateway |
| `payment.interbank.v1.status.replied.v1` | payment-service | gateway |
| `payment.interbank.v1.cancel.replied.v1` | payment-service | gateway |
| `payment.interbank.v1.reversal.replied.v1` | payment-service | gateway |
| `payment.interbank.v1.reconciliation.replied.v1` | payment-service | gateway |

## Comprobaciones de coherencia

| ID estable | Regla | Verificación actual |
| --- | --- | --- |
| M-1 | Un comando tiene un handler responsable | Los comandos del inventario declaran un consumidor. |
| M-2 | Todo evento tiene consumidor | `defineContract` rechaza eventos huérfanos y la topología verifica ruta. |
| M-3 | Notification & Audit no produce eventos de dominio | Publica respuestas; la alerta entra como comando y no da órdenes de negocio. |
| M-4 | Fallo posterior al débito dispone de compensación | `payment.failed.v1` y `account.credit.rejected.v1` ordenan la misma compensación; TIMEOUT interbancario sin resolver no es aún fallo. |
| M-5 | Datos sensibles no se replican a eventos públicos | Hash de credencial privado; comandos de registro/autenticación sí transportan la entrada necesaria por broker. Auditoría redacta antes de persistir. |
| M-6 | Correlación de extremo a extremo | Envelope obligatorio; `traceparent` va en cabeceras de transporte y se persiste al diferir trabajo. |

**Límite del generador de documentación:** su mapa cubre 48/134 contratos. El inventario actual se reconstruyó desde los metadatos emitidos sin cambiar código; ampliar la prosa/flujo del generador sigue pendiente. Los 134 contratos no son 134 casos de uso ni 134 eventos.
