# ADR-023: evolución desplegada del stack de observabilidad

- **Status**: Accepted — registra cambios existentes y separa configuración de evidencia.
- **Date**: 2026-10-21
- **Deciders**: Bank USAC team; consolidación documental T-61 (#168).
- **Supersedes in part**: [ADR-018](ADR-018-observability-stack.md), §7 y el pendiente de NetworkPolicy; conserva elección de motores, chart, separación de Collectors y ciclo de vida.
- **Related**: [ADR-020](ADR-020-slo-error-budgets.md).

## Contexto

ADR-018 decidió un chart paraguas para Collector, Prometheus, Tempo, Loki y
Grafana, con siete días de retención y Grafana accesible por port-forward.
Desde entonces el código de infraestructura incorporó Dataplane V2, políticas
opcionales, redacción de telemetría, correlación corregida y Grafana público.
Editar el razonamiento histórico de ADR-018 ocultaría ese cambio.

El comentario vigente de
[`values.yaml`](../../../infra/k8s/helm/bank-observability/values.yaml) fecha la
exposición de Grafana el **2026-10-20** para acceso del evaluador desde su
navegador. Este ADR registra esa razón escrita en el repositorio; no supone
una evaluación de riesgo o aprobación distinta no conservada.

## Estado documentado

- **Terraform:** `infra/terraform/gcp/gke.tf` configura
  `datapath_provider = "ADVANCED_DATAPATH"`. El clúster es zonal; no se deduce
  alta disponibilidad multizona de sus tres nodos.
- **Helm:** `bank-observability` sigue separado de `bank-usac`, en namespace
  `observability`, para `dev` y `prod`. Las dependencias fijadas y archivadas
  son dos instancias del chart Collector 0.176.0, Prometheus 29.36.2, Tempo
  1.24.4, Loki 7.3.0 y Grafana 10.5.15. Son **versiones de chart**, no una
  afirmación de la imagen que ejecuta cada pod.
- **Métricas y trazas:** `otel-gateway` recibe OTLP gRPC/HTTP (4317/4318),
  entrega trazas a Tempo y expone métricas en 8889 para Prometheus. El agente
  DaemonSet lee logs del nodo y envía OTLP HTTP a Loki. Logs no viajan por AMQP.
- **Retención y discos:** Prometheus 7 d, Tempo 168 h y Loki 168 h; PVC de
  10 GiB por almacén y 2 GiB para Grafana. Kind sobrescribe Prometheus a
  2 h y Tempo a 24 h; las conclusiones de una corrida local quedan delimitadas.
- **Acceso:** Grafana usa **LoadBalancer puerto 80**, autenticación de usuario,
  Secret `grafana-admin` y sin TLS en el endpoint de entrega. Los motores y
  OTLP usan Services `ClusterIP`. Port-forward sigue siendo una vía operativa,
  pero ya no es la única ni se afirma que Grafana carezca de IP pública.
- **Correlación:** Loki usa `service_name`, `deployment_environment` y namespace
  como etiquetas indexadas; identificadores como metadatos. Los enlaces de
  log→traza y correlación escapan variables de provisioning; los dashboards
  separan entorno métrico de namespace local.
- **Redacción:** SDK antes del exportador y Collector antes de almacenar;
  agente sobre cuerpo crudo antes de parsear JSON. Hay nueve dashboards y
  dieciséis alertas provisionados como código, con resolución hacia Audit.

Fuentes: [Chart.yaml](../../../infra/k8s/helm/bank-observability/Chart.yaml),
[values](../../../infra/k8s/helm/bank-observability/values.yaml),
[overrides de kind](../../../infra/k8s/kind/observability.values.yaml) y
[GKE](../../../infra/terraform/gcp/gke.tf).

## Seguridad: capacidad configurada y aislamiento aplicado

Las nueve NetworkPolicies están en una plantilla condicionada por
`networkPolicies.enabled`, cuyo default es **false**. Dataplane V2 habilita
su aplicación y está activo en el clúster consultado; no crea las políticas
ni demuestra que un selector coincida.
La inspección read-only del clúster del **2026-10-21** encontró **cero políticas
en `observability`, `dev` y `prod`**. Se conserva explícitamente esa brecha:
no se afirma cerrado el acceso de cualquier pod a stores/Collectors.

Activarlas requiere comprobar selectores, entrada OTLP, consulta de Grafana,
scrape de Prometheus, API server, DNS y entrega del webhook, además de una
prueba de acceso denegado. La plantilla deja egress de Prometheus abierto y
`apiServerCidr: 0.0.0.0/0` como defecto: incluso habilitada no implica que toda
salida sea mínima. Esta actualización documental no aplica políticas.

## Consecuencias operativas

1. El evaluador puede entrar directamente a Grafana. A cambio hay una consola
   administrativa expuesta por HTTP: las credenciales deben transmitirse fuera
   de los artefactos públicos. La cuarta IP ya se utiliza; la observación de
   cuota de ADR-018 es histórica.
2. La autenticación de Grafana no protege consultas directas a stores desde un
   pod sin aislamiento. La redacción reduce exposición accidental, no prueba
   que cada texto libre futuro esté limpio.
3. Un PVC protege frente a ciertos reemplazos de pod, pero no demuestra
   replicación, restauración, RPO cero o durabilidad porcentual. Reinstalar,
   borrar claims o perder la zona requiere un plan de recuperación propio.
4. Con siete días de retención hay que capturar/exportar evidencia y postmortem
   antes de su vencimiento. Una URL de traza no conserva su contenido.
5. Los textos viejos de `NOTES.txt` y el mensaje de `cd.yml` que dicen que
   Grafana no usa LoadBalancer contradicen los values. Se registran como
   discrepancia de implementación y se entregan a #167; T-61 no modifica esos
   archivos de configuración.

## Validación y alternativas

La inspección del 2026-10-21 encontró nueve pods de observabilidad Ready,
Grafana LoadBalancer y los cuatro PVC Bound con `standard-rwo`. Es una
instantánea de salud, no prueba de retención completa, entrega de cada alerta
ni aislamiento por red. Inventario conservado: [observabilidad](../../qa/load/2026-10-21-gke-observability-inventory.txt),
[producción](../../qa/load/2026-10-21-gke-prod-inventory.txt) y
[desarrollo](../../qa/load/2026-10-21-gke-dev-inventory.txt). La ausencia de
NetworkPolicies se verificó en una consulta separada; no se deduce de la lista
de Services/PVC. Cada afirmación posterior debe conservar comandos, fecha y
versión en la evidencia de cloud.

Port-forward conserva una superficie pública menor, pero no describe el acceso
actual aprobado para la entrega. Un segundo stack por entorno seguiría
introduciendo coste y operación adicionales. Introducir TLS, autenticación en
stores, políticas activas o backup es un cambio operativo que requiere su
validación; no se presenta como realizado por corregir este documento.
