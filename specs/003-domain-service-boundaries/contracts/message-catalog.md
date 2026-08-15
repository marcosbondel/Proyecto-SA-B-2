# Contract — Catálogo inicial de comandos y eventos

**Feature**: [../spec.md](../spec.md) | **Fecha**: 2026-08-14

Qué fija este contrato: **nombre, productor, consumidores y flujo** de cada mensaje. Qué no
fija: forma del payload, versionado, nombres de exchange o routing key, y política de
reintentos del broker. Eso es **T-05** y FR-051 lo prohíbe aquí (R3).

Dos reglas que este catálogo hace verificables:

- **Un comando, un servicio que lo atiende** (FR-048).
- **Un evento, al menos un consumidor** (FR-047). Cero eventos huérfanos.

Convención: un **comando** expresa una intención dirigida a un servicio concreto y admite un
solo receptor; un **evento** narra un hecho consumado y admite muchos. Que la Saga sea
coreografiada no elimina los comandos: Transaction Service ordena el débito, no lo insinúa.
Lo que la coreografía evita es que un servicio espere bloqueado la respuesta de otro.

---

## Comandos

| Comando | Emite | Atiende | Flujo | Nota |
| --- | --- | --- | --- | --- |
| `customer.register` | Gateway | Customer | Crear cliente | — |
| `customer.authenticate` | Gateway | Customer | Login | Request/reply asíncrono; responde claims, no token (FR-036) |
| `customer.verify-email` | Gateway | Customer | Activación por correo | Lleva el token que Customer Service firmó |
| `customer.update` | Gateway | Customer | Actualizar datos | — |
| `customer.validate-identity` | Gateway | Customer | Validación de identidad | Eje independiente de la activación |
| `account.create` | Gateway | Account | Crear cuenta | Incluye `accountType` (FR-031) |
| `account.balance.query` | Gateway | Account | Consultar saldo | Request/reply asíncrono (FR-032) |
| `account.set-status` | Gateway | Account | Desactivación o reactivación manual | Solo `ADMINISTRADOR` |
| `transfer.requested` | Gateway | Transaction | Transferir | Lleva la `idempotencyKey` del solicitante |
| `account.debit.requested` | Transaction | Account | Transferir — paso 2 | — |
| `payment.requested` | Transaction | Payment | Transferir — paso 4 | — |
| `account.credit.requested` | Transaction | Account | Transferir — paso 6 | — |
| `account.debit.compensation.requested` | Transaction | Account | Transferir — compensación | Devuelve el dinero al origen |

---

## Eventos

### Customer Service

| Evento | Consumidores | Flujo |
| --- | --- | --- |
| `customer.registered` | Notification & Audit | Crear cliente |
| `customer.activation.requested` | Notification & Audit | Activación por correo — dispara la entrega (D-03) |
| `customer.email.verified` | Notification & Audit | Activación por correo — cierre |
| `customer.updated` | Notification & Audit | Actualizar datos |
| `customer.identity.validated` | Notification & Audit | Validación de identidad |
| `customer.identity.rejected` | Notification & Audit | Validación de identidad |
| `customer.login.succeeded` | Notification & Audit | Login |
| `customer.login.rejected` | Notification & Audit | Login — incluye el motivo distinguible de D-04 |

### Account Service

| Evento | Consumidores | Flujo |
| --- | --- | --- |
| `account.opened` | Notification & Audit | Crear cuenta |
| `account.debited` | Transaction, Notification & Audit | Transferir — paso 2 exitoso |
| `account.debit.rejected` | Transaction, Notification & Audit | Transferir — cierra en `FAILED` |
| `account.credited` | Transaction, Notification & Audit | Transferir — paso 6 exitoso |
| `account.credit.rejected` | Transaction, Notification & Audit | Transferir — dispara compensación |
| `account.debit.compensated` | Transaction, Notification & Audit | Transferir — cierra en `COMPENSATED` |
| `account.deactivated` | Notification & Audit | Desactivación automática o manual |
| `account.reactivated` | Notification & Audit | Reactivación por crédito o por administrador |

### Transaction Service

| Evento | Consumidores | Flujo |
| --- | --- | --- |
| `transaction.initiated` | Notification & Audit | Transferir — apertura de la Saga |
| `transaction.completed` | Notification & Audit | Transferir — cierre exitoso |
| `transaction.failed` | Notification & Audit | Transferir — nunca salió dinero |
| `transaction.compensated` | Notification & Audit | Transferir — salió y volvió |

### Payment Service

| Evento | Consumidores | Flujo |
| --- | --- | --- |
| `payment.succeeded` | Transaction, Notification & Audit | Transferir — paso 4 exitoso |
| `payment.failed` | Transaction, Notification & Audit | Transferir — reintentos agotados |

### Notification & Audit Service

**No publica ningún evento.** Es terminal por diseño (FR-050): consume todo lo anterior para
el registro auditable y para notificar, y ningún servicio depende de él para decidir nada.
Si un diseño posterior necesita que este servicio publique un evento que otro consuma para
tomar una decisión de negocio, el diseño contradice §4.1 (p. 7) y este contrato.

---

## Verificación de coherencia

Comprobaciones que un revisor puede hacer sobre las tablas anteriores sin conocer el código:

| # | Comprobación | Resultado esperado |
| --- | --- | --- |
| M-1 | Cada comando aparece con exactamente un servicio en "Atiende" | 13 de 13 |
| M-2 | Cada evento aparece con al menos un consumidor | 22 de 22, cero huérfanos |
| M-3 | Ningún evento de Notification & Audit tiene consumidores | La sección está vacía por diseño |
| M-4 | La Saga de transferencia tiene un camino de compensación desde cada paso que puede fallar tras el débito | `payment.failed` y `account.credit.rejected` llevan ambos a `account.debit.compensation.requested` |
| M-5 | Ningún mensaje transporta un dato de la lista "no cruza" de `data-model.md` §2 | Única excepción: el correo en `customer.activation.requested` (FR-041a) |
| M-6 | Todo mensaje propaga `correlationId` | Regla transversal X-3, aplicable sin excepción |
