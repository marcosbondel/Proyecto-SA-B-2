# Research: API Gateway y shell de frontend (T-15)

**Fase 0** · 2026-08-24 · [plan.md](plan.md) · [spec.md](spec.md)

La spec entró a esta fase **sin marcadores `[NEEDS CLARIFICATION]`**: los tres
que tenía se resolvieron con el responsable y quedaron en la sección
`## Clarifications`. Lo que sigue no vuelve sobre esas tres preguntas. Resuelve
las incógnitas técnicas que aparecen al mirar el código que ya existe, y cada
una está verificada contra el repositorio, no supuesta.

---

## R1 — La cola de respuestas del Gateway no existe, y no puede ser durable

**Incógnita**: ¿dónde aterrizan `account.balance.replied.v1`,
`transaction.status.replied.v1`, `audit.query.replied.v1` y
`customer.authenticate.replied.v1`?

**Hallazgo**: en ninguna parte. `apps/packages/contracts/src/routing/topology.ts`
declara seis colas —`customer.commands`, `account.commands`,
`transaction.commands`, `transaction.saga`, `payment.commands`, `audit.all`— y
**ninguna está ligada al exchange `bank.replies`**. Las cuatro respuestas del
catálogo no tienen destino. `unroutedContracts()` no lo detecta porque filtra
`category !== 'reply'` a propósito.

No es un descuido de T-05: una cola de respuestas **no puede** declararse ahí.
`QUEUES` alimenta `allQueueDeclarations()`, que crea colas durables compartidas
con escalera de reintentos y DLQ. Una cola de respuestas durable y compartida es
exactamente lo que `request-reply.ts` advierte que no se haga:

> *"A durable queue shared by every replica would have the broker deliver
> replies round-robin, so the answer to instance A's question could land on
> instance B, which has nobody waiting for it."*

**Decisión**: el Gateway declara **su propia cola exclusiva y efímera** en
tiempo de arranque, con nombre `replyQueueName('gateway', instanceId)` —la
función ya existe y está exportada—, ligada a `bank.replies` con patrón `#`.
Exclusiva, autodelete, no durable, sin escalera de reintentos y sin DLQ.

**Fundamento**: reintentar una respuesta no tiene sentido. Si nadie la esperaba,
volver a entregarla tampoco encontrará a nadie; `ReplyRegistry.settle()` ya
devuelve `false` y la descarta, que es el comportamiento correcto y está
documentado como tal. Una DLQ de respuestas solo acumularía basura.

**Consecuencia**: `MessageBroker.subscribe()` hoy declara siempre
`assertQueue(..., { durable: true })` más las tres colas de reintento y la DLQ.
Hay que ampliarlo. Es un cambio en `@bank/messaging`, aditivo:
`SubscriptionOptions` gana un modo exclusivo que omite la escalera. Ningún
consumidor actual lo pide, así que nada existente cambia de comportamiento.

**Alternativas consideradas**:

- *Añadir `gateway.replies` a `QUEUES`.* Rechazada: la haría durable y
  compartida entre réplicas, que es el fallo que `request-reply.ts` describe.
- *Usar la cola sin nombre que RabbitMQ genera (`amq.gen-*`).* Es lo correcto en
  producción y `replyQueueName` lo contempla ("server-named in production"). Se
  deja el nombre explícito derivado del identificador de instancia porque hace
  la evidencia legible en la administración de RabbitMQ, que es un entregable
  del ticket.

---

## R2 — La verificación de correo escucha eventos, no respuestas

**Incógnita**: la aclaración Q1 decidió veredicto síncrono, pero
`customer.email.verified.v1` y `customer.email.verification.rejected.v1` son
**eventos**, no respuestas. Viajan por `bank.events`, no por `bank.replies`, y
su único consumidor declarado es `notification-audit-service`.

**Decisión**: la cola exclusiva del Gateway lleva **tres ligaduras**, no una:

| Exchange | Patrón | Para qué |
| --- | --- | --- |
| `bank.replies` | `#` | Las cuatro respuestas del catálogo |
| `bank.events` | `customer.email.verified.v1` | Veredicto de activación |
| `bank.events` | `customer.email.verification.rejected.v1` | Rechazo de activación |

`ReplyRegistry` empareja por `correlationId` y no le importa de qué exchange
vino el sobre, así que el mecanismo es el mismo sin tocarlo.

**Fundamento**: es una ligadura adicional sobre un exchange topic. No cambia el
contrato de los dos eventos, no los quita de `audit.all` —que sigue ligada a
`#`— y no añade un consumidor a la lista `consumers` del contrato, porque el
Gateway no los *consume* en el sentido del catálogo: los observa para
correlacionar. Esto último hay que dejarlo escrito, porque
`defineContract` valida `consumers` y alguien leerá la discrepancia como un
error.

**Un detalle que hay que probar**: con dos réplicas, **ambas** reciben copia del
evento, porque cada una tiene su propia cola exclusiva ligada al mismo patrón.
La que esperaba lo resuelve; la otra llama a `settle()`, obtiene `false` y lo
descarta. Correcto por construcción, pero merece una prueba explícita: es el
único punto de la feature donde una entrega duplicada es lo normal y no un
fallo.

**Alternativa considerada**: *añadir un contrato de respuesta
`customer.verify-email.replied.v1`.* Rechazada. Sería un mensaje nuevo en el
catálogo de T-05 —no una enmienda aditiva— obligaría a Customer Service a
publicar dos cosas donde hoy publica una, y el evento seguiría existiendo para
auditoría. Se gana nada y se duplica el estado.

---

## R3 — `paymentScenario`: dónde ponerlo y por qué opcional

**Incógnita**: cómo enmendar `transfer.requested.v1` sin romper a nadie.

**Hallazgo verificado**: `paymentScenario` **no aparece en ningún archivo del
repositorio** fuera de la propia spec. No hay migración que hacer.

**Decisión**: campo opcional en el esquema del contrato, con enum de tres
valores, sin cambio de versión:

```ts
paymentScenario: z.enum(['APPROVE', 'REJECT', 'TRANSIENT_FAILURE']).optional()
```

**Fundamento**: en Zod, `.optional()` sobre un objeto ya existente es
estrictamente permisivo — todo mensaje que hoy valida sigue validando. Subir a
`.v2` obligaría a cambiar las ligaduras de `transaction.commands` (que apunta al
patrón literal `transfer.requested.v1`) y a que T-19 consumiera dos versiones.
El costo sería real y el beneficio ninguno: no hay ningún consumidor desplegado
al que proteger.

**Dónde queda la prueba**: en `pnpm test:contract`, dos aserciones —un mensaje
sin el campo valida, un cuarto valor no valida—. Es la garantía de
retrocompatibilidad de SC-013 y es barata.

**Alternativa considerada**: *llevarlo en las cabeceras del sobre en lugar del
payload.* Rechazada: el sobre es transporte y su forma la fija
`envelope.schema.ts`; meter una instrucción de negocio de demostración ahí
ensucia la única estructura que los siete aplicativos comparten.

---

## R4 — Actor y sujeto son dos cosas distintas

**Incógnita**: `account.create.v1` exige `customerId` en el payload, pero
FR-012 dice que la identidad sale del token y nunca del cuerpo. Un
`CAJERO_RECEPTOR` abre cuentas "for any client" (D-06). ¿De dónde sale ese
`customerId`?

**Decisión**: se distinguen dos conceptos y se nombran así en todo el código:

- **Actor** — quién hace la petición. Sale **siempre** del token verificado y va
  en `envelope.identity`. El cuerpo nunca lo toca (FR-012).
- **Sujeto** — sobre quién se opera. Va en el **payload**. Cuando la petición no
  lo trae, el Gateway lo rellena con el `customerId` del actor.

**Fundamento**: son campos distintos con significados distintos y hoy se
confunden porque en el caso del `CLIENTE` coinciden. Separarlos deja el sobre
intacto y permite que el cajero opere por cuenta de un tercero sin que el
Gateway decida nada.

**Lo que el Gateway explícitamente NO hace**: comprobar que un `CLIENTE` solo
opere sobre sí mismo. No puede — no tiene base de datos y no conoce la propiedad
de las cuentas—, y la spec ya lo dice en sus casos límite: eso lo rechaza el
servicio dueño con su código nombrado. El Gateway autoriza por rol y reenvía.

**Consecuencia visible**: `POST /api/accounts` acepta un `customerId` opcional
en el cuerpo. Un `CLIENTE` que lo mande apuntando a otro pasa el Gateway y
choca contra Account Service. Es correcto, y hay que documentarlo para que no
se lea como un agujero.

---

## R5 — El mapeo de fallo a HTTP tiene que ser una tabla

**Incógnita**: cómo mapear un rechazo de negocio a un estado HTTP sin que el
Gateway tome una decisión de dominio (criterio 2.4, principio V).

**Decisión**: una tabla de datos `FailureCode → HttpStatus` en
`application/errors/`, sin ramas condicionales, y el código del catálogo viaja
intacto al cuerpo de la respuesta (FR-030). Los cinco tipos de fallo, más los
dos de autenticación, se detallan en
[`contracts/error-contract.md`](contracts/error-contract.md).

**Fundamento**: la diferencia entre "traducir" y "decidir" es exactamente la
diferencia entre una tabla y un `if`. Una tabla se lee de un vistazo, se prueba
exhaustivamente y hace visible cualquier caso nuevo. Un encadenado de
condicionales es donde una regla de negocio entra sin que nadie la vea entrar —
que es el modo realista de perder el criterio 2.4, no la mala fe.

**Nota de riesgo**: `failureCode` tiene veinte valores en
`schemas/primitives.ts`. La tabla debe cubrirlos todos y una prueba debe fallar
si el enum crece sin que la tabla crezca. Sin esa prueba, un código nuevo cae en
el genérico y nadie se entera.

---

## R6 — El techo de cinco segundos no se reimplementa

**Hallazgo**: `@bank/messaging` ya trae `DEFAULT_REPLY_TIMEOUT_MS = 5_000`,
`ReplyRegistry` con temporizador inyectable, y `ReplyTimeoutError` cuyo mensaje
ya dice *"The operation was not cancelled; query its status to find out how it
ended"* — literalmente FR-026.

**Decisión**: el Gateway usa `ReplyRegistry` tal cual. No escribe su propio
temporizador, no ajusta el plazo por ruta (FR-023, y la suposición de la spec lo
dice), y la verificación de correo reutiliza el mismo (FR-015b).

**Consecuencia para las pruebas**: `ReplyRegistryOptions` acepta `setTimeoutFn`
y `clearTimeoutFn` inyectables "so tests do not wait five real seconds". Las
pruebas de vencimiento del plazo usan esa puerta; ninguna prueba de esta feature
debe dormir cinco segundos de verdad.

**Lo que sí hay que añadir**: `abortAll()` en el apagado, para que ninguna
espera quede colgada. Existe y no se usa todavía.

---

## R7 — El depósito de la foto ocurre antes de publicar, y su fallo es un tipo propio

**Incógnita**: orden de operaciones y qué pasa si MinIO no responde.

**Decisión**: `multipart/form-data` → validar forma y límites (5 MB, JPEG o
PNG) → calcular SHA-256 en memoria → subir a `customer-identity-documents` →
publicar `customer.register.v1` con la referencia. **Si la subida falla, no se
publica nada** y se responde con un fallo distinguible.

**Fundamento**: publicar primero dejaría una referencia a un objeto que no
existe, y Customer Service la rechazaría por `IDENTITY_OBJECT_NOT_FOUND`
después de haber aceptado el registro. La spec ya fija este orden en sus casos
límite: *"no se publica el comando a medias"*.

**Qué tipo de error es**: no es validación —la petición estaba bien— ni rechazo
de negocio —ningún servicio opinó—. Es **fallo interno**. Se registra con el
`correlationId` y no revela el nombre del bucket ni el punto final.

**Credenciales**: `OBJECT_STORAGE_*` en el entorno, alcance limitado a ese
bucket. No son credenciales de base de datos y no contradicen FR-002 — la
búsqueda estática de SC-007 debe buscar `DATABASE_URL`, `postgres://`,
`pg`, `typeorm`, `prisma`, no la palabra "credencial".

---

## R8 — El OpenAPI se genera y se verifica, no se escribe a mano

**Incógnita**: cómo cumplir FR-046 y FR-047 sin que el contrato se desincronice
del código a la primera semana.

**Decisión**: `@nestjs/swagger` decora los controladores; un script emite
`apps/gateway/openapi/gateway.v1.yaml`; el archivo **se versiona en el
repositorio**; y dos pruebas lo custodian:

1. **Deriva**: el YAML versionado es idéntico al que produce el código. Si
   alguien cambia una ruta y no regenera, falla.
2. **Consistencia con T-05**: cada ruta declara el nombre del mensaje que
   publica, y ese nombre existe en `catalog` de `@bank/contracts`. Es SC-010 y
   el criterio 5 del ticket, ejecutable.

**Fundamento**: un contrato escrito a mano es correcto el día que se escribe.
Cinco tickets van a construir contra este documento durante semanas; lo que hay
que garantizar no es que sea correcto hoy, sino que no pueda dejar de serlo en
silencio.

**Alternativa considerada**: *YAML a mano como fuente de verdad, con el código
validado contra él.* Es más riguroso y es lo correcto en un contrato entre
organizaciones. Rechazada aquí por costo: son once rutas, un equipo, y la
prueba de deriva da la misma garantía.

---

## R9 — El frontend puede tener pruebas reales pese a TD-010

**Incógnita**: `apps/web` no tiene marco de pruebas de componentes y su `test`
es un `node --test` de humo. ¿Se declara el frontend no verificable?

**Decisión**: no. La lógica que decide algo se extrae a `app/lib/` como
funciones puras y se prueba con `node --test`:

| Módulo | Qué prueba |
| --- | --- |
| `lib/gateway-error.ts` | Los siete códigos se normalizan; uno desconocido cae en fallo interno |
| `lib/money.ts` | `es-GT`, dos decimales, separador de miles, prefijo `Q`, mínimo un centavo |
| `lib/navigation.ts` | Cada rol ve exactamente los módulos de D-06 — es SC-014 sin navegador |

**Fundamento**: TD-010 impide probar el *renderizado*, no la *lógica*. Meter la
matriz D-06 dentro de un `.vue` la vuelve no verificable por una limitación de
herramientas; sacarla a una función pura la vuelve verificable hoy, sin añadir
dependencias ni contradecir la suposición de la spec.

**Lo que sigue sin probarse automáticamente**: que el componente se vea bien.
Eso son las capturas del shell contra `bonking.dc.html`, tal como la spec asume.

---

## R10 — La sesión vive en memoria, no en el disco del navegador

**Incógnita**: dónde guarda el token el frontend.

**Decisión**: en el estado de la aplicación (`useState` de Nuxt), no en
`localStorage`. La sesión no sobrevive a una recarga completa de la página.

**Fundamento**: la suposición de la spec ya lo dice —"no sobrevive al
navegador"— y ADR-010 explica por qué importa: sin revocación, un token vale
hasta una hora y guardarlo en disco solo alarga la ventana de algo que ya no se
puede invalidar.

**El costo, dicho en voz alta**: recargar la pestaña obliga a iniciar sesión de
nuevo. Es molesto durante una demostración. Se acepta porque la alternativa es
persistir un token no revocable, y porque una sesión de una hora sin renovación
va a expirar de todas formas.

**No se añade Pinia.** `useState` cubre esto y `apps/web/package.json` no lo
tiene; meter una dependencia de estado global para guardar una cadena de texto
sería sobreingeniería.

---

## R11 — Qué dependencias entran, y qué se evita

| Paquete | Para qué | Por qué no otra cosa |
| --- | --- | --- |
| `@nestjs/jwt` | Firmar y verificar HS256 | ADR-010 lo nombra explícitamente |
| `passport-jwt`, `@nestjs/passport` | Guarda de autenticación | ADR-010: "required **only in the Gateway**" |
| `@nestjs/swagger` | Emitir el OpenAPI | R8 |
| `@aws-sdk/client-s3` | Depósito de la foto | MinIO es compatible con S3 (ADR-012) |
| `@nestjs/platform-express` + `multer` | `multipart/form-data` | Ya está en las dependencias del Gateway |

**Lo que no entra**: ninguna base de datos, ningún ORM, ningún cliente HTTP
(`axios`, `got`, `node-fetch`). La ausencia de estos es literalmente el criterio
4 del ticket y SC-007, y se verifica con búsqueda estática sobre
`apps/gateway/`.

---

## Resumen de lo que esta fase cambia fuera de `apps/gateway/` y `apps/web/`

Tres escrituras, y ninguna es incidental:

| Archivo | Cambio | Riesgo |
| --- | --- | --- |
| `apps/packages/contracts/src/events/transaction/transfer.requested.v1.ts` | Campo opcional `paymentScenario` | Bajo — aditivo, con prueba de retrocompatibilidad |
| `apps/packages/contracts/src/routing/topology.ts` | Ligaduras de la cola del Gateway, como dato exportado y **fuera** de `QUEUES` | Bajo — no altera `allQueueDeclarations()` |
| `apps/packages/messaging/src/broker.ts` | Modo de suscripción exclusiva sin escalera | Bajo — nadie lo pide hoy, nada cambia de comportamiento |
| `docs/DESIGN.md` | Actualización a la revisión `bonking. Core` | **Medio** — es artefacto de T-01 y lo consumen cinco tickets. Decidido por el responsable el 2026-08-24 |

Los cuatro son paquetes o documentos compartidos. Cada uno merece su propia
tarea y su propia prueba, en lugar de viajar escondido dentro de una tarea del
Gateway.
