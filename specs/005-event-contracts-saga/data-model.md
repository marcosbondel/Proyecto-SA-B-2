# Data Model: Contratos de eventos y Saga de transferencias (T-05)

**Fase 1** · Feature `005-event-contracts-saga` · 2026-08-19

Las entidades de esta feature son **formas de transporte y descriptores de topología**, no
entidades de negocio. El modelo de dominio bancario ya existe y es de T-02
([`docs/domain/entities.md`](../../docs/domain/entities.md)); aquí nada lo redefine.

---

## 1. `MessageEnvelope` — la envoltura común

Todo mensaje del sistema viaja dentro de ella. Es la única estructura que los siete aplicativos
comparten sin excepción.

| Campo | Tipo | Obligatorio | Regla |
| --- | --- | --- | --- |
| `messageId` | UUID v4 | sí | Único por mensaje. **Nunca se reutiliza**, ni en una reentrega |
| `messageType` | string | sí | Nombre + sufijo de versión: `^[a-z][a-z.-]*\.v[0-9]+$` |
| `messageVersion` | entero ≥ 1 | sí | **Debe** coincidir con el sufijo de `messageType` (FR-005a) |
| `producer` | string | sí | Servicio emisor. Conjunto cerrado de 7 valores |
| `correlationId` | UUID v4 | sí | Fijado una vez al inicio del flujo; nunca se regenera |
| `causationId` | UUID v4 \| null | sí | `messageId` del mensaje causante; `null` sólo en el primero |
| `idempotencyKey` | string 1–128 | sí | Igualdad = "la misma intención" |
| `occurredAt` | ISO-8601 UTC | sí | Momento de emisión, no de entrega |
| `identity` | `Identity` \| null | sí | Identidad ya verificada por el Gateway; `null` si nadie la originó |
| `payload` | objeto | sí | El contrato concreto. El sobre nunca lo inspecciona |

### `Identity`

| Campo | Tipo | Regla |
| --- | --- | --- |
| `customerId` | UUID v4 | El sujeto de la operación |
| `role` | enum | `CLIENTE` \| `CAJERO_RECEPTOR` \| `ADMINISTRADOR` (§4.1 NOTA, p. 7) |

**Nunca contiene**: token, firma, contraseña ni `username`. Su validez descansa en un supuesto
declarado: ningún productor publica sin haber pasado por el Gateway.

### Diferencia con el sobre vigente

`apps/packages/contracts/src/envelope.ts` existe y le faltan **tres** campos: `messageVersion`,
`producer` e `identity`. Los siete restantes ya están y no cambian de significado.

---

## 2. `MessageContract` — un mensaje concreto

Cada uno de los 42 mensajes es una instancia de esta forma.

| Atributo | Regla |
| --- | --- |
| Nombre | El de `docs/domain/message-catalog.md`, más el sufijo `.vN` |
| Categoría | `command` \| `event` \| `reply` |
| Productor | Exactamente uno |
| Consumidores | `command`: exactamente 1 · `event`: ≥ 1 · `reply`: quien preguntó |
| Esquema del payload | Un esquema Zod; el tipo se deriva de él |
| Precondiciones | Qué debe ser cierto antes de emitirlo |
| Efectos | Qué cambia en el consumidor |
| Ante error | Qué mensaje lo cierra, o si va a la DLQ |
| Exchange | Derivado de la categoría (§4) |

**Invariante C-1**: `command` con más de un manejador es un error de diseño, no de
configuración. **Invariante C-2**: `event` sin consumidor es huérfano y está prohibido por
T-02. **Invariante C-3**: una `reply` no es huérfana pese a tener un solo destinatario, porque
su destinatario es quien preguntó.

---

## 3. `MessageCatalog` — el conjunto

42 contratos: los 35 de T-02 (13 comandos + 22 eventos) más los 7 de R11 (2 solicitudes,
4 respuestas y 1 evento de rechazo de activación).

| Familia (prefijo del nombre) | Comandos y solicitudes | Eventos | Respuestas | Total |
| --- | --- | --- | --- | --- |
| `customer.*` | 5 | 9 | 1 | 15 |
| `account.*` | 6 | 8 | 1 | 15 |
| `transfer.*` + `transaction.*` | 2 | 4 | 1 | 7 |
| `payment.*` | 1 | 2 | 0 | 3 |
| `audit.*` | 1 | 0 | 1 | 2 |
| **Total** | **15** | **23** | **4** | **42** |

Las familias se agrupan por **prefijo del nombre**, no por servicio productor: los tres
comandos de la Saga que Transaction envía a Account (`account.debit.requested`,
`account.credit.requested`, `account.debit.compensation.requested`) pertenecen a la familia
`account.*` porque es la cuenta lo que actúan, y es ese prefijo el que enruta.

Las 2 solicitudes nuevas (`transaction.status.requested`, `audit.query.requested`) cuentan como
comandos a efectos de enrutamiento: van a `bank.commands` y tienen un único manejador.

---

## 4. `Topology` — exchanges, colas y claves

### Exchanges

Cuatro, todos `topic` y `durable`. Ver [R4](research.md#r4).

| Exchange | Contenido |
| --- | --- |
| `bank.commands` | 15 comandos y solicitudes |
| `bank.events` | 22 eventos |
| `bank.replies` | 4 respuestas |
| `bank.errors` | Lo que agotó reintentos o llegó inválido |

### Gramática de la routing key

**La routing key es el `messageType` literal**, sufijo de versión incluido. Sin traducción, sin
tabla de correspondencia, sin caso especial: `account.debit.requested.v1` se publica con la
clave `account.debit.requested.v1`.

### Colas de trabajo

Una por consumidor lógico (FR-012). Nombre: `<servicio>.<propósito>`.

| Cola | Servicio | Se enlaza a |
| --- | --- | --- |
| `customer.commands` | Customer | `customer.*.v1` en `bank.commands` |
| `account.commands` | Account | `account.*.v1` en `bank.commands` |
| `transaction.saga` | Transaction | `account.debited.v1`, `account.debit.rejected.v1`, `account.credited.v1`, `account.credit.rejected.v1`, `account.debit.compensated.v1`, `payment.succeeded.v1`, `payment.failed.v1` |
| `transaction.commands` | Transaction | `transfer.requested.v1`, `transaction.status.requested.v1` |
| `payment.commands` | Payment | `payment.requested.v1` |
| `audit.all` | Notification & Audit | `#` en `bank.events`, y `audit.query.requested.v1` |
| `gateway.replies.<instancia>` | Gateway | Exclusiva, autoborrable, enlazada a `bank.replies` |

Siete consumidores lógicos, siete colas. **Ninguna compartida entre servicios.**

### Colas de reintento y de error

Por cada cola de trabajo `Q`, cuatro colas más:

| Cola | `x-message-ttl` | `x-dead-letter-exchange` | `x-dead-letter-routing-key` |
| --- | --- | --- | --- |
| `Q.retry.1s` | 1 000 | `""` (por defecto) | `Q` |
| `Q.retry.5s` | 5 000 | `""` | `Q` |
| `Q.retry.30s` | 30 000 | `""` | `Q` |
| `Q.dlq` | — | — | — |

El mensaje vuelve **a la cola que falló** y a ninguna otra. Ver [R5](research.md#r5) para por
qué reencolar en el exchange sería incorrecto.

---

## 5. `DeliveryPolicy` — qué pasa cuando algo falla

| Parámetro | Valor | Origen |
| --- | --- | --- |
| Reconocimiento | Explícito, posterior al efecto | FR-014 |
| Reintentos | 3 como máximo, tras el primer intento | FR-014 |
| Esperas | 1 s, 5 s, 30 s — configurables | FR-014 |
| Entregas totales | 4 como máximo | SC-008 |
| Destino final | `Q.dlq` con causa, intento y `correlationId` | FR-015 |
| Mensaje inválido | DLQ **directa**, sin reintentos | FR-016 |
| Orden global | No se asume nunca | FR-017 |

### Máquina de estados de una entrega

```
recibido
   ├── sobre o payload inválido ──────────────► Q.dlq        (sin reintento)
   ├── idempotencyKey ya visto ───────────────► ack          (sin efecto)
   ├── efecto aplicado ───────────────────────► ack
   └── fallo de proceso
         ├── intento < 3 ─────────────────────► Q.retry.{1s|5s|30s}
         └── intento = 3 ─────────────────────► Q.dlq
```

`x-attempt` es la cabecera que cuenta. Ver [R6](research.md#r6) por qué no se usa `x-death`.

---

## 6. `ReplyCorrelation` — emparejar respuesta con pregunta

| Elemento | Regla |
| --- | --- |
| Emparejamiento | Por `correlationId` del sobre |
| Ruta de vuelta | Propiedad AMQP `replyTo` puesta por quien pregunta |
| Cola | Exclusiva y autoborrable, **una por instancia** |
| Vencimiento | 5 s, medido por quien espera |
| Al vencer | Se abandona la espera; **la operación de negocio no se cancela** |
| Consulta posterior | Por `transactionId` o por `correlationId` |

Cuatro interacciones: autenticación, saldo, estado de transacción, consulta de auditoría.

---

## 7. `SagaScript` — la transferencia

Los siete pasos son los de [`docs/domain/use-cases.md`](../../docs/domain/use-cases.md) §6 y
**no se redefinen aquí**. Lo que esta feature añade es el mensaje versionado de cada
transición.

| # | Servicio | Reacciona a | Publica | Estado tras el paso |
| --- | --- | --- | --- | --- |
| 1 | Transaction | `transfer.requested.v1` | `account.debit.requested.v1` | `PENDING` → `DEBITING` |
| 2 | Account | `account.debit.requested.v1` | `account.debited.v1` \| `account.debit.rejected.v1` | — |
| 3 | Transaction | `account.debited.v1` | `payment.requested.v1` | `PAYMENT_PENDING` |
| 4 | Payment | `payment.requested.v1` | `payment.succeeded.v1` \| `payment.failed.v1` | — |
| 5 | Transaction | `payment.succeeded.v1` | `account.credit.requested.v1` | — |
| 6 | Account | `account.credit.requested.v1` | `account.credited.v1` \| `account.credit.rejected.v1` | — |
| 7 | Transaction | `account.credited.v1` | `transaction.completed.v1` | `COMPLETED` |

### Los dos finales

| Final | Disparador | Compensación |
| --- | --- | --- |
| `FAILED` | `account.debit.rejected.v1` en el paso 2 | **Ninguna**: el dinero nunca salió |
| `COMPENSATED` | `payment.failed.v1` (paso 4) o `account.credit.rejected.v1` (paso 6) | `account.debit.compensation.requested.v1` → `account.debit.compensated.v1` → `transaction.compensated.v1` |

**Invariante T-7 de T-02**: toda transacción que salió de `DEBITING` con el débito aplicado
termina en `COMPLETED` o en `COMPENSATED`, **nunca** en `FAILED`.

### Los seis escenarios que hay que documentar

| Escenario | Dónde ocurre | Cierre |
| --- | --- | --- |
| Camino feliz | Los 7 pasos | `COMPLETED` |
| Fondos insuficientes | Paso 2 | `FAILED`, sin compensación |
| Vencimiento de espera | En quien pregunta | La Saga sigue; se consulta después |
| Fallo de pago | Paso 4 | `COMPENSATED` |
| Mensaje duplicado | Cualquier paso | Descartado; sin segunda transición |
| Compensación | Tras paso 4 o 6 | `COMPENSATED` |

---

## 8. `PhotoReference` — la foto del documento

Los bytes **no viajan por el broker** ([R9](research.md#r9)). El comando lleva:

| Campo | Tipo | Regla |
| --- | --- | --- |
| `objectKey` | string | Clave en el bucket `customer-identity-documents` |
| `contentType` | enum | `image/jpeg` \| `image/png` |
| `sizeBytes` | entero | ≤ 5 242 880 (5 MB) |
| `sha256` | string | 64 caracteres hexadecimales en minúscula |

Customer Service recupera el objeto, **recalcula el SHA-256 y lo compara** antes de persistir.
Una referencia irrecuperable y una huella que no cuadra son fallos distintos y se responden
distinto.

**Invariante P-1**: ningún payload de ningún mensaje contiene bytes de imagen.
**Invariante P-2**: ningún payload supera 64 KB (SC-009a).
