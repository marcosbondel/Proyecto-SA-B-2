# Catálogo de telemetría — Bank USAC

Una fila por señal que el sistema emite: su nombre en OpenTelemetry, su tipo,
su unidad, **las etiquetas que tiene permitidas** y por qué cada una no
multiplica las series. Es el documento que el enunciado pide **antes** de
implementar (§6, Paso 2) y la fuente única de la que T-50 construye las
*recording rules*, los paneles y las alertas.

Revisión **2026-10-21**, contrastada con los adaptadores de telemetría y
[`@bank/observability`](../../apps/packages/observability/src/sdk.ts). Los nombres
y conjuntos se describen como los emite el código; las mediciones y sus ventanas
están en [`sli-slo-sla.md`](sli-slo-sla.md). Un nombre de instrumento no demuestra
que el Collector esté recibiéndolo en un entorno concreto.

## Cómo leer la columna de Prometheus

Las aplicaciones exportan por OTLP al Collector, y el Collector republica en
`:8889` para que Prometheus lo raspe (job `otel-gateway`). En esa conversión:

- los puntos se vuelven guiones bajos: `bank.transfer.duration` →
  `bank_transfer_duration`;
- un contador monotónico recibe `_total`;
- la unidad del instrumento se añade al nombre: `s` → `_seconds`. Una unidad
  entre llaves (`{transfer}`, `{event}`) es una pseudo-unidad y **no** se añade;
- un histograma produce `_bucket`, `_sum` y `_count`.

Ambas cosas las decide `add_metric_suffixes` del exportador
(`infra/k8s/helm/bank-observability/values.yaml`), que está en `true`.

**Tres detalles que sólo se ven consultando, y que una consulta escrita a ciegas
no sobrevive** (medidos contra el stack en kind, T-50):

| Lo que se espera | Lo que Prometheus tiene de verdad |
| --- | --- |
| `le="5"` en el bucket del histograma | **`le="5.0"`**. El Collector expone `le="5"` en su texto y la serie almacenada lleva `5.0`. Un selector `le="5"` no devuelve nada — ni error, ni cero: vacío. Por eso la regla de SLO-2 usa `le=~"5(\\.0+)?"` |
| el `job` del servicio | **`exported_job`**. El exportador del Collector pone `job=<service.name>`, y Prometheus, que ya tiene su propio `job="otel-gateway"`, renombra el ajeno. El nombre del servicio se filtra por `service_name`, nunca por `job` |
| nada más | **`otel_scope_name`, `otel_scope_version`, `otel_scope_schema_url`**. Las añade el exportador por cada *scope* de instrumentación. No son de alta cardinalidad (una por servicio), pero aparecen en todo `sum by` que no las agrupe fuera |

**Las etiquetas de recurso no se promueven.** `resource_to_telemetry_conversion`
está desactivado a propósito: habría subido *todos* los atributos de recurso,
incluido `k8s.pod.name`, que cambia en cada despliegue. En su lugar el Collector
añade exactamente dos, con un `transform`:

| Etiqueta | De dónde sale | Para qué |
| --- | --- | --- |
| `service_name` | `service.name` del recurso | separar los siete componentes |
| `environment` | `deployment.environment` del recurso | separar `dev` de `prod` en un único stack |

Toda consulta de este catálogo puede filtrar por esas dos, y ninguna otra
etiqueta de recurso existe.

---

## 1. La regla de cardinalidad

> §4.1: *"Logs de actividad con el accountId. El detalle por cuenta se consulta
> en los logs, no como etiqueta de una métrica (evitar alta cardinalidad)"*.
> Recomendaciones: *"Evitar etiquetas de alta cardinalidad (accountId,
> customerId) en las métricas"*.

Por eso el sistema tiene **tres planos; los identificadores pueden aparecer en trazas y logs**:

| Plano | Qué lleva | Cardinalidad |
| --- | --- | --- |
| **Métricas** | conjuntos cerrados: resultado, razón, tipo de cuenta, operación, severidad, cola | acotada, decenas de series |
| **Trazas** | los identificadores: `bank.account.id`, `bank.customer.id`, `bank.transfer.id`, `bank.payment.id`, `bank.correlation_id` | una traza por operación |
| **Logs** | lo mismo que la traza, más el mensaje | una línea por evento |

`bank.*.id` **existe en el código y es correcto**: son atributos de span y
campos de log. Lo que ninguna métrica puede tener es uno de ellos como etiqueta,
y eso lo hace cumplir una prueba, no la buena intención:
`apps/packages/observability/test/metric-cardinality.spec.ts` barre el código de
los siete componentes, extrae las claves de atributo de cada `.add(` y
`.record(`, y **falla si aparece una clave fuera de su allow-list estática**, sincronizada
manualmente con este catálogo. La prueba no parsea el Markdown ni valida por
sí sola los valores de las etiquetas. Añadir una
etiqueta nueva obliga a añadir su fila aquí, que es exactamente el acoplamiento
que se busca.

---

## 2. Métricas

### 2.1 Mensajería — los siete componentes (`@bank/messaging`, T-48)

El **throughput por servicio y por cola** que exige §4.1 sale de aquí, no de
cada dominio.

| Métrica | Tipo | Unidad | Etiquetas | En Prometheus |
| --- | --- | --- | --- | --- |
| `messaging.client.sent.messages` | Counter | `{message}` | `messaging.system`, `messaging.operation.name`, `messaging.destination.name`, `error.type` | `messaging_client_sent_messages_total` |
| `messaging.client.operation.duration` | Histogram | `s` | `messaging.system`, `messaging.operation.name`, `messaging.destination.name` | `messaging_client_operation_duration_seconds` |
| `messaging.client.consumed.messages` | Counter | `{message}` | `messaging.system`, `messaging.operation.name`, `messaging.destination.name`, `bank.delivery.outcome` | `messaging_client_consumed_messages_total` |
| `messaging.process.duration` | Histogram | `s` | las mismas que el contador de consumo | `messaging_process_duration_seconds` |

- `messaging.destination.name` es el **exchange** al publicar y la **cola** al
  consumir: conjuntos cerrados, declarados en `@bank/contracts/routing`. La
  *routing key* no es etiqueta: es por mensaje y va al span.
- La cola de respuesta por réplica del Gateway se reporta con una etiqueta
  **estable**, no con el nombre de la cola, que incluye el nombre del pod.
- `bank.delivery.outcome` ∈ `ack` · `retry` · `dead_letter` · `invalid` ·
  `dropped`. Cinco valores, fijados en el tipo `DeliveryOutcome`.
- `error.type` sólo aparece cuando la publicación falló, y lleva el nombre de la
  clase de error, no su mensaje.

### 2.2 HTTP — Gateway y mock (instrumentación del SDK, T-48)

El Gateway **no declara métricas de dominio propias**: su latencia y su disponibilidad
salen de la instrumentación HTTP, con convenciones semánticas estables
(`@opentelemetry/instrumentation-http` 0.223.0 emite
`http.server.request.duration`, verificado en el paquete instalado).

| Métrica | Tipo | Unidad | Etiquetas | En Prometheus |
| --- | --- | --- | --- | --- |
| `http.server.request.duration` | Histogram | `s` | `http.request.method`, `http.response.status_code`, `http.route` | `http_server_request_duration_seconds` |
| `http.client.request.duration` | Histogram | `s` | `http.request.method`, `http.response.status_code`, `server.address` | `http_client_request_duration_seconds` |

`http.route` es la **plantilla** de la ruta (`/api/accounts/:id`), no la URL con
el identificador dentro: un conjunto acotado de plantillas registradas, no una serie por cuenta. El inventario HTTP vigente está en [OpenAPI](../../apps/gateway/openapi/). Los sondeos
`/health` y `/ready` quedan fuera de las consultas de disponibilidad: los pide
el kubelet cada pocos segundos y diluirían la medida con tráfico que no es de
ningún cliente.

### 2.3 Customer Service (T-41)

| Métrica | Tipo | Unidad | Etiquetas | En Prometheus |
| --- | --- | --- | --- | --- |
| `bank.customer.kyc.decisions` | Counter | `{decision}` | `result` (`verified` · `rejected`), `path` | `bank_customer_kyc_decisions_total` |
| `bank.customer.kyc.time_to_decision` | Histogram | `s` | `path` | `bank_customer_kyc_time_to_decision_seconds` |
| `bank.customer.registration.refusals` | Counter | `{registration}` | `reason` | `bank_customer_registration_refusals_total` |

`path` ∈ `counter` · `review`: decisión de ventanilla o revisión posterior del cliente. Las negativas de registro usan los códigos cerrados `DOCUMENT_ALREADY_REGISTERED`, `EMAIL_ALREADY_REGISTERED`, `INVALID_BIRTH_DATE` y `ROLE_NOT_ELIGIBLE`. Los *buckets*
del histograma llegan a siete días a propósito: una verificación de identidad
puede tardar lo que tarde una persona, y los *buckets* por defecto se detienen
en diez segundos, lo que dejaría todo en el último y haría el p95 ilegible.

**Verificados contra rechazados**, que es la métrica que pide §4.1, es una
consulta sobre `result`, no dos contadores.

### 2.4 Account Service (T-42)

| Métrica | Tipo | Unidad | Etiquetas | En Prometheus |
| --- | --- | --- | --- | --- |
| `bank.account.operations` | Counter | `{operation}` | `account_type` (`AHORRO` · `MONETARIA`), `operation` (`debit` · `credit` · `compensation`) | `bank_account_operations_total` |
| `bank.account.anomalies` | Counter | `{anomaly}` | `account_type`, `rule` (`HIGH_FREQUENCY`) | `bank_account_anomalies_total` |

Seis combinaciones de etiquetas de dominio para el primero y dos para el segundo, por recurso/scope exportado. **El `accountId` no está**:
va al span `account.activity anomaly` y a la línea de log, que es donde §4.1
dice que se consulta el detalle por cuenta.

### 2.5 Transaction Service (T-43)

| Métrica | Tipo | Unidad | Etiquetas | En Prometheus |
| --- | --- | --- | --- | --- |
| `bank.transfer.started` | Counter | `{transfer}` | — | `bank_transfer_started_total` |
| `bank.transfer.finished` | Counter | `{transfer}` | `result`, `reason` | `bank_transfer_finished_total` |
| `bank.transfer.duration` | Histogram | `s` | `result` | `bank_transfer_duration_seconds` |

`result` ∈ **`completed` · `failed` · `compensated`**, en minúsculas; el estado persistido permanece en mayúsculas. Son los tres estados finales de la máquina de seis. `reason` es `NONE` para éxito y un conjunto cerrado de códigos de rechazo para los otros cierres; véase [el adaptador](../../apps/services/transaction-service/src/infrastructure/telemetry/otel-transfer.telemetry.ts). Los
límites de *bucket* están densos alrededor de los cinco segundos porque **SLO-2 se lee en el bucket de 5 s con `le=~"5(\\.0+)?"`**: un histograma sólo responde "¿cuántas bajo
cinco segundos?" si hay un límite justo ahí.

### 2.6 Payment Service — proveedor simulado (T-44)

| Métrica | Tipo | Unidad | Etiquetas | En Prometheus |
| --- | --- | --- | --- | --- |
| `bank.payment.provider.calls` | Counter | `{call}` | `result`, `source` | `bank_payment_provider_calls_total` |
| `bank.payment.provider.duration` | Histogram | `s` | `result` | `bank_payment_provider_duration_seconds` |
| `bank.payment.simulation.changes` | Counter | `{change}` | `action` | `bank_payment_simulation_changes_total` |

`result` ∈ `success` · `failure` · `timeout`; `source` ∈ `scenario` ·
`configuration` · `runtime`; `action` ∈ `update` · `reset` · `denied`, todos en
minúsculas. `scenario` viene del guion de la transferencia, `configuration` de
los valores de arranque y `runtime` de los ajustes persistidos por el
administrador. **Todo el proveedor de pagos de servicios es simulado**; estas
etiquetas no distinguen un proveedor real de uno simulado. El banco pareja HTTP
se mide por separado (§2.7 y §2.10).

### 2.7 Payment Service — interbancario entrante (T-46)

| Métrica | Tipo | Unidad | Etiquetas | En Prometheus |
| --- | --- | --- | --- | --- |
| `bank.interbank.deposits` | Counter | `{deposit}` | `result` (`accepted` · `rejected`) | `bank_interbank_deposits_total` |
| `bank.interbank.deposit.duration` | Histogram | `s` | `result` | `bank_interbank_deposit_duration_seconds` |
| `bank.interbank.callbacks` | Counter | `{attempt}` | `result` (`delivered` · `failed`) | `bank_interbank_callbacks_total` |

El **motivo** del rechazo (`ACCOUNT_NOT_FOUND`, `UNSUPPORTED_CURRENCY`, …) no es
etiqueta de la métrica: es atributo del span `payment.interbank state` y campo
del log. El conjunto es cerrado y pequeño, así que podría serlo; se deja fuera
porque el contrato oficial puede ampliarlo (T-56) y una etiqueta que crece con
un contrato ajeno es una etiqueta que no controlamos.

### 2.8 Notification & Audit Service (T-45)

| Métrica | Tipo | Unidad | Etiquetas | En Prometheus |
| --- | --- | --- | --- | --- |
| `bank.audit.events` | Counter | `{event}` | `family`, `severity`, `outcome`, `processing` | `bank_audit_events_total` |
| `bank.audit.notifications` | Counter | `{notification}` | `severity`, `result` | `bank_audit_notifications_total` |
| `bank.audit.alerts.received` | Counter | `{alert}` | `status`, `severity` | `bank_audit_alerts_received_total` |

`family` es la primera palabra del tipo de mensaje con un conjunto cerrado
(`customer`, `account`, `transaction`, `payment`, `alert`, `other`): un nombre
imprevisto cae en `other` y **no** crea una serie nueva. `severity` es la
clasificación de eventos que pide el enunciado: `INFO` · `WARNING` · `ERROR`
para `events` y `notifications`. En `alerts.received`, `severity` ∈ `critical` ·
`warning` · `info`, y `status` ∈ `firing` · `resolved`. Además, `outcome` ∈
`recorded` · `duplicate`; `processing` ∈ `processed` · `invalid` · `error`;
resultado de notificación ∈ `sent` · `failed` · `suppressed`. No intercambiar las
mayúsculas del nivel bancario con la severidad operativa de Grafana.

### 2.9 Lo que no emite la aplicación

| Señal | Quién la expone | Cómo llega |
| --- | --- | --- |
| **Consumer lag** del broker | RabbitMQ con `rabbitmq_prometheus` (`:15692`) | jobs `rabbitmq` y **`rabbitmq-detailed`**, targets por namespace con `environment` |
| CPU y memoria por contenedor | cAdvisor del kubelet | job `kubernetes-nodes-cadvisor` del chart |
| Pods, Deployments, réplicas y **HPA** | `kube-state-metrics` | subchart de Prometheus |
| Salud del propio Collector | su auto-telemetría en `:8888` | job del chart |

El plugin básico agrega colas y no proporciona la etiqueta `queue` necesaria
para este diagnóstico. Las reglas usan **`rabbitmq_detailed_queue_messages_ready`**
y **`rabbitmq_detailed_queue_messages_unacked`**, provenientes del endpoint
detallado, y agrupan por `environment, queue`. La disponibilidad del scrape se
comprueba antes de interpretar una ausencia como cola vacía.

### 2.10 El envío interbancario (T-47, medido desde T-51)

Se reservaron aquí antes de existir, para que el envío no inventara otros ni
reutilizara los del entrante — las dos direcciones se miden por separado, como
pide §4.1 (*"tasa de éxito de depósitos interbancarios (enviados y recibidos)"*).
**Ya existen**: los emite `payment-service` y los grafica T-50.

| Métrica | Tipo | Unidad | Etiquetas | Serie en Prometheus |
| --- | --- | --- | --- | --- |
| `bank.interbank.sent` | Counter | `{deposit}` | `result` (`accepted` · `rejected` · `timeout`) | `bank_interbank_sent_total` |
| `bank.interbank.confirmation.duration` | Histogram | `s` | `result` | `bank_interbank_confirmation_duration_seconds` |

**Tres valores de `result` y no cuatro.** La reserva preveía un `reversed`, y no
se emite: `REVERSED` es la constancia de haber devuelto un depósito que ya se
contó como `rejected` o `timeout`, así que contarlo otra vez duplicaría el
denominador de la tasa de éxito. Los estados en vuelo `PENDING` y `SENT` no cuentan. **`timeout` se cuenta al
entrar en `TIMEOUT`**, aunque éste aún no sea una decisión financiera final.
Una aceptación/rechazo posterior a ese timeout no vuelve a incrementar el
contador, para conservar un resultado por envío. Por tanto una recuperación
tardía puede dejar el ratio de éxito bajo sin significar pérdida de dinero.

El **número de timeouts** que pide el enunciado es
`bank_interbank_sent_total{result="timeout"}`, no un contador aparte: un
contador separado se desincroniza del total en cuanto alguien añade un estado.

Los límites del histograma son `[0.25, 0.5, 1, 2, 3, 5, 10, 20, 30, 60]`: densos
alrededor de los 5 s, que es el umbral de `PartnerBankSendConfirmationSlow`, y
hasta 60 s. El TTL actual del contrato es **180 s** y luego se consulta o
cancela; el timeout **no se observa en este histograma**, porque su duración es
un plazo de protocolo y no una confirmación recibida. Esto evita presentar el
p95 de respuestas como si incluyera los envíos que nunca recibieron respuesta. Un histograma sólo puede responder
«cuántas por debajo de cinco segundos» si hay una frontera exactamente ahí.

Las cuatro reglas que las consumen —la tasa, el presupuesto, el p95 y los
vencimientos— y las dos alertas `PartnerBankSend*` se añadieron en **T-51**, no
en T-47: la carga encontró que el escenario obligatorio del enunciado, el banco
pareja rechazando lo que le enviamos, no disparaba ninguna alerta porque las dos
que existían miraban sólo el entrante.

---

## 3. Nombres de span

Una traza por operación de negocio, con el `correlationId` como atributo
(`bank.correlation_id`) en todas. El `traceId` identifica la traza técnica; el
`correlationId`, el flujo de negocio — y una transferencia reintentada tiene una
correlación y posiblemente varias trazas.

| Span | Quién lo abre | Dónde encaja |
| --- | --- | --- |
| `publish <exchange>` | `@bank/messaging` | PRODUCER; inyecta el `traceparent` en los headers AMQP |
| `process <cola>` | `@bank/messaging` | CONSUMER; hijo del anterior, aunque el mensaje cruce de servicio |
| `customer.lifecycle created` · `refused` · `verified` · `rejected` | Customer | la verificación es **hija** de la creación, no un *link*: así el flujo completo de §4.1 se ve en una sola traza aunque pasen días |
| `account.activity anomaly` | Account | lleva `bank.account.id`, la regla y el umbral |
| `transfer.requested` → `transfer` → `saga.step <paso>` | Transaction | la Saga completa, con el padre reconstruido del `traceparent` guardado |
| `saga.compensation ordered` · `saga.compensation completed` | Transaction | las compensaciones que el criterio 2.2 exige ver en la traza |
| `saga.payment attempt` | Transaction | un span por escalón de la escalera |
| `payment.provider call` | Payment | con el evento `simulated_failure` cuando el fallo fue inyectado |
| `payment.interbank state` | Payment | un span por cambio de estado del depósito entrante |
| `payment.interbank send` · `payment.interbank.resolve` | Payment | estado del envío y resolución persistida de timeout; consulta, cancelación y reverso se siguen por HTTP/Undici |
| `audit.record` | Audit | el asiento de auditoría, con severidad y resultado |

---

## 4. Campos de log

Todos los componentes escriben **una línea de JSON por evento en stdout**, con
los campos en orden fijo (`@bank/observability/src/logger.ts`). El agente del
Collector los recoge del disco del nodo; ningún servicio empuja logs por red ni
por el broker.

| Campo | Origen | Obligatorio |
| --- | --- | --- |
| `timestamp` | reloj, ISO 8601 UTC | sí |
| `level` | `debug` · `info` · `warn` · `error` | sí |
| `serviceName` | el constructor del logger | sí |
| `environment` | `DEPLOYMENT_ENVIRONMENT` | sí |
| `version` | `SERVICE_VERSION`, la etiqueta de la imagen desplegada | sí |
| `correlationId` | el flujo de negocio | cuando hay uno |
| `traceId`, `spanId` | el span activo | cuando un SDK los registra |
| `message` | el texto | sí |

Un campo que el emisor no dio **se omite**, nunca va en `null`: un `traceId`
vacío se leería como una traza que alguien puede buscar.

**Redacción implementada y límites.** El logger elimina campos por nombre
(credenciales, tokens, correos, documentos, fotografías, teléfonos y direcciones)
y enmascara formas de JWT, Bearer y correo en texto. **Su deny-list no elimina
`amount` o `balance`**: los adaptadores de dominio evitan emitirlos. La
redacción de auditoría es diferente y sí sustituye montos/saldos antes del
insert. No se debe atribuir a un filtro una garantía que sólo aporta la
selección de campos del emisor.

El SDK aplica `RedactingSpanProcessor` antes del exportador: cubre atributos,
eventos, links, nombre y estado del span, y parámetros sensibles de URL. El
Collector repite la redacción en spans y sobre el cuerpo crudo de logs antes
de parsear JSON. Son defensas por nombre y forma; un nuevo campo de texto libre
requiere prueba con datos sintéticos. Fuentes:
[logger](../../apps/packages/observability/src/logger.ts),
[spans](../../apps/packages/observability/src/redaction.ts),
[auditoría](../../apps/services/notification-audit-service/src/domain/redaction.ts).

Loki indexa solamente `service_name`, `deployment_environment` y
`k8s_namespace_name`. `traceId`, `spanId`, `correlationId`, versión y demás
campos JSON son **metadatos estructurados**, no etiquetas indexadas. Consulta:

```logql
{service_name="payment-service", deployment_environment="dev"}
  | correlationId="<correlationId>"
```

### 4.1 Exportación, retención y muestreo

- El SDK se registra primero en `instrumentation.ts`; sin endpoint OTLP conserva
  contexto y logs pero no exporta métricas/trazas. `OTEL_SDK_DISABLED=true`
  desactiva el SDK. Intervalo de exportación métrica por defecto: **15 s**.
- La propagación HTTP y los headers AMQP `traceparent`/`tracestate` permiten
  reconstruir el flujo. Reintentos, un contexto inválido o un banco externo sin
  instrumentación pueden impedir que todos los spans aparezcan juntos: se
  conserva el `correlationId` para cruzar trazas.
- El código y el chart no declaran una política propia de muestreo probabilístico
  ni `tail_sampling`. No se presume una garantía de captura del 100 %; el padre
  W3C puede marcar una traza como no muestreada y un exportador puede perderla.
- Cloud configura **7 d** para métricas, logs y trazas; kind reduce Prometheus
  a **2 h** y Tempo a **24 h**. Una traza de KYC cuya creación ocurrió fuera de
  la retención puede conservar su contexto sin conservar su span inicial.
- El Collector agrega `service_name` y `environment` a las métricas de
  aplicación. Las etiquetas de infraestructura (`pod`, `node`, `queue`) vienen
  de los jobs correspondientes y no invalidan esa lista de recursos promovidos.

---

## 5. Qué hacer al añadir una señal

1. Añadir su fila aquí, con unidad, etiquetas y la justificación de cardinalidad.
2. Si es una clave de etiqueta nueva, actualizar la allow-list estática de
   `metric-cardinality.spec.ts` junto con su justificación en este catálogo.
3. Registrarla en la descripción del PR.
4. Si alimenta un SLI, decirlo en [`sli-slo-sla.md`](sli-slo-sla.md) §5.3.

Lo que **no** hay que hacer: añadir una etiqueta con un identificador de
entidad. El plano de las trazas y el de los logs ya responden esa pregunta, y
una serie por cuenta deja de responder las demás.
