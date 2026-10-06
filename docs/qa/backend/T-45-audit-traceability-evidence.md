# T-45 — Evidencia: auditoría consultable, anomalías, alertas de SLO y trazabilidad en el frontend

Registro manual, no regenerado por un script: la salida real de los comandos de
validación que pide `T-45.md`, capturada el día de la implementación. No se edita
a mano después de escrita; una revisión posterior debe volver a correr los
comandos y añadir una entrada nueva.

**Fecha**: 2026-10-05 · **Rama**: `feature/T-45` (apilada sobre `feature/T-44`) ·
**Alcance tocado**: `apps/packages/contracts`, `apps/services/notification-audit-service`,
`apps/gateway`, `apps/web`, `infra/` (Helm y los dos Compose), `docs/`, y —por los hallazgos del final— una prueba de `payment-service` (T-44) y una de `transaction-service` (T-43).

## Qué se implementó

Cubre el enunciado de la Fase 3 (§4.1, *Notification & Audit Service* y
*Integración con el sistema existente*: «mostrar el correlationId / traceId de cada
operación y permitir consultar la auditoría»).

| Capa | Qué se agregó |
| --- | --- |
| Contratos | `alert.slo.received.v1` (comando del Gateway; el catálogo pasa de 107 a 108) y la cola `audit.alert`. `audit.events.list.query.v1` gana `correlationId`, `traceId` y `service`; su respuesta y `audit.query.replied.v1` ganan `traceId`. Todo aditivo y opcional |
| Auditoría | Migración `006`: `audit_events.trace_id` (con `CHECK` del formato W3C y sin el valor todo-ceros) y `notifications.dedupe_key` (índice único parcial). `traceId` desde el **span activo**; los cuatro filtros de §4.1 en una consulta (`AND`, parámetros enlazados); la anomalía genera una notificación `WARNING`; la alerta de SLO se clasifica por lo que dice |
| Gateway | `POST /api/alerts/slo` (sin sesión, con secreto compartido), filtros en `GET /api/audit/recent`, y `X-Trace-Id` en cada respuesta |
| Frontend | La insignia del código de seguimiento muestra también la traza; la pantalla `/auditoria` gana los cuatro filtros y una columna de traza; el panel de detalle muestra la traza del evento |
| Infra | `ALERT_WEBHOOK_TOKEN` por Secret del chart (opcional, `optional: true`) y en los dos Compose, **vacío por defecto** |

**Ya existía y no se rehízo**: la clasificación `INFO`/`WARNING`/`ERROR` (T-30) y la
redacción antes del insert. La anomalía ya figuraba como `WARNING` en la tabla de
clasificación y ya se *registraba* por el binding `account.#`; lo que faltaba era
notificarla.

## Catálogo de telemetría (lo que T-50 consolida)

### Métricas (`notification-audit-service`)

| Métrica | Tipo | Unidad | Etiquetas |
| --- | --- | --- | --- |
| `bank.audit.events` | contador | `{event}` | `family` (`customer` / `account` / `transaction` / `payment` / `alert` / `other`), `severity`, `outcome` (`recorded` / `duplicate`), `processing` (`processed` / `invalid` / `error`) |
| `bank.audit.notifications` | contador | `{notification}` | `severity`, `result` (`sent` / `failed` / `suppressed`) |
| `bank.audit.alerts.received` | contador | `{alert}` | `status` (`firing` / `resolved`), `severity` (`critical` / `warning` / `info`) |

- Ninguna etiqueta es un identificador. `family` es la primera palabra del tipo de
  mensaje y cualquier otra cosa cae en `other`: un nombre imprevisto no puede crear una
  serie nueva. Los estados y severidades de las alertas se cuentan **solo** si el
  contrato los aceptó y pertenecen a su conjunto cerrado.
- Una redelivery cuenta como `duplicate` y nunca como un segundo evento: la tasa de
  `recorded` es la de cosas que ocurrieron; la de `duplicate`, la de reentregas del broker.
- `suppressed` es la segunda notificación de una misma anomalía: la señal de que
  Account Service republicó.

### Spans

| Span | Cuándo | Atributos |
| --- | --- | --- |
| `audit.record` | cada mensaje entregado a la auditoría | `bank.audit.message_type`, `bank.audit.severity`, `bank.audit.processing_status`, `bank.audit.outcome`, `bank.audit.notification`, `bank.correlation_id` |

### Logs

`event recorded` (info) gana `traceId` cuando hay uno. Ya llevaba `correlationId`,
`eventId`, `messageType`, `producer`, `consumer` y `outcome`.

### Cabecera HTTP

`X-Trace-Id` en cada respuesta del Gateway, **ausente** (no vacía, no ceros) mientras
ningún SDK registre un span. Expuesta por CORS.

## Decisiones de diseño

- **El `traceId` sale del span activo, no del sobre del mensaje.** El sobre no gana
  un campo: T-48 inyecta y extrae el `traceparent` en las propiedades AMQP, y una
  segunda copia en el payload serían dos fuentes que pueden discrepar. Con la API de
  OpenTelemetry sin SDK es un no-op y se enciende solo cuando T-48 lo registre. Las
  pruebas usan un SDK real y un gestor de contexto mínimo.
- **La anomalía llega al titular y al administrador.** El evento trae `customerId`
  (opcional); sin él, la notificación queda igualmente en la consola del
  administrador. El texto no dice cifras: la bandeja es del cliente y los números
  pertenecen a la auditoría.
- **Deduplicación por clave de negocio, no por id de mensaje.** Account Service puede
  republicar la misma anomalía con otro `messageId` (T-42). `caused_by` no lo ve; la
  clave `anomaly:<cuenta>:<inicio de ventana>` sí, y es un índice único, no una
  comprobación: ocho réplicas anunciándola a la vez producen una sola notificación.
  El evento **sí** se registra las ocho veces en la auditoría (llegó), y la
  repetición se cuenta como `suppressed`. La ventana siguiente es otra anomalía y
  notifica de nuevo.
- **La alerta es un comando, no un evento.** El Gateway publica intenciones. Va a una
  cola propia (`audit.alert`, la sexta del servicio) por la misma razón que cada
  familia tiene la suya: una tormenta de alertas no debe hacer cola delante de la
  auditoría de una transferencia.
- **El Gateway mapea el cuerpo de Grafana, no lo reenvía.** Solo sobreviven nombre,
  estado, severidad, resumen, runbook, SLO y huella. El texto libre se corta al
  largo del contrato en vez de rechazarse (una alerta sobre una caída no se rechaza
  por tener un resumen largo); una severidad ausente o desconocida es `warning`.
- **El webhook falla cerrado.** Sin `ALERT_WEBHOOK_TOKEN` rechaza a todos; con él, la
  comparación es de tiempo constante (ambos lados se hashean antes). Una sesión JWT,
  incluso de administrador, **no** sustituye al secreto. La variable es opcional para
  que un Gateway sin ella siga sirviendo todo lo demás, y exige ≥ 32 caracteres para
  que no sea adivinable desde fuera del cluster.
- **La severidad de una alerta es lo que dice.** `ERROR` si algo crítico está
  activo; `WARNING` si algo está activo a nivel `warning`; `INFO` si todo se
  resolvió o lo activo es informativo. La más grave del lote decide. La clasificación
  se calcula con el payload **vivo**, antes de la redacción (que conserva 20 elementos).
- **Cada repetición del webhook se registra y se notifica.** Grafana reenvía la
  misma alerta mientras sigue activa y la auditoría debe reflejar lo que llegó; la
  deduplicación fina de alertas, si hace falta, la decide T-50 con sus intervalos.

## Validación

Todas las cifras de esta sección son salida real de esta sesión, sin caché
(`turbo run … --force`).

### Pruebas unitarias y de contrato

| Paquete | Resultado |
| --- | --- |
| `@bank/contracts` | 19 suites, **875** casos (los de `alert.slo.received.v1` —incluidos los 6 trace-id inválidos— y los de los filtros) |
| `notification-audit-service` | 14 suites, **251** casos con PostgreSQL (196 unitarios + 55 de integración) |
| `gateway` | 29 suites, **406** casos unitarios sin broker; con broker, 33 suites y **517** (ver más abajo) |
| `web` | `node --test`: **306** casos (272 de antes + 34); Vitest con Nitro: **94** casos (84 + 9 de la pantalla en un navegador real + 1 del proxy) |

### Contra PostgreSQL real (18.4, desechable)

`trace-and-dedupe.integration.spec.ts` y las de antes, `--runInBand`:

- La columna `trace_id` guarda el id, lo devuelve en el rastro y en el listado, es
  `NULL` para un evento sin traza, y la base **rechaza** un valor que no sea un
  trace-id (incluido el todo-ceros) y uno en mayúsculas.
- Los cuatro filtros funcionan solos y combinados con `AND`; `total` sigue el mismo
  filtro que la página; un valor de filtro con `' OR '1'='1` es dato, no SQL.
- La misma anomalía anunciada con dos `messageId` escribe **una** notificación y dos
  eventos de auditoría; ocho anuncios simultáneos, una notificación; la ventana
  siguiente y otra cuenta notifican; una notificación sin clave puede repetirse.
- El caso de uso completo sobre el repositorio real envía **una vez** y deja la
  notificación `SENT`.

### Mutaciones

Se rompió una pieza a la vez y se corrió la suite; cada mutante debía matar al menos
una prueba. **24 de 25 mueren.**

| Mutación | Resultado |
| --- | --- |
| un crítico activo solo es `WARNING` | muerta |
| una alerta resuelta cuenta como activa | muerta |
| la anomalía no lleva clave de deduplicación | muerta |
| la clave ignora la ventana | muerta |
| se envía la notificación que el repositorio declinó | muerta |
| los filtros se combinan con `OR` | muerta (contra PostgreSQL) |
| el `trace_id` nunca se guarda | muerta |
| el filtro `service` lee otra columna | muerta |
| el handler no lee la traza de la fuente inyectada | muerta |
| el listado no devuelve la traza | muerta |
| el webhook admite a todos | muerta |
| un secreto sin configurar abre el webhook | muerta |
| se acepta un trace-id de ceros en el Gateway | muerta |
| el filtro `service` no se valida | muerta |
| `X-Trace-Id` se emite aunque no haya traza | muerta |
| una severidad desconocida pasa a `critical` | muerta |
| una redelivery cuenta como un segundo evento | muerta |
| la supresión no se reporta | muerta |
| el id de correlación como etiqueta | muerta |
| un nombre imprevisto crea una serie | muerta |
| el frontend muestra una traza de ceros | muerta |
| el libro de trazas nunca olvida | muerta |
| se envía un filtro vacío | muerta |
| se envía un menú en `TODOS` | muerta |
| el Gateway reenvía el ruido de Grafana (`generatorURL`) | **sobrevive**: es un mutante equivalente — el esquema del contrato descarta los campos desconocidos al validar, que es la segunda defensa; la prueba comprueba que el ruido no llega al broker |

### Pantalla de auditoría, en un navegador real

`audit-screen.integration.spec.ts` (9 casos, Nitro real + `playwright-core`, con el
Gateway interpretado por `page.route`): los cuatro filtros están en pantalla; la columna
de traza muestra el id o un guion; buscar por traza envía `traceId` normalizado
(recortado y en minúscula) y **solo** los filtros activos; combinar filtros es una
sola petición; un identificador mal escrito se explica junto al campo y **no se
busca**; «ningún evento coincide» y «el servicio no respondió» son mensajes distintos;
«Limpiar» vuelve al listado completo; la insignia muestra la traza **de esa
operación** (no la última que algo produjo); y con la cabecera ausente o con un valor
que no es un trace-id no se muestra ninguna.

### Chart

`helm lint` sin fallos; `helm template` (con `external.mode=hostFallback`) renderiza
`ALERT_WEBHOOK_TOKEN` en el Secret —vacío por defecto— y en el Deployment del Gateway
con `optional: true`; con `--set secrets.alertWebhookToken=…` lo emite.

### Contra el RabbitMQ real (Gateway)

Con el broker del stack local (los servicios de negocio pausados, que es lo que
`reply-correlation` necesita para ser fiable) y `--runInBand`: **33 suites, 517 de 517
casos, ninguno omitido**.

- `alert-webhook.integration.spec.ts` (11 casos): el comando sale por `bank.commands`
  con la clave `alert.slo.received.v1` y valida contra el catálogo; `identity` viaja
  como `null` y no como campo ausente; el ruido de Grafana no llega al cable; un lote
  de tres es un mensaje de tres; sin credenciales, con un secreto equivocado o con un
  JWT de administrador el broker queda intacto (401); un cuerpo sin alertas también
  (400). Del listado: publica exactamente los cuatro filtros pedidos y ninguno más, y
  un `traceId` o un `service` mal escritos dejan el broker intacto (400).
- `publish-routing.integration.spec.ts`: la fila nueva `POST /api/alerts/slo` publica en
  el exchange y con la clave del catálogo.

### Pirámide de pruebas (`pnpm test:pyramid --require-executed --without-e2e`)

Corrida real, con PostgreSQL 18.4 desechable (una base `*_pyramid` por servicio),
el RabbitMQ del stack y el parche local de `npx.cmd` (copia temporal, ya borrada; los
informes `docs/qa/pyramid.*` se restauraron). **`exit=0`: «La pirámide está dentro de
la tolerancia»**, y como se pasó `--require-executed`, ninguna suite de integración se
omitió.

| Paquete | Unitarias | Integración | % integ | Objetivo |
| --- | ---: | ---: | ---: | ---: |
| `gateway` | 406 | 111 | 21,5 % | 22,2 % |
| `web` | 306 | 94 | 23,5 % | 22,2 % |
| `customer-service` | 158 | 42 | 21,0 % | 22,2 % |
| `account-service` | 188 | 56 | 23,0 % | 22,2 % |
| `transaction-service` | 203 | 55 | 21,3 % | 22,2 % |
| `payment-service` | 151 | 45 | 23,0 % | 22,2 % |
| `notification-audit-service` | 196 | 55 | 21,9 % | 22,2 % |
| `@bank/messaging` | 42 | 12 | 22,2 % | 22,2 % |

Las primeras cifras de esta sesión sacaban tres paquetes de la tolerancia de 1,5
puntos (auditoría 24,3 %, web 23,9 %, Gateway 19,8 %) y el CI habría fallado. Se
corrigió con pruebas que valen por sí mismas (el caso de uso completo contra
PostgreSQL y las del Gateway contra el broker real), no con relleno.

### De punta a punta, contra el stack de imágenes

Imágenes `gateway`, `notification-audit-service` y `web` reconstruidas con el código de
este ticket (`--allow-dirty`) y levantadas con `ALERT_WEBHOOK_TOKEN` definido. Un guion
habla con el Gateway como lo haría un cliente: **29 de 29**.

- Webhook: 401 sin credenciales, con un secreto equivocado y con un JWT de
  **administrador**; 400 sin alertas; 202 con el secreto. `X-Correlation-Id` vuelve;
  `X-Trace-Id` **no** (sin SDK, ausente y no vacío).
- La alerta crítica queda en la auditoría como evento del `gateway`, en `audit.alert`,
  clasificada `ERROR`, con lo que dijo y sin el ruido de Grafana; la resuelta, `INFO`.
  Genera una notificación para los operadores (severidad `ERROR`, el asunto nombra la
  alerta, sin destinatario personal).
- Filtros: `service=gateway&severity=ERROR` la encuentra; el mismo servicio a otro nivel
  no; un trace-id válido que nadie registró devuelve 200 vacío; cuatro filtros mal
  formados (incluido el todo-ceros) devuelven 400; un `CLIENTE` recibe 403.
- Anomalía: doce depósitos a una cuenta disparan `account.anomaly.detected.v1`; queda en
  la auditoría (`service=account-service`, `WARNING`) y **el titular recibe una
  notificación `account.anomaly` `WARNING` en su bandeja**. Tres movimientos más dentro
  de la misma ventana no avisan otra vez.

### La pantalla, vista en un navegador real

`/auditoria` abierta con Playwright contra el stack: los cuatro filtros se ven y
funcionan (traza pegada en mayúsculas → «Ningún evento coincide con los filtros»;
`Servicio = gateway` → aparecen las alertas, `Info` la resuelta y `Error` la crítica).
**El navegador encontró lo que ninguna prueba veía**: la cabecera «Traza» se pegaba a
«Estado», la columna de 32 caracteres desbordaba la tabla y a este ancho los filtros
quedaban truncados. Se corrigió (ocho caracteres en la tabla y el id completo en el
tooltip y en el panel de detalle; los filtros en rejilla de dos columnas hasta `xl`).

### Las dos pantallas restantes, vistas en el navegador (y lo que encontraron)

Se abrieron la bandeja del cliente y la consola de operadores contra el stack. **Las dos
revisiones encontraron un defecto** que ni las pruebas ni el guion de punta a punta veían:

- **La alerta de SLO salía «No enviada»** (`sin destinatario`) y encendía el aviso rojo
  «2 notificaciones no se entregaron». El canal simulado reporta `FAILED` para una
  notificación sin destinatario, y una alerta no tiene cliente. El guion solo comprobaba
  que la notificación *existía*, y el doble de pruebas (`RecordingSender`) siempre contesta
  `SENT`, así que ninguna prueba podía verlo. **Corregido**: las notificaciones para los
  operadores llevan el destinatario simulado `operadores@simulado.bonking.gt` (no nombra a
  nadie), y la prueba nueva usa el **canal simulado real**: falla con el defecto y pasa sin
  él. Comprobado otra vez en el stack: `SENT`, severidad `ERROR`. (Las dos filas `FAILED`
  que siguen en la consola de desarrollo son sondas de antes del arreglo; la auditoría es
  *append-only*.)
- **La cuenta de ahorro con un débito perdía todo su estado de movimientos.** El enlace
  «Ver →» de la notificación de anomalía aterrizó en `/cuentas/<id>` con un `TypeError`
  (`reading 'label'`): la API devuelve operaciones `COMMISSION` (la comisión de Q3 de T-27)
  y la tabla del frontend solo conocía `DEBIT`, `CREDIT` y `COMPENSATION`. **Anterior a
  T-45** y sin relación con él, pero el flujo de T-45 desemboca ahí. **Corregido**
  (`Comisión`, con signo de salida) y blindado: una prueba lee los tipos de operación **del
  contrato** y exige que cada uno tenga nombre en la pantalla, de modo que el siguiente tipo
  que se agregue no vuelva a romperla. Comprobado en el navegador: el estado de movimientos
  dibuja `Crédito`, `Comisión`, `Débito` y `Compensación`.

La bandeja del cliente muestra «Detectamos actividad inusual en tu cuenta» con la
insignia «Advertencia», la etiqueta «Actividad inusual en la cuenta» y ninguna cifra; y
«Ver →» lleva a la cuenta correcta.

## Lo que no se verificó

- **Nada de esto se ha visto en Prometheus, Jaeger o Grafana**: no hay SDK registrado
  hasta T-48. Las métricas y los spans se comprobaron con exporters en memoria.
  Mientras tanto `X-Trace-Id` no sale, `trace_id` es `NULL` y la insignia del frontend
  no muestra traza: es lo correcto, no un defecto. Por la misma razón **la insignia con
  una traza real solo se vio en el navegador de las pruebas de Nitro** (con el Gateway
  interpretado), no contra el stack.
- **La pantalla no se comparó con el prototipo de Claude Design** (`docs/DESIGN.md` lo
  pide): el MCP no estaba disponible. Se siguió `DESIGN.md` y se miró la pantalla real,
  que es más de lo que TD-054 tenía, pero no es la comparación que pide.
- **El E2E de `test/e2e` no se corrió** (`pnpm test:pyramid` se corrió con
  `--without-e2e`, como el CI).
- **`traceparent` por el broker** llega con T-48: hasta entonces cada servicio traza lo
  suyo y el `trace_id` de un evento no une a los de otros servicios.

## Hallazgos corregidos en esta rama que no son de T-45

- **Prueba intermitente de T-44** (`payment-service/test/provider-telemetry.spec.ts`,
  «keeps every field a person could be identified by…»): serializaba los puntos de la
  métrica completos para buscar `25000`, y el `startTime` de cada punto va en
  nanosegundos con resolución de milisegundo: cuando los milisegundos terminan en `25`
  (`…525000000`) contiene `25000` por casualidad. Falló una vez en las corridas completas
  de esta sesión (y no se reproducía en 60 corridas aisladas, que es lo que lo hace
  traicionero). **Corregido**: la comprobación lee las **etiquetas** de los puntos, y una
  prueba determinista fija un punto de milisegundo `525` para demostrar el mecanismo.
- **El mismo defecto, latente, en T-43** (`transaction-service/test/transfer-telemetry.spec.ts`,
  «keeps accounts, customers and amounts out…»): buscaba `15000` en las métricas
  completas, así que fallaba cuando los milisegundos terminaban en `15`. Mismo arreglo y
  misma prueba determinista. Se revisaron el resto de pruebas de telemetría de T-41 a
  T-45: las demás buscan identificadores largos, que no pueden aparecer por azar.
- **Error de hidratación de Vue en consola** (`Hydration completed but contains
  mismatches`) en todas las pantallas probadas (`/auditoria`, `/cuentas`,
  `/transferencias`): es anterior a T-45 (la sesión vive en `sessionStorage` y el servidor
  no la tiene) y no se tocó. Es el tipo de cosa que TD-054 dice que nadie había visto.
