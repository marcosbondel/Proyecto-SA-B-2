# C4 L2 — Contenedores

![Contenedores](diagrams/03-c4-contenedores.png)

[Fuente PlantUML](diagrams/03-c4-contenedores.puml), [fuente DSL](diagrams/03-c4-contenedores.dsl), [modelo](diagrams/c4.dsl), [PNG ampliado](diagrams/03-c4-contenedores.png).

Diagrama optimizado con espaciado amplio (`ranksep 280`, `nodesep 160`), curvas suaves (`polyline`) y diferenciación cromática de relaciones (Azul: Ingress/HTTP, Rojo: AMQP/RabbitMQ, Azul Marino: PostgreSQL, Púrpura discontinuo: OTLP/Observabilidad, Naranja: Externos) para trazabilidad clara y sin congestión visual.

Nuxt 4/Vue 3/Nitro sirve la interfaz; su proxy llama al Gateway NestJS. Los
cinco servicios NestJS/Node 24 se comunican exclusivamente por RabbitMQ AMQP
0-9-1, con `correlationId` y `traceparent`. Cada servicio posee una base
PostgreSQL; el Gateway carece de base y dominio. Gateway deposita la foto en
MinIO S3 y Customer verifica su digest.

Payment es el único adaptador HTTP al banco externo; Notification & Audit
entrega correo por Resend. Los demás intercambios internos siguen en el broker.
La telemetría tiene otra ruta: seis cargas NestJS → Collector OTLP → Tempo y
exportador de métricas; Prometheus hace scrape del Collector, RabbitMQ,
kube-state-metrics y `/metrics` de web. El DaemonSet lee stdout JSON y envía
logs a Loki. Grafana consulta los tres almacenes y su webhook autenticado entra
por Gateway hacia auditoría. Los IDs viven en logs/trazas, no labels de métricas.

Las versiones objetivo y las observadas se distinguen: GKE usa RabbitMQ
`3.13-management`, mientras el repositorio declara `4.3.4` para otros entornos.
La ubicación física, almacenamiento, Helm y Terraform están en
[despliegue](deployment.md), no se infieren de esta vista lógica.
