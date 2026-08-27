# Contrato HTTP: las once rutas del Gateway

**Fase 1** · 2026-08-24 · [plan.md](../plan.md) · [data-model.md](../data-model.md)

Este documento es la fuente de la que se deriva `apps/gateway/openapi/gateway.v1.yaml`.
Cuando los dos difieran, gana el YAML generado desde el código y este documento
está desactualizado — la prueba de deriva de R8 lo hace imposible en silencio.

**Regla que atraviesa todo**: cada ruta nombra un mensaje que existe **con ese
nombre exacto** en `catalog` de `@bank/contracts`. Los nombres que usa el texto
del ticket no existen; la tabla FR-004 de la spec registra la correspondencia.

Toda respuesta, incluida cada error, lleva `correlationId`.

---

## Rutas públicas

### `POST /api/auth/login`

| | |
| --- | --- |
| Publica | `customer.authenticate.v1` → `bank.commands` |
| Espera | `customer.authenticate.replied.v1`, 5 s |
| Autenticación | pública |

**Cuerpo**

```json
{ "email": "ana@example.com", "credential": "········" }
```

**Respuestas**

| Estado | Cuándo | Cuerpo |
| --- | --- | --- |
| `200` | `outcome: APPROVED` y `activationPending: false` | `{ token, expiresIn: 3600, correlationId }` |
| `401` | `outcome: REJECTED`, **o** `APPROVED` con `activationPending: true` | Rechazo genérico idéntico en los tres casos |
| `504` | Sin respuesta en 5 s | Vencimiento del plazo |
| `503` | Broker inalcanzable | — |

**Los tres rechazos son indistinguibles** en cuerpo, código, cabeceras y tiempo
de respuesta (FR-013, SC-002). Esto contradice el prototipo de diseño, que sí
los separa; la discrepancia está razonada en el plan.

**`credential` no se registra en ningún log, nunca.**

---

### `POST /api/customers`

| | |
| --- | --- |
| Publica | `customer.register.v1` → `bank.commands` |
| Espera | nada — asíncrono |
| Autenticación | pública |
| Formato | `multipart/form-data` |

**Partes**: `fullName`, `identityDocument`, `email`, `dateOfBirth` (`YYYY-MM-DD`),
`address`, `role`, `credential` (8–256), y `photo` opcional.

El `customerId` lo **genera el Gateway** y lo devuelve.

**Foto**: ≤ 5 MB, `image/jpeg` o `image/png`. Orden obligatorio: validar →
SHA-256 → subir a `customer-identity-documents` → publicar la referencia. Si la
subida falla no se publica nada (`500`). Sin foto, se publica `photo: null`.

| Estado | Cuándo |
| --- | --- |
| `202` | Aceptado — `{ customerId, correlationId }` |
| `400` | Validación, incluido un tipo de foto no admitido |
| `413` | La foto supera los 5 MB. El tipo de fallo sigue siendo `VALIDATION_ERROR`; el estado es más preciso y el cliente ya lo conoce |
| `500` | El almacenamiento de objetos no respondió |
| `503` | Broker inalcanzable |

**`credential` nunca se registra. Los bytes de la foto nunca viajan por el broker.**

---

### `GET /api/customers/verify-email?token=...`

| | |
| --- | --- |
| Publica | `customer.verify-email.v1` → `bank.commands` |
| Espera | `customer.email.verified.v1` **o** `customer.email.verification.rejected.v1`, correlacionados sobre `bank.events`, 5 s |
| Autenticación | pública |

Es la ruta que la aclaración Q1 convirtió en **veredicto síncrono**. Los dos
eventos siguen publicándose y auditándose exactamente igual; el Gateway los
observa por correlación, no los consume en el sentido del catálogo (R2).

| Estado | Cuándo | Cuerpo |
| --- | --- | --- |
| `200` | Llegó `customer.email.verified.v1` | `{ status: "ACTIVE", correlationId }` |
| `400` | `token` ausente o fuera de 16–512 caracteres | Sin publicar nada |
| `409` | Llegó el rechazo | **Idéntico** para token inventado, usado y caducado (FR-015e) |
| `504` | Silencio en 5 s | Declara que la activación **no fue cancelada** |

**El token de activación no se registra en ningún log.**

---

### `GET /health` · `GET /ready`

Públicas, sin token. `/health` responde si el proceso vive. `/ready` responde si
además el broker está conectado. Ya existen en `interfaces/health.controller.ts`.

---

## Rutas protegidas

Todas exigen un token válido. Sin él, `401` y **no se publica nada**. Con rol no
autorizado, `403` y tampoco. La matriz está en
[`authorization-matrix.md`](authorization-matrix.md).

### `PATCH /api/customers/:customerId`

| | |
| --- | --- |
| Publica | `customer.update.v1` |
| Espera | nada — `202` |
| Roles | los tres |

Cuerpo: al menos uno de `fullName`, `address`, `dateOfBirth`. El contrato ya
rechaza el objeto vacío.

`:customerId` es el **sujeto**; el actor sale del token (R4). Que un `CLIENTE`
actualice a otro lo rechaza Customer Service, no el Gateway.

---

### `POST /api/accounts`

| | |
| --- | --- |
| Publica | `account.create.v1` |
| Espera | nada — `202` |
| Roles | los tres |

```json
{ "accountType": "MONETARIA", "customerId": "opcional" }
```

`accountId` lo genera el Gateway. `customerId` es el sujeto: si falta, se
rellena con el del token; si viene, se reenvía tal cual. Un `CLIENTE` que apunte
a un tercero pasa el Gateway y choca contra Account Service con
`ROLE_NOT_ELIGIBLE` o el rechazo que corresponda. Es correcto y está razonado en
R4.

Respuesta `202`: `{ accountId, correlationId }`.

---

### `GET /api/accounts/:accountId/balance`

| | |
| --- | --- |
| Publica | `account.balance.query.v1` |
| Espera | `account.balance.replied.v1`, 5 s |
| Roles | los tres |

| Estado | Cuándo |
| --- | --- |
| `200` | `outcome: FOUND` — `{ accountId, balance, status, lastActivityAt, correlationId }` |
| `404` | `outcome: NOT_FOUND` — conserva `ACCOUNT_NOT_FOUND` |
| `504` | Silencio en 5 s |

---

### `POST /api/transfers`

| | |
| --- | --- |
| Publica | `transfer.requested.v1` |
| Espera | nada — `202` |
| Roles | los tres |

```json
{
  "sourceAccount": "uuid",
  "targetAccount": "uuid",
  "amount": { "amountMinor": 125000, "currency": "GTQ" },
  "idempotencyKey": "...",
  "paymentScenario": "APPROVE"
}
```

`transactionId` lo genera el Gateway (FR-021) y lo devuelve.

`paymentScenario` es **opcional y de demostración** (FR-021b–d). Se valida
contra los tres valores y se traslada sin interpretar. Un cuarto valor es `400`.
Su ausencia es el camino normal.

`idempotencyKey` viaja al sobre sin reinterpretarse. Dos peticiones con la misma
clave se publican ambas: reconocer la repetición es de Transaction Service
(constitución V).

Respuesta `202`: `{ transactionId, correlationId }`.

Las invariantes del contrato —monto positivo, origen ≠ destino— las valida el
esquema y producen `400` sin publicar.

---

### `GET /api/transfers/:transactionId`

| | |
| --- | --- |
| Publica | `transaction.status.requested.v1` |
| Espera | `transaction.status.replied.v1`, 5 s |
| Roles | los tres |

`200` con `outcome: FOUND`, `404` con `NOT_FOUND`, `504` al vencer.

---

### `GET /api/audit?correlationId=...`

| | |
| --- | --- |
| Publica | `audit.query.requested.v1` |
| Espera | `audit.query.replied.v1`, 5 s |
| Roles | **`ADMINISTRADOR` únicamente** |

Es la única ruta que D-06 restringe por rol, y por tanto la que ejercita el
`403` de SC-003.

Respuesta `200`: `{ correlationId, events[], notifications[] }`. Es la vía por la
que el frontend averigua cómo terminó cualquier comando asíncrono.

---

## Cabeceras comunes

| Cabecera | Dirección | Regla |
| --- | --- | --- |
| `Authorization: Bearer <jwt>` | entrada | Obligatoria en ruta protegida |
| `X-Correlation-Id` | entrada, opcional | Se conserva si viene; se genera si no |
| `X-Correlation-Id` | salida | **Siempre**, incluidos los errores |
| `Idempotency-Key` | entrada, opcional | Se traslada al sobre sin reinterpretar |

---

## Resumen: ruta → mensaje

Esta tabla es la que la prueba de consistencia de SC-010 recorre, comprobando
que cada nombre existe en `catalog`.

| Ruta | Publica | Espera |
| --- | --- | --- |
| `POST /api/auth/login` | `customer.authenticate.v1` | `customer.authenticate.replied.v1` |
| `POST /api/customers` | `customer.register.v1` | — |
| `GET /api/customers/verify-email` | `customer.verify-email.v1` | `customer.email.verified.v1` / `customer.email.verification.rejected.v1` |
| `PATCH /api/customers/:customerId` | `customer.update.v1` | — |
| `POST /api/accounts` | `account.create.v1` | — |
| `GET /api/accounts/:accountId/balance` | `account.balance.query.v1` | `account.balance.replied.v1` |
| `POST /api/transfers` | `transfer.requested.v1` | — |
| `GET /api/transfers/:transactionId` | `transaction.status.requested.v1` | `transaction.status.replied.v1` |
| `GET /api/audit` | `audit.query.requested.v1` | `audit.query.replied.v1` |
| `GET /health`, `GET /ready` | — | — |
