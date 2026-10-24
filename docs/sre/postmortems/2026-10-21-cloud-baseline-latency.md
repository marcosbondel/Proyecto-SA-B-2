# Cloud dev — Latencia del seguimiento en carga base

**Fecha:** 21/oct/2026 GT; timestamps UTC del 22/oct. **Tipo:** experimento
autorizado de entrega académica, entorno dev GKE. Producción observada en
lectura. **Responsable de seguimiento:** Marcos Bonifasi / #167.

## Impacto observado

k6 p95 5807.6ms, umbral <5000ms cruzado; servidor p95 4.838s. No demuestra por sí solo incumplimiento del SLO interno.

Todas las muestras del monitor productivo dieron Ready; es una muestra
periódica, no prueba de disponibilidad continua. No hubo compensaciones SQL
manuales ni truncados. El total de las cuentas de prueba se mantuvo en
330000 centavos GTQ antes/después.

## Línea temporal

| UTC | Acción observada |
| --- | --- |
| 2026-10-22T04:28:33.059Z | start |
| 2026-10-22T04:29:56.549Z | load-finished |
| 2026-10-22T04:30:41.551Z | after-drain |
| 2026-10-22T04:30:42.385Z | finish |

## Causa y recuperación

El polling y los relojes/muestras difieren; no se aisló una causa única. Correlacionar cola, CPU, spans y ruta de seguimiento antes de atribuirlo a un servicio.

Se esperaron 45s para drenar; la simulación de proveedor fue restaurada a
0/0/0 en el finally de su escenario. Kubernetes administra réplicas y
reposición; no se dejó un HPA deshabilitado ni un manifiesto modificado.

## Evidencia y límites

[Salida k6](../../qa/load/2026-10-21-baseline/k6-output.txt),
[timeline](../../qa/load/2026-10-21-baseline/timeline.json),
[estado monetario](../../qa/load/2026-10-21-baseline/state.json),
[muestras plataforma](../../qa/load/2026-10-21-baseline/platform-samples.json),
[cuantiles del servidor](../../qa/load/2026-10-21-window-metrics.json) y
[informe cloud](../../qa/backend/T-60-cloud-evidence.md).

![Plataforma dev](../../images/fase3/observability/03-plataforma-hpa-dev.jpg)

Los conteos SQL usan además una ventana con 10s de margen al inicio y guardan
el conteo exacto sin margen. No son una prueba de Chaos Engineering de todas
las dependencias. No se observaron aquí tiempos firing/resolved de una alerta;
no se inventa una duración de indisponibilidad ni consumo exacto del budget.

## Acciones

Investigar diferencia cliente/servidor y repetir con IDs y reloj documentados; no relajar el umbral para ocultar el resultado.
