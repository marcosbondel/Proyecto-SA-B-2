# Data Model: API Gateway y shell de frontend (T-15)

**Fase 1** · 2026-08-24 · [plan.md](plan.md) · [research.md](research.md)

El Gateway **no tiene modelo de datos persistente**: no tiene base, no guarda
estado de negocio y su única escritura es un objeto en un búfer de
transferencia. Lo que sigue son las estructuras que viven en memoria durante una
petición, más las dos enmiendas a estructuras compartidas.

Todo lo que no aparezca aquí ya está definido en `@bank/contracts` y no se
redefine: el sobre, los 42 contratos, la topología, los primitivos.

---

## 1. Sesión

Lo que el Gateway emite tras un inicio de sesión aprobado. **No se persiste en
ninguna parte**: existe únicamente dentro del token.

| Reclamación | Tipo | Origen |
| --- | --- | --- |
| `customerId` | UUID v4 | `claims.customerId` de `customer.authenticate.replied.v1` |
| `username` | texto, 1–100 | `claims.username` de la misma respuesta |
| `role` | `CLIENTE` \| `CAJERO_RECEPTOR` \| `ADMINISTRADOR` | `claims.role` de la misma respuesta |
| `iat`, `exp` | epoch | El Gateway. `exp = iat + 3600` |

**Reglas**

- HS256, secreto de entorno, **una hora, sin renovación** (ADR-010).
- El Gateway es el único que firma y el único que verifica.
- Ninguna reclamación se toma del cuerpo de la petición.
- **`activationPending: true` no produce sesión.** La respuesta aprobada con la
  cuenta sin activar se traduce en el mismo rechazo genérico que una credencial
  inválida (FR-013). El token no se emite.

**Transición**

```
sin sesión ──(credenciales válidas + cuenta activa)──► sesión válida
sesión válida ──(exp alcanzado)──► sin sesión
```

No hay transición de revocación. Es una ausencia deliberada de ADR-010, no un
olvido.

---

## 2. Identidad verificada

Lo único que sobrevive del token cuando el mensaje cruza al broker. Es la
interfaz `Identity` que **ya existe** en `apps/packages/contracts/src/envelope.ts`:

```ts
interface Identity {
  readonly customerId: string;
  readonly role: Role;
}
```

No se redefine ni se extiende. Se rellena desde el token verificado y se pasa a
`envelopeForRequest()`, que ya existe en `application/request-envelope.ts`.

### Actor y sujeto

La distinción que R4 fija, y que se nombra así en el código:

| Concepto | Dónde viaja | De dónde sale |
| --- | --- | --- |
| **Actor** — quién pide | `envelope.identity` | Siempre del token. Nunca del cuerpo (FR-012) |
| **Sujeto** — sobre quién se opera | El payload (`customerId`, `accountId`) | Del cuerpo o de la ruta; si falta, se rellena con el `customerId` del actor |

Coinciden cuando un `CLIENTE` opera sobre sí mismo, que es el caso común y la
razón por la que es fácil confundirlos. Un `CAJERO_RECEPTOR` que abre una cuenta
para un tercero es actor de uno y sujeto de otro.

**El Gateway no comprueba que coincidan.** No puede: no conoce la propiedad de
las cuentas. Esa decisión es del servicio dueño y llega como rechazo nombrado.

---

## 3. Solicitud correlacionada

Una petición HTTP en vuelo. Vive en memoria mientras dura y desaparece con la
respuesta.

| Campo | Origen | Regla |
| --- | --- | --- |
| `correlationId` | Cabecera `X-Correlation-Id` si viene; si no, UUID v4 nuevo | Se conserva si viene, se genera si no (FR-018) |
| `idempotencyKey` | Cabecera `Idempotency-Key` o campo del cuerpo | Se traslada al sobre **sin reinterpretar** (FR-020). 1–128 caracteres |
| `actor` | Token verificado, o `null` en ruta pública | — |
| `awaitingReply` | `true` en las cinco rutas que esperan | Vencimiento a los 5 000 ms |

**Invariante: toda espera termina.** O la resuelve una respuesta, o la rechaza
el temporizador. `ReplyRegistry` lo garantiza y `abortAll()` cierra las
pendientes en el apagado.

**Estados**

```
recibida ──► validada ──► publicada ──► [respondida | vencida]
    │            │
    └─ rechazada └─ rechazada          (sin publicar nada)
```

Una petición rechazada por validación, autenticación o autorización **nunca**
llega a `publicada`. Es SC-004 y se prueba contando mensajes en el broker.

---

## 4. Error del Gateway

La forma común de fallar. Un solo tipo, siete códigos. El detalle del mapeo a
HTTP está en [`contracts/error-contract.md`](contracts/error-contract.md).

| Campo | Tipo | Siempre presente |
| --- | --- | --- |
| `type` | uno de los siete códigos | sí |
| `message` | texto apto para mostrar a una persona | sí |
| `correlationId` | UUID v4 | **sí, también en los errores** (FR-019) |
| `failureCode` | código del catálogo de T-05 | solo en rechazo de negocio (FR-030) |
| `field` | nombre del campo culpable | solo en error de validación |

**Lo que nunca lleva**: rastro de pila, cadena de conexión, credencial, nombre
de servicio interno, nombre de bucket, punto final del broker (FR-028).

---

## 5. Referencia de foto

Ya definida en `apps/packages/contracts/src/dto/photo-reference.dto.ts`. No se
redefine. El Gateway la **produce**:

| Campo | Cómo lo calcula el Gateway |
| --- | --- |
| `objectKey` | `<uuid v4>.<jpg\|png>`, dentro de `customer-identity-documents` |
| `contentType` | Del `multipart`, validado contra `image/jpeg` \| `image/png` |
| `sizeBytes` | Bytes reales recibidos, ≤ `MAX_PHOTO_BYTES` (5 242 880) |
| `sha256` | SHA-256 de los bytes, 64 caracteres hexadecimales minúsculos |

**Orden obligatorio** (R7): validar → calcular digest → subir → publicar. Si la
subida falla no se publica nada. El registro sin foto publica `photo: null`, que
el contrato ya admite (`photoReference.nullable()`).

**El Gateway no conserva la imagen.** Ni en disco, ni en memoria más allá de la
petición, ni en un almacenamiento propio. El bucket es de ADR-012 y es un búfer:
el dueño de la foto sigue siendo Customer Service.

---

## 6. Módulo del shell

Una de las cuatro áreas de navegación. Es dato puro, en `app/lib/navigation.ts`,
para que sea verificable sin navegador (R9).

| Módulo | Ruta | Roles que lo ven |
| --- | --- | --- |
| Clientes | `/clientes` | `CLIENTE`, `CAJERO_RECEPTOR`, `ADMINISTRADOR` |
| Cuentas | `/cuentas` | `CLIENTE`, `CAJERO_RECEPTOR`, `ADMINISTRADOR` |
| Transferencias | `/transferencias` | `CLIENTE`, `CAJERO_RECEPTOR`, `ADMINISTRADOR` |
| Auditoría | `/auditoria` | `ADMINISTRADOR` |

Deriva de D-06 y **debe coincidir con la matriz que aplica el Gateway**
([`contracts/authorization-matrix.md`](contracts/authorization-matrix.md)). Es
comodidad, no defensa: el Gateway rechaza igual (FR-041f).

---

## 7. Sesión del navegador

| Campo | Dónde vive |
| --- | --- |
| `token` | Estado de la aplicación (`useState`), **no** `localStorage` (R10) |
| `customerId`, `username`, `role` | Decodificados del token para pintar la interfaz |

**Reglas**

- `useGatewayApi` lo adjunta a toda ruta protegida. Ninguna pantalla lo toca.
- Ante `UNAUTHENTICATED`, se descarta y se va a `/login` (FR-041d).
- No sobrevive a una recarga completa. Es deliberado y tiene su costo, dicho en
  R10.

---

## 8. Enmienda: `paymentScenario`

Único cambio al catálogo de T-05 en esta feature.

```ts
// apps/packages/contracts/src/events/transaction/transfer.requested.v1.ts
paymentScenario: z.enum(['APPROVE', 'REJECT', 'TRANSIENT_FAILURE']).optional()
```

| Propiedad | Valor |
| --- | --- |
| Aditivo | sí — un mensaje sin el campo sigue validando |
| Cambia versión | **no** — sigue siendo `.v1` |
| Quién lo valida | El Gateway, contra los tres valores (FR-021c) |
| Quién lo interpreta | Transaction Service. **El Gateway no** |
| Camino normal | Su ausencia |

Las dos invariantes existentes del contrato (`amount > 0` y origen ≠ destino) no
se tocan.

---

## 9. Enmienda: ligaduras de la cola del Gateway

Dato exportado desde `topology.ts`, **fuera de `QUEUES`** para no volverse una
cola durable compartida (R1).

| Exchange | Patrón | Por qué |
| --- | --- | --- |
| `bank.replies` | `#` | Las cuatro respuestas del catálogo |
| `bank.events` | `customer.email.verified.v1` | Veredicto de activación (R2) |
| `bank.events` | `customer.email.verification.rejected.v1` | Rechazo de activación |

**Propiedades de la cola**: exclusiva, autodelete, no durable, sin escalera de
reintentos, sin DLQ. Nombre `gateway.replies.<instanceId>`.

Con varias réplicas, un evento de activación llega a **todas**. La que esperaba
lo resuelve; las demás obtienen `false` de `settle()` y lo descartan. Es correcto
y necesita prueba explícita, porque es el único punto de la feature donde una
entrega duplicada es lo esperado.

---

## 10. Entorno del Gateway

Amplía `GatewayEnvironment` en `infrastructure/config/environment.ts`, que ya
valida al arranque y falla nombrando la variable culpable.

| Variable | Existe hoy | Notas |
| --- | --- | --- |
| `NODE_ENV`, `PORT`, `RABBITMQ_URL` | sí | Sin cambios |
| `JWT_SECRET` | no | Obligatoria, mínimo 32 caracteres. Del entorno, jamás del repositorio (FR-016) |
| `JWT_EXPIRES_IN` | no | Por defecto `3600`. Fijo por ADR-010 |
| `GATEWAY_INSTANCE_ID` | no | Nombra la cola de respuestas. Por defecto, un UUID por proceso |
| `REPLY_TIMEOUT_MS` | no | Por defecto `5000`. Existe para las pruebas, no para ajustar producción |
| `OBJECT_STORAGE_ENDPOINT` | no | MinIO, `http://localhost:9000` en local |
| `OBJECT_STORAGE_ACCESS_KEY` | no | Alcance limitado al bucket |
| `OBJECT_STORAGE_SECRET_KEY` | no | ídem |
| `OBJECT_STORAGE_BUCKET` | no | `customer-identity-documents` |
| `OBJECT_STORAGE_REGION` | no | `us-east-1`; MinIO lo ignora pero el SDK lo exige |

**`DATABASE_URL` sigue sin existir, y su ausencia es un entregable.** El
comentario que ya está en `.env.example` explicándolo se conserva.
