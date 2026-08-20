# Research: Contratos de eventos y Saga de transferencias (T-05)

**Fase 0** · Feature `005-event-contracts-saga` · 2026-08-19

Resuelve las incógnitas técnicas del plan. Cada entrada registra la decisión, su razón y las
alternativas descartadas. Lo que aquí se decide es vinculante para `tasks.md`; cambiarlo
después exige enmendar este documento.

---

## R1 — Mecanismo de validación de payloads

**Decisión**: **Zod** como única fuente de verdad de cada contrato, con el tipo TypeScript
derivado por `z.infer`. El artefacto JSON Schema se genera desde los mismos esquemas.

**Razón**: el fallo que este ticket existe para evitar es que el tipo y el validador se
separen — que un campo se añada al `interface` y nadie actualice la comprobación. Con Zod eso
es imposible por construcción: hay un solo objeto y el tipo se deriva de él. Además, la unión
discriminada por `messageType` valida el sobre y despacha el payload en una sola llamada, que
es exactamente la forma de FR-023 ("validar antes de ejecutar lógica de dominio"). Y
`zod-to-json-schema` produce el "JSON Schema o DTO versionado" que pide el ticket, en un
formato que no obliga a nadie a leer TypeScript.

**Alternativas descartadas**:

- **`class-validator` + `class-transformer`** (0.15.1 y 0.5.1, ya en el catálogo, ya instaladas
  en los cinco servicios, con `experimentalDecorators` y `emitDecoratorMetadata` ya activos en
  `tsconfig.base.json`). Es la opción de **cero dependencias nuevas** y por eso la más
  tentadora. Descartada porque el tipo y las reglas siguen siendo dos cosas —la clase y sus
  decoradores— que pueden divergir; porque hidratar 42 payloads exige `plainToInstance` en cada
  consumidor; y porque el artefacto JSON Schema necesitaría igualmente un generador aparte.
  Sigue siendo la herramienta de validación de configuración de entorno: **este ADR no la
  retira de ahí**.
- **Type guards escritos a mano**, en el estilo del `isEnvelope` que ya existe en
  `apps/packages/messaging/src/broker.ts`. Cero dependencias y control total. Descartada
  porque 42 validadores manuales es superficie de error pura, y no produce ningún artefacto
  publicable.
- **AJV con JSON Schema como fuente**. El esquema sería el original y el tipo derivado, que es
  la dirección opuesta a Zod. Descartada porque escribir JSON Schema a mano para 42 mensajes es
  más verboso que escribir Zod, y el tipo derivado de JSON Schema es notablemente peor.

**Condición previa, no negociable**: `pnpm-workspace.yaml` documenta su propia regla de
actualización — "before changing a version here, query OSV and run `pnpm audit`. A dependency
with an open vulnerability does not enter the catalog".

**Comprobación ejecutada el 2026-08-19 (T001)**:

| Paquete | Versión | OSV (npm) | Resultado |
| --- | --- | --- | --- |
| `zod` | 4.4.3 | `POST api.osv.dev/v1/query` → `{}` | Sin vulnerabilidades conocidas |
| — | — | `pnpm audit` sobre el workspace completo | `No known vulnerabilities found` |

La puerta se pasa y Zod entra al catálogo.

**Hallazgo que reduce el alcance**: Zod 4 incorpora **`z.toJSONSchema()` de forma nativa**,
verificado sobre la versión instalada (`typeof z.toJSONSchema === 'function'`). El paquete
`zod-to-json-schema`, que el plan preveía como dependencia de desarrollo, **no se instala**:
sería una dependencia de más para hacer lo que el runtime ya hace. El artefacto JSON Schema
del catálogo se genera con la API nativa.

**Una sola dependencia nueva en todo el ticket**, y de ejecución: `zod`.

---

## R2 — Formato de serialización

**Decisión**: **JSON en UTF-8**, con `contentType: application/json` en las propiedades AMQP.
Versionado como parte del contrato del sobre.

**Razón**: ya es lo que hace el adaptador vigente (`broker.ts` publica
`Buffer.from(JSON.stringify(envelope))` con `contentType: 'application/json'`), y es lo que
hace legible la evidencia que la entrega exige — un ejemplo JSON de cada transición se lee sin
herramientas.

**Alternativas descartadas**: **Protobuf** o **Avro** darían esquema binario y evolución
formal, a cambio de un registro de esquemas, un paso de compilación y una evidencia que nadie
puede leer en una defensa. **MessagePack** ahorra bytes que aquí no son escasos.

---

## R3 — Dónde se materializa la versión

**Decisión**: la versión aparece **en el nombre del mensaje y en el sobre**, como fijó el spec
(FR-005). Concretamente:

| Sitio | Forma | Ejemplo |
| --- | --- | --- |
| `messageType` del sobre | nombre + sufijo | `account.debited.v1` |
| Routing key | idéntica al `messageType` | `account.debited.v1` |
| Campo del sobre | entero | `messageVersion: 1` |
| Archivo del contrato | nombre + sufijo | `account.debited.v1.ts` |

**Razón**: la routing key con versión permite que un consumidor viejo **nunca vea** un mensaje
`.v2`, porque su binding es `.v1`. El campo del sobre permite rechazar explícitamente una
versión inesperada en vez de interpretarla a medias. La redundancia es deliberada y
verificable: FR-005a la convierte en una comprobación (discrepancia = mensaje inválido).

**Regla de compatibilidad**: dentro de una versión sólo se **añaden campos opcionales**.
Quitar un campo, renombrarlo, estrechar su tipo o volver obligatorio uno opcional obliga a
`.v2`. El productor publica ambas versiones hasta que todos los consumidores migran.

---

## R4 — Topología de exchanges: conflicto con lo ya escrito

**Decisión**: **cuatro exchanges**, todos `topic` y `durable`:

| Exchange | Lleva |
| --- | --- |
| `bank.commands` | Los 15 comandos y las 2 solicitudes nuevas: intención dirigida a un único manejador |
| `bank.events` | Los 22 eventos: hechos consumados, con uno o más consumidores |
| `bank.replies` | Las 4 respuestas, enrutadas a la cola exclusiva de quien preguntó |
| `bank.errors` | Los mensajes que agotaron reintentos o llegaron inválidos |

**Conflicto detectado**: `infra/docker/README.md` afirma hoy que la infraestructura local
expone "the topic exchange the applications publish to (`bank.events`)" — **un** exchange, en
singular, y con ese nombre para todo. FR-011 del spec exige exchanges separados para comandos,
eventos y errores. Los dos documentos no pueden ser ciertos a la vez.

**Resolución**: gana el spec, y `infra/docker/README.md` se corrige en este ticket. El nombre
`bank.events` sobrevive con su significado estrechado: pasa de "el exchange" a "el exchange de
eventos". T-06 escribirá el Compose contra los cuatro. Dejar el README como está sería fijar
una topología de un solo exchange en el ticket que la implementa.

**Alternativa descartada**: un exchange único con la separación codificada en la routing key
(`cmd.*` / `evt.*`). Menos objetos que declarar, pero borra la distinción en el punto donde el
criterio 2.5 de la rúbrica la mira, y hace imposible dar permisos distintos a comandos y a
eventos.

---

## R5 — Reintentos con backoff sobre RabbitMQ 4.3.4

**Decisión**: **colas de reintento con TTL por consumidor**, sin plugins. Para cada cola de
trabajo `Q` se declaran `Q.retry.1s`, `Q.retry.5s` y `Q.retry.30s`, cada una con
`x-message-ttl` de 1 000, 5 000 y 30 000 ms, `x-dead-letter-exchange: ""` (el exchange por
defecto) y `x-dead-letter-routing-key: Q`. Al expirar el TTL, el mensaje vuelve **a esa misma
cola** y a ninguna otra.

**Razón, y es la parte que importa**: la imagen fijada por
[`infra/docker/README.md`](../../infra/docker/README.md) es `rabbitmq:4.3.4-management`, que
**no incluye** `rabbitmq_delayed_message_exchange`. Ese plugin es un `.ez` que hay que copiar y
habilitar en una imagen propia; pedirlo obligaría a construir una imagen personalizada en T-06
sólo para tener un `sleep`.

Y el reintento tiene que ser **por consumidor, no por exchange**. Si un mensaje fallido se
reencolara en `bank.events`, se reentregaría a *todos* los consumidores enlazados: cuando
Notification & Audit falla procesando `account.debited.v1`, Transaction Service lo recibiría
otra vez. La idempotencia lo haría inofensivo, pero el reintento dejaría de significar lo que
dice. Devolver el mensaje a la cola que falló es lo que hace que "tres reintentos" sea una
afirmación verdadera.

**Conteo de intentos**: cabecera explícita `x-attempt`, que el consumidor lee, incrementa y
reenvía. Se prefiere a la cabecera `x-death` que RabbitMQ mantiene sola, porque `x-death`
acumula una entrada por cada cola por la que pasó y leer el intento de ahí es frágil en cuanto
hay tres colas de reintento.

**Alternativas descartadas**: **`setTimeout` en el proceso** y republicación — pierde el
mensaje si el consumidor cae durante la espera, que es precisamente cuando se necesitaba.
**`basic.nack` con requeue** — reintenta inmediatamente y en bucle cerrado, sin backoff.

---

## R6 — Cola de errores

**Decisión**: una DLQ por cola de trabajo, `Q.dlq`, alimentada publicando en `bank.errors` con
la routing key original. El mensaje llega con su sobre intacto y estas cabeceras:

| Cabecera | Contenido |
| --- | --- |
| `x-attempt` | Número del último intento |
| `x-failure-reason` | Causa legible, sin datos sensibles |
| `x-failed-at` | Marca temporal ISO-8601 |
| `x-original-routing-key` | Routing key con la que se publicó |

`correlationId` no necesita cabecera propia: ya viaja en el sobre y en la propiedad AMQP
`correlationId` que `broker.ts` ya rellena.

**Razón**: FR-015 pide causa, último intento y `correlationId`. Preservar el sobre íntegro es
lo que permite reprocesar un mensaje de la DLQ sin reconstruirlo.

**Distinción que FR-016 exige**: un mensaje **inválido** —tipo desconocido, versión no
soportada, payload no conforme— va a la DLQ **en el primer fallo, sin pasar por las colas de
reintento**. Reintentar un mensaje malformado no lo arregla; sólo retrasa 36 segundos el mismo
resultado. Un mensaje **válido cuyo procesamiento falló** sí recorre 1 s, 5 s y 30 s.

---

## R7 — Correlación de solicitud y respuesta

**Decisión**: **cola de respuestas exclusiva por instancia**. Quien pregunta declara una cola
sin nombre (`assertQueue('', { exclusive: true, autoDelete: true })`), la enlaza a
`bank.replies`, y pone su nombre en la propiedad AMQP `replyTo` del comando. Quien responde
publica a `bank.replies` con esa routing key. El emparejamiento es por `correlationId`, que ya
viaja en el sobre.

**Razón, y es una trampa real**: una cola de respuestas **compartida y durable** funciona con
un Gateway y se rompe en cuanto hay dos réplicas — RabbitMQ reparte las entregas, y la
respuesta a la pregunta de la réplica A puede llegarle a la réplica B, que no tiene a nadie
esperándola. Como el sistema se despliega en Kubernetes (constitución VII), donde replicar es
lo normal, la cola exclusiva por instancia no es una precaución teórica.

**Vencimiento**: 5 segundos (FR-018), medido por quien espera. Al vencer se abandona la espera
y **no se cancela nada**: la Saga sigue y el resultado se consulta después.

**Alternativa descartada**: `amq.rabbitmq.reply-to` (direct reply-to), que evita declarar
colas y es más barato. Descartada porque obliga a consumir en el mismo canal que publicó y con
`noAck`, lo que encaja mal con el `ChannelWrapper` reconectante de
`amqp-connection-manager` que el repo ya usa. Queda anotada como optimización posterior.

---

## R8 — La identidad verificada en el sobre

**Decisión**: campo `identity`, opcional, con la forma:

```json
"identity": { "customerId": "uuid", "role": "CLIENTE | CAJERO_RECEPTOR | ADMINISTRADOR" }
```

Es `null` en los mensajes que ningún usuario originó: los que el sistema se envía a sí mismo,
como la desactivación automática de cuentas inactivas.

**Razón**: ADR-010 registró como consecuencia pendiente que "el sobre de mensaje debe
incorporar el campo de identidad verificada, y que T-05 lo define". El Gateway es el único que
firma y valida el JWT; los servicios reciben la identidad ya verificada y no vuelven a
comprobarla. Los tres roles son los del enunciado (§4.1 NOTA, p. 7).

**Lo que el campo no lleva**: ni el token, ni su firma, ni el `username`. El `username` es dato
de Customer Service y viaja en el payload de quien lo necesite, no en el sobre de todos.

**Supuesto de confianza, explícito**: esto sólo es seguro mientras ningún productor publique
al broker sin haber pasado por el Gateway. Queda escrito en el contrato del sobre, no
implícito.

---

## R9 — Almacenamiento de objetos para la foto del documento

**Decisión**: **MinIO**, API compatible con S3, un bucket `customer-identity-documents`. El
Gateway escribe el objeto y publica el comando con la referencia; Customer Service lo lee,
verifica el SHA-256 y lo persiste como `BYTEA` en su propia base.

**Razón**: es la consecuencia de la decisión del equipo registrada en el spec — los bytes no
viajan por el broker. MinIO corre como un contenedor más junto a los PostgreSQL que ya viven
en `infra/docker`, y hablar S3 evita atarse a él.

**Lo que arrastra, y no lo absorbe este ticket**: hace falta un **ADR nuevo** (ninguno de los
once de T-03 contempla almacenamiento de objetos), provisión en **T-06** y presencia en el
diagrama de despliegue de **T-11**. El spec ya lo registra en su tabla de dependencias.

**Frontera que hay que sostener**: MinIO es un **búfer de transferencia**, no la base de datos
de ningún servicio. Nadie consulta ahí el estado del negocio y el objeto se borra tras su
política de retención. En cuanto alguien lo consulte para decidir algo, contradice la
constitución II y el criterio 2.3 de la rúbrica.

**Alternativa descartada**: los bytes dentro del comando, en base64. Cero infraestructura
nueva, pero 5 MB se convierten en ~6,7 MB codificados, hay que subir el límite de frame de
RabbitMQ, y un mensaje así atascado en una DLQ ocupa memoria del broker durante toda la
demostración.

---

## R10 — Qué cambia en `@bank/messaging` y qué no

**Decisión**: el adaptador **sigue sin conocer un solo nombre de negocio**. Lo que gana es
topología y política, no vocabulario.

| Hoy | Después de T-05 |
| --- | --- |
| Un exchange, pasado por constructor | Cuatro exchanges declarados desde un descriptor de topología |
| `assertQueue(durable)` | Cola de trabajo + 3 de reintento + DLQ, desde el mismo descriptor |
| `nack(false, false)` en cualquier error | Reintento con backoff si es fallo de proceso; DLQ directa si es inválido |
| Sin request/reply | Cola exclusiva, `replyTo`, espera por `correlationId` con vencimiento |
| `parseEnvelope` comprueba la forma del sobre | Sigue igual; la validación del payload es de `@bank/contracts` |

**Razón**: el límite que el paquete ya respeta —"Knows no business event names", dice su
`package.json`— es lo que impide que la infraestructura compartida se convierta en un lugar
donde vive lógica de negocio. La topología entra como **datos** que el llamador pasa, no como
constantes escritas dentro del adaptador.

---

## R11 — Los siete mensajes que T-02 no lista

**Decisión**: se contratan con esta nomenclatura, coherente con la de T-02:

| Mensaje | Categoría | Responde a |
| --- | --- | --- |
| `customer.authenticate.replied.v1` | respuesta | `customer.authenticate` |
| `account.balance.replied.v1` | respuesta | `account.balance.query` |
| `transaction.status.requested.v1` | solicitud | — |
| `transaction.status.replied.v1` | respuesta | `transaction.status.requested` |
| `audit.query.requested.v1` | solicitud | — |
| `audit.query.replied.v1` | respuesta | `audit.query.requested` |
| `customer.email.verification.rejected.v1` | evento | — |

**Razón**: T-02 nombró dos interacciones "async request/reply" (`customer.authenticate`,
`account.balance.query`) sin contratar la respuesta, y el ticket T-05 exige además consulta de
estado y de auditoría. El sufijo `.replied` distingue la categoría sin inventar un vocabulario
nuevo.

**El séptimo apareció al implementar.** FR-020 exige distinguir en el rechazo de la activación
entre token expirado y token inválido, y el catálogo de T-02 no tiene ningún mensaje capaz de
transportar esa distinción: `customer.verify-email` es un comando sin respuesta y sin evento de
fallo. Se modela como **evento hacia Notification & Audit**, que es exactamente como T-02 ya
modela `customer.login.rejected` — un rechazo auditado, no una respuesta al que preguntó. Sin
él, FR-020 sería inverificable.

**Obligación que genera**: `docs/domain/message-catalog.md` afirma "13 comandos" y "22 eventos,
cero huérfanos". Esa afirmación debe seguir siendo verificable, así que el catálogo recibe una
nota de ampliación que declara **respuesta** como tercera categoría y explica por qué una
respuesta no es un evento huérfano: su único destinatario es quien preguntó.

---

## R12 — El paquete de contratos gana dependencias de ejecución

**Decisión**: `@bank/contracts` pasa de cero dependencias de ejecución a dos (`zod` y, sólo
para generar el artefacto, `zod-to-json-schema` como dependencia de desarrollo).

**Razón**: sin validador en el paquete, cada servicio elegiría el suyo y la comprobación
dejaría de ser común, que es justo lo que el paquete existe para evitar.

**Lo que protege el límite**: la regla de lint que prohíbe `@bank/*` en `src/domain/**`
(`apps/packages/tooling/eslint.base.mjs`) sigue vigente y no se toca. Ningún archivo de
dominio importa contratos, y por tanto ningún dominio hereda Zod. SC-010 lo convierte en una
comprobación ejecutable.
