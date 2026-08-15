# Phase 1 — Data Model: Dominio y límites de los cinco servicios (T-02)

**Feature**: [spec.md](spec.md) | **Research**: [research.md](research.md) | **Fecha**: 2026-08-14

Este archivo es el borrador revisable del modelo. La implementación de T-02 lo transcribe a
`docs/domain/` en inglés (R2); el contenido normativo es este. No prescribe clases, tablas ni
tipos de lenguaje: FR-057 lo prohíbe y la nota del ticket también.

---

## 1. Matriz de ownership de datos

Un solo servicio escribe cada atributo. "Consumidores" son los servicios que lo reciben, y
siempre por mensajería: **cero filas admiten una consulta a la base de otro servicio**
(FR-007, FR-024).

### Customer Service

| Atributo | Escribe | Consumidores | Medio |
| --- | --- | --- | --- |
| `customerId` | Customer | Account (referencia opaca), Notification & Audit | Evento |
| Nombre completo | Customer | Notification & Audit (auditoría) | Evento |
| Documento de identidad | Customer | — | **No cruza** |
| Correo electrónico | Customer | Notification & Audit (solo como destinatario de entrega) | Evento — excepción acotada FR-041a |
| Fecha de nacimiento | Customer | — | **No cruza** |
| Dirección | Customer | — | **No cruza** |
| `username` | Customer | Notification & Audit (auditoría) | Evento |
| Referencia a foto del documento | Customer | — | **No cruza** |
| Credencial de acceso | Customer | — | **No cruza, nunca** |
| `role` | Customer | Gateway (como claim tras el login) | Request/reply asíncrono |
| `identityStatus` | Customer | Notification & Audit | Evento |
| `emailVerifiedAt` | Customer | Notification & Audit | Evento |
| `status` | Customer | Notification & Audit | Evento |

### Account Service

| Atributo | Escribe | Consumidores | Medio |
| --- | --- | --- | --- |
| `accountId` | Account | Transaction (referencia opaca), Notification & Audit | Evento |
| `customerId` (referencia) | Account | Notification & Audit | Evento |
| `balance` | **Account, y solo Account** | Gateway (consulta de saldo) | Request/reply asíncrono |
| `status` | Account | Notification & Audit | Evento |
| `accountType` | Account | Notification & Audit | Evento |
| `lastActivityAt` | Account | — | **No cruza** |

> `balance` es el atributo más sensible del modelo. Transaction Service **nunca** lo lee: ordena
> un débito y espera el evento de resultado. Si algún diseño posterior necesita "consultar el
> saldo antes de transferir" desde Transaction Service, el diseño está mal.

### Transaction Service

| Atributo | Escribe | Consumidores | Medio |
| --- | --- | --- | --- |
| `transactionId` | Transaction | Payment (referencia opaca), Notification & Audit | Evento |
| `sourceAccount`, `targetAccount` | Transaction | Account (como destinatario de la orden), Notification & Audit | Evento |
| `amount` | Transaction | Account, Payment, Notification & Audit | Evento |
| `status` | Transaction | Notification & Audit | Evento |
| `correlationId` | Transaction (lo origina el Gateway y se propaga) | Todos | Todos los mensajes |
| `idempotencyKey` | Transaction | — | **No cruza** |
| Marcas de tiempo | Transaction | Notification & Audit | Evento |

### Payment Service

| Atributo | Escribe | Consumidores | Medio |
| --- | --- | --- | --- |
| `paymentId` | Payment | Notification & Audit | Evento |
| `transactionId` (referencia) | Payment | Transaction, Notification & Audit | Evento |
| `status` | Payment | Transaction, Notification & Audit | Evento |
| `attempt` | Payment | Notification & Audit | Evento |
| `failureReason` | Payment | Transaction, Notification & Audit | Evento |

### Notification & Audit Service

| Atributo | Escribe | Consumidores | Medio |
| --- | --- | --- | --- |
| `eventId`, tipo, `timestamp`, `payload`, `correlationId`, origen | Notification & Audit | **Ninguno** | — |
| Notificación: destinatario, canal, tipo, estado, intentos | Notification & Audit | **Ninguno** | — |

> Notification & Audit es terminal por diseño: consume mucho y **no publica ningún evento que
> otro servicio consuma para decidir algo** (FR-050). §4.1 (p. 7) lo describe como altamente
> desacoplado y sin afectar la lógica de negocio.

### API Gateway

Sin entidades de negocio, sin base de datos, sin decisiones de dominio (FR-006). Origina el
`correlationId` de cada flujo externo y traduce entre el mundo síncrono del cliente y el
mundo asíncrono del broker.

---

## 2. Datos que no pueden cruzar límites

| Dato | Se queda en | Por qué |
| --- | --- | --- |
| Credencial de acceso | Customer Service | Ni siquiera cifrada. Un evento que la transporte es una fuga, aunque el broker sea interno. |
| Foto del documento y su referencia | Customer Service | Es el dato personal más sensible del sistema y ningún otro contexto tiene motivo para verlo. |
| Documento de identidad completo | Customer Service | El registro de auditoría no lo persiste. Si hace falta identificar al cliente en auditoría, se usa `customerId`. |
| Fecha de nacimiento, dirección | Customer Service | Perfil, no operación. Ningún flujo los necesita fuera. |
| `balance` | Account Service | Solo sale como respuesta a la consulta de saldo del Gateway. No viaja en eventos de la Saga. |
| `lastActivityAt` | Account Service | Insumo interno del proceso de desactivación. |
| `idempotencyKey` | Transaction Service | Es la defensa contra el doble movimiento; exponerla invita a que otro servicio la reinterprete. |
| Token de activación | Customer Service lo genera y lo valida | Notification & Audit solo lo transporta dentro del enlace (R12). |

**Única excepción**: el correo del cliente llega a Notification & Audit como destinatario de
entrega (FR-041a). Cruza como dato de entrega, no como dato de perfil, y no autoriza a mover
nada más.

---

## 3. Catálogo de entidades

### `Customer` — Customer Service

**Identidad**: `customerId`.

| Atributo | Notas |
| --- | --- |
| Nombre completo | Fuente del `username` generado |
| Documento de identidad | Único |
| Correo electrónico | Único. Es el identificador de login (R4) |
| Fecha de nacimiento | El enunciado exige validar coherencia del campo (§4.1, p. 5) |
| Dirección | — |
| `username` | Generado y único (R5) |
| Referencia a foto del documento | Nullable hasta que se carga |
| Credencial de acceso | Nunca sale del servicio |
| `role` | `ADMINISTRADOR` \| `CAJERO_RECEPTOR` \| `CLIENTE` |
| `identityStatus` | `PENDING` \| `VALIDATED` \| `REJECTED` |
| `emailVerifiedAt` | Nullable |
| `status` | `PENDING_ACTIVATION` \| `ACTIVE` |

**Estados y transiciones**

- `status`: `PENDING_ACTIVATION` → `ACTIVE`. Una sola transición legal, disparada por la
  verificación del token. No hay vuelta atrás en Fase 1.
- `identityStatus`: `PENDING` → `VALIDATED` \| `REJECTED`; `REJECTED` → `PENDING` al recargar
  la foto. **Eje independiente de `status`** (FR-010): un cliente puede estar `ACTIVE` con
  identidad `PENDING`, y viceversa.

**Invariantes**

| # | Invariante | Fallo esperado |
| --- | --- | --- |
| C-1 | El documento de identidad es único | `DOCUMENT_ALREADY_REGISTERED` — rechazo, no se crea el `Customer` |
| C-2 | El `username` es único | Se resuelve por sufijo (R5), no llega a fallo visible |
| C-3 | El correo es único | `EMAIL_ALREADY_REGISTERED` — rechazo |
| C-4 | `status = ACTIVE` ⟺ `emailVerifiedAt` no es nulo | Transición ilegal descartada. La redundancia es deliberada: el enunciado nombra el estado, la marca de tiempo dice cuándo |
| C-5 | La fecha de nacimiento es coherente (pasada y de persona viva plausible) | `INVALID_BIRTH_DATE` — rechazo |
| C-6 | Solo `role = CLIENTE` exige validación de identidad y puede tener cuentas (FR-043a, FR-043b) | `ROLE_NOT_ELIGIBLE` al intentar crear una cuenta para un empleado |
| C-7 | La verificación de un token ya usado, caducado o invalidado no cambia el estado | `ACTIVATION_TOKEN_INVALID` — rechazo sin efecto |

---

### `Account` — Account Service

**Identidad**: `accountId`.

| Atributo | Notas |
| --- | --- |
| `customerId` | Referencia opaca. Siempre de un `Customer` con `role = CLIENTE` |
| `balance` | Quetzales, dos decimales exactos (R9) |
| `status` | `ACTIVE` \| `INACTIVE` |
| `accountType` | `MONETARIA` \| `AHORRO`. Clasificación sin reglas diferenciadas en Fase 1 (D-02) |
| `lastActivityAt` | Última vez que se movió dinero confirmado (R6) |

**Estados y transiciones**

- `ACTIVE` → `INACTIVE`: por el proceso automático (`balance < Q50.00` **y** seis meses sin
  actividad), o por acción de un `ADMINISTRADOR`.
- `INACTIVE` → `ACTIVE`: al recibir un crédito, o por acción de un `ADMINISTRADOR` (R7).

**Invariantes**

| # | Invariante | Fallo esperado |
| --- | --- | --- |
| A-1 | `balance` nunca queda negativo tras una operación aprobada | `INSUFFICIENT_FUNDS` — el débito se rechaza, no se aplica parcialmente |
| A-2 | Un débito solo se aplica sobre una cuenta `ACTIVE` | `ACCOUNT_INACTIVE` — rechazo, la Saga cierra en `FAILED` |
| A-3 | Un crédito sobre cuenta `INACTIVE` se aplica y la reactiva | Sin fallo; es una transición legal |
| A-4 | Todo movimiento confirmado actualiza `lastActivityAt`; consultar el saldo no | — |
| A-5 | El proceso de desactivación es idempotente: una cuenta ya `INACTIVE` no vuelve a transicionar ni emite un segundo evento | — |
| A-6 | Los montos tienen dos decimales exactos | `INVALID_AMOUNT_PRECISION` — rechazo, nunca redondeo (R9) |

---

### `Transaction` — Transaction Service

**Identidad**: `transactionId`.

| Atributo | Notas |
| --- | --- |
| `sourceAccount`, `targetAccount` | Referencias opacas |
| `amount` | > 0, dos decimales |
| `status` | Ver abajo |
| `correlationId` | Originado por el Gateway, propagado a todo el flujo |
| `idempotencyKey` | Único dentro del servicio |
| `createdAt`, `updatedAt` | — |

**Estados y transiciones legales** — todo lo no enumerado es ilegal y se descarta (FR-015).

```
PENDING ──► DEBITING ──► PAYMENT_PENDING ──► COMPLETED
               │                │
               │                └──► COMPENSATED   (pago falló, o abono rechazado)
               └──► FAILED                          (débito rechazado: nada que deshacer)
```

`COMPLETED`, `FAILED` y `COMPENSATED` son terminales. `FAILED` significa que **nunca salió
dinero**; `COMPENSATED` significa que salió y volvió. La auditoría necesita distinguirlas
(R11).

**Invariantes**

| # | Invariante | Fallo esperado |
| --- | --- | --- |
| T-1 | `amount` > 0 | `INVALID_AMOUNT` — rechazo antes de crear la transacción |
| T-2 | `sourceAccount` ≠ `targetAccount` | `SAME_ACCOUNT_TRANSFER` — rechazo |
| T-3 | La misma `idempotencyKey` con el mismo contenido devuelve la transacción original, sin mover balances | Sin fallo; respuesta idempotente |
| T-4 | La misma `idempotencyKey` con contenido distinto se rechaza | `IDEMPOTENCY_KEY_CONFLICT` (R8) |
| T-5 | Un evento repetido no produce una segunda transición ni una segunda compensación | Descarte silencioso por `eventId` ya procesado |
| T-6 | Un evento que pide una transición no enumerada se descarta y se registra | `ILLEGAL_TRANSITION` en auditoría, sin cambio de estado |
| T-7 | Toda transacción que salió de `DEBITING` con débito aplicado termina en `COMPLETED` o `COMPENSATED`, nunca en `FAILED` | Garantía de la Saga |

---

### `Payment` — Payment Service

**Identidad**: `paymentId`.

| Atributo | Notas |
| --- | --- |
| `transactionId` | Referencia opaca |
| `status` | `PENDING` \| `SUCCEEDED` \| `FAILED` |
| `attempt` | Número de intento, desde 1 |
| `failureReason` | Nullable; obligatorio cuando `status = FAILED` |

**Transiciones**: `PENDING` → `SUCCEEDED` \| `FAILED`. Los reintentos ocurren **dentro** de
`PENDING` incrementando `attempt`; `FAILED` se alcanza al agotar los reintentos y es terminal.

**Invariantes**

| # | Invariante | Fallo esperado |
| --- | --- | --- |
| P-1 | Un `transactionId` no produce dos pagos exitosos | `PAYMENT_ALREADY_PROCESSED` — se responde con el resultado existente |
| P-2 | `status = FAILED` exige `failureReason` | Estado inválido, no persistible |
| P-3 | `attempt` es monótono creciente | — |

---

### `AuditEvent` — Notification & Audit Service

**Identidad**: `eventId`. Atributos: tipo de evento, `timestamp`, `payload`, `correlationId`,
servicio de origen.

**Sin estados**: es un registro append-only. **Inmutable** (FR-014): no se modifica ni se
borra.

**Invariantes**

| # | Invariante | Fallo esperado |
| --- | --- | --- |
| E-1 | Todo `AuditEvent` tiene `correlationId` | Registro rechazado; un evento sin correlación no es auditable |
| E-2 | Un `eventId` ya registrado no se registra dos veces | Descarte silencioso |
| E-3 | El `payload` no contiene credenciales ni el documento completo | Violación del modelo, no un error en tiempo de ejecución |

---

### `Notification` — Notification & Audit Service

Atributos: destinatario, canal, tipo, `status` (`PENDING` \| `SENT` \| `FAILED`), intentos.

**Invariantes**

| # | Invariante | Fallo esperado |
| --- | --- | --- |
| N-1 | El fallo de envío no altera ningún estado de dominio de otro servicio | Se reintenta y se registra; el `Customer` o la `Transaction` no cambian (R12) |
| N-2 | Un evento repetido no produce una segunda notificación | Descarte por `eventId` |

---

## 4. Invariantes transversales

| # | Invariante | Quién la protege |
| --- | --- | --- |
| X-1 | Ningún servicio consulta las tablas de otro | Todos. Es la que penaliza con el 50 % de la nota (§4.2, p. 13) |
| X-2 | Todo dato ajeno llega por evento o request/reply asíncrono | Todos |
| X-3 | Todo flujo propaga el `correlationId` de extremo a extremo | Gateway lo origina; todos lo propagan |
| X-4 | Todo consumidor deduplica por `eventId` | Todos los consumidores |
| X-5 | Toda operación que abarca dos servicios tiene compensación definida | Transaction Service la coordina |
| X-6 | Todos los importes son quetzales con dos decimales exactos | Account y Transaction |
| X-7 | El Gateway no toma decisiones de dominio | Gateway |

---

## 5. Actores y permisos mínimos *(propuesta — requiere aprobación, FR-045)*

El enunciado nombra los tres actores y no define ningún permiso (§4.1, p. 7). Todo lo que
sigue es decisión del equipo.

| Caso de uso | `CLIENTE` | `CAJERO_RECEPTOR` | `ADMINISTRADOR` |
| --- | :---: | :---: | :---: |
| Registrarse (autoservicio) | ✔ anónimo | ✔ a nombre del cliente | ✔ |
| Activar el correo | ✔ propio | ✘ | ✘ |
| Iniciar sesión | ✔ | ✔ | ✔ |
| Crear cuenta | ✔ propia | ✔ para cualquier cliente | ✔ |
| Consultar saldo | ✔ propias | ✔ cualquiera | ✔ cualquiera |
| Transferir | ✔ desde propias | ✔ en ventanilla | ✔ |
| Actualizar datos del cliente | ✔ propios | ✔ | ✔ |
| Validar la foto del documento | ✘ solo la carga | ✔ | ✔ |
| Desactivar o reactivar cuenta a mano | ✘ | ✘ | ✔ |
| Asignar roles | ✘ | ✘ | ✔ |
| Consultar auditoría y notificaciones | ✘ | ✘ | ✔ |

**Frontera explícita**

- Un `CLIENTE` que opera sobre una cuenta ajena recibe `FORBIDDEN_ACCOUNT_ACCESS` (FR-044).
- Un `CAJERO_RECEPTOR` no cambia roles, no toca el estado de las cuentas a mano y no ve la
  auditoría.
- Un `ADMINISTRADOR` no puede alterar un `AuditEvent`: es inmutable para todos (E-3).
- `ADMINISTRADOR` y `CAJERO_RECEPTOR` pueden existir sin ninguna `Account` (FR-043b).

**Nota sobre el depósito y el retiro**: el enunciado nombra al Cajero Receptor pero no
describe ninguna operación de efectivo, y este modelo no la inventa. Si el equipo la quiere,
son casos de uso nuevos sobre Account Service y un cambio de modelo (FR-056).

---

## 6. Glosario del lenguaje ubicuo

Se fija una sola vez porque el modelo es bilingüe por decisión (R2): prosa en inglés,
literales del enunciado en español.

| Término (modelo) | Español del enunciado | Qué es |
| --- | --- | --- |
| Customer | Cliente / cuentahabiente | Persona registrada, sea cliente o personal del banco (D-01) |
| Account | Cuenta | Cuenta bancaria de un cliente |
| Transaction | Transacción / transferencia | Intento de mover dinero entre dos cuentas, con su Saga |
| Payment | Pago | Procesamiento del pago asociado a una transacción |
| AuditEvent | Evento de auditoría | Registro inmutable de algo que ocurrió |
| Notification | Notificación | Aviso enviado a una persona |
| Activation | Activación | Verificación del correo que habilita al cliente a operar |
| Identity validation | Validación de identidad | Revisión de la foto del documento. **Distinto de la activación** |
| Compensation | Compensación | Paso que deshace un efecto ya aplicado cuando la Saga no puede completar |
