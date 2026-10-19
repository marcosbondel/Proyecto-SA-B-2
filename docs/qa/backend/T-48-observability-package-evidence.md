# T-48 — Evidencia: `@bank/observability` y la propagación del contexto por el broker

Registro manual, no regenerado por un script: la salida real de los comandos de
validación que pide `T-48`, capturada el día de la implementación. No se edita a
mano después de escrita; una revisión posterior debe volver a correr los comandos
y añadir una entrada nueva.

**Fecha**: 2026-10-11 · **Rama**: `feature/T-48` (desde `develop` en `58cb0ca`) ·
**Alcance tocado**: `apps/packages/observability` (nuevo), `apps/packages/messaging`,
los cinco servicios y el Gateway (`src/instrumentation.ts`, `main.ts`, `interfaces/logging.ts`),
el outbox de `transaction-service` y `payment-service`, los siete Dockerfiles, el chart,
los dos Compose, `turbo.json`, `pnpm-workspace.yaml`, `.github/` y `docs/`.

## Qué se implementó

Cubre el enunciado de la Fase 3, §4.1 (*Instrumentación con OpenTelemetry*,
*Métricas (SLI base)*, *Logging estructurado*) y las penalizaciones de §8.3 que
dependen de ello: «no existen trazas distribuidas reales (el contexto no cruza el
broker)» y «OpenTelemetry no está integrado en el código de los servicios», 50 %
cada una.

| Capa | Qué se agregó |
| --- | --- |
| `@bank/observability` (nuevo) | `startTelemetry`: SDK de Node con propagador W3C, instrumentación de HTTP, Express, NestJS y `pg`, y exportación OTLP/HTTP **solo si hay `OTEL_EXPORTER_OTLP_ENDPOINT`**. `JsonLogger`: una línea JSON con `timestamp`, `level`, `serviceName`, `environment`, `version`, `message`, `correlationId`, `traceId`, `spanId`; descarta campos de secretos y datos personales y enmascara JWT, `Bearer` y correos en cualquier valor. `nestLoggerFor`: los logs de Nest en el mismo JSON. `currentTraceparent` / `withTraceparent` / `continueTrace`: la traza a través del tiempo (outbox, reintentos) |
| `@bank/messaging` | Span PRODUCER por publicación con `traceparent` inyectado en los headers AMQP; span CONSUMER por entrega, hijo del contexto extraído, con el handler corriendo dentro. También en las respuestas exclusivas del Gateway y en el drenaje de mensajes estacionados. Métricas `messaging.client.sent.messages`, `messaging.client.consumed.messages`, `messaging.client.operation.duration` y `messaging.process.duration` |
| Los seis componentes | `src/instrumentation.ts`, importado **primero** por `main.ts`; el logger compartido en lugar de los cinco `StructuredLogger` duplicados y del `Logger` de texto del Gateway; vaciado de la telemetría al apagar |
| Outbox | Columna `trace_context` en `outbox_messages` (`transaction` migración `011`, `payment` migración `006`) y en `payments`: el relay publica dentro de la traza de la fila, y cada peldaño de la escalera de pagos es un paso de la traza de la Saga |
| Contenedores | Los siete Dockerfiles copian y compilan el paquete; nada nuevo horneado en la imagen |
| Chart | Bloque `observability` en `values.yaml`, sus claves en el ConfigMap y el helper `bank-usac.telemetryEnv` en los seis Deployments; `SERVICE_VERSION` es el tag de la imagen de ese Deployment. `helm-deploy.sh` fija `observability.environment` al namespace y pasa `OTEL_EXPORTER_OTLP_ENDPOINT` desde una variable del repositorio |
| Compose | Las variables en los seis servicios de ambos archivos; un Jaeger detrás del perfil `telemetry` en el de imágenes y `pnpm images:trace` |

**No se agregó** ninguna llamada HTTP entre servicios: las seis pruebas de aislamiento
siguen verdes. `web` no se instrumenta en T-48.

## Catálogo de telemetría (lo que T-50 consolida)

### Recurso (en cada span y cada métrica)

`service.name`, `service.version`, `deployment.environment.name` y `deployment.environment`
(los dos, porque el nombre actual de la convención y el que usa el enunciado difieren),
`service.namespace=bank-usac` y `service.instance.id` (el nombre del pod).

### Métricas

| Métrica | Tipo | Unidad | Etiquetas |
| --- | --- | --- | --- |
| `messaging.client.sent.messages` | contador | `{message}` | `messaging.system`, `messaging.operation.name`, `messaging.destination.name` (el exchange), `error.type` si falló |
| `messaging.client.operation.duration` | histograma | `s` | las mismas, sin `error.type` |
| `messaging.client.consumed.messages` | contador | `{message}` | `messaging.system`, `messaging.operation.name`, `messaging.destination.name` (la cola), `bank.delivery.outcome` (`ack` / `retry` / `dead_letter` / `invalid` / `dropped`) |
| `messaging.process.duration` | histograma | `s` | las mismas |
| `http.server.request.duration` | histograma | `s` | de la instrumentación HTTP con convenciones estables: `http.request.method`, `http.response.status_code`, `http.route` |

Ninguna etiqueta es un identificador: la cola de respuestas del Gateway, que se nombra
por pod, aparece como `gateway.replies` (`telemetryName`), o cada reinicio crearía una
serie. Las consultas de throughput y disponibilidad están en
[`docs/sre/sli-slo-sla.md`](../../sre/sli-slo-sla.md), anexo T-48.

### Spans

| Span | Tipo | Atributos |
| --- | --- | --- |
| `publish <exchange>` | PRODUCER | `messaging.system`, `messaging.operation.type=send`, `messaging.destination.name`, `messaging.rabbitmq.destination.routing_key`, `messaging.message.id`, `messaging.message.conversation_id`, `bank.correlation_id`, `bank.message.type` |
| `process <cola>` | CONSUMER | los mismos con `operation.type=process`, más `bank.message.attempt` y `bank.delivery.outcome` |
| `payment.retry` | INTERNAL | `bank.correlation_id`, `bank.payment.attempt` |
| HTTP, Express, NestJS, `pg` | SERVER / INTERNAL / CLIENT | los de la instrumentación automática; `/health` y `/ready` no se trazan |

### Logs

Todas las líneas de los seis componentes, con la cabecera fija de arriba. Los campos
propios de cada servicio siguen tipados por su `LogFields`.

## Decisiones de diseño

- **La propagación por el broker es código del repositorio, no un parche.** No se usa
  `@opentelemetry/instrumentation-amqplib`: el repositorio usa amqplib 2.x, que ese paquete
  no promete soportar, y la rúbrica busca la propagación «integrada en el código». Está en
  `apps/packages/messaging/src/telemetry.ts` y la prueban 19 casos.
- **El SDK se registra aunque no haya a dónde exportar.** Sin endpoint, los spans se
  registran y se descartan: la propagación y el `traceId` en los logs funcionan en una
  laptop y en CI, y nada reintenta un collector inexistente.
- **El outbox guarda la traza, no solo el mensaje.** Sin `trace_context`, el relay publicaría
  desde el contexto de su temporizador y la Saga se partiría en dos justo en el salto que
  califica el criterio 2.2. Lo mismo con la escalera de pagos, que corre desde un barrido.
- **Una sola copia de `@opentelemetry/core`** (override en `pnpm-workspace.yaml`): dos
  copias tienen dos claves de «suprimir trazas», y la exportación de un span se volvería
  otro span.
- **Los logs van a stdout y nada más.** Los recolecta el agente de T-49; ningún servicio
  envía sus logs a otro, que es lo que pide §4.1 para Notification & Audit.
- **`deliveryLink` no se redacta.** El servicio de auditoría solo lo revela fuera de
  producción, decisión que ya se toma en su `main.ts`; el filtro no aprende excepciones.

## Validación

### Pruebas unitarias y de contrato

| Paquete | Resultado |
| --- | --- |
| `@bank/observability` | 3 suites, **61 casos**: 48 unitarios (`logger.spec.ts`, `context-and-nest.spec.ts`) y 13 de integración |
| `@bank/messaging` | 10 suites, **73 casos**: 15 nuevos unitarios (`trace-propagation.spec.ts`) y 4 nuevos de integración; los 42 + 12 anteriores, sin cambios |
| `@bank/contracts` | 875 casos |
| `transaction-service`, `payment-service` | se actualizaron dos aserciones que esperaban `service` en lugar de `serviceName` (`logging.spec.ts`, `provider-telemetry.spec.ts`) |
| Los demás | sin cambios en sus pruebas |

`npx turbo run build lint typecheck --force`: **30 de 30** tareas. `apps/web`: 94 casos de Vitest.

### Integración contra procesos reales

Con un PostgreSQL 18.4 y un RabbitMQ 4.3.4 desechables (`docker run`, puertos libres, una
base por servicio, como el paso de CI):

| Paquete | Casos |
| --- | --- |
| `gateway` | 517 de 517 |
| `transaction-service` | 258 de 258 |
| `notification-audit-service` | 257 de 257 |
| `payment-service` | 196 de 196 |
| `account-service` | 244 de 244 en serie sobre una base limpia; en paralelo, 8 fallos (ver TD-086) |
| `customer-service` | 203 de 203 en serie sobre una base limpia; en paralelo, 1 fallo (ver TD-086) |
| `@bank/messaging` | 73 de 73 |

Los fallos en paralelo de account y customer **no son de T-48**: dos archivos de integración
vacían las mismas tablas a la vez, porque esos dos servicios nunca fijaron `maxWorkers: 1`
como payment y auditoría. Registrado como TD-086.

La integración de `@bank/observability` cruza un proceso de verdad: lanza
`test/fixtures/instrumented-process.js`, que arranca el SDK compilado y sirve HTTP, y la
prueba hace de Collector. Comprueba que se exporta por OTLP, el recurso, el span SERVER con
convenciones estables, el error de un 5xx, que los sondeos no se trazan, que se continúa un
`traceparent` entrante, el hijo dentro del handler, el log con el mismo `traceId`, el histograma
HTTP por código y los dos modos sin exportación.

### Pirámide de pruebas

`pnpm test:pyramid --require-executed --without-e2e`, como el CI: **«La pirámide está dentro de
la tolerancia»**, sin ninguna suite de integración saltada. `@bank/observability` queda en
21,3 % (objetivo 22,2 % ± 1,5) y `@bank/messaging` en 21,9 %.

### Mutaciones

| Mutación | Resultado |
| --- | --- |
| La expresión que excluye `/health` y `/ready` deja de coincidir | 1 caso de integración falla («does not trace the kubelet probes») |
| `tracePublish` deja de inyectar el contexto | 6 casos fallan, unitarios y contra RabbitMQ |

### Contra las imágenes reales

Las siete imágenes construidas con `build-images.sh --allow-dirty`, el stack de imágenes con
`--profile telemetry` y `OTEL_EXPORTER_OTLP_ENDPOINT=http://jaeger:4318`:

- `pnpm images:smoke`: **63 passed, 0 failed**. Ni una variable nueva horneada en una capa.
- `pnpm images:flow`: las cinco Sagas con el dinero comprobado antes y después — KYC rechazado,
  COMPLETED, COMPENSATED por rechazo, COMPENSATED tras la escalera y COMPENSATED con el
  proveedor al 100 % de fallo.
- Ninguna línea de log de los seis contenedores deja de ser JSON, y ninguna es `error`.
- `pnpm images:trace`, sobre Jaeger:

```
OK   54daeea8d5f535cb3d6295783fd0d1ae   177 spans   26 broker spans  root gateway: POST /api/transfers
OK   0a88dedb9dfc17550184af2d6d2ed5e2   271 spans   38 broker spans  root gateway: POST /api/transfers  (compensation)
OK   57a4fd9b8028cc2a7f5e77511779edd0   263 spans   38 broker spans  root gateway: POST /api/transfers  (compensation)
OK   f41ac6d3e6dbf6fa10efc8041fd66fd3   188 spans   29 broker spans  root gateway: POST /api/transfers  (compensation)
OK   88707b3c622aae50dccc206dbb9d260a   177 spans   26 broker spans  root gateway: POST /api/transfers

9 traces reach payment-service; 5 complete (rooted at a Gateway request, no orphan span, all of:
gateway, customer-service, account-service, transaction-service, payment-service, notification-audit-service).
```

**Cada transferencia que llega a pagos es una sola traza**, con raíz en la petición del Gateway,
sin un span huérfano y con los seis componentes dentro. Las otras cuatro trazas son el cambio y
la consulta de la simulación (Gateway y pagos) y el arranque de un proceso, que no son
transferencias. En la traza de la escalera (`57a4fd9b…`), los intentos 2, 3 y 4 son spans
`payment.retry` hijos del `process payment.commands` original: el barrido continúa la traza en
lugar de abrir una nueva.

### Chart

`helm lint` sin errores. `helm template` con los valores obligatorios: los seis Deployments
reciben las seis variables, ninguna duplicada, y `SERVICE_VERSION` es el tag de cada uno
(`1.4.0-abc` en payment cuando solo a él se le fijó; `dev` en el resto). `web` no las recibe.

## Lo que no se verificó

- **No hay Collector, Prometheus, Tempo ni Loki** todavía (T-49). Lo que se probó es que los
  seis componentes exportan OTLP y que un receptor real arma la traza; las consultas PromQL del
  anexo de `sli-slo-sla.md` no se ejecutaron contra un Prometheus.
- **Ningún despliegue en la nube ni en kind.** El chart se renderizó, no se instaló; no existe
  hoy un clúster en GCP donde instalarlo (ver T-53).
- **La suite E2E de `test/e2e`** no se corrió en esta sesión; sí `images:flow`, que recorre los
  mismos caminos de dinero.
- **Ojo al reproducir `images:flow`**: si `infra/docker/.env` tiene `NOTIFICATION_CHANNEL=resend`,
  el enlace de activación sale por **correo real** en lugar de por el log, y el script falla en el
  paso 2. Exporta `NOTIFICATION_CHANNEL=simulated` antes de levantar el stack. Pasó una vez en esta
  sesión: el primer intento envió un correo real a una dirección inventada por el script.
