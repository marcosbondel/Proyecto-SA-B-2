# Catálogo de telemetría — Bank USAC

Una fila por señal que el sistema emite: su nombre en OpenTelemetry, su tipo,
su unidad, **las etiquetas que tiene permitidas** y por qué cada una no
multiplica las series. Es el documento que el enunciado pide **antes** de
implementar (§6, Paso 2) y la fuente única de la que T-50 construye las
*recording rules*, los paneles y las alertas.

Lo que **no** es: una descripción de cómo se obtuvo cada número. Eso está en los
anexos de [`sli-slo-sla.md`](sli-slo-sla.md), uno por ticket (T-43 a T-48), y no
se repite aquí.

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

Por eso el sistema tiene **tres planos y cada identificador vive en uno solo**:

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
`.record(`, y **falla si aparece una que no esté en este catálogo**. Añadir una
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

El Gateway **no declara métricas propias**: su latencia y su disponibilidad
salen de la instrumentación HTTP, con convenciones semánticas estables
(`@opentelemetry/instrumentation-http` 0.223.0 emite
`http.server.request.duration`, verificado en el paquete instalado).

| Métrica | Tipo | Unidad | Etiquetas | En Prometheus |
| --- | --- | --- | --- | --- |
| `http.server.request.duration` | Histogram | `s` | `http.request.method`, `http.response.status_code`, `http.route` | `http_server_request_duration_seconds` |
| `http.client.request.duration` | Histogram | `s` | `http.request.method`, `http.response.status_code`, `server.address` | `http_client_request_duration_seconds` |

`http.route` es la **plantilla** de la ruta (`/api/accounts/:id`), no la URL con
el identificador dentro: veinticinco rutas, no una por cuenta. Los sondeos
`/health` y `/ready` quedan fuera de las consultas de disponibilidad: los pide
el kubelet cada pocos segundos y diluirían la medida con tráfico que no es de
ningún cliente.

### 2.3 Customer Service (T-41)

| Métrica | Tipo | Unidad | Etiquetas | En Prometheus |
| --- | --- | --- | --- | --- |
| `bank.customer.kyc.decisions` | Counter | `{decision}` | `result` (`verified` · `rejected`), `path` | `bank_customer_kyc_decisions_total` |
| `bank.customer.kyc.time_to_decision` | Histogram | `s` | `path` | `bank_customer_kyc_time_to_decision_seconds` |
| `bank.customer.registration.refusals` | Counter | `{registration}` | `reason` | `bank_customer_registration_refusals_total` |

`path` es por dónde entró el cliente (autoservicio o ventanilla). Los *buckets*
del histograma llegan a siete días a propósito: una verificación de identidad
puede tardar lo que tarde una persona, y los *buckets* por defecto se detienen
en diez segundos, lo que dejaría todo en el último y haría el p95 ilegible.

**Verificados contra rechazados**, que es la métrica que pide §4.1, es una
consulta sobre `result`, no dos contadores.

### 2.4 Account Service (T-42)

| Métrica | Tipo | Unidad | Etiquetas | En Prometheus |
| --- | --- | --- | --- | --- |
| `bank.account.operations` | Counter | `{operation}` | `account_type` (`AHORRO` · `CORRIENTE`), `operation` (`debit` · `credit`) | `bank_account_operations_total` |
| `bank.account.anomalies` | Counter | `{anomaly}` | `account_type`, `rule` (`HIGH_FREQUENCY`) | `bank_account_anomalies_total` |

Cuatro series para el primero y dos para el segundo. **El `accountId` no está**:
va al span `account.activity anomaly` y a la línea de log, que es donde §4.1
dice que se consulta el detalle por cuenta.

### 2.5 Transaction Service (T-43)

| Métrica | Tipo | Unidad | Etiquetas | En Prometheus |
| --- | --- | --- | --- | --- |
| `bank.transfer.started` | Counter | `{transfer}` | — | `bank_transfer_started_total` |
| `bank.transfer.finished` | Counter | `{transfer}` | `result`, `reason` | `bank_transfer_finished_total` |
| `bank.transfer.duration` | Histogram | `s` | `result` | `bank_transfer_duration_seconds` |

`result` ∈ `COMPLETED` · `FAILED` · `COMPENSATED`: los tres estados finales de
la máquina de seis. `reason` es un conjunto cerrado de motivos de cierre. Los
límites de *bucket* están densos alrededor de los cinco segundos porque **SLO-2
se lee exactamente en `le="5"`**: un histograma sólo responde "¿cuántas bajo
cinco segundos?" si hay un límite justo ahí.

### 2.6 Payment Service — proveedor simulado (T-44)

| Métrica | Tipo | Unidad | Etiquetas | En Prometheus |
| --- | --- | --- | --- | --- |
| `bank.payment.provider.calls` | Counter | `{call}` | `result`, `source` | `bank_payment_provider_calls_total` |
| `bank.payment.provider.duration` | Histogram | `s` | `result` | `bank_payment_provider_duration_seconds` |
| `bank.payment.simulation.changes` | Counter | `{change}` | `action` | `bank_payment_simulation_changes_total` |

`source` dice **quién decidió** el resultado: la escalera normal o una
simulación fijada por un administrador. Es lo que permite distinguir un fallo
externo real de uno inyectado para una prueba, y sin ella la *tasa de fallos
externos* mezclaría las dos cosas.

### 2.7 Payment Service — interbancario entrante (T-46)

| Métrica | Tipo | Unidad | Etiquetas | En Prometheus |
| --- | --- | --- | --- | --- |
| `bank.interbank.deposits` | Counter | `{deposit}` | `result` (`accepted` · `rejected`) | `bank_interbank_deposits_total` |
| `bank.interbank.deposit.duration` | Histogram | `s` | `result` | `bank_interbank_deposit_duration_seconds` |
| `bank.interbank.callbacks` | Counter | `{attempt}` | `result` | `bank_interbank_callbacks_total` |

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
clasificación que pide el enunciado: `INFO` · `WARNING` · `ERROR`.

### 2.9 Lo que no emite la aplicación

| Señal | Quién la expone | Cómo llega |
| --- | --- | --- |
| **Consumer lag** del broker | RabbitMQ con `rabbitmq_prometheus` (`:15692`) | job `rabbitmq` de Prometheus, un target por namespace con la etiqueta `environment` |
| CPU y memoria por contenedor | cAdvisor del kubelet | job `kubernetes-nodes-cadvisor` del chart |
| Pods, Deployments, réplicas y **HPA** | `kube-state-metrics` | subchart de Prometheus |
| Salud del propio Collector | su auto-telemetría en `:8888` | job del chart |

Los nombres exactos de las series de RabbitMQ (`rabbitmq_queue_messages_ready`,
`rabbitmq_queue_messages_unacked`) se confirman en kind antes de escribir la
*recording rule* del consumer lag: son del plugin, no nuestros. T-50 no debe dar
ninguno por supuesto.

### 2.10 Nombres reservados para T-47 (envío interbancario)

No existen todavía. Se reservan aquí para que el envío no invente otros ni
reutilice los del entrante — las dos direcciones se miden por separado, como
pide §4.1 (*"tasa de éxito de depósitos interbancarios (enviados y recibidos)"*):

| Métrica | Tipo | Unidad | Etiquetas previstas |
| --- | --- | --- | --- |
| `bank.interbank.sent` | Counter | `{deposit}` | `result` (`accepted` · `rejected` · `timeout` · `reversed`) |
| `bank.interbank.confirmation.duration` | Histogram | `s` | `result` |

El **número de timeouts** que pide el enunciado es
`bank_interbank_sent_total{result="timeout"}`, no un contador aparte: un
contador separado se desincroniza del total en cuanto alguien añade un estado.

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
| `payment.interbank state` | Payment | un span por cambio de estado del depósito |
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

**Lo que ninguna línea lleva**, por tipo y por `redactFields`: número de
documento, correo, fotografía, contraseña, token JWT, dirección, monto o saldo.
Las dos barreras son el tipo `LogFields` de cada componente (lo que *puede*
decir) y el barrido por nombre de campo (para cuando se derrama un objeto más
ancho).

---

## 5. Qué hacer al añadir una señal

1. Añadir su fila aquí, con unidad, etiquetas y la justificación de cardinalidad.
2. Si es una etiqueta nueva, añadirla al conjunto permitido de
   `metric-cardinality.spec.ts`, que falla hasta que esté.
3. Registrarla en la descripción del PR.
4. Si alimenta un SLI, decirlo en [`sli-slo-sla.md`](sli-slo-sla.md) §5.3.

Lo que **no** hay que hacer: añadir una etiqueta con un identificador de
entidad. El plano de las trazas y el de los logs ya responden esa pregunta, y
una serie por cuenta deja de responder las demás.
