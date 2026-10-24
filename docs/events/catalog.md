# Catálogo actual de mensajes — Fase III

> Revisión T-61, 2026-10-21. **134 contratos ejecutables**: 58 comandos, 43 eventos y 33 respuestas. Derivado de `schema/index.json` y los JSON Schema emitidos desde Zod, después de compilar el paquete. Las declaraciones de origen siguen siendo la autoridad.

El generador versionado `pnpm --filter @bank/contracts docs:catalog` falla con `Flow listing covers 48 of 134 contracts`: su lista de flujos y prosa cubre 48. Para T-61 un adaptador documental temporal produjo este inventario completo con los metadatos y campos emitidos, sin modificar scripts, esquemas ni contratos. **86 contratos carecen de clasificación de flujo en ese generador**; aquí se identifican como extensiones por familia, sin atribuirles precondiciones o efectos no verificados. El defecto del generador queda pendiente de #167.

La regeneración usa: compilación de `@bank/contracts` → `schema:emit` → lectura ordenada de los 134 metadatos y sus propiedades `required`, tipos y validaciones → enlace al archivo que declara cada nombre. No editar tablas de campos a mano. La clasificación `base` sólo significa que el nombre figura en la lista de 48 del generador; no significa que el contrato o su payload sigan en Fase I.

Las tablas enumeran campos de primer nivel; los objetos, uniones y refinamientos cruzados se consultan en el contrato enlazado. JSON Schema no expresa todos los refinamientos Zod; esta proyección no sustituye la validación ejecutable. Los identificadores `messageId`, `correlationId` y la propagación W3C se explican en [envelope](envelope.md); la responsabilidad funcional está en [dominio](../domain/message-catalog.md).

## Inventario

| Mensaje | Categoría | Productor | Consumidores declarados | Flujo del generador |
| --- | --- | --- | --- | --- |
| `customer.activation.requested.v1` | event | customer-service | notification-audit-service | base |
| `customer.authenticate.replied.v1` | reply | customer-service | gateway | base |
| `customer.authenticate.v1` | command | gateway | customer-service | base |
| `customer.email.verification.rejected.v1` | event | customer-service | notification-audit-service | base |
| `customer.email.verified.v1` | event | customer-service | notification-audit-service | base |
| `customer.identity.rejected.v1` | event | customer-service | notification-audit-service | base |
| `customer.identity.validated.v1` | event | customer-service | notification-audit-service | base |
| `customer.login.rejected.v1` | event | customer-service | notification-audit-service | base |
| `customer.login.succeeded.v1` | event | customer-service | notification-audit-service | base |
| `customer.register.rejected.v1` | event | customer-service | notification-audit-service | base |
| `customer.register.v1` | command | gateway | customer-service | base |
| `customer.registered.v1` | event | customer-service | notification-audit-service | base |
| `customer.update.v1` | command | gateway | customer-service | base |
| `customer.updated.v1` | event | customer-service | notification-audit-service | base |
| `customer.validate-identity.v1` | command | gateway | customer-service | base |
| `customer.get.query.v1` | command | gateway | customer-service | extensión sin mapa de flujo |
| `customer.get.replied.v1` | reply | customer-service | gateway | extensión sin mapa de flujo |
| `customer.identity-document.query.v1` | command | gateway | customer-service | extensión sin mapa de flujo |
| `customer.identity-document.replied.v1` | reply | customer-service | gateway | extensión sin mapa de flujo |
| `customer.change-password.v1` | command | gateway | customer-service | extensión sin mapa de flujo |
| `customer.password-changed.v1` | event | customer-service | notification-audit-service | extensión sin mapa de flujo |
| `customer.password-change.rejected.v1` | event | customer-service | notification-audit-service | extensión sin mapa de flujo |
| `customer.password-reset.completed.v1` | event | customer-service | notification-audit-service | extensión sin mapa de flujo |
| `customer.password-reset.confirm.v1` | command | gateway | customer-service | extensión sin mapa de flujo |
| `customer.password-reset.issued.v1` | event | customer-service | notification-audit-service | extensión sin mapa de flujo |
| `customer.password-reset.rejected.v1` | event | customer-service | notification-audit-service | extensión sin mapa de flujo |
| `customer.password-reset.requested.v1` | command | gateway | customer-service | extensión sin mapa de flujo |
| `customer.names.query.v1` | command | gateway | customer-service | extensión sin mapa de flujo |
| `customer.names.replied.v1` | reply | customer-service | gateway | extensión sin mapa de flujo |
| `customer.pending-validation.query.v1` | command | gateway | customer-service | extensión sin mapa de flujo |
| `customer.pending-validation.replied.v1` | reply | customer-service | gateway | extensión sin mapa de flujo |
| `customer.list.query.v1` | command | gateway | customer-service | extensión sin mapa de flujo |
| `customer.list.replied.v1` | reply | customer-service | gateway | extensión sin mapa de flujo |
| `customer.set-identity-verdict.v1` | command | gateway | customer-service | extensión sin mapa de flujo |
| `customer.set-kyc-status.v1` | command | gateway | customer-service | extensión sin mapa de flujo |
| `customer.kyc.rejected.v1` | event | customer-service | notification-audit-service | extensión sin mapa de flujo |
| `customer.kyc.verified.v1` | event | customer-service | notification-audit-service | extensión sin mapa de flujo |
| `customer.kyc.check.requested.v1` | command | transaction-service | customer-service | extensión sin mapa de flujo |
| `customer.kyc.checked.v1` | event | customer-service | transaction-service, notification-audit-service | extensión sin mapa de flujo |
| `customer.verify-email.v1` | command | gateway | customer-service | base |
| `account.balance.query.v1` | command | gateway | account-service | base |
| `account.balance.replied.v1` | reply | account-service | gateway | base |
| `account.create.v1` | command | gateway | account-service | base |
| `account.credit.rejected.v1` | event | account-service | transaction-service, notification-audit-service | base |
| `account.credit.requested.v1` | command | transaction-service | account-service | base |
| `account.credited.v1` | event | account-service | transaction-service, notification-audit-service | base |
| `customer.stats.query.v1` | command | gateway | customer-service | extensión sin mapa de flujo |
| `customer.stats.replied.v1` | reply | customer-service | gateway | extensión sin mapa de flujo |
| `account.stats.query.v1` | command | gateway | account-service | extensión sin mapa de flujo |
| `account.stats.replied.v1` | reply | account-service | gateway | extensión sin mapa de flujo |
| `transaction.stats.query.v1` | command | gateway | transaction-service | extensión sin mapa de flujo |
| `transaction.stats.replied.v1` | reply | transaction-service | gateway | extensión sin mapa de flujo |
| `payment.stats.query.v1` | command | gateway | payment-service | extensión sin mapa de flujo |
| `payment.stats.replied.v1` | reply | payment-service | gateway | extensión sin mapa de flujo |
| `audit.stats.query.v1` | command | gateway | notification-audit-service | extensión sin mapa de flujo |
| `audit.stats.replied.v1` | reply | notification-audit-service | gateway | extensión sin mapa de flujo |
| `account.billers.query.v1` | command | gateway | account-service | extensión sin mapa de flujo |
| `account.billers.replied.v1` | reply | account-service | gateway | extensión sin mapa de flujo |
| `account.anomaly.detected.v1` | event | account-service | notification-audit-service | extensión sin mapa de flujo |
| `account.commission.charged.v1` | event | account-service | notification-audit-service | extensión sin mapa de flujo |
| `account.deposit.v1` | command | gateway | account-service | extensión sin mapa de flujo |
| `account.deposited.v1` | event | account-service | notification-audit-service | extensión sin mapa de flujo |
| `account.deposit.rejected.v1` | event | account-service | notification-audit-service | extensión sin mapa de flujo |
| `account.deactivated.v1` | event | account-service | notification-audit-service | base |
| `account.debit.compensated.v1` | event | account-service | transaction-service, notification-audit-service | base |
| `account.debit.compensation.requested.v1` | command | transaction-service | account-service | base |
| `account.debit.rejected.v1` | event | account-service | transaction-service, notification-audit-service | base |
| `account.debit.requested.v1` | command | transaction-service | account-service | base |
| `account.debited.v1` | event | account-service | transaction-service, notification-audit-service | base |
| `account.list.query.v1` | command | gateway | account-service | base |
| `account.list.replied.v1` | reply | account-service | gateway | base |
| `account.open.rejected.v1` | event | account-service | notification-audit-service | base |
| `account.opened.v1` | event | account-service | notification-audit-service | base |
| `account.operations.query.v1` | command | gateway | account-service | base |
| `account.operations.replied.v1` | reply | account-service | gateway | base |
| `account.reactivated.v1` | event | account-service | notification-audit-service | base |
| `account.set-status.v1` | command | gateway | account-service | base |
| `transaction.compensated.v1` | event | transaction-service | notification-audit-service | base |
| `transaction.completed.v1` | event | transaction-service | notification-audit-service | base |
| `transaction.failed.v1` | event | transaction-service | notification-audit-service | base |
| `transaction.initiated.v1` | event | transaction-service | notification-audit-service | base |
| `transaction.list.query.v1` | command | gateway | transaction-service | extensión sin mapa de flujo |
| `transaction.list.replied.v1` | reply | transaction-service | gateway | extensión sin mapa de flujo |
| `transaction.status.replied.v1` | reply | transaction-service | gateway | base |
| `transaction.status.requested.v1` | command | gateway | transaction-service | base |
| `transfer.requested.v1` | command | gateway | transaction-service | base |
| `payment.attempt.failed.v1` | event | payment-service | transaction-service, notification-audit-service | extensión sin mapa de flujo |
| `payment.failed.v1` | event | payment-service | transaction-service, notification-audit-service | base |
| `payment.list.query.v1` | command | gateway | payment-service | extensión sin mapa de flujo |
| `payment.list.replied.v1` | reply | payment-service | gateway | extensión sin mapa de flujo |
| `payment.requested.v1` | command | transaction-service | payment-service | base |
| `payment.status.query.v1` | command | gateway | payment-service | extensión sin mapa de flujo |
| `payment.status.replied.v1` | reply | payment-service | gateway | extensión sin mapa de flujo |
| `payment.simulation.query.v1` | command | gateway | payment-service | extensión sin mapa de flujo |
| `payment.simulation.replied.v1` | reply | payment-service | gateway | extensión sin mapa de flujo |
| `payment.simulation.update.v1` | command | gateway | payment-service | extensión sin mapa de flujo |
| `payment.succeeded.v1` | event | payment-service | transaction-service, notification-audit-service | base |
| `notification.inbox.query.v1` | command | gateway | notification-audit-service | extensión sin mapa de flujo |
| `notification.inbox.replied.v1` | reply | notification-audit-service | gateway | extensión sin mapa de flujo |
| `notification.mark-read.v1` | command | gateway | notification-audit-service | extensión sin mapa de flujo |
| `notification.read.replied.v1` | reply | notification-audit-service | gateway | extensión sin mapa de flujo |
| `notification.list.query.v1` | command | gateway | notification-audit-service | extensión sin mapa de flujo |
| `notification.list.replied.v1` | reply | notification-audit-service | gateway | extensión sin mapa de flujo |
| `audit.query.replied.v1` | reply | notification-audit-service | gateway | base |
| `audit.query.requested.v1` | command | gateway | notification-audit-service | base |
| `audit.events.list.query.v1` | command | gateway | notification-audit-service | extensión sin mapa de flujo |
| `audit.events.list.replied.v1` | reply | notification-audit-service | gateway | extensión sin mapa de flujo |
| `alert.slo.received.v1` | command | gateway | notification-audit-service | extensión sin mapa de flujo |
| `payment.interbank.receive.v1` | command | gateway | payment-service | extensión sin mapa de flujo |
| `account.interbank.eligibility.query.v1` | command | payment-service | account-service | extensión sin mapa de flujo |
| `account.interbank.eligibility.replied.v1` | reply | account-service | payment-service | extensión sin mapa de flujo |
| `account.interbank.credit.requested.v1` | command | payment-service | account-service | extensión sin mapa de flujo |
| `account.interbank.credited.v1` | event | account-service | payment-service, notification-audit-service | extensión sin mapa de flujo |
| `account.interbank.credit.rejected.v1` | event | account-service | payment-service, notification-audit-service | extensión sin mapa de flujo |
| `payment.interbank.accepted.v1` | event | payment-service | notification-audit-service | extensión sin mapa de flujo |
| `payment.interbank.rejected.v1` | event | payment-service | notification-audit-service | extensión sin mapa de flujo |
| `payment.interbank.callback.received.v1` | command | gateway | payment-service | extensión sin mapa de flujo |
| `payment.interbank.sent.v1` | event | payment-service | notification-audit-service | extensión sin mapa de flujo |
| `payment.interbank.v1.transfer.query.v1` | command | gateway | payment-service | extensión sin mapa de flujo |
| `payment.interbank.v1.transfer.replied.v1` | reply | payment-service | gateway | extensión sin mapa de flujo |
| `payment.interbank.send.query.v1` | command | gateway | payment-service | extensión sin mapa de flujo |
| `payment.interbank.send.replied.v1` | reply | payment-service | gateway | extensión sin mapa de flujo |
| `payment.interbank.send.list.query.v1` | command | gateway | payment-service | extensión sin mapa de flujo |
| `payment.interbank.send.list.replied.v1` | reply | payment-service | gateway | extensión sin mapa de flujo |
| `payment.interbank.v1.status.query.v1` | command | gateway | payment-service | extensión sin mapa de flujo |
| `payment.interbank.v1.status.replied.v1` | reply | payment-service | gateway | extensión sin mapa de flujo |
| `payment.interbank.v1.cancel.query.v1` | command | gateway | payment-service | extensión sin mapa de flujo |
| `payment.interbank.v1.cancel.replied.v1` | reply | payment-service | gateway | extensión sin mapa de flujo |
| `payment.interbank.v1.result.received.v1` | command | gateway | payment-service | extensión sin mapa de flujo |
| `payment.interbank.v1.reversal.requested.v1` | command | gateway | payment-service | extensión sin mapa de flujo |
| `payment.interbank.v1.reversal.query.v1` | command | gateway | payment-service | extensión sin mapa de flujo |
| `payment.interbank.v1.reversal.replied.v1` | reply | payment-service | gateway | extensión sin mapa de flujo |
| `payment.interbank.v1.reconciliation.query.v1` | command | gateway | payment-service | extensión sin mapa de flujo |
| `payment.interbank.v1.reconciliation.replied.v1` | reply | payment-service | gateway | extensión sin mapa de flujo |

## Familia `account`

### `account.balance.query.v1`

**command** · gateway → account-service. Exchange `bank.commands`; routing key `account.balance.query.v1`.

Contrato: [`account.balance.query.v1.ts`](../../apps/packages/contracts/src/events/account/account.balance.query.v1.ts).

| Campo | Tipo / valores | Obligatorio | Validación emitida |
| --- | --- | --- | --- |
| `accountId` | uuid | sí | pattern=^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12})$ |

### `account.balance.replied.v1`

**reply** · account-service → gateway. Exchange `bank.replies`; routing key `account.balance.replied.v1`.

Contrato: [`account.balance.replied.v1.ts`](../../apps/packages/contracts/src/events/account/account.balance.replied.v1.ts).

| Campo | Tipo / valores | Obligatorio | Validación emitida |
| --- | --- | --- | --- |
| — | Unión/variante: consultar contrato | — | — |

### `account.create.v1`

**command** · gateway → account-service. Exchange `bank.commands`; routing key `account.create.v1`.

Contrato: [`account.create.v1.ts`](../../apps/packages/contracts/src/events/account/account.create.v1.ts).

| Campo | Tipo / valores | Obligatorio | Validación emitida |
| --- | --- | --- | --- |
| `accountId` | uuid | sí | pattern=^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12})$ |
| `customerId` | uuid | sí | pattern=^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12})$ |
| `accountType` | `MONETARIA` \| `AHORRO` | sí | — |
| `initialDeposit` | object | no | — |

### `account.credit.rejected.v1`

**event** · account-service → transaction-service, notification-audit-service. Exchange `bank.events`; routing key `account.credit.rejected.v1`.

Contrato: [`account.credit.rejected.v1.ts`](../../apps/packages/contracts/src/events/account/account.credit.rejected.v1.ts).

| Campo | Tipo / valores | Obligatorio | Validación emitida |
| --- | --- | --- | --- |
| `transactionId` | uuid | sí | pattern=^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12})$ |
| `accountId` | uuid | sí | pattern=^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12})$ |
| `reason` | `ACCOUNT_NOT_FOUND` \| `INVALID_AMOUNT_PRECISION` | sí | — |

### `account.credit.requested.v1`

**command** · transaction-service → account-service. Exchange `bank.commands`; routing key `account.credit.requested.v1`.

Contrato: [`account.credit.requested.v1.ts`](../../apps/packages/contracts/src/events/account/account.credit.requested.v1.ts).

| Campo | Tipo / valores | Obligatorio | Validación emitida |
| --- | --- | --- | --- |
| `transactionId` | uuid | sí | pattern=^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12})$ |
| `accountId` | uuid | sí | pattern=^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12})$ |
| `amount` | object | sí | — |

### `account.credited.v1`

**event** · account-service → transaction-service, notification-audit-service. Exchange `bank.events`; routing key `account.credited.v1`.

Contrato: [`account.credited.v1.ts`](../../apps/packages/contracts/src/events/account/account.credited.v1.ts).

| Campo | Tipo / valores | Obligatorio | Validación emitida |
| --- | --- | --- | --- |
| `transactionId` | uuid | sí | pattern=^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12})$ |
| `accountId` | uuid | sí | pattern=^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12})$ |
| `amount` | object | sí | — |
| `balanceAfter` | object | sí | — |
| `reactivated` | boolean | sí | — |
| `creditedAt` | date-time | sí | pattern=^(?:(?:\d\d[2468][048]\|\d\d[13579][26]\|\d\d0[48]\|[02468][048]00\|[13579][26]00)-02-29\|\d{4}-(?:(?:0[13578]\|1[02])-(?:0[1-9]\|[12]\d\|3[01])\|(?:0[469]\|11)-(?:0[1-9]\|[12]\d\|30)\|(?:02)-(?:0[1-9]\|1\d\|2[0-8])))T(?:(?:[01]\d\|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d+)?)?(?:Z))$ |

### `account.stats.query.v1`

**command** · gateway → account-service. Exchange `bank.commands`; routing key `account.stats.query.v1`.

Contrato: [`account.stats.query.v1.ts`](../../apps/packages/contracts/src/events/account/account.stats.query.v1.ts).

| Campo | Tipo / valores | Obligatorio | Validación emitida |
| --- | --- | --- | --- |
| — | Unión/variante: consultar contrato | — | — |

### `account.stats.replied.v1`

**reply** · account-service → gateway. Exchange `bank.replies`; routing key `account.stats.replied.v1`.

Contrato: [`account.stats.replied.v1.ts`](../../apps/packages/contracts/src/events/account/account.stats.replied.v1.ts).

| Campo | Tipo / valores | Obligatorio | Validación emitida |
| --- | --- | --- | --- |
| `active` | integer | sí | minimum=0; maximum=9007199254740991 |
| `inactive` | integer | sí | minimum=0; maximum=9007199254740991 |
| `openedToday` | integer | sí | minimum=0; maximum=9007199254740991 |
| `depositsToday` | integer | sí | minimum=0; maximum=9007199254740991 |
| `depositedToday` | object | sí | — |

### `account.billers.query.v1`

**command** · gateway → account-service. Exchange `bank.commands`; routing key `account.billers.query.v1`.

Contrato: [`account.billers.query.v1.ts`](../../apps/packages/contracts/src/events/account/account.billers.query.v1.ts).

| Campo | Tipo / valores | Obligatorio | Validación emitida |
| --- | --- | --- | --- |
| — | Unión/variante: consultar contrato | — | — |

### `account.billers.replied.v1`

**reply** · account-service → gateway. Exchange `bank.replies`; routing key `account.billers.replied.v1`.

Contrato: [`account.billers.replied.v1.ts`](../../apps/packages/contracts/src/events/account/account.billers.replied.v1.ts).

| Campo | Tipo / valores | Obligatorio | Validación emitida |
| --- | --- | --- | --- |
| `billers` | array de object | sí | — |

### `account.anomaly.detected.v1`

**event** · account-service → notification-audit-service. Exchange `bank.events`; routing key `account.anomaly.detected.v1`.

Contrato: [`account.anomaly.detected.v1.ts`](../../apps/packages/contracts/src/events/account/account.anomaly.detected.v1.ts).

| Campo | Tipo / valores | Obligatorio | Validación emitida |
| --- | --- | --- | --- |
| `accountId` | uuid | sí | pattern=^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12})$ |
| `customerId` | uuid | no | pattern=^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12})$ |
| `accountType` | `MONETARIA` \| `AHORRO` | sí | — |
| `rule` | `HIGH_FREQUENCY` | sí | — |
| `operationCount` | integer | sí | maximum=9007199254740991; exclusiveMinimum=0 |
| `threshold` | integer | sí | maximum=9007199254740991; exclusiveMinimum=0 |
| `windowMinutes` | integer | sí | maximum=9007199254740991; exclusiveMinimum=0 |
| `windowStart` | date-time | sí | pattern=^(?:(?:\d\d[2468][048]\|\d\d[13579][26]\|\d\d0[48]\|[02468][048]00\|[13579][26]00)-02-29\|\d{4}-(?:(?:0[13578]\|1[02])-(?:0[1-9]\|[12]\d\|3[01])\|(?:0[469]\|11)-(?:0[1-9]\|[12]\d\|30)\|(?:02)-(?:0[1-9]\|1\d\|2[0-8])))T(?:(?:[01]\d\|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d+)?)?(?:Z))$ |
| `detectedAt` | date-time | sí | pattern=^(?:(?:\d\d[2468][048]\|\d\d[13579][26]\|\d\d0[48]\|[02468][048]00\|[13579][26]00)-02-29\|\d{4}-(?:(?:0[13578]\|1[02])-(?:0[1-9]\|[12]\d\|3[01])\|(?:0[469]\|11)-(?:0[1-9]\|[12]\d\|30)\|(?:02)-(?:0[1-9]\|1\d\|2[0-8])))T(?:(?:[01]\d\|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d+)?)?(?:Z))$ |

### `account.commission.charged.v1`

**event** · account-service → notification-audit-service. Exchange `bank.events`; routing key `account.commission.charged.v1`.

Contrato: [`account.commission.charged.v1.ts`](../../apps/packages/contracts/src/events/account/account.commission.charged.v1.ts).

| Campo | Tipo / valores | Obligatorio | Validación emitida |
| --- | --- | --- | --- |
| `accountId` | uuid | sí | pattern=^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12})$ |
| `transactionId` | uuid | sí | pattern=^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12})$ |
| `amount` | object | sí | — |
| `balanceAfter` | object | sí | — |
| `chargedAt` | date-time | sí | pattern=^(?:(?:\d\d[2468][048]\|\d\d[13579][26]\|\d\d0[48]\|[02468][048]00\|[13579][26]00)-02-29\|\d{4}-(?:(?:0[13578]\|1[02])-(?:0[1-9]\|[12]\d\|3[01])\|(?:0[469]\|11)-(?:0[1-9]\|[12]\d\|30)\|(?:02)-(?:0[1-9]\|1\d\|2[0-8])))T(?:(?:[01]\d\|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d+)?)?(?:Z))$ |

### `account.deposit.v1`

**command** · gateway → account-service. Exchange `bank.commands`; routing key `account.deposit.v1`.

Contrato: [`account.deposit.v1.ts`](../../apps/packages/contracts/src/events/account/account.deposit.v1.ts).

| Campo | Tipo / valores | Obligatorio | Validación emitida |
| --- | --- | --- | --- |
| `depositId` | uuid | sí | pattern=^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12})$ |
| `accountId` | uuid | sí | pattern=^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12})$ |
| `amount` | object | sí | — |
| `description` | string | no | minLength=1; maxLength=140 |

### `account.deposited.v1`

**event** · account-service → notification-audit-service. Exchange `bank.events`; routing key `account.deposited.v1`.

Contrato: [`account.deposited.v1.ts`](../../apps/packages/contracts/src/events/account/account.deposited.v1.ts).

| Campo | Tipo / valores | Obligatorio | Validación emitida |
| --- | --- | --- | --- |
| `depositId` | uuid | sí | pattern=^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12})$ |
| `accountId` | uuid | sí | pattern=^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12})$ |
| `operationId` | uuid | sí | pattern=^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12})$ |
| `amount` | object | sí | — |
| `balanceAfter` | object | sí | — |
| `reactivated` | boolean | sí | — |
| `occurredAt` | date-time | sí | pattern=^(?:(?:\d\d[2468][048]\|\d\d[13579][26]\|\d\d0[48]\|[02468][048]00\|[13579][26]00)-02-29\|\d{4}-(?:(?:0[13578]\|1[02])-(?:0[1-9]\|[12]\d\|3[01])\|(?:0[469]\|11)-(?:0[1-9]\|[12]\d\|30)\|(?:02)-(?:0[1-9]\|1\d\|2[0-8])))T(?:(?:[01]\d\|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d+)?)?(?:Z))$ |

### `account.deposit.rejected.v1`

**event** · account-service → notification-audit-service. Exchange `bank.events`; routing key `account.deposit.rejected.v1`.

Contrato: [`account.deposit.rejected.v1.ts`](../../apps/packages/contracts/src/events/account/account.deposit.rejected.v1.ts).

| Campo | Tipo / valores | Obligatorio | Validación emitida |
| --- | --- | --- | --- |
| `depositId` | uuid | sí | pattern=^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12})$ |
| `reason` | `ACCOUNT_NOT_FOUND` \| `INVALID_AMOUNT_PRECISION` \| `FORBIDDEN_ACCOUNT_ACCESS` | sí | — |
| `occurredAt` | date-time | sí | pattern=^(?:(?:\d\d[2468][048]\|\d\d[13579][26]\|\d\d0[48]\|[02468][048]00\|[13579][26]00)-02-29\|\d{4}-(?:(?:0[13578]\|1[02])-(?:0[1-9]\|[12]\d\|3[01])\|(?:0[469]\|11)-(?:0[1-9]\|[12]\d\|30)\|(?:02)-(?:0[1-9]\|1\d\|2[0-8])))T(?:(?:[01]\d\|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d+)?)?(?:Z))$ |

### `account.deactivated.v1`

**event** · account-service → notification-audit-service. Exchange `bank.events`; routing key `account.deactivated.v1`.

Contrato: [`account.deactivated.v1.ts`](../../apps/packages/contracts/src/events/account/account.deactivated.v1.ts).

| Campo | Tipo / valores | Obligatorio | Validación emitida |
| --- | --- | --- | --- |
| `accountId` | uuid | sí | pattern=^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12})$ |
| `customerId` | uuid | no | pattern=^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12})$ |
| `cause` | `AUTOMATIC_INACTIVITY` \| `ADMINISTRATOR` \| `CUSTOMER` \| `TELLER` | sí | — |
| `balanceAtDeactivation` | object | sí | — |
| `lastActivityAt` | date-time \| null | sí | — |
| `deactivatedAt` | date-time | sí | pattern=^(?:(?:\d\d[2468][048]\|\d\d[13579][26]\|\d\d0[48]\|[02468][048]00\|[13579][26]00)-02-29\|\d{4}-(?:(?:0[13578]\|1[02])-(?:0[1-9]\|[12]\d\|3[01])\|(?:0[469]\|11)-(?:0[1-9]\|[12]\d\|30)\|(?:02)-(?:0[1-9]\|1\d\|2[0-8])))T(?:(?:[01]\d\|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d+)?)?(?:Z))$ |
| `reason` | string \| null | sí | — |

### `account.debit.compensated.v1`

**event** · account-service → transaction-service, notification-audit-service. Exchange `bank.events`; routing key `account.debit.compensated.v1`.

Contrato: [`account.debit.compensated.v1.ts`](../../apps/packages/contracts/src/events/account/account.debit.compensated.v1.ts).

| Campo | Tipo / valores | Obligatorio | Validación emitida |
| --- | --- | --- | --- |
| `transactionId` | uuid | sí | pattern=^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12})$ |
| `accountId` | uuid | sí | pattern=^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12})$ |
| `amount` | object | sí | — |
| `balanceAfter` | object | sí | — |
| `compensatedAt` | date-time | sí | pattern=^(?:(?:\d\d[2468][048]\|\d\d[13579][26]\|\d\d0[48]\|[02468][048]00\|[13579][26]00)-02-29\|\d{4}-(?:(?:0[13578]\|1[02])-(?:0[1-9]\|[12]\d\|3[01])\|(?:0[469]\|11)-(?:0[1-9]\|[12]\d\|30)\|(?:02)-(?:0[1-9]\|1\d\|2[0-8])))T(?:(?:[01]\d\|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d+)?)?(?:Z))$ |

### `account.debit.compensation.requested.v1`

**command** · transaction-service → account-service. Exchange `bank.commands`; routing key `account.debit.compensation.requested.v1`.

Contrato: [`account.debit.compensation.requested.v1.ts`](../../apps/packages/contracts/src/events/account/account.debit.compensation.requested.v1.ts).

| Campo | Tipo / valores | Obligatorio | Validación emitida |
| --- | --- | --- | --- |
| `transactionId` | uuid | sí | pattern=^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12})$ |
| `accountId` | uuid | sí | pattern=^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12})$ |
| `amount` | object | sí | — |
| `triggeredBy` | `PAYMENT_DECLINED` \| `PAYMENT_RETRIES_EXHAUSTED` \| `ACCOUNT_NOT_FOUND` \| `INVALID_AMOUNT_PRECISION` | sí | — |

### `account.debit.rejected.v1`

**event** · account-service → transaction-service, notification-audit-service. Exchange `bank.events`; routing key `account.debit.rejected.v1`.

Contrato: [`account.debit.rejected.v1.ts`](../../apps/packages/contracts/src/events/account/account.debit.rejected.v1.ts).

| Campo | Tipo / valores | Obligatorio | Validación emitida |
| --- | --- | --- | --- |
| `transactionId` | uuid | sí | pattern=^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12})$ |
| `accountId` | uuid | sí | pattern=^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12})$ |
| `reason` | `INSUFFICIENT_FUNDS` \| `ACCOUNT_INACTIVE` \| `ACCOUNT_NOT_FOUND` \| `INVALID_AMOUNT_PRECISION` | sí | — |

### `account.debit.requested.v1`

**command** · transaction-service → account-service. Exchange `bank.commands`; routing key `account.debit.requested.v1`.

Contrato: [`account.debit.requested.v1.ts`](../../apps/packages/contracts/src/events/account/account.debit.requested.v1.ts).

| Campo | Tipo / valores | Obligatorio | Validación emitida |
| --- | --- | --- | --- |
| `transactionId` | uuid | sí | pattern=^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12})$ |
| `accountId` | uuid | sí | pattern=^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12})$ |
| `amount` | object | sí | — |

### `account.debited.v1`

**event** · account-service → transaction-service, notification-audit-service. Exchange `bank.events`; routing key `account.debited.v1`.

Contrato: [`account.debited.v1.ts`](../../apps/packages/contracts/src/events/account/account.debited.v1.ts).

| Campo | Tipo / valores | Obligatorio | Validación emitida |
| --- | --- | --- | --- |
| `transactionId` | uuid | sí | pattern=^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12})$ |
| `accountId` | uuid | sí | pattern=^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12})$ |
| `amount` | object | sí | — |
| `balanceAfter` | object | sí | — |
| `debitedAt` | date-time | sí | pattern=^(?:(?:\d\d[2468][048]\|\d\d[13579][26]\|\d\d0[48]\|[02468][048]00\|[13579][26]00)-02-29\|\d{4}-(?:(?:0[13578]\|1[02])-(?:0[1-9]\|[12]\d\|3[01])\|(?:0[469]\|11)-(?:0[1-9]\|[12]\d\|30)\|(?:02)-(?:0[1-9]\|1\d\|2[0-8])))T(?:(?:[01]\d\|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d+)?)?(?:Z))$ |

### `account.list.query.v1`

**command** · gateway → account-service. Exchange `bank.commands`; routing key `account.list.query.v1`.

Contrato: [`account.list.query.v1.ts`](../../apps/packages/contracts/src/events/account/account.list.query.v1.ts).

| Campo | Tipo / valores | Obligatorio | Validación emitida |
| --- | --- | --- | --- |
| `customerId` | uuid | no | pattern=^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12})$ |
| `status` | `ACTIVE` \| `INACTIVE` | no | — |
| `accountType` | `MONETARIA` \| `AHORRO` | no | — |

### `account.list.replied.v1`

**reply** · account-service → gateway. Exchange `bank.replies`; routing key `account.list.replied.v1`.

Contrato: [`account.list.replied.v1.ts`](../../apps/packages/contracts/src/events/account/account.list.replied.v1.ts).

| Campo | Tipo / valores | Obligatorio | Validación emitida |
| --- | --- | --- | --- |
| `accounts` | array de object | sí | — |

### `account.open.rejected.v1`

**event** · account-service → notification-audit-service. Exchange `bank.events`; routing key `account.open.rejected.v1`.

Contrato: [`account.open.rejected.v1.ts`](../../apps/packages/contracts/src/events/account/account.open.rejected.v1.ts).

| Campo | Tipo / valores | Obligatorio | Validación emitida |
| --- | --- | --- | --- |
| `accountId` | uuid | sí | pattern=^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12})$ |
| `customerId` | uuid | sí | pattern=^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12})$ |
| `reason` | `ROLE_NOT_ELIGIBLE` \| `FORBIDDEN_ACCOUNT_ACCESS` \| `MINIMUM_BALANCE_VIOLATION` | sí | — |
| `rejectedAt` | date-time | sí | pattern=^(?:(?:\d\d[2468][048]\|\d\d[13579][26]\|\d\d0[48]\|[02468][048]00\|[13579][26]00)-02-29\|\d{4}-(?:(?:0[13578]\|1[02])-(?:0[1-9]\|[12]\d\|3[01])\|(?:0[469]\|11)-(?:0[1-9]\|[12]\d\|30)\|(?:02)-(?:0[1-9]\|1\d\|2[0-8])))T(?:(?:[01]\d\|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d+)?)?(?:Z))$ |

### `account.opened.v1`

**event** · account-service → notification-audit-service. Exchange `bank.events`; routing key `account.opened.v1`.

Contrato: [`account.opened.v1.ts`](../../apps/packages/contracts/src/events/account/account.opened.v1.ts).

| Campo | Tipo / valores | Obligatorio | Validación emitida |
| --- | --- | --- | --- |
| `accountId` | uuid | sí | pattern=^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12})$ |
| `customerId` | uuid | sí | pattern=^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12})$ |
| `accountType` | `MONETARIA` \| `AHORRO` | sí | — |
| `status` | `ACTIVE` | sí | — |
| `balance` | object | sí | — |
| `openedAt` | date-time | sí | pattern=^(?:(?:\d\d[2468][048]\|\d\d[13579][26]\|\d\d0[48]\|[02468][048]00\|[13579][26]00)-02-29\|\d{4}-(?:(?:0[13578]\|1[02])-(?:0[1-9]\|[12]\d\|3[01])\|(?:0[469]\|11)-(?:0[1-9]\|[12]\d\|30)\|(?:02)-(?:0[1-9]\|1\d\|2[0-8])))T(?:(?:[01]\d\|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d+)?)?(?:Z))$ |

### `account.operations.query.v1`

**command** · gateway → account-service. Exchange `bank.commands`; routing key `account.operations.query.v1`.

Contrato: [`account.operations.query.v1.ts`](../../apps/packages/contracts/src/events/account/account.operations.query.v1.ts).

| Campo | Tipo / valores | Obligatorio | Validación emitida |
| --- | --- | --- | --- |
| `accountId` | uuid | sí | pattern=^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12})$ |

### `account.operations.replied.v1`

**reply** · account-service → gateway. Exchange `bank.replies`; routing key `account.operations.replied.v1`.

Contrato: [`account.operations.replied.v1.ts`](../../apps/packages/contracts/src/events/account/account.operations.replied.v1.ts).

| Campo | Tipo / valores | Obligatorio | Validación emitida |
| --- | --- | --- | --- |
| — | Unión/variante: consultar contrato | — | — |

### `account.reactivated.v1`

**event** · account-service → notification-audit-service. Exchange `bank.events`; routing key `account.reactivated.v1`.

Contrato: [`account.reactivated.v1.ts`](../../apps/packages/contracts/src/events/account/account.reactivated.v1.ts).

| Campo | Tipo / valores | Obligatorio | Validación emitida |
| --- | --- | --- | --- |
| `accountId` | uuid | sí | pattern=^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12})$ |
| `customerId` | uuid | no | pattern=^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12})$ |
| `cause` | `CREDIT_RECEIVED` \| `ADMINISTRATOR` \| `CUSTOMER` \| `TELLER` | sí | — |
| `reactivatedAt` | date-time | sí | pattern=^(?:(?:\d\d[2468][048]\|\d\d[13579][26]\|\d\d0[48]\|[02468][048]00\|[13579][26]00)-02-29\|\d{4}-(?:(?:0[13578]\|1[02])-(?:0[1-9]\|[12]\d\|3[01])\|(?:0[469]\|11)-(?:0[1-9]\|[12]\d\|30)\|(?:02)-(?:0[1-9]\|1\d\|2[0-8])))T(?:(?:[01]\d\|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d+)?)?(?:Z))$ |

### `account.set-status.v1`

**command** · gateway → account-service. Exchange `bank.commands`; routing key `account.set-status.v1`.

Contrato: [`account.set-status.v1.ts`](../../apps/packages/contracts/src/events/account/account.set-status.v1.ts).

| Campo | Tipo / valores | Obligatorio | Validación emitida |
| --- | --- | --- | --- |
| `accountId` | uuid | sí | pattern=^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12})$ |
| `status` | `ACTIVE` \| `INACTIVE` | sí | — |
| `reason` | string | no | minLength=1; maxLength=300 |

### `account.interbank.eligibility.query.v1`

**command** · payment-service → account-service. Exchange `bank.commands`; routing key `account.interbank.eligibility.query.v1`.

Contrato: [`incoming.v1.ts`](../../apps/packages/contracts/src/events/interbank/incoming.v1.ts).

| Campo | Tipo / valores | Obligatorio | Validación emitida |
| --- | --- | --- | --- |
| `depositId` | uuid | sí | pattern=^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12})$ |
| `accountId` | uuid | no | pattern=^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12})$ |
| `accountNumber` | string | no | pattern=^[A-Za-z0-9-]{1,34}$ |

### `account.interbank.eligibility.replied.v1`

**reply** · account-service → payment-service. Exchange `bank.replies`; routing key `account.interbank.eligibility.replied.v1`.

Contrato: [`incoming.v1.ts`](../../apps/packages/contracts/src/events/interbank/incoming.v1.ts).

| Campo | Tipo / valores | Obligatorio | Validación emitida |
| --- | --- | --- | --- |
| `depositId` | uuid | sí | pattern=^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12})$ |
| `accountId` | uuid | no | pattern=^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12})$ |
| `accountNumber` | string | no | pattern=^[A-Za-z0-9-]{1,34}$ |
| `eligible` | boolean | sí | — |
| `reason` | `ACCOUNT_NOT_FOUND` \| `ACCOUNT_INACTIVE` \| null | sí | — |

### `account.interbank.credit.requested.v1`

**command** · payment-service → account-service. Exchange `bank.commands`; routing key `account.interbank.credit.requested.v1`.

Contrato: [`incoming.v1.ts`](../../apps/packages/contracts/src/events/interbank/incoming.v1.ts).

| Campo | Tipo / valores | Obligatorio | Validación emitida |
| --- | --- | --- | --- |
| `depositId` | uuid | sí | pattern=^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12})$ |
| `accountId` | uuid | no | pattern=^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12})$ |
| `accountNumber` | string | no | pattern=^[A-Za-z0-9-]{1,34}$ |
| `amount` | object | sí | — |

### `account.interbank.credited.v1`

**event** · account-service → payment-service, notification-audit-service. Exchange `bank.events`; routing key `account.interbank.credited.v1`.

Contrato: [`incoming.v1.ts`](../../apps/packages/contracts/src/events/interbank/incoming.v1.ts).

| Campo | Tipo / valores | Obligatorio | Validación emitida |
| --- | --- | --- | --- |
| `depositId` | uuid | sí | pattern=^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12})$ |
| `accountId` | uuid | sí | pattern=^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12})$ |
| `accountNumber` | string | no | pattern=^[A-Za-z0-9-]{1,34}$ |
| `creditedAt` | date-time | sí | pattern=^(?:(?:\d\d[2468][048]\|\d\d[13579][26]\|\d\d0[48]\|[02468][048]00\|[13579][26]00)-02-29\|\d{4}-(?:(?:0[13578]\|1[02])-(?:0[1-9]\|[12]\d\|3[01])\|(?:0[469]\|11)-(?:0[1-9]\|[12]\d\|30)\|(?:02)-(?:0[1-9]\|1\d\|2[0-8])))T(?:(?:[01]\d\|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d+)?)?(?:Z))$ |

### `account.interbank.credit.rejected.v1`

**event** · account-service → payment-service, notification-audit-service. Exchange `bank.events`; routing key `account.interbank.credit.rejected.v1`.

Contrato: [`incoming.v1.ts`](../../apps/packages/contracts/src/events/interbank/incoming.v1.ts).

| Campo | Tipo / valores | Obligatorio | Validación emitida |
| --- | --- | --- | --- |
| `depositId` | uuid | sí | pattern=^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12})$ |
| `accountId` | uuid | no | pattern=^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12})$ |
| `accountNumber` | string | no | pattern=^[A-Za-z0-9-]{1,34}$ |
| `reason` | `ACCOUNT_NOT_FOUND` \| `ACCOUNT_INACTIVE` \| `INVALID_REQUEST` | sí | — |


## Familia `alert`

### `alert.slo.received.v1`

**command** · gateway → notification-audit-service. Exchange `bank.commands`; routing key `alert.slo.received.v1`.

Contrato: [`alert.slo.received.v1.ts`](../../apps/packages/contracts/src/events/alert/alert.slo.received.v1.ts).

| Campo | Tipo / valores | Obligatorio | Validación emitida |
| --- | --- | --- | --- |
| `source` | `grafana` | sí | — |
| `alerts` | array de object | sí | minItems=1; maxItems=50 |


## Familia `audit`

### `audit.stats.query.v1`

**command** · gateway → notification-audit-service. Exchange `bank.commands`; routing key `audit.stats.query.v1`.

Contrato: [`audit.stats.query.v1.ts`](../../apps/packages/contracts/src/events/audit/audit.stats.query.v1.ts).

| Campo | Tipo / valores | Obligatorio | Validación emitida |
| --- | --- | --- | --- |
| — | Unión/variante: consultar contrato | — | — |

### `audit.stats.replied.v1`

**reply** · notification-audit-service → gateway. Exchange `bank.replies`; routing key `audit.stats.replied.v1`.

Contrato: [`audit.stats.replied.v1.ts`](../../apps/packages/contracts/src/events/audit/audit.stats.replied.v1.ts).

| Campo | Tipo / valores | Obligatorio | Validación emitida |
| --- | --- | --- | --- |
| `eventsToday` | integer | sí | minimum=0; maximum=9007199254740991 |
| `invalidToday` | integer | sí | minimum=0; maximum=9007199254740991 |
| `notificationsToday` | integer | sí | minimum=0; maximum=9007199254740991 |
| `lastEventType` | string \| null | sí | — |
| `lastEventAt` | date-time \| null | sí | — |
| `infoToday` | integer | no | minimum=0; maximum=9007199254740991 |
| `warningToday` | integer | no | minimum=0; maximum=9007199254740991 |
| `errorToday` | integer | no | minimum=0; maximum=9007199254740991 |

### `audit.query.replied.v1`

**reply** · notification-audit-service → gateway. Exchange `bank.replies`; routing key `audit.query.replied.v1`.

Contrato: [`audit.query.replied.v1.ts`](../../apps/packages/contracts/src/events/audit/audit.query.replied.v1.ts).

| Campo | Tipo / valores | Obligatorio | Validación emitida |
| --- | --- | --- | --- |
| `correlationId` | uuid | sí | pattern=^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12})$ |
| `events` | array de object | sí | — |
| `notifications` | array de object | sí | — |

### `audit.query.requested.v1`

**command** · gateway → notification-audit-service. Exchange `bank.commands`; routing key `audit.query.requested.v1`.

Contrato: [`audit.query.requested.v1.ts`](../../apps/packages/contracts/src/events/audit/audit.query.requested.v1.ts).

| Campo | Tipo / valores | Obligatorio | Validación emitida |
| --- | --- | --- | --- |
| `correlationId` | uuid | sí | pattern=^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12})$ |

### `audit.events.list.query.v1`

**command** · gateway → notification-audit-service. Exchange `bank.commands`; routing key `audit.events.list.query.v1`.

Contrato: [`audit.events.list.query.v1.ts`](../../apps/packages/contracts/src/events/audit/audit.events.list.query.v1.ts).

| Campo | Tipo / valores | Obligatorio | Validación emitida |
| --- | --- | --- | --- |
| `limit` | integer | no | maximum=100; exclusiveMinimum=0 |
| `page` | integer | no | maximum=9007199254740991; exclusiveMinimum=0 |
| `severity` | `INFO` \| `WARNING` \| `ERROR` | no | — |
| `correlationId` | uuid | no | pattern=^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12})$ |
| `traceId` | string | no | pattern=^[0-9a-f]{32}$ |
| `service` | `gateway` \| `customer-service` \| `account-service` \| `transaction-service` \| `payment-service` \| `notification-audit-service` | no | — |

### `audit.events.list.replied.v1`

**reply** · notification-audit-service → gateway. Exchange `bank.replies`; routing key `audit.events.list.replied.v1`.

Contrato: [`audit.events.list.replied.v1.ts`](../../apps/packages/contracts/src/events/audit/audit.events.list.replied.v1.ts).

| Campo | Tipo / valores | Obligatorio | Validación emitida |
| --- | --- | --- | --- |
| `events` | array de object | sí | — |
| `total` | integer | sí | minimum=0; maximum=9007199254740991 |
| `page` | integer | sí | maximum=9007199254740991; exclusiveMinimum=0 |
| `limit` | integer | sí | maximum=9007199254740991; exclusiveMinimum=0 |


## Familia `customer`

### `customer.activation.requested.v1`

**event** · customer-service → notification-audit-service. Exchange `bank.events`; routing key `customer.activation.requested.v1`.

Contrato: [`customer.activation.requested.v1.ts`](../../apps/packages/contracts/src/events/customer/customer.activation.requested.v1.ts).

| Campo | Tipo / valores | Obligatorio | Validación emitida |
| --- | --- | --- | --- |
| `customerId` | uuid | sí | pattern=^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12})$ |
| `email` | email | sí | pattern=^(?!\.)(?!.*\.\.)([A-Za-z0-9_'+\-\.]*)[A-Za-z0-9_+-]@([A-Za-z0-9][A-Za-z0-9\-]*\.)+[A-Za-z]{2,}$ |
| `expiresAt` | date-time | sí | pattern=^(?:(?:\d\d[2468][048]\|\d\d[13579][26]\|\d\d0[48]\|[02468][048]00\|[13579][26]00)-02-29\|\d{4}-(?:(?:0[13578]\|1[02])-(?:0[1-9]\|[12]\d\|3[01])\|(?:0[469]\|11)-(?:0[1-9]\|[12]\d\|30)\|(?:02)-(?:0[1-9]\|1\d\|2[0-8])))T(?:(?:[01]\d\|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d+)?)?(?:Z))$ |
| `activationToken` | string | no | minLength=16; maxLength=512 |

### `customer.authenticate.replied.v1`

**reply** · customer-service → gateway. Exchange `bank.replies`; routing key `customer.authenticate.replied.v1`.

Contrato: [`customer.authenticate.replied.v1.ts`](../../apps/packages/contracts/src/events/customer/customer.authenticate.replied.v1.ts).

| Campo | Tipo / valores | Obligatorio | Validación emitida |
| --- | --- | --- | --- |
| — | Unión/variante: consultar contrato | — | — |

### `customer.authenticate.v1`

**command** · gateway → customer-service. Exchange `bank.commands`; routing key `customer.authenticate.v1`.

Contrato: [`customer.authenticate.v1.ts`](../../apps/packages/contracts/src/events/customer/customer.authenticate.v1.ts).

| Campo | Tipo / valores | Obligatorio | Validación emitida |
| --- | --- | --- | --- |
| `email` | email | sí | pattern=^(?!\.)(?!.*\.\.)([A-Za-z0-9_'+\-\.]*)[A-Za-z0-9_+-]@([A-Za-z0-9][A-Za-z0-9\-]*\.)+[A-Za-z]{2,}$ |
| `credential` | string | sí | minLength=1; maxLength=256 |

### `customer.email.verification.rejected.v1`

**event** · customer-service → notification-audit-service. Exchange `bank.events`; routing key `customer.email.verification.rejected.v1`.

Contrato: [`customer.email.verification.rejected.v1.ts`](../../apps/packages/contracts/src/events/customer/customer.email.verification.rejected.v1.ts).

| Campo | Tipo / valores | Obligatorio | Validación emitida |
| --- | --- | --- | --- |
| `reason` | `ACTIVATION_TOKEN_EXPIRED` \| `ACTIVATION_TOKEN_INVALID` | sí | — |
| `occurredAt` | date-time | sí | pattern=^(?:(?:\d\d[2468][048]\|\d\d[13579][26]\|\d\d0[48]\|[02468][048]00\|[13579][26]00)-02-29\|\d{4}-(?:(?:0[13578]\|1[02])-(?:0[1-9]\|[12]\d\|3[01])\|(?:0[469]\|11)-(?:0[1-9]\|[12]\d\|30)\|(?:02)-(?:0[1-9]\|1\d\|2[0-8])))T(?:(?:[01]\d\|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d+)?)?(?:Z))$ |

### `customer.email.verified.v1`

**event** · customer-service → notification-audit-service. Exchange `bank.events`; routing key `customer.email.verified.v1`.

Contrato: [`customer.email.verified.v1.ts`](../../apps/packages/contracts/src/events/customer/customer.email.verified.v1.ts).

| Campo | Tipo / valores | Obligatorio | Validación emitida |
| --- | --- | --- | --- |
| `customerId` | uuid | sí | pattern=^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12})$ |
| `emailVerifiedAt` | date-time | sí | pattern=^(?:(?:\d\d[2468][048]\|\d\d[13579][26]\|\d\d0[48]\|[02468][048]00\|[13579][26]00)-02-29\|\d{4}-(?:(?:0[13578]\|1[02])-(?:0[1-9]\|[12]\d\|3[01])\|(?:0[469]\|11)-(?:0[1-9]\|[12]\d\|30)\|(?:02)-(?:0[1-9]\|1\d\|2[0-8])))T(?:(?:[01]\d\|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d+)?)?(?:Z))$ |
| `status` | `ACTIVE` | sí | — |

### `customer.identity.rejected.v1`

**event** · customer-service → notification-audit-service. Exchange `bank.events`; routing key `customer.identity.rejected.v1`.

Contrato: [`customer.identity.rejected.v1.ts`](../../apps/packages/contracts/src/events/customer/customer.identity.rejected.v1.ts).

| Campo | Tipo / valores | Obligatorio | Validación emitida |
| --- | --- | --- | --- |
| `customerId` | uuid | sí | pattern=^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12})$ |
| `identityStatus` | `REJECTED` | sí | — |
| `reason` | `IDENTITY_DOCUMENT_UNREADABLE` \| `IDENTITY_OBJECT_NOT_FOUND` \| `IDENTITY_DIGEST_MISMATCH` | sí | — |
| `rejectedAt` | date-time | sí | pattern=^(?:(?:\d\d[2468][048]\|\d\d[13579][26]\|\d\d0[48]\|[02468][048]00\|[13579][26]00)-02-29\|\d{4}-(?:(?:0[13578]\|1[02])-(?:0[1-9]\|[12]\d\|3[01])\|(?:0[469]\|11)-(?:0[1-9]\|[12]\d\|30)\|(?:02)-(?:0[1-9]\|1\d\|2[0-8])))T(?:(?:[01]\d\|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d+)?)?(?:Z))$ |
| `email` | email | no | pattern=^(?!\.)(?!.*\.\.)([A-Za-z0-9_'+\-\.]*)[A-Za-z0-9_+-]@([A-Za-z0-9][A-Za-z0-9\-]*\.)+[A-Za-z]{2,}$ |
| `fullName` | string | no | — |

### `customer.identity.validated.v1`

**event** · customer-service → notification-audit-service. Exchange `bank.events`; routing key `customer.identity.validated.v1`.

Contrato: [`customer.identity.validated.v1.ts`](../../apps/packages/contracts/src/events/customer/customer.identity.validated.v1.ts).

| Campo | Tipo / valores | Obligatorio | Validación emitida |
| --- | --- | --- | --- |
| `customerId` | uuid | sí | pattern=^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12})$ |
| `identityStatus` | `VALIDATED` | sí | — |
| `validatedAt` | date-time | sí | pattern=^(?:(?:\d\d[2468][048]\|\d\d[13579][26]\|\d\d0[48]\|[02468][048]00\|[13579][26]00)-02-29\|\d{4}-(?:(?:0[13578]\|1[02])-(?:0[1-9]\|[12]\d\|3[01])\|(?:0[469]\|11)-(?:0[1-9]\|[12]\d\|30)\|(?:02)-(?:0[1-9]\|1\d\|2[0-8])))T(?:(?:[01]\d\|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d+)?)?(?:Z))$ |

### `customer.login.rejected.v1`

**event** · customer-service → notification-audit-service. Exchange `bank.events`; routing key `customer.login.rejected.v1`.

Contrato: [`customer.login.rejected.v1.ts`](../../apps/packages/contracts/src/events/customer/customer.login.rejected.v1.ts).

| Campo | Tipo / valores | Obligatorio | Validación emitida |
| --- | --- | --- | --- |
| `reason` | `INVALID_CREDENTIALS` | sí | — |
| `occurredAt` | date-time | sí | pattern=^(?:(?:\d\d[2468][048]\|\d\d[13579][26]\|\d\d0[48]\|[02468][048]00\|[13579][26]00)-02-29\|\d{4}-(?:(?:0[13578]\|1[02])-(?:0[1-9]\|[12]\d\|3[01])\|(?:0[469]\|11)-(?:0[1-9]\|[12]\d\|30)\|(?:02)-(?:0[1-9]\|1\d\|2[0-8])))T(?:(?:[01]\d\|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d+)?)?(?:Z))$ |

### `customer.login.succeeded.v1`

**event** · customer-service → notification-audit-service. Exchange `bank.events`; routing key `customer.login.succeeded.v1`.

Contrato: [`customer.login.succeeded.v1.ts`](../../apps/packages/contracts/src/events/customer/customer.login.succeeded.v1.ts).

| Campo | Tipo / valores | Obligatorio | Validación emitida |
| --- | --- | --- | --- |
| `customerId` | uuid | sí | pattern=^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12})$ |
| `firstLogin` | boolean | sí | — |
| `occurredAt` | date-time | sí | pattern=^(?:(?:\d\d[2468][048]\|\d\d[13579][26]\|\d\d0[48]\|[02468][048]00\|[13579][26]00)-02-29\|\d{4}-(?:(?:0[13578]\|1[02])-(?:0[1-9]\|[12]\d\|3[01])\|(?:0[469]\|11)-(?:0[1-9]\|[12]\d\|30)\|(?:02)-(?:0[1-9]\|1\d\|2[0-8])))T(?:(?:[01]\d\|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d+)?)?(?:Z))$ |

### `customer.register.rejected.v1`

**event** · customer-service → notification-audit-service. Exchange `bank.events`; routing key `customer.register.rejected.v1`.

Contrato: [`customer.register.rejected.v1.ts`](../../apps/packages/contracts/src/events/customer/customer.register.rejected.v1.ts).

| Campo | Tipo / valores | Obligatorio | Validación emitida |
| --- | --- | --- | --- |
| `reason` | `DOCUMENT_ALREADY_REGISTERED` \| `EMAIL_ALREADY_REGISTERED` \| `INVALID_BIRTH_DATE` \| `ROLE_NOT_ELIGIBLE` | sí | — |
| `rejectedAt` | date-time | sí | pattern=^(?:(?:\d\d[2468][048]\|\d\d[13579][26]\|\d\d0[48]\|[02468][048]00\|[13579][26]00)-02-29\|\d{4}-(?:(?:0[13578]\|1[02])-(?:0[1-9]\|[12]\d\|3[01])\|(?:0[469]\|11)-(?:0[1-9]\|[12]\d\|30)\|(?:02)-(?:0[1-9]\|1\d\|2[0-8])))T(?:(?:[01]\d\|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d+)?)?(?:Z))$ |

### `customer.register.v1`

**command** · gateway → customer-service. Exchange `bank.commands`; routing key `customer.register.v1`.

Contrato: [`customer.register.v1.ts`](../../apps/packages/contracts/src/events/customer/customer.register.v1.ts).

| Campo | Tipo / valores | Obligatorio | Validación emitida |
| --- | --- | --- | --- |
| `customerId` | uuid | sí | pattern=^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12})$ |
| `fullName` | string | sí | minLength=1; maxLength=200 |
| `identityDocument` | string | sí | minLength=1; maxLength=50 |
| `email` | email | sí | pattern=^(?!\.)(?!.*\.\.)([A-Za-z0-9_'+\-\.]*)[A-Za-z0-9_+-]@([A-Za-z0-9][A-Za-z0-9\-]*\.)+[A-Za-z]{2,}$ |
| `dateOfBirth` | date | sí | pattern=^(?:(?:\d\d[2468][048]\|\d\d[13579][26]\|\d\d0[48]\|[02468][048]00\|[13579][26]00)-02-29\|\d{4}-(?:(?:0[13578]\|1[02])-(?:0[1-9]\|[12]\d\|3[01])\|(?:0[469]\|11)-(?:0[1-9]\|[12]\d\|30)\|(?:02)-(?:0[1-9]\|1\d\|2[0-8])))$ |
| `address` | string | sí | minLength=1; maxLength=300 |
| `role` | `CLIENTE` \| `CAJERO_RECEPTOR` \| `ADMINISTRADOR` | sí | — |
| `credential` | string | sí | minLength=8; maxLength=256 |
| `photo` | object \| null | sí | — |

### `customer.registered.v1`

**event** · customer-service → notification-audit-service. Exchange `bank.events`; routing key `customer.registered.v1`.

Contrato: [`customer.registered.v1.ts`](../../apps/packages/contracts/src/events/customer/customer.registered.v1.ts).

| Campo | Tipo / valores | Obligatorio | Validación emitida |
| --- | --- | --- | --- |
| `customerId` | uuid | sí | pattern=^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12})$ |
| `username` | string | sí | minLength=1; maxLength=100 |
| `email` | email | sí | pattern=^(?!\.)(?!.*\.\.)([A-Za-z0-9_'+\-\.]*)[A-Za-z0-9_+-]@([A-Za-z0-9][A-Za-z0-9\-]*\.)+[A-Za-z]{2,}$ |
| `role` | `CLIENTE` \| `CAJERO_RECEPTOR` \| `ADMINISTRADOR` | sí | — |
| `status` | `PENDING_ACTIVATION` \| `ACTIVE` | sí | — |
| `identityStatus` | `PENDING` \| `VALIDATED` \| `REJECTED` | sí | — |
| `registeredAt` | date-time | sí | pattern=^(?:(?:\d\d[2468][048]\|\d\d[13579][26]\|\d\d0[48]\|[02468][048]00\|[13579][26]00)-02-29\|\d{4}-(?:(?:0[13578]\|1[02])-(?:0[1-9]\|[12]\d\|3[01])\|(?:0[469]\|11)-(?:0[1-9]\|[12]\d\|30)\|(?:02)-(?:0[1-9]\|1\d\|2[0-8])))T(?:(?:[01]\d\|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d+)?)?(?:Z))$ |

### `customer.update.v1`

**command** · gateway → customer-service. Exchange `bank.commands`; routing key `customer.update.v1`.

Contrato: [`customer.update.v1.ts`](../../apps/packages/contracts/src/events/customer/customer.update.v1.ts).

| Campo | Tipo / valores | Obligatorio | Validación emitida |
| --- | --- | --- | --- |
| `customerId` | uuid | sí | pattern=^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12})$ |
| `fullName` | string | no | minLength=1; maxLength=200 |
| `address` | string | no | minLength=1; maxLength=300 |
| `dateOfBirth` | date | no | pattern=^(?:(?:\d\d[2468][048]\|\d\d[13579][26]\|\d\d0[48]\|[02468][048]00\|[13579][26]00)-02-29\|\d{4}-(?:(?:0[13578]\|1[02])-(?:0[1-9]\|[12]\d\|3[01])\|(?:0[469]\|11)-(?:0[1-9]\|[12]\d\|30)\|(?:02)-(?:0[1-9]\|1\d\|2[0-8])))$ |

### `customer.updated.v1`

**event** · customer-service → notification-audit-service. Exchange `bank.events`; routing key `customer.updated.v1`.

Contrato: [`customer.updated.v1.ts`](../../apps/packages/contracts/src/events/customer/customer.updated.v1.ts).

| Campo | Tipo / valores | Obligatorio | Validación emitida |
| --- | --- | --- | --- |
| `customerId` | uuid | sí | pattern=^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12})$ |
| `changedFields` | array de `fullName` \| `address` \| `dateOfBirth` | sí | minItems=1 |
| `updatedAt` | date-time | sí | pattern=^(?:(?:\d\d[2468][048]\|\d\d[13579][26]\|\d\d0[48]\|[02468][048]00\|[13579][26]00)-02-29\|\d{4}-(?:(?:0[13578]\|1[02])-(?:0[1-9]\|[12]\d\|3[01])\|(?:0[469]\|11)-(?:0[1-9]\|[12]\d\|30)\|(?:02)-(?:0[1-9]\|1\d\|2[0-8])))T(?:(?:[01]\d\|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d+)?)?(?:Z))$ |

### `customer.validate-identity.v1`

**command** · gateway → customer-service. Exchange `bank.commands`; routing key `customer.validate-identity.v1`.

Contrato: [`customer.validate-identity.v1.ts`](../../apps/packages/contracts/src/events/customer/customer.validate-identity.v1.ts).

| Campo | Tipo / valores | Obligatorio | Validación emitida |
| --- | --- | --- | --- |
| `customerId` | uuid | sí | pattern=^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12})$ |
| `photo` | object | sí | — |

### `customer.get.query.v1`

**command** · gateway → customer-service. Exchange `bank.commands`; routing key `customer.get.query.v1`.

Contrato: [`customer.get.query.v1.ts`](../../apps/packages/contracts/src/events/customer/customer.get.query.v1.ts).

| Campo | Tipo / valores | Obligatorio | Validación emitida |
| --- | --- | --- | --- |
| `customerId` | uuid | sí | pattern=^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12})$ |

### `customer.get.replied.v1`

**reply** · customer-service → gateway. Exchange `bank.replies`; routing key `customer.get.replied.v1`.

Contrato: [`customer.get.replied.v1.ts`](../../apps/packages/contracts/src/events/customer/customer.get.replied.v1.ts).

| Campo | Tipo / valores | Obligatorio | Validación emitida |
| --- | --- | --- | --- |
| — | Unión/variante: consultar contrato | — | — |

### `customer.identity-document.query.v1`

**command** · gateway → customer-service. Exchange `bank.commands`; routing key `customer.identity-document.query.v1`.

Contrato: [`customer.identity-document.query.v1.ts`](../../apps/packages/contracts/src/events/customer/customer.identity-document.query.v1.ts).

| Campo | Tipo / valores | Obligatorio | Validación emitida |
| --- | --- | --- | --- |
| `customerId` | uuid | sí | pattern=^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12})$ |

### `customer.identity-document.replied.v1`

**reply** · customer-service → gateway. Exchange `bank.replies`; routing key `customer.identity-document.replied.v1`.

Contrato: [`customer.identity-document.replied.v1.ts`](../../apps/packages/contracts/src/events/customer/customer.identity-document.replied.v1.ts).

| Campo | Tipo / valores | Obligatorio | Validación emitida |
| --- | --- | --- | --- |
| — | Unión/variante: consultar contrato | — | — |

### `customer.change-password.v1`

**command** · gateway → customer-service. Exchange `bank.commands`; routing key `customer.change-password.v1`.

Contrato: [`customer.change-password.v1.ts`](../../apps/packages/contracts/src/events/customer/customer.change-password.v1.ts).

| Campo | Tipo / valores | Obligatorio | Validación emitida |
| --- | --- | --- | --- |
| `customerId` | uuid | sí | pattern=^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12})$ |
| `currentCredential` | string | sí | minLength=1; maxLength=256 |
| `newCredential` | string | sí | minLength=8; maxLength=256 |

### `customer.password-changed.v1`

**event** · customer-service → notification-audit-service. Exchange `bank.events`; routing key `customer.password-changed.v1`.

Contrato: [`customer.password-changed.v1.ts`](../../apps/packages/contracts/src/events/customer/customer.password-changed.v1.ts).

| Campo | Tipo / valores | Obligatorio | Validación emitida |
| --- | --- | --- | --- |
| `customerId` | uuid | sí | pattern=^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12})$ |
| `email` | email | no | pattern=^(?!\.)(?!.*\.\.)([A-Za-z0-9_'+\-\.]*)[A-Za-z0-9_+-]@([A-Za-z0-9][A-Za-z0-9\-]*\.)+[A-Za-z]{2,}$ |
| `fullName` | string | no | — |
| `changedAt` | date-time | sí | pattern=^(?:(?:\d\d[2468][048]\|\d\d[13579][26]\|\d\d0[48]\|[02468][048]00\|[13579][26]00)-02-29\|\d{4}-(?:(?:0[13578]\|1[02])-(?:0[1-9]\|[12]\d\|3[01])\|(?:0[469]\|11)-(?:0[1-9]\|[12]\d\|30)\|(?:02)-(?:0[1-9]\|1\d\|2[0-8])))T(?:(?:[01]\d\|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d+)?)?(?:Z))$ |

### `customer.password-change.rejected.v1`

**event** · customer-service → notification-audit-service. Exchange `bank.events`; routing key `customer.password-change.rejected.v1`.

Contrato: [`customer.password-change.rejected.v1.ts`](../../apps/packages/contracts/src/events/customer/customer.password-change.rejected.v1.ts).

| Campo | Tipo / valores | Obligatorio | Validación emitida |
| --- | --- | --- | --- |
| `customerId` | uuid | sí | pattern=^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12})$ |
| `reason` | `INVALID_CREDENTIALS` \| `FORBIDDEN_ACCOUNT_ACCESS` | sí | — |
| `occurredAt` | date-time | sí | pattern=^(?:(?:\d\d[2468][048]\|\d\d[13579][26]\|\d\d0[48]\|[02468][048]00\|[13579][26]00)-02-29\|\d{4}-(?:(?:0[13578]\|1[02])-(?:0[1-9]\|[12]\d\|3[01])\|(?:0[469]\|11)-(?:0[1-9]\|[12]\d\|30)\|(?:02)-(?:0[1-9]\|1\d\|2[0-8])))T(?:(?:[01]\d\|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d+)?)?(?:Z))$ |

### `customer.password-reset.completed.v1`

**event** · customer-service → notification-audit-service. Exchange `bank.events`; routing key `customer.password-reset.completed.v1`.

Contrato: [`customer.password-reset.completed.v1.ts`](../../apps/packages/contracts/src/events/customer/customer.password-reset.completed.v1.ts).

| Campo | Tipo / valores | Obligatorio | Validación emitida |
| --- | --- | --- | --- |
| `customerId` | uuid | sí | pattern=^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12})$ |
| `changedAt` | date-time | sí | pattern=^(?:(?:\d\d[2468][048]\|\d\d[13579][26]\|\d\d0[48]\|[02468][048]00\|[13579][26]00)-02-29\|\d{4}-(?:(?:0[13578]\|1[02])-(?:0[1-9]\|[12]\d\|3[01])\|(?:0[469]\|11)-(?:0[1-9]\|[12]\d\|30)\|(?:02)-(?:0[1-9]\|1\d\|2[0-8])))T(?:(?:[01]\d\|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d+)?)?(?:Z))$ |

### `customer.password-reset.confirm.v1`

**command** · gateway → customer-service. Exchange `bank.commands`; routing key `customer.password-reset.confirm.v1`.

Contrato: [`customer.password-reset.confirm.v1.ts`](../../apps/packages/contracts/src/events/customer/customer.password-reset.confirm.v1.ts).

| Campo | Tipo / valores | Obligatorio | Validación emitida |
| --- | --- | --- | --- |
| `resetToken` | string | sí | minLength=16; maxLength=512 |
| `credential` | string | sí | minLength=8; maxLength=256 |

### `customer.password-reset.issued.v1`

**event** · customer-service → notification-audit-service. Exchange `bank.events`; routing key `customer.password-reset.issued.v1`.

Contrato: [`customer.password-reset.issued.v1.ts`](../../apps/packages/contracts/src/events/customer/customer.password-reset.issued.v1.ts).

| Campo | Tipo / valores | Obligatorio | Validación emitida |
| --- | --- | --- | --- |
| `customerId` | uuid | sí | pattern=^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12})$ |
| `email` | email | sí | pattern=^(?!\.)(?!.*\.\.)([A-Za-z0-9_'+\-\.]*)[A-Za-z0-9_+-]@([A-Za-z0-9][A-Za-z0-9\-]*\.)+[A-Za-z]{2,}$ |
| `expiresAt` | date-time | sí | pattern=^(?:(?:\d\d[2468][048]\|\d\d[13579][26]\|\d\d0[48]\|[02468][048]00\|[13579][26]00)-02-29\|\d{4}-(?:(?:0[13578]\|1[02])-(?:0[1-9]\|[12]\d\|3[01])\|(?:0[469]\|11)-(?:0[1-9]\|[12]\d\|30)\|(?:02)-(?:0[1-9]\|1\d\|2[0-8])))T(?:(?:[01]\d\|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d+)?)?(?:Z))$ |
| `resetToken` | string | sí | minLength=16; maxLength=512 |

### `customer.password-reset.rejected.v1`

**event** · customer-service → notification-audit-service. Exchange `bank.events`; routing key `customer.password-reset.rejected.v1`.

Contrato: [`customer.password-reset.rejected.v1.ts`](../../apps/packages/contracts/src/events/customer/customer.password-reset.rejected.v1.ts).

| Campo | Tipo / valores | Obligatorio | Validación emitida |
| --- | --- | --- | --- |
| `reason` | `RESET_TOKEN_EXPIRED` \| `RESET_TOKEN_INVALID` | sí | — |
| `occurredAt` | date-time | sí | pattern=^(?:(?:\d\d[2468][048]\|\d\d[13579][26]\|\d\d0[48]\|[02468][048]00\|[13579][26]00)-02-29\|\d{4}-(?:(?:0[13578]\|1[02])-(?:0[1-9]\|[12]\d\|3[01])\|(?:0[469]\|11)-(?:0[1-9]\|[12]\d\|30)\|(?:02)-(?:0[1-9]\|1\d\|2[0-8])))T(?:(?:[01]\d\|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d+)?)?(?:Z))$ |

### `customer.password-reset.requested.v1`

**command** · gateway → customer-service. Exchange `bank.commands`; routing key `customer.password-reset.requested.v1`.

Contrato: [`customer.password-reset.requested.v1.ts`](../../apps/packages/contracts/src/events/customer/customer.password-reset.requested.v1.ts).

| Campo | Tipo / valores | Obligatorio | Validación emitida |
| --- | --- | --- | --- |
| `email` | email | sí | pattern=^(?!\.)(?!.*\.\.)([A-Za-z0-9_'+\-\.]*)[A-Za-z0-9_+-]@([A-Za-z0-9][A-Za-z0-9\-]*\.)+[A-Za-z]{2,}$ |

### `customer.names.query.v1`

**command** · gateway → customer-service. Exchange `bank.commands`; routing key `customer.names.query.v1`.

Contrato: [`customer.names.query.v1.ts`](../../apps/packages/contracts/src/events/customer/customer.names.query.v1.ts).

| Campo | Tipo / valores | Obligatorio | Validación emitida |
| --- | --- | --- | --- |
| `customerIds` | array de uuid | sí | minItems=1; maxItems=100 |

### `customer.names.replied.v1`

**reply** · customer-service → gateway. Exchange `bank.replies`; routing key `customer.names.replied.v1`.

Contrato: [`customer.names.replied.v1.ts`](../../apps/packages/contracts/src/events/customer/customer.names.replied.v1.ts).

| Campo | Tipo / valores | Obligatorio | Validación emitida |
| --- | --- | --- | --- |
| `names` | array de object | sí | — |

### `customer.pending-validation.query.v1`

**command** · gateway → customer-service. Exchange `bank.commands`; routing key `customer.pending-validation.query.v1`.

Contrato: [`customer.pending-validation.query.v1.ts`](../../apps/packages/contracts/src/events/customer/customer.pending-validation.query.v1.ts).

| Campo | Tipo / valores | Obligatorio | Validación emitida |
| --- | --- | --- | --- |
| — | Unión/variante: consultar contrato | — | — |

### `customer.pending-validation.replied.v1`

**reply** · customer-service → gateway. Exchange `bank.replies`; routing key `customer.pending-validation.replied.v1`.

Contrato: [`customer.pending-validation.replied.v1.ts`](../../apps/packages/contracts/src/events/customer/customer.pending-validation.replied.v1.ts).

| Campo | Tipo / valores | Obligatorio | Validación emitida |
| --- | --- | --- | --- |
| `customers` | array de object | sí | — |
| `omitted` | integer | sí | minimum=0; maximum=9007199254740991 |

### `customer.list.query.v1`

**command** · gateway → customer-service. Exchange `bank.commands`; routing key `customer.list.query.v1`.

Contrato: [`customer.list.query.v1.ts`](../../apps/packages/contracts/src/events/customer/customer.list.query.v1.ts).

| Campo | Tipo / valores | Obligatorio | Validación emitida |
| --- | --- | --- | --- |
| `limit` | integer | no | maximum=100; exclusiveMinimum=0 |

### `customer.list.replied.v1`

**reply** · customer-service → gateway. Exchange `bank.replies`; routing key `customer.list.replied.v1`.

Contrato: [`customer.list.replied.v1.ts`](../../apps/packages/contracts/src/events/customer/customer.list.replied.v1.ts).

| Campo | Tipo / valores | Obligatorio | Validación emitida |
| --- | --- | --- | --- |
| `customers` | array de object | sí | — |
| `omitted` | integer | sí | minimum=0; maximum=9007199254740991 |

### `customer.set-identity-verdict.v1`

**command** · gateway → customer-service. Exchange `bank.commands`; routing key `customer.set-identity-verdict.v1`.

Contrato: [`customer.set-identity-verdict.v1.ts`](../../apps/packages/contracts/src/events/customer/customer.set-identity-verdict.v1.ts).

| Campo | Tipo / valores | Obligatorio | Validación emitida |
| --- | --- | --- | --- |
| `customerId` | uuid | sí | pattern=^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12})$ |
| `verdict` | `VALIDATED` \| `REJECTED` | sí | — |

### `customer.set-kyc-status.v1`

**command** · gateway → customer-service. Exchange `bank.commands`; routing key `customer.set-kyc-status.v1`.

Contrato: [`customer.set-kyc-status.v1.ts`](../../apps/packages/contracts/src/events/customer/customer.set-kyc-status.v1.ts).

| Campo | Tipo / valores | Obligatorio | Validación emitida |
| --- | --- | --- | --- |
| `customerId` | uuid | sí | pattern=^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12})$ |
| `status` | `VERIFIED` \| `REJECTED` | sí | — |

### `customer.kyc.rejected.v1`

**event** · customer-service → notification-audit-service. Exchange `bank.events`; routing key `customer.kyc.rejected.v1`.

Contrato: [`customer.kyc.rejected.v1.ts`](../../apps/packages/contracts/src/events/customer/customer.kyc.rejected.v1.ts).

| Campo | Tipo / valores | Obligatorio | Validación emitida |
| --- | --- | --- | --- |
| `customerId` | uuid | sí | pattern=^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12})$ |
| `kycStatus` | `REJECTED` | sí | — |
| `rejectedAt` | date-time | sí | pattern=^(?:(?:\d\d[2468][048]\|\d\d[13579][26]\|\d\d0[48]\|[02468][048]00\|[13579][26]00)-02-29\|\d{4}-(?:(?:0[13578]\|1[02])-(?:0[1-9]\|[12]\d\|3[01])\|(?:0[469]\|11)-(?:0[1-9]\|[12]\d\|30)\|(?:02)-(?:0[1-9]\|1\d\|2[0-8])))T(?:(?:[01]\d\|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d+)?)?(?:Z))$ |

### `customer.kyc.verified.v1`

**event** · customer-service → notification-audit-service. Exchange `bank.events`; routing key `customer.kyc.verified.v1`.

Contrato: [`customer.kyc.verified.v1.ts`](../../apps/packages/contracts/src/events/customer/customer.kyc.verified.v1.ts).

| Campo | Tipo / valores | Obligatorio | Validación emitida |
| --- | --- | --- | --- |
| `customerId` | uuid | sí | pattern=^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12})$ |
| `kycStatus` | `VERIFIED` | sí | — |
| `verifiedAt` | date-time | sí | pattern=^(?:(?:\d\d[2468][048]\|\d\d[13579][26]\|\d\d0[48]\|[02468][048]00\|[13579][26]00)-02-29\|\d{4}-(?:(?:0[13578]\|1[02])-(?:0[1-9]\|[12]\d\|3[01])\|(?:0[469]\|11)-(?:0[1-9]\|[12]\d\|30)\|(?:02)-(?:0[1-9]\|1\d\|2[0-8])))T(?:(?:[01]\d\|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d+)?)?(?:Z))$ |

### `customer.kyc.check.requested.v1`

**command** · transaction-service → customer-service. Exchange `bank.commands`; routing key `customer.kyc.check.requested.v1`.

Contrato: [`customer.kyc.check.requested.v1.ts`](../../apps/packages/contracts/src/events/customer/customer.kyc.check.requested.v1.ts).

| Campo | Tipo / valores | Obligatorio | Validación emitida |
| --- | --- | --- | --- |
| `transactionId` | uuid | sí | pattern=^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12})$ |
| `customerId` | uuid | sí | pattern=^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12})$ |

### `customer.kyc.checked.v1`

**event** · customer-service → transaction-service, notification-audit-service. Exchange `bank.events`; routing key `customer.kyc.checked.v1`.

Contrato: [`customer.kyc.checked.v1.ts`](../../apps/packages/contracts/src/events/customer/customer.kyc.checked.v1.ts).

| Campo | Tipo / valores | Obligatorio | Validación emitida |
| --- | --- | --- | --- |
| `transactionId` | uuid | sí | pattern=^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12})$ |
| `customerId` | uuid | sí | pattern=^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12})$ |
| `kycStatus` | `PENDING` \| `VERIFIED` \| `REJECTED` | sí | — |
| `allowed` | boolean | sí | — |

### `customer.verify-email.v1`

**command** · gateway → customer-service. Exchange `bank.commands`; routing key `customer.verify-email.v1`.

Contrato: [`customer.verify-email.v1.ts`](../../apps/packages/contracts/src/events/customer/customer.verify-email.v1.ts).

| Campo | Tipo / valores | Obligatorio | Validación emitida |
| --- | --- | --- | --- |
| `activationToken` | string | sí | minLength=16; maxLength=512 |

### `customer.stats.query.v1`

**command** · gateway → customer-service. Exchange `bank.commands`; routing key `customer.stats.query.v1`.

Contrato: [`customer.stats.query.v1.ts`](../../apps/packages/contracts/src/events/customer/customer.stats.query.v1.ts).

| Campo | Tipo / valores | Obligatorio | Validación emitida |
| --- | --- | --- | --- |
| — | Unión/variante: consultar contrato | — | — |

### `customer.stats.replied.v1`

**reply** · customer-service → gateway. Exchange `bank.replies`; routing key `customer.stats.replied.v1`.

Contrato: [`customer.stats.replied.v1.ts`](../../apps/packages/contracts/src/events/customer/customer.stats.replied.v1.ts).

| Campo | Tipo / valores | Obligatorio | Validación emitida |
| --- | --- | --- | --- |
| `registered` | integer | sí | minimum=0; maximum=9007199254740991 |
| `pendingValidation` | integer | sí | minimum=0; maximum=9007199254740991 |
| `activatedToday` | integer | sí | minimum=0; maximum=9007199254740991 |


## Familia `notification`

### `notification.inbox.query.v1`

**command** · gateway → notification-audit-service. Exchange `bank.commands`; routing key `notification.inbox.query.v1`.

Contrato: [`notification.inbox.query.v1.ts`](../../apps/packages/contracts/src/events/notification/notification.inbox.query.v1.ts).

| Campo | Tipo / valores | Obligatorio | Validación emitida |
| --- | --- | --- | --- |
| `limit` | integer | no | maximum=100; exclusiveMinimum=0 |

### `notification.inbox.replied.v1`

**reply** · notification-audit-service → gateway. Exchange `bank.replies`; routing key `notification.inbox.replied.v1`.

Contrato: [`notification.inbox.replied.v1.ts`](../../apps/packages/contracts/src/events/notification/notification.inbox.replied.v1.ts).

| Campo | Tipo / valores | Obligatorio | Validación emitida |
| --- | --- | --- | --- |
| `notifications` | array de object | sí | — |
| `unread` | integer | sí | minimum=0; maximum=9007199254740991 |

### `notification.mark-read.v1`

**command** · gateway → notification-audit-service. Exchange `bank.commands`; routing key `notification.mark-read.v1`.

Contrato: [`notification.mark-read.v1.ts`](../../apps/packages/contracts/src/events/notification/notification.mark-read.v1.ts).

| Campo | Tipo / valores | Obligatorio | Validación emitida |
| --- | --- | --- | --- |
| `notificationIds` | array de uuid | no | minItems=1; maxItems=100 |

### `notification.read.replied.v1`

**reply** · notification-audit-service → gateway. Exchange `bank.replies`; routing key `notification.read.replied.v1`.

Contrato: [`notification.read.replied.v1.ts`](../../apps/packages/contracts/src/events/notification/notification.read.replied.v1.ts).

| Campo | Tipo / valores | Obligatorio | Validación emitida |
| --- | --- | --- | --- |
| `changed` | integer | sí | minimum=0; maximum=9007199254740991 |
| `unread` | integer | sí | minimum=0; maximum=9007199254740991 |

### `notification.list.query.v1`

**command** · gateway → notification-audit-service. Exchange `bank.commands`; routing key `notification.list.query.v1`.

Contrato: [`notification.list.query.v1.ts`](../../apps/packages/contracts/src/events/notification/notification.list.query.v1.ts).

| Campo | Tipo / valores | Obligatorio | Validación emitida |
| --- | --- | --- | --- |
| `correlationId` | uuid | no | pattern=^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12})$ |
| `status` | `PENDING` \| `SENT` \| `FAILED` | no | — |
| `type` | string | no | minLength=1; maxLength=50 |
| `limit` | integer | no | maximum=200; exclusiveMinimum=0 |

### `notification.list.replied.v1`

**reply** · notification-audit-service → gateway. Exchange `bank.replies`; routing key `notification.list.replied.v1`.

Contrato: [`notification.list.replied.v1.ts`](../../apps/packages/contracts/src/events/notification/notification.list.replied.v1.ts).

| Campo | Tipo / valores | Obligatorio | Validación emitida |
| --- | --- | --- | --- |
| `notifications` | array de object | sí | — |
| `omitted` | integer | sí | minimum=0; maximum=9007199254740991 |


## Familia `payment`

### `payment.stats.query.v1`

**command** · gateway → payment-service. Exchange `bank.commands`; routing key `payment.stats.query.v1`.

Contrato: [`payment.stats.query.v1.ts`](../../apps/packages/contracts/src/events/payment/payment.stats.query.v1.ts).

| Campo | Tipo / valores | Obligatorio | Validación emitida |
| --- | --- | --- | --- |
| — | Unión/variante: consultar contrato | — | — |

### `payment.stats.replied.v1`

**reply** · payment-service → gateway. Exchange `bank.replies`; routing key `payment.stats.replied.v1`.

Contrato: [`payment.stats.replied.v1.ts`](../../apps/packages/contracts/src/events/payment/payment.stats.replied.v1.ts).

| Campo | Tipo / valores | Obligatorio | Validación emitida |
| --- | --- | --- | --- |
| `today` | integer | sí | minimum=0; maximum=9007199254740991 |
| `succeededToday` | integer | sí | minimum=0; maximum=9007199254740991 |
| `failedToday` | integer | sí | minimum=0; maximum=9007199254740991 |
| `retrying` | integer | sí | minimum=0; maximum=9007199254740991 |

### `payment.attempt.failed.v1`

**event** · payment-service → transaction-service, notification-audit-service. Exchange `bank.events`; routing key `payment.attempt.failed.v1`.

Contrato: [`payment.attempt.failed.v1.ts`](../../apps/packages/contracts/src/events/payment/payment.attempt.failed.v1.ts).

| Campo | Tipo / valores | Obligatorio | Validación emitida |
| --- | --- | --- | --- |
| `paymentId` | uuid | sí | pattern=^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12})$ |
| `transactionId` | uuid | sí | pattern=^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12})$ |
| `attempt` | integer | sí | maximum=9007199254740991; exclusiveMinimum=0 |
| `errorType` | `TRANSIENT` \| `PERMANENT` | sí | — |
| `providerResult` | `FAILURE` \| `TIMEOUT` | sí | — |
| `willRetry` | boolean | sí | — |
| `nextAttemptAt` | date-time \| null | sí | — |
| `failureReason` | `PAYMENT_DECLINED` \| `PAYMENT_RETRIES_EXHAUSTED` \| null | sí | — |
| `failedAt` | date-time | sí | pattern=^(?:(?:\d\d[2468][048]\|\d\d[13579][26]\|\d\d0[48]\|[02468][048]00\|[13579][26]00)-02-29\|\d{4}-(?:(?:0[13578]\|1[02])-(?:0[1-9]\|[12]\d\|3[01])\|(?:0[469]\|11)-(?:0[1-9]\|[12]\d\|30)\|(?:02)-(?:0[1-9]\|1\d\|2[0-8])))T(?:(?:[01]\d\|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d+)?)?(?:Z))$ |

### `payment.failed.v1`

**event** · payment-service → transaction-service, notification-audit-service. Exchange `bank.events`; routing key `payment.failed.v1`.

Contrato: [`payment.failed.v1.ts`](../../apps/packages/contracts/src/events/payment/payment.failed.v1.ts).

| Campo | Tipo / valores | Obligatorio | Validación emitida |
| --- | --- | --- | --- |
| `paymentId` | uuid | sí | pattern=^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12})$ |
| `transactionId` | uuid | sí | pattern=^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12})$ |
| `status` | `FAILED` | sí | — |
| `attempt` | integer | sí | maximum=9007199254740991; exclusiveMinimum=0 |
| `failureReason` | `PAYMENT_DECLINED` \| `PAYMENT_RETRIES_EXHAUSTED` | sí | — |
| `failedAt` | date-time | sí | pattern=^(?:(?:\d\d[2468][048]\|\d\d[13579][26]\|\d\d0[48]\|[02468][048]00\|[13579][26]00)-02-29\|\d{4}-(?:(?:0[13578]\|1[02])-(?:0[1-9]\|[12]\d\|3[01])\|(?:0[469]\|11)-(?:0[1-9]\|[12]\d\|30)\|(?:02)-(?:0[1-9]\|1\d\|2[0-8])))T(?:(?:[01]\d\|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d+)?)?(?:Z))$ |

### `payment.list.query.v1`

**command** · gateway → payment-service. Exchange `bank.commands`; routing key `payment.list.query.v1`.

Contrato: [`payment.list.query.v1.ts`](../../apps/packages/contracts/src/events/payment/payment.list.query.v1.ts).

| Campo | Tipo / valores | Obligatorio | Validación emitida |
| --- | --- | --- | --- |
| `transactionId` | uuid | no | pattern=^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12})$ |
| `status` | `PENDING` \| `SUCCEEDED` \| `FAILED` | no | — |
| `errorType` | `TRANSIENT` \| `PERMANENT` | no | — |

### `payment.list.replied.v1`

**reply** · payment-service → gateway. Exchange `bank.replies`; routing key `payment.list.replied.v1`.

Contrato: [`payment.list.replied.v1.ts`](../../apps/packages/contracts/src/events/payment/payment.list.replied.v1.ts).

| Campo | Tipo / valores | Obligatorio | Validación emitida |
| --- | --- | --- | --- |
| `payments` | array de object | sí | — |

### `payment.requested.v1`

**command** · transaction-service → payment-service. Exchange `bank.commands`; routing key `payment.requested.v1`.

Contrato: [`payment.requested.v1.ts`](../../apps/packages/contracts/src/events/payment/payment.requested.v1.ts).

| Campo | Tipo / valores | Obligatorio | Validación emitida |
| --- | --- | --- | --- |
| `paymentId` | uuid | sí | pattern=^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12})$ |
| `transactionId` | uuid | sí | pattern=^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12})$ |
| `amount` | object | sí | — |
| `scenario` | `APPROVE` \| `REJECT` \| `TRANSIENT_FAILURE` \| `TIMEOUT` | no | — |
| `interbank` | object | no | — |

### `payment.status.query.v1`

**command** · gateway → payment-service. Exchange `bank.commands`; routing key `payment.status.query.v1`.

Contrato: [`payment.status.query.v1.ts`](../../apps/packages/contracts/src/events/payment/payment.status.query.v1.ts).

| Campo | Tipo / valores | Obligatorio | Validación emitida |
| --- | --- | --- | --- |
| `paymentId` | uuid | sí | pattern=^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12})$ |

### `payment.status.replied.v1`

**reply** · payment-service → gateway. Exchange `bank.replies`; routing key `payment.status.replied.v1`.

Contrato: [`payment.status.replied.v1.ts`](../../apps/packages/contracts/src/events/payment/payment.status.replied.v1.ts).

| Campo | Tipo / valores | Obligatorio | Validación emitida |
| --- | --- | --- | --- |
| — | Unión/variante: consultar contrato | — | — |

### `payment.simulation.query.v1`

**command** · gateway → payment-service. Exchange `bank.commands`; routing key `payment.simulation.query.v1`.

Contrato: [`payment.simulation.query.v1.ts`](../../apps/packages/contracts/src/events/payment/payment.simulation.query.v1.ts).

| Campo | Tipo / valores | Obligatorio | Validación emitida |
| --- | --- | --- | --- |
| — | Unión/variante: consultar contrato | — | — |

### `payment.simulation.replied.v1`

**reply** · payment-service → gateway. Exchange `bank.replies`; routing key `payment.simulation.replied.v1`.

Contrato: [`payment.simulation.replied.v1.ts`](../../apps/packages/contracts/src/events/payment/payment.simulation.replied.v1.ts).

| Campo | Tipo / valores | Obligatorio | Validación emitida |
| --- | --- | --- | --- |
| `failureRatePercent` | number | sí | minimum=0; maximum=100 |
| `timeoutRatePercent` | number | sí | minimum=0; maximum=100 |
| `latencyMs` | integer | sí | minimum=0; maximum=30000 |
| `source` | `DEFAULTS` \| `RUNTIME` | sí | — |
| `updatedAt` | date-time \| null | sí | — |

### `payment.simulation.update.v1`

**command** · gateway → payment-service. Exchange `bank.commands`; routing key `payment.simulation.update.v1`.

Contrato: [`payment.simulation.update.v1.ts`](../../apps/packages/contracts/src/events/payment/payment.simulation.update.v1.ts).

| Campo | Tipo / valores | Obligatorio | Validación emitida |
| --- | --- | --- | --- |
| — | Unión/variante: consultar contrato | — | — |

### `payment.succeeded.v1`

**event** · payment-service → transaction-service, notification-audit-service. Exchange `bank.events`; routing key `payment.succeeded.v1`.

Contrato: [`payment.succeeded.v1.ts`](../../apps/packages/contracts/src/events/payment/payment.succeeded.v1.ts).

| Campo | Tipo / valores | Obligatorio | Validación emitida |
| --- | --- | --- | --- |
| `paymentId` | uuid | sí | pattern=^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12})$ |
| `transactionId` | uuid | sí | pattern=^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12})$ |
| `status` | `SUCCEEDED` | sí | — |
| `attempt` | integer | sí | maximum=9007199254740991; exclusiveMinimum=0 |
| `succeededAt` | date-time | sí | pattern=^(?:(?:\d\d[2468][048]\|\d\d[13579][26]\|\d\d0[48]\|[02468][048]00\|[13579][26]00)-02-29\|\d{4}-(?:(?:0[13578]\|1[02])-(?:0[1-9]\|[12]\d\|3[01])\|(?:0[469]\|11)-(?:0[1-9]\|[12]\d\|30)\|(?:02)-(?:0[1-9]\|1\d\|2[0-8])))T(?:(?:[01]\d\|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d+)?)?(?:Z))$ |

### `payment.interbank.receive.v1`

**command** · gateway → payment-service. Exchange `bank.commands`; routing key `payment.interbank.receive.v1`.

Contrato: [`incoming.v1.ts`](../../apps/packages/contracts/src/events/interbank/incoming.v1.ts).

| Campo | Tipo / valores | Obligatorio | Validación emitida |
| --- | --- | --- | --- |
| `depositId` | uuid | sí | pattern=^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12})$ |
| `interbankTransferId` | string | sí | minLength=1; maxLength=128 |
| `idempotencyKey` | string | sí | minLength=1; maxLength=128 |
| `originBankCode` | string | sí | pattern=^BANK[0-9]{2}$ |
| `destinationBankCode` | string | sí | pattern=^BANK[0-9]{2}$ |
| `accountId` | string | sí | minLength=1; maxLength=64 |
| `amount` | object | sí | — |
| `partnerTimestamp` | date-time | sí | pattern=^(?:(?:\d\d[2468][048]\|\d\d[13579][26]\|\d\d0[48]\|[02468][048]00\|[13579][26]00)-02-29\|\d{4}-(?:(?:0[13578]\|1[02])-(?:0[1-9]\|[12]\d\|3[01])\|(?:0[469]\|11)-(?:0[1-9]\|[12]\d\|30)\|(?:02)-(?:0[1-9]\|1\d\|2[0-8])))T(?:(?:[01]\d\|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d+)?)?(?:Z))$ |
| `requestedAt` | date-time | sí | pattern=^(?:(?:\d\d[2468][048]\|\d\d[13579][26]\|\d\d0[48]\|[02468][048]00\|[13579][26]00)-02-29\|\d{4}-(?:(?:0[13578]\|1[02])-(?:0[1-9]\|[12]\d\|3[01])\|(?:0[469]\|11)-(?:0[1-9]\|[12]\d\|30)\|(?:02)-(?:0[1-9]\|1\d\|2[0-8])))T(?:(?:[01]\d\|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d+)?)?(?:Z))$ |

### `payment.interbank.accepted.v1`

**event** · payment-service → notification-audit-service. Exchange `bank.events`; routing key `payment.interbank.accepted.v1`.

Contrato: [`incoming.v1.ts`](../../apps/packages/contracts/src/events/interbank/incoming.v1.ts).

| Campo | Tipo / valores | Obligatorio | Validación emitida |
| --- | --- | --- | --- |
| `depositId` | uuid | sí | pattern=^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12})$ |
| `decidedAt` | date-time | sí | pattern=^(?:(?:\d\d[2468][048]\|\d\d[13579][26]\|\d\d0[48]\|[02468][048]00\|[13579][26]00)-02-29\|\d{4}-(?:(?:0[13578]\|1[02])-(?:0[1-9]\|[12]\d\|3[01])\|(?:0[469]\|11)-(?:0[1-9]\|[12]\d\|30)\|(?:02)-(?:0[1-9]\|1\d\|2[0-8])))T(?:(?:[01]\d\|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d+)?)?(?:Z))$ |

### `payment.interbank.rejected.v1`

**event** · payment-service → notification-audit-service. Exchange `bank.events`; routing key `payment.interbank.rejected.v1`.

Contrato: [`incoming.v1.ts`](../../apps/packages/contracts/src/events/interbank/incoming.v1.ts).

| Campo | Tipo / valores | Obligatorio | Validación emitida |
| --- | --- | --- | --- |
| `depositId` | uuid | sí | pattern=^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12})$ |
| `reason` | `ACCOUNT_NOT_FOUND` \| `ACCOUNT_INACTIVE` \| `AMOUNT_EXCEEDS_LIMIT` \| `UNSUPPORTED_CURRENCY` \| `WRONG_DESTINATION_BANK` \| `BANK_NOT_AUTHORIZED` \| `INVALID_REQUEST` \| `IDEMPOTENCY_CONFLICT` \| `EXPIRED` \| `CANCELLED` | sí | — |
| `decidedAt` | date-time | sí | pattern=^(?:(?:\d\d[2468][048]\|\d\d[13579][26]\|\d\d0[48]\|[02468][048]00\|[13579][26]00)-02-29\|\d{4}-(?:(?:0[13578]\|1[02])-(?:0[1-9]\|[12]\d\|3[01])\|(?:0[469]\|11)-(?:0[1-9]\|[12]\d\|30)\|(?:02)-(?:0[1-9]\|1\d\|2[0-8])))T(?:(?:[01]\d\|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d+)?)?(?:Z))$ |

### `payment.interbank.callback.received.v1`

**command** · gateway → payment-service. Exchange `bank.commands`; routing key `payment.interbank.callback.received.v1`.

Contrato: [`outgoing.v1.ts`](../../apps/packages/contracts/src/events/interbank/outgoing.v1.ts).

| Campo | Tipo / valores | Obligatorio | Validación emitida |
| --- | --- | --- | --- |
| — | Unión/variante: consultar contrato | — | — |

### `payment.interbank.sent.v1`

**event** · payment-service → notification-audit-service. Exchange `bank.events`; routing key `payment.interbank.sent.v1`.

Contrato: [`outgoing.v1.ts`](../../apps/packages/contracts/src/events/interbank/outgoing.v1.ts).

| Campo | Tipo / valores | Obligatorio | Validación emitida |
| --- | --- | --- | --- |
| `paymentId` | uuid | sí | pattern=^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12})$ |
| `transactionId` | uuid | sí | pattern=^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12})$ |
| `interbankTransferId` | string | sí | minLength=1; maxLength=128 |
| `state` | `PENDING` \| `SENT` \| `ACCEPTED` \| `REJECTED` \| `TIMEOUT` \| `REVERSED` | sí | — |
| `reason` | string \| null | sí | — |
| `occurredAt` | date-time | sí | pattern=^(?:(?:\d\d[2468][048]\|\d\d[13579][26]\|\d\d0[48]\|[02468][048]00\|[13579][26]00)-02-29\|\d{4}-(?:(?:0[13578]\|1[02])-(?:0[1-9]\|[12]\d\|3[01])\|(?:0[469]\|11)-(?:0[1-9]\|[12]\d\|30)\|(?:02)-(?:0[1-9]\|1\d\|2[0-8])))T(?:(?:[01]\d\|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d+)?)?(?:Z))$ |

### `payment.interbank.v1.transfer.query.v1`

**command** · gateway → payment-service. Exchange `bank.commands`; routing key `payment.interbank.v1.transfer.query.v1`.

Contrato: [`v1-messages.ts`](../../apps/packages/contracts/src/events/interbank/v1-messages.ts).

| Campo | Tipo / valores | Obligatorio | Validación emitida |
| --- | --- | --- | --- |
| `transfer` | object | sí | additionalProperties=False |
| `callerBankCode` | string | sí | pattern=^BANK[0-9]{2}$ |
| `receivedAt` | date-time | sí | pattern=^(?:(?:\d\d[2468][048]\|\d\d[13579][26]\|\d\d0[48]\|[02468][048]00\|[13579][26]00)-02-29\|\d{4}-(?:(?:0[13578]\|1[02])-(?:0[1-9]\|[12]\d\|3[01])\|(?:0[469]\|11)-(?:0[1-9]\|[12]\d\|30)\|(?:02)-(?:0[1-9]\|1\d\|2[0-8])))T(?:(?:[01]\d\|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d+)?)?(?:Z))$ |

### `payment.interbank.v1.transfer.replied.v1`

**reply** · payment-service → gateway. Exchange `bank.replies`; routing key `payment.interbank.v1.transfer.replied.v1`.

Contrato: [`v1-messages.ts`](../../apps/packages/contracts/src/events/interbank/v1-messages.ts).

| Campo | Tipo / valores | Obligatorio | Validación emitida |
| --- | --- | --- | --- |
| `interbankTransferId` | uuid | sí | pattern=^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12})$ |
| `admission` | `ACCEPTED_FOR_PROCESSING` \| `DUPLICATE` \| `CONFLICT` | sí | — |
| `status` | `PROCESSING` \| `ACCEPTED` \| `REJECTED` \| `CANCELLED` \| null | sí | — |
| `reasonCode` | `ACCOUNT_NOT_FOUND` \| `ACCOUNT_INACTIVE` \| `AMOUNT_LIMIT_EXCEEDED` \| `CURRENCY_NOT_SUPPORTED` \| `EXPIRED` \| `CANCELLED` \| `PROCESSING_ERROR` \| null | sí | — |
| `updatedAt` | date-time | sí | pattern=^(?:(?:\d\d[2468][048]\|\d\d[13579][26]\|\d\d0[48]\|[02468][048]00\|[13579][26]00)-02-29\|\d{4}-(?:(?:0[13578]\|1[02])-(?:0[1-9]\|[12]\d\|3[01])\|(?:0[469]\|11)-(?:0[1-9]\|[12]\d\|30)\|(?:02)-(?:0[1-9]\|1\d\|2[0-8])))T(?:(?:[01]\d\|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d+)?)?(?:Z))$ |

### `payment.interbank.send.query.v1`

**command** · gateway → payment-service. Exchange `bank.commands`; routing key `payment.interbank.send.query.v1`.

Contrato: [`send-views.v1.ts`](../../apps/packages/contracts/src/events/interbank/send-views.v1.ts).

| Campo | Tipo / valores | Obligatorio | Validación emitida |
| --- | --- | --- | --- |
| `interbankTransferId` | string | sí | minLength=1; maxLength=128 |

### `payment.interbank.send.replied.v1`

**reply** · payment-service → gateway. Exchange `bank.replies`; routing key `payment.interbank.send.replied.v1`.

Contrato: [`send-views.v1.ts`](../../apps/packages/contracts/src/events/interbank/send-views.v1.ts).

| Campo | Tipo / valores | Obligatorio | Validación emitida |
| --- | --- | --- | --- |
| — | Unión/variante: consultar contrato | — | — |

### `payment.interbank.send.list.query.v1`

**command** · gateway → payment-service. Exchange `bank.commands`; routing key `payment.interbank.send.list.query.v1`.

Contrato: [`send-views.v1.ts`](../../apps/packages/contracts/src/events/interbank/send-views.v1.ts).

| Campo | Tipo / valores | Obligatorio | Validación emitida |
| --- | --- | --- | --- |
| `state` | `PENDING` \| `SENT` \| `ACCEPTED` \| `REJECTED` \| `TIMEOUT` \| `REVERSED` | no | — |
| `limit` | integer | no | minimum=1; maximum=200 |

### `payment.interbank.send.list.replied.v1`

**reply** · payment-service → gateway. Exchange `bank.replies`; routing key `payment.interbank.send.list.replied.v1`.

Contrato: [`send-views.v1.ts`](../../apps/packages/contracts/src/events/interbank/send-views.v1.ts).

| Campo | Tipo / valores | Obligatorio | Validación emitida |
| --- | --- | --- | --- |
| `sends` | array de object | sí | — |

### `payment.interbank.v1.status.query.v1`

**command** · gateway → payment-service. Exchange `bank.commands`; routing key `payment.interbank.v1.status.query.v1`.

Contrato: [`v1-messages.ts`](../../apps/packages/contracts/src/events/interbank/v1-messages.ts).

| Campo | Tipo / valores | Obligatorio | Validación emitida |
| --- | --- | --- | --- |
| `interbankTransferId` | uuid | sí | pattern=^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12})$ |
| `callerBankCode` | string | sí | pattern=^BANK[0-9]{2}$ |

### `payment.interbank.v1.status.replied.v1`

**reply** · payment-service → gateway. Exchange `bank.replies`; routing key `payment.interbank.v1.status.replied.v1`.

Contrato: [`v1-messages.ts`](../../apps/packages/contracts/src/events/interbank/v1-messages.ts).

| Campo | Tipo / valores | Obligatorio | Validación emitida |
| --- | --- | --- | --- |
| `interbankTransferId` | uuid | sí | pattern=^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12})$ |
| `found` | boolean | sí | — |
| `status` | `PROCESSING` \| `ACCEPTED` \| `REJECTED` \| `CANCELLED` \| null | sí | — |
| `reasonCode` | `ACCOUNT_NOT_FOUND` \| `ACCOUNT_INACTIVE` \| `AMOUNT_LIMIT_EXCEEDED` \| `CURRENCY_NOT_SUPPORTED` \| `EXPIRED` \| `CANCELLED` \| `PROCESSING_ERROR` \| null | sí | — |
| `updatedAt` | date-time \| null | sí | — |

### `payment.interbank.v1.cancel.query.v1`

**command** · gateway → payment-service. Exchange `bank.commands`; routing key `payment.interbank.v1.cancel.query.v1`.

Contrato: [`v1-messages.ts`](../../apps/packages/contracts/src/events/interbank/v1-messages.ts).

| Campo | Tipo / valores | Obligatorio | Validación emitida |
| --- | --- | --- | --- |
| `interbankTransferId` | uuid | sí | pattern=^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12})$ |
| `callerBankCode` | string | sí | pattern=^BANK[0-9]{2}$ |
| `reason` | `TIMEOUT` \| `CLIENT_REQUEST` | sí | — |
| `requestedAt` | date-time | sí | pattern=^(?:(?:\d\d[2468][048]\|\d\d[13579][26]\|\d\d0[48]\|[02468][048]00\|[13579][26]00)-02-29\|\d{4}-(?:(?:0[13578]\|1[02])-(?:0[1-9]\|[12]\d\|3[01])\|(?:0[469]\|11)-(?:0[1-9]\|[12]\d\|30)\|(?:02)-(?:0[1-9]\|1\d\|2[0-8])))T(?:(?:[01]\d\|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d+)?)?(?:Z))$ |

### `payment.interbank.v1.cancel.replied.v1`

**reply** · payment-service → gateway. Exchange `bank.replies`; routing key `payment.interbank.v1.cancel.replied.v1`.

Contrato: [`v1-messages.ts`](../../apps/packages/contracts/src/events/interbank/v1-messages.ts).

| Campo | Tipo / valores | Obligatorio | Validación emitida |
| --- | --- | --- | --- |
| `interbankTransferId` | uuid | sí | pattern=^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12})$ |
| `result` | `CANCELLED` \| `ALREADY_ACCEPTED` \| `ALREADY_REJECTED` \| `IN_PROGRESS` | sí | — |

### `payment.interbank.v1.result.received.v1`

**command** · gateway → payment-service. Exchange `bank.commands`; routing key `payment.interbank.v1.result.received.v1`.

Contrato: [`v1-messages.ts`](../../apps/packages/contracts/src/events/interbank/v1-messages.ts).

| Campo | Tipo / valores | Obligatorio | Validación emitida |
| --- | --- | --- | --- |
| `result` | object | sí | additionalProperties=False |
| `callerBankCode` | string | sí | pattern=^BANK[0-9]{2}$ |
| `receivedAt` | date-time | sí | pattern=^(?:(?:\d\d[2468][048]\|\d\d[13579][26]\|\d\d0[48]\|[02468][048]00\|[13579][26]00)-02-29\|\d{4}-(?:(?:0[13578]\|1[02])-(?:0[1-9]\|[12]\d\|3[01])\|(?:0[469]\|11)-(?:0[1-9]\|[12]\d\|30)\|(?:02)-(?:0[1-9]\|1\d\|2[0-8])))T(?:(?:[01]\d\|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d+)?)?(?:Z))$ |

### `payment.interbank.v1.reversal.requested.v1`

**command** · gateway → payment-service. Exchange `bank.commands`; routing key `payment.interbank.v1.reversal.requested.v1`.

Contrato: [`v1-messages.ts`](../../apps/packages/contracts/src/events/interbank/v1-messages.ts).

| Campo | Tipo / valores | Obligatorio | Validación emitida |
| --- | --- | --- | --- |
| `reversalId` | uuid | sí | pattern=^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12})$ |
| `originalTransferId` | uuid | sí | pattern=^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12})$ |
| `callerBankCode` | string | sí | pattern=^BANK[0-9]{2}$ |
| `amount` | string | sí | pattern=^[0-9]{1,5}\.[0-9]{2}$ |
| `requestedAt` | date-time | sí | pattern=^(?:(?:\d\d[2468][048]\|\d\d[13579][26]\|\d\d0[48]\|[02468][048]00\|[13579][26]00)-02-29\|\d{4}-(?:(?:0[13578]\|1[02])-(?:0[1-9]\|[12]\d\|3[01])\|(?:0[469]\|11)-(?:0[1-9]\|[12]\d\|30)\|(?:02)-(?:0[1-9]\|1\d\|2[0-8])))T(?:(?:[01]\d\|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d+)?)?(?:Z))$ |

### `payment.interbank.v1.reversal.query.v1`

**command** · gateway → payment-service. Exchange `bank.commands`; routing key `payment.interbank.v1.reversal.query.v1`.

Contrato: [`v1-messages.ts`](../../apps/packages/contracts/src/events/interbank/v1-messages.ts).

| Campo | Tipo / valores | Obligatorio | Validación emitida |
| --- | --- | --- | --- |
| `reversalId` | uuid | sí | pattern=^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12})$ |
| `callerBankCode` | string | sí | pattern=^BANK[0-9]{2}$ |

### `payment.interbank.v1.reversal.replied.v1`

**reply** · payment-service → gateway. Exchange `bank.replies`; routing key `payment.interbank.v1.reversal.replied.v1`.

Contrato: [`v1-messages.ts`](../../apps/packages/contracts/src/events/interbank/v1-messages.ts).

| Campo | Tipo / valores | Obligatorio | Validación emitida |
| --- | --- | --- | --- |
| `reversalId` | uuid | sí | pattern=^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12})$ |
| `found` | boolean | sí | — |
| `status` | `PROCESSING` \| `COMPLETED` \| `FAILED` \| null | sí | — |
| `refundTransferId` | uuid \| null | sí | — |
| `reasonMessage` | string \| null | sí | — |

### `payment.interbank.v1.reconciliation.query.v1`

**command** · gateway → payment-service. Exchange `bank.commands`; routing key `payment.interbank.v1.reconciliation.query.v1`.

Contrato: [`v1-messages.ts`](../../apps/packages/contracts/src/events/interbank/v1-messages.ts).

| Campo | Tipo / valores | Obligatorio | Validación emitida |
| --- | --- | --- | --- |
| `callerBankCode` | string | sí | pattern=^BANK[0-9]{2}$ |
| `date` | string | sí | pattern=^\d{4}-\d{2}-\d{2}$ |
| `page` | integer | sí | minimum=1; maximum=9007199254740991 |
| `pageSize` | integer | sí | minimum=1; maximum=500 |

### `payment.interbank.v1.reconciliation.replied.v1`

**reply** · payment-service → gateway. Exchange `bank.replies`; routing key `payment.interbank.v1.reconciliation.replied.v1`.

Contrato: [`v1-messages.ts`](../../apps/packages/contracts/src/events/interbank/v1-messages.ts).

| Campo | Tipo / valores | Obligatorio | Validación emitida |
| --- | --- | --- | --- |
| `date` | string | sí | pattern=^\d{4}-\d{2}-\d{2}$ |
| `page` | integer | sí | minimum=-9007199254740991; maximum=9007199254740991 |
| `pageSize` | integer | sí | minimum=-9007199254740991; maximum=9007199254740991 |
| `totalItems` | integer | sí | minimum=-9007199254740991; maximum=9007199254740991 |
| `items` | array de object | sí | — |


## Familia `transaction`

### `transaction.stats.query.v1`

**command** · gateway → transaction-service. Exchange `bank.commands`; routing key `transaction.stats.query.v1`.

Contrato: [`transaction.stats.query.v1.ts`](../../apps/packages/contracts/src/events/transaction/transaction.stats.query.v1.ts).

| Campo | Tipo / valores | Obligatorio | Validación emitida |
| --- | --- | --- | --- |
| — | Unión/variante: consultar contrato | — | — |

### `transaction.stats.replied.v1`

**reply** · transaction-service → gateway. Exchange `bank.replies`; routing key `transaction.stats.replied.v1`.

Contrato: [`transaction.stats.replied.v1.ts`](../../apps/packages/contracts/src/events/transaction/transaction.stats.replied.v1.ts).

| Campo | Tipo / valores | Obligatorio | Validación emitida |
| --- | --- | --- | --- |
| `today` | integer | sí | minimum=0; maximum=9007199254740991 |
| `completedToday` | integer | sí | minimum=0; maximum=9007199254740991 |
| `failedToday` | integer | sí | minimum=0; maximum=9007199254740991 |
| `compensatedToday` | integer | sí | minimum=0; maximum=9007199254740991 |
| `inFlight` | integer | sí | minimum=0; maximum=9007199254740991 |

### `transaction.compensated.v1`

**event** · transaction-service → notification-audit-service. Exchange `bank.events`; routing key `transaction.compensated.v1`.

Contrato: [`transaction.compensated.v1.ts`](../../apps/packages/contracts/src/events/transaction/transaction.compensated.v1.ts).

| Campo | Tipo / valores | Obligatorio | Validación emitida |
| --- | --- | --- | --- |
| `transactionId` | uuid | sí | pattern=^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12})$ |
| `customerId` | uuid \| null | sí | — |
| `status` | `COMPENSATED` | sí | — |
| `reason` | `PAYMENT_DECLINED` \| `PAYMENT_RETRIES_EXHAUSTED` \| `ACCOUNT_NOT_FOUND` \| `INVALID_AMOUNT_PRECISION` | sí | — |
| `compensatedAt` | date-time | sí | pattern=^(?:(?:\d\d[2468][048]\|\d\d[13579][26]\|\d\d0[48]\|[02468][048]00\|[13579][26]00)-02-29\|\d{4}-(?:(?:0[13578]\|1[02])-(?:0[1-9]\|[12]\d\|3[01])\|(?:0[469]\|11)-(?:0[1-9]\|[12]\d\|30)\|(?:02)-(?:0[1-9]\|1\d\|2[0-8])))T(?:(?:[01]\d\|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d+)?)?(?:Z))$ |

### `transaction.completed.v1`

**event** · transaction-service → notification-audit-service. Exchange `bank.events`; routing key `transaction.completed.v1`.

Contrato: [`transaction.completed.v1.ts`](../../apps/packages/contracts/src/events/transaction/transaction.completed.v1.ts).

| Campo | Tipo / valores | Obligatorio | Validación emitida |
| --- | --- | --- | --- |
| `transactionId` | uuid | sí | pattern=^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12})$ |
| `customerId` | uuid \| null | sí | — |
| `sourceAccount` | uuid | sí | pattern=^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12})$ |
| `targetAccount` | uuid | sí | pattern=^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12})$ |
| `amount` | object | sí | — |
| `status` | `COMPLETED` | sí | — |
| `completedAt` | date-time | sí | pattern=^(?:(?:\d\d[2468][048]\|\d\d[13579][26]\|\d\d0[48]\|[02468][048]00\|[13579][26]00)-02-29\|\d{4}-(?:(?:0[13578]\|1[02])-(?:0[1-9]\|[12]\d\|3[01])\|(?:0[469]\|11)-(?:0[1-9]\|[12]\d\|30)\|(?:02)-(?:0[1-9]\|1\d\|2[0-8])))T(?:(?:[01]\d\|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d+)?)?(?:Z))$ |

### `transaction.failed.v1`

**event** · transaction-service → notification-audit-service. Exchange `bank.events`; routing key `transaction.failed.v1`.

Contrato: [`transaction.failed.v1.ts`](../../apps/packages/contracts/src/events/transaction/transaction.failed.v1.ts).

| Campo | Tipo / valores | Obligatorio | Validación emitida |
| --- | --- | --- | --- |
| `transactionId` | uuid | sí | pattern=^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12})$ |
| `customerId` | uuid \| null | sí | — |
| `status` | `FAILED` | sí | — |
| `reason` | `INSUFFICIENT_FUNDS` \| `ACCOUNT_INACTIVE` \| `ACCOUNT_NOT_FOUND` \| `INVALID_AMOUNT` \| `INVALID_AMOUNT_PRECISION` \| `SAME_ACCOUNT_TRANSFER` \| `IDEMPOTENCY_KEY_CONFLICT` \| `KYC_NOT_VERIFIED` | sí | — |
| `failedAt` | date-time | sí | pattern=^(?:(?:\d\d[2468][048]\|\d\d[13579][26]\|\d\d0[48]\|[02468][048]00\|[13579][26]00)-02-29\|\d{4}-(?:(?:0[13578]\|1[02])-(?:0[1-9]\|[12]\d\|3[01])\|(?:0[469]\|11)-(?:0[1-9]\|[12]\d\|30)\|(?:02)-(?:0[1-9]\|1\d\|2[0-8])))T(?:(?:[01]\d\|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d+)?)?(?:Z))$ |

### `transaction.initiated.v1`

**event** · transaction-service → notification-audit-service. Exchange `bank.events`; routing key `transaction.initiated.v1`.

Contrato: [`transaction.initiated.v1.ts`](../../apps/packages/contracts/src/events/transaction/transaction.initiated.v1.ts).

| Campo | Tipo / valores | Obligatorio | Validación emitida |
| --- | --- | --- | --- |
| `transactionId` | uuid | sí | pattern=^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12})$ |
| `sourceAccount` | uuid | sí | pattern=^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12})$ |
| `targetAccount` | uuid | sí | pattern=^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12})$ |
| `amount` | object | sí | — |
| `status` | `PENDING` | sí | — |
| `createdAt` | date-time | sí | pattern=^(?:(?:\d\d[2468][048]\|\d\d[13579][26]\|\d\d0[48]\|[02468][048]00\|[13579][26]00)-02-29\|\d{4}-(?:(?:0[13578]\|1[02])-(?:0[1-9]\|[12]\d\|3[01])\|(?:0[469]\|11)-(?:0[1-9]\|[12]\d\|30)\|(?:02)-(?:0[1-9]\|1\d\|2[0-8])))T(?:(?:[01]\d\|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d+)?)?(?:Z))$ |

### `transaction.list.query.v1`

**command** · gateway → transaction-service. Exchange `bank.commands`; routing key `transaction.list.query.v1`.

Contrato: [`transaction.list.query.v1.ts`](../../apps/packages/contracts/src/events/transaction/transaction.list.query.v1.ts).

| Campo | Tipo / valores | Obligatorio | Validación emitida |
| --- | --- | --- | --- |
| `customerId` | uuid | no | pattern=^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12})$ |
| `accountId` | uuid | no | pattern=^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12})$ |
| `status` | `PENDING` \| `DEBITING` \| `PAYMENT_PENDING` \| `COMPLETED` \| `FAILED` \| `COMPENSATED` | no | — |
| `phaseStatus` | `PENDING` \| `APPROVED` \| `FAILED` | no | — |
| `from` | date-time | no | pattern=^(?:(?:\d\d[2468][048]\|\d\d[13579][26]\|\d\d0[48]\|[02468][048]00\|[13579][26]00)-02-29\|\d{4}-(?:(?:0[13578]\|1[02])-(?:0[1-9]\|[12]\d\|3[01])\|(?:0[469]\|11)-(?:0[1-9]\|[12]\d\|30)\|(?:02)-(?:0[1-9]\|1\d\|2[0-8])))T(?:(?:[01]\d\|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d+)?)?(?:Z))$ |
| `to` | date-time | no | pattern=^(?:(?:\d\d[2468][048]\|\d\d[13579][26]\|\d\d0[48]\|[02468][048]00\|[13579][26]00)-02-29\|\d{4}-(?:(?:0[13578]\|1[02])-(?:0[1-9]\|[12]\d\|3[01])\|(?:0[469]\|11)-(?:0[1-9]\|[12]\d\|30)\|(?:02)-(?:0[1-9]\|1\d\|2[0-8])))T(?:(?:[01]\d\|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d+)?)?(?:Z))$ |
| `limit` | integer | no | maximum=100; exclusiveMinimum=0 |

### `transaction.list.replied.v1`

**reply** · transaction-service → gateway. Exchange `bank.replies`; routing key `transaction.list.replied.v1`.

Contrato: [`transaction.list.replied.v1.ts`](../../apps/packages/contracts/src/events/transaction/transaction.list.replied.v1.ts).

| Campo | Tipo / valores | Obligatorio | Validación emitida |
| --- | --- | --- | --- |
| `transactions` | array de object | sí | — |
| `total` | integer | sí | minimum=0; maximum=9007199254740991 |

### `transaction.status.replied.v1`

**reply** · transaction-service → gateway. Exchange `bank.replies`; routing key `transaction.status.replied.v1`.

Contrato: [`transaction.status.replied.v1.ts`](../../apps/packages/contracts/src/events/transaction/transaction.status.replied.v1.ts).

| Campo | Tipo / valores | Obligatorio | Validación emitida |
| --- | --- | --- | --- |
| — | Unión/variante: consultar contrato | — | — |

### `transaction.status.requested.v1`

**command** · gateway → transaction-service. Exchange `bank.commands`; routing key `transaction.status.requested.v1`.

Contrato: [`transaction.status.requested.v1.ts`](../../apps/packages/contracts/src/events/transaction/transaction.status.requested.v1.ts).

| Campo | Tipo / valores | Obligatorio | Validación emitida |
| --- | --- | --- | --- |
| `transactionId` | uuid | no | pattern=^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12})$ |
| `correlationId` | uuid | no | pattern=^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12})$ |


## Familia `transfer`

### `transfer.requested.v1`

**command** · gateway → transaction-service. Exchange `bank.commands`; routing key `transfer.requested.v1`.

Contrato: [`transfer.requested.v1.ts`](../../apps/packages/contracts/src/events/transaction/transfer.requested.v1.ts).

| Campo | Tipo / valores | Obligatorio | Validación emitida |
| --- | --- | --- | --- |
| `transactionId` | uuid | sí | pattern=^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12})$ |
| `sourceAccount` | uuid | sí | pattern=^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12})$ |
| `targetAccount` | uuid | sí | pattern=^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12})$ |
| `amount` | object | sí | — |
| `customerId` | uuid | no | pattern=^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12})$ |
| `paymentScenario` | `APPROVE` \| `REJECT` \| `TRANSIENT_FAILURE` \| `TIMEOUT` | no | — |
| `interbank` | object | no | — |
| `reference` | string | no | minLength=1; maxLength=60 |
