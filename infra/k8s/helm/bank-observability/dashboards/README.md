# Los nueve dashboards, como código

Uno por archivo, y el archivo es la fuente de verdad. `templates/dashboards.yaml`
los convierte en ConfigMaps etiquetados `grafana_dashboard: "1"`, y el sidecar de
Grafana los carga al arrancar y en caliente.

| Archivo | Dashboard | Qué responde |
| --- | --- | --- |
| `00-estado-del-sistema.json` | Estado del sistema | ¿está bien el banco ahora mismo? los grupos SLO operativos, el throughput que les da sentido y los 5xx |
| `01-metricas-clave-sli.json` | Métricas clave (SLI) | latencias en percentiles, throughput por cola, el proveedor simulado, KYC y cuentas |
| `02-slo-error-budget.json` | SLO y error budget | ¿cuánto margen queda y a qué velocidad se gasta? |
| `03-errores-en-tiempo-real.json` | Errores en tiempo real | qué está fallando, de la métrica a la línea de log |
| `04-flujo-de-trazas.json` | Flujo de trazas | la Saga completa, con sus compensaciones, en una traza |
| `05-consumer-lag.json` | Consumer lag del broker | qué cola se atasca y si su consumidor está lento o ausente |
| `06-plataforma-cpu-memoria-hpa.json` | CPU, memoria, pods y HPA | la evidencia de autoescalado bajo carga |
| `07-logs.json` | Logs | búsqueda por `correlationId` y `traceId`, con salto a la traza |
| `08-banco-pareja.json` | Banco pareja | la dependencia externa y si reaccionamos bien a sus fallos |

Las nueve vistas cubren estado, métricas, SLO, errores, trazas, colas,
plataforma, logs y dependencia interbancaria. Su correspondencia con §4.1 no
implica que cada panel tenga tráfico en toda ventana.

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
- **Y una oculta, `$namespace`**, para lo que se filtra por namespace (pods,
  réplicas, HPA, la anotación de despliegues). Sale de la regla
  `sli:namespace_environment:info`: en la nube el namespace se llama como el
  entorno, pero en kind el entorno `local` vive en `bank-usac`, y
  `namespace=~"$environment"` dejaba esos paneles vacíos en local.
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
- **Los valores se escriben como los emite cada instrumento**: resultados
  de Saga/proveedor en minúsculas (`failed`); tipos de cuenta `AHORRO`/`MONETARIA`
  y severidad de evento `INFO`/`WARNING`/`ERROR` en mayúsculas. La severidad
  de alerta Grafana es `critical`/`warning`/`info`. Ver catálogo.
- El nombre del servicio se filtra por `service_name`, nunca por `job`: el
  Collector renombra el suyo a `exported_job`.

## Evidencia de las nueve vistas

Las capturas de GKE, sus filtros y ventanas están en
[el informe cloud](../../../../../docs/qa/backend/T-60-cloud-evidence.md).
No sustituir `No data` por cero: varias vistas dependen de tráfico en la
ventana. La comparación local/cloud (retención, PVC y acceso) se documenta en
[despliegue](../../../../../docs/architecture/deployment.md).

## Interpretación de ventanas y cobertura

Hay **71 recording rules** y **16 alertas** en los values actuales. El budget
cloud usa siete días desde incrementos de contadores, no el promedio de ratios.
Una serie nueva con `[7d]` sólo aporta su historia existente. Sin tráfico,
“No data” no es cumplimiento; los targets y la exportación se revisan aparte.

El proxy de duración Saga incluye todos los cierres y omite pendientes; los
comandos HTTP usan el bucket conservador 2.5 s por faltar 3 s. El p95 saliente
interbancario excluye timeouts y el contador no duplica una aceptación tardía
ya contada como timeout. Las limitaciones están en
[SLO §5.3](../../../../../docs/sre/sli-slo-sla.md#53-los-slo-que-la-fase-3-mide-con-datos-reales-t-58).
No modificar consultas o umbrales sólo para que una captura salga verde.
