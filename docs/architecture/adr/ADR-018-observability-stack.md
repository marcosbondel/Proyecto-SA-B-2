# ADR-018: Collector, Prometheus, Tempo, Loki y Grafana en un chart propio, con los subcharts versionados

- **Status**: Accepted — parcialmente sustituida por [ADR-023](ADR-023-observability-evolution.md) (2026-10-21): exposición de Grafana y evolución de NetworkPolicy. El texto siguiente conserva la decisión de 2026-10-13.
- **Date**: 2026-10-13
- **Deciders**: Bank USAC team
- **Assignment reference**: Fase III (`docs/references/780_Proyecto_3_2S2026.pdf`), §4.2
  *alcance obligatorio* — "Despliegue de un OpenTelemetry Collector en el cluster",
  recolección de métricas, logs y trazas, "ELK (Elasticsearch, Logstash, Kibana) **o** Loki +
  Grafana", "Visualización de métricas, logs y trazas con dashboards versionados como código";
  §4.2 *Restricciones* — "No desplegar manualmente el stack de observabilidad (misma regla de la
  Fase 2)"; §4.2 *Consideraciones de costo* — "Elasticsearch requiere bastante memoria; se
  recomienda Loki por su menor consumo", "Configurar la retención de datos (por ejemplo, 7
  días)"; §4.3 — Collector, Prometheus (o Mimir/VictoriaMetrics), Jaeger **o** Tempo, ELK **o**
  Loki, Grafana **o** Kibana, todos `Obligatorio`; §8.3 — "Despliegue manual del stack de
  observabilidad: 25 %" y "Logs no centralizados: 25 %".
- **Ticket**: T-49 (#136)

## Context

El código ya está instrumentado. T-41 a T-45 emitieron las métricas y los spans de los cinco
servicios, T-48 añadió `@bank/observability` —el SDK, el formato JSON de log y la propagación
del contexto W3C por las propiedades AMQP— y el Gateway participa como cualquier otro
componente. Nada de eso se ve: `OTEL_EXPORTER_OTLP_ENDPOINT` está vacío, y el SDK registra y
descarta, que es su comportamiento documentado cuando no hay a dónde exportar.

Lo que falta es el destino. Y la decisión no es sólo "qué motores", porque el enunciado deja
elegir entre dos pilas completas (ELK o Loki, Jaeger o Tempo, Prometheus o compatibles) y
penaliza aparte **cómo** se despliegan. Tres restricciones acotan la respuesta antes de empezar:

1. **No caben más nodos.** La cuota de `us-central1` en este proyecto da `INSTANCES = 8`, y el
   sistema ya usa ocho: cinco VMs de PostgreSQL y tres nodos de GKE. El stack tiene que caber en
   los tres nodos que existen — 6 vCPU y 24 GiB en total, de los que las dieciocho cargas de
   `dev` y `prod` ya piden 900 m.
2. **Queda una sola IP pública.** `IN_USE_ADDRESSES = 4`, y Cloud NAT, el Gateway de `prod` y el
   de `dev` usan tres. La cuarta es margen de la entrada del banco, no una consola.
3. **Un despliegue manual cuesta un 25 %**, así que el stack es parte del pipeline o no cuenta.

## Decision

### 1. Loki, no ELK

El enunciado recomienda Loki y da el motivo (memoria), y aquí la recomendación es una
obligación: un Elasticsearch de un nodo pide del orden de 2 GiB de heap y un `vm.max_map_count`
que en GKE hay que tocar con un DaemonSet privilegiado, más Logstash y Kibana. Loki en modo
`SingleBinary` con almacenamiento de fichero son **un pod y un disco**, 150 m de CPU y 512 MiB.

Hay además una razón que no es el coste. Loki 3.x guarda **metadatos estructurados**: campos
consultables que no son etiquetas. Eso resuelve exactamente el problema que el enunciado plantea
dos veces — poder buscar por `traceId` y por `correlationId` (§4.1) sin crear etiquetas de alta
cardinalidad (§4.2, *Recomendaciones*). Con una etiqueta por transferencia habría una serie por
transferencia; con metadato estructurado hay una consulta (`| traceId="…"`) y ninguna serie.

### 2. Tempo, no Jaeger

Por la misma forma: `grafana/tempo` en modo binario único es un StatefulSet, y su almacenamiento
es el mismo disco que ya hay que pedir. Jaeger habría traído su propia interfaz, que se solapa
con Grafana, y su propio almacén.

Lo que decide, más que el tamaño, es la **correlación**. Grafana nativo enlaza las tres señales
en los dos sentidos cuando los tres datasources son suyos: de un log a su traza
(`derivedFields`), de un span a sus logs (`tracesToLogsV2`) y de una métrica a una traza de
ejemplo (`exemplarTraceIdDestinations`). El enunciado pide literalmente "Navegación desde un log
hacia su traza"; con Jaeger habría que mantener ese salto a mano.

### 3. Un chart propio, con los subcharts **versionados en el repositorio**

`infra/k8s/helm/bank-observability/` es un chart paraguas cuyas seis dependencias son los charts
oficiales, con la versión fijada en `Chart.yaml`, el digest en `Chart.lock` y los `.tgz`
**commiteados** en `charts/`.

Lo que escribe este repositorio es todo lo que codifica una decisión nuestra: la configuración
de los dos Collectors, el mapeo de atributos a etiquetas, la retención, el dimensionado y los
datasources. Reimplementar Prometheus o Loki a mano habría sido más código y peor.

Versionar los `.tgz` cuesta 372 KB y compra que **el despliegue no dependa de que los
repositorios de Grafana, Prometheus y OpenTelemetry respondan**. El día de la calificación eso
vale más que el espacio. Por eso ni `ci.yml` ni `cd.yml` ejecutan `helm dependency build`: ese
comando refresca el índice por red y devolvería la dependencia que se quiso quitar. Lo que sí
corren es `infra/k8s/scripts/check-chart-deps.sh`, que comprueba sin red que `Chart.yaml`,
`Chart.lock` y `charts/` concuerden — porque `helm lint` y `helm template` renderizan
felizmente con el `.tgz` viejo y no dirían nada.

### 4. Dos Collectors, no uno

- **`otel-gateway`** (Deployment, una réplica) recibe OTLP de los siete componentes, manda las
  trazas a Tempo y publica las métricas en `:8889` para que Prometheus las raspe.
- **`otel-log-agent`** (DaemonSet) lee `/var/log/pods` del nodo y manda los logs a Loki por
  OTLP.

La separación la pide el enunciado, aunque no con estas palabras: "Recolectar los logs de todos
los servicios mediante un agente de infraestructura […] Los servicios no envían sus logs a este
microservicio por el broker" (§4.1, Notification & Audit Service). Un agente tiene que estar en
cada nodo porque los ficheros son del nodo; un receptor de OTLP no, y replicarlo por nodo sería
pagar tres veces por lo mismo.

Hay una consecuencia de diseño que conviene nombrar: **las aplicaciones no exportan logs por
OTLP**. `@bank/observability` los escribe en stdout y no sabe que el agente existe. Un servicio
que empujara sus logs por red sería más lento cada vez que el almacén lo fuera, y mudo cuando
estuviera caído — y el log que más importa es el de un fallo, que es justo cuando el almacén
puede estar en apuros.

### 5. Un solo stack para `dev` y `prod`

Los dos namespaces mandan su telemetría al mismo Collector y se miran en el mismo Grafana,
separados por el atributo `deployment.environment` que cada pod ya trae (T-48). El enunciado lo
pide así — "la telemetría debe identificar el entorno", no "un stack por entorno" — y con la
cuota de nodos de este proyecto no caben dos de todas formas. La ventaja real es poder comparar
un incidente entre entornos sin cambiar de pestaña.

De ahí se sigue que el stack se despliega **sólo desde `main`**, y no desde `develop` como el
resto del CD. Si `develop` pudiera actualizarlo, un commit de desarrollo cambiaría el monitoreo
de producción: la misma clase de problema que TD-070, pero ésta sí se evita sin coste. Para
iterar sin merge está `workflow_dispatch` con la entrada `deploy_observability`.

### 6. Las etiquetas son una lista cerrada, en dos sitios

El enunciado prohíbe las etiquetas de alta cardinalidad y el código ya no las emite. El stack
añade la segunda barrera, y en los dos casos es una lista escrita a mano y no una conversión
automática:

- **Métricas**: un procesador `transform/metric_labels` copia exactamente `service.name` y
  `deployment.environment` a los puntos de datos. La alternativa del Collector,
  `resource_to_telemetry_conversion`, habría subido *todos* los atributos de recurso — incluido
  `k8s.pod.name`, que cambia en cada despliegue y multiplica las series por el número de pods
  que han existido.
- **Logs**: `limits_config.otlp_config` de Loki indexa como etiqueta `service.name`,
  `deployment.environment` y `k8s.namespace.name`, con `ignore_defaults: true`. Todo lo demás
  —`traceId`, `spanId`, `correlationId`, `version`— queda como metadato estructurado.

### 7. Retención de 7 días, y Grafana sin IP pública

Siete días en los tres almacenes, con 10 GiB de disco cada uno (2 GiB Grafana). Cubre la ventana
de una prueba de carga y su postmortem sin pagar por historia que nadie va a leer, y es el
ejemplo que da el propio enunciado.

Grafana es `ClusterIP` y se alcanza por `kubectl port-forward`. No es austeridad: es que la
cuota deja una IP libre y exponer la consola que lo ve todo —sin TLS, porque no hay certificado
en este clúster— es un intercambio malo cuando el acceso que hace falta es el de tres personas.

## Consequences

**Lo que esto habilita.** El criterio 2.1 de la rúbrica deja de ser "instrumentación que no
exporta": `cd.yml` pone `OTEL_EXPORTER_OTLP_ENDPOINT` por defecto al Collector del clúster, así
que nadie tiene que acordarse de una variable para que haya telemetría. T-50 tiene dónde poner
los dashboards (el sidecar recoge cualquier ConfigMap etiquetado `grafana_dashboard: "1"`) y las
reglas (`prometheus.serverFiles`). T-51 tiene dónde ver el HPA y el consumer lag.

**El presupuesto gastado.** 820 m de CPU y 3 008 MiB de memoria en requests, 32 GiB de disco y
doce pods. Sobre los tres nodos que existen quedan unos 2,8 vCPU libres para que el HPA escale
durante las pruebas de carga de T-51. Si no alcanza, la salida **no** es un cuarto nodo —la
cuota no lo permite— sino subir el tipo de máquina o pedir el aumento de `INSTANCES`.

**Lo que queda abierto.**

- El chart de Tempo escribe en su `Service` los puertos de Zipkin, OpenCensus y los OTLP
  heredados con valores fijos, sin mirar la configuración de receptores, y su helper
  desreferencia `receivers.jaeger` sin comprobar si existe. Son puertos `ClusterIP` en un
  clúster privado; se deja así y se registra como deuda en vez de pelearse con el chart.
- No hay `NetworkPolicy` que limite quién habla con Tempo, Loki y Prometheus dentro del
  clúster. Para que una política se **aplique** en GKE hace falta Dataplane V2, que es un cambio
  del clúster, y el clúster todavía no existe; se decide cuando se recree.
- Alertmanager está apagado a propósito: alerta Grafana Alerting (T-50), con su runbook por
  alerta. Dos sistemas de alertas compitiendo es la forma más segura de que una alerta real se
  pierda entre dos consolas.

## Alternatives considered

| Alternativa | Por qué no |
| --- | --- |
| **ELK en vez de Loki** | Un Elasticsearch de un nodo no cabe en los tres nodos disponibles junto a Prometheus, Tempo y dieciocho pods de aplicación. El enunciado además recomienda Loki por coste, y Loki da metadatos estructurados, que es lo que hace consultable el `traceId` sin crear una serie por transferencia. |
| **Jaeger en vez de Tempo** | Trae su propia interfaz, que se solapa con Grafana, y su propio almacén. Con los tres datasources en Grafana la correlación log ↔ traza ↔ métrica es configuración; con Jaeger es trabajo. |
| **`kube-prometheus-stack` en vez de `prometheus`** | Trae el Prometheus Operator, Alertmanager, Grafana y decenas de reglas y dashboards por defecto. Habría dado dashboards "gratis" que la rúbrica llamaría decorativos, un segundo Grafana que chocaría con el nuestro, y un operador que no hace falta para un Prometheus. |
| **Los subcharts por referencia, con `helm dependency update` en el pipeline** | Es lo normal, y mete tres repositorios de terceros en el camino crítico de un despliegue. 372 KB compran que el despliegue del día de la calificación no dependa de que respondan. |
| **El stack dentro del chart `bank-usac`** | Haría que cada despliegue de la aplicación —uno por push a `develop`— reinstalara Prometheus, Tempo y Loki, y que el stack se duplicara por namespace. Son dos ciclos de vida distintos: el stack cambia cuando cambia la observabilidad, no cuando cambia un servicio. |
| **Un stack por entorno** | No cabe en la cuota, y obliga a mirar en dos Grafanas para comparar un incidente entre `dev` y `prod`. El atributo `deployment.environment` ya los distingue. |
| **Grafana por `LoadBalancer`** | Consumiría la última IP pública de la cuota —el margen de la entrada del banco— para exponer sin TLS la consola que ve todo el sistema, a un público de tres personas. |
| **Un exportador de RabbitMQ aparte** | `prometheus-community/prometheus-rabbitmq-exporter` lleva el appVersion en 1.0.0. RabbitMQ publica sus propias métricas con el plugin `rabbitmq_prometheus`, que viene en la imagen y sólo hay que habilitar: un pod menos, una versión menos que seguir, y las métricas vienen del broker y no de alguien que le pregunta. |
