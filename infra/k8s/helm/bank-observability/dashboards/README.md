# Los nueve dashboards, como código

Uno por archivo, y el archivo es la fuente de verdad. `templates/dashboards.yaml`
los convierte en ConfigMaps etiquetados `grafana_dashboard: "1"`, y el sidecar de
Grafana los carga al arrancar y en caliente.

| Archivo | Dashboard | Qué responde |
| --- | --- | --- |
| `00-estado-del-sistema.json` | Estado del sistema | ¿está bien el banco ahora mismo? Los cuatro SLO, el throughput que les da sentido y los 5xx |
| `01-metricas-clave-sli.json` | Métricas clave (SLI) | latencias en percentiles, throughput por cola, el proveedor externo, KYC y cuentas |
| `02-slo-error-budget.json` | SLO y error budget | ¿cuánto margen queda y a qué velocidad se gasta? |
| `03-errores-en-tiempo-real.json` | Errores en tiempo real | qué está fallando, de la métrica a la línea de log |
| `04-flujo-de-trazas.json` | Flujo de trazas | la Saga completa, con sus compensaciones, en una traza |
| `05-consumer-lag.json` | Consumer lag del broker | qué cola se atasca y si su consumidor está lento o ausente |
| `06-plataforma-cpu-memoria-hpa.json` | CPU, memoria, pods y HPA | la evidencia de autoescalado bajo carga |
| `07-logs.json` | Logs | búsqueda por `correlationId` y `traceId`, con salto a la traza |
| `08-banco-pareja.json` | Banco pareja | la dependencia externa y si reaccionamos bien a sus fallos |

Los ocho primeros son los que §4.1 enumera como obligatorios; el de logs sale de
la observabilidad que §4.1 pide a Notification & Audit.

## Editarlos

1. Toca el JSON de este directorio, no la interfaz. **Un dashboard editado en
   Grafana se pierde en el siguiente `helm upgrade`**, y eso es deliberado: lo
   que no está en el repositorio no está desplegado.
2. Si quieres probar un panel con el ratón primero, hazlo y luego trae el JSON:
   *Dashboard → Export → Save to file*, y pega sólo el panel que cambió.
3. `pnpm obs:check:dashboards` antes de subir (también corre en CI). Falla si
   un panel cita un `slo:`/`sli:` que ninguna regla graba, una métrica que no
   está en el catálogo, una etiqueta de Loki que no se indexa o un valor que el
   código no emite — que son los errores que no dan error: el panel sale vacío
   para siempre y parece que no hay datos.
4. `pnpm obs:kind` si cambiaste una consulta: ejecuta **cada** consulta de los
   nueve dashboards contra un stack en kind con productores falsos y falla si
   alguna sale vacía.

## Convenciones

- **Una variable `$environment`** en todos, enlazada a `label_values(environment)`.
  Un panel que suma `dev` y `prod` no es el panel de ninguno de los dos.
- **Las consultas leen reglas grabadas** (`slo:…`, `sli:…`), no expresiones
  crudas. El SLI se define una vez, en `values.yaml`, y el panel, la alerta y el
  error budget leen la misma serie.
- **Percentiles, nunca promedios**, para cualquier latencia.
- **Los despliegues se dibujan como anotaciones** en los nueve, con una consulta
  sobre `kube_replicaset_created`: un ReplicaSet nuevo sólo nace cuando cambia
  la plantilla del pod, así que marca rollouts y no escalados. Hasta T-60 era
  `kube_deployment_metadata_generation`, que sube también cada vez que el HPA
  escala. `cd.yml` añade la anotación de *release* con la versión, por
  `port-forward` a Grafana desde el job de producción.
- **Loki se filtra sólo por sus tres etiquetas indexadas**: `service_name`,
  `deployment_environment` y `k8s_namespace_name`. Todo lo demás (`level`,
  `correlationId`, `traceId`, `environment`) es metadato estructurado y va
  después de un `|`. Un selector `{environment="prod"}` no da error: no
  encuentra nada.
- **Los valores de etiqueta se escriben como los emite el código**: `result`,
  `outcome`, `operation`… en minúsculas (`failed`, no `FAILED`).
- El nombre del servicio se filtra por `service_name`, nunca por `job`: el
  Collector renombra el suyo a `exported_job`.
