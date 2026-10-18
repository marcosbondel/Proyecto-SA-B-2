# GatewayReadLatencyBreach / GatewayCommandLatencyBreach

**SLO-6** — lecturas (`GET`) del Gateway en menos de **1 s**, y **SLO-7** —
comandos (`POST`) en menos de **3 s**. Objetivo **≥ 95 %** de las peticiones
sobre 7 días corridos. Los sondeos `/health` y `/ready` no cuentan.

## Qué significa

Durante media hora, menos del 95 % de las lecturas (o de los comandos) respondió
bajo su umbral. Es lo mismo que decir que el **p95** pasó de 1 s (o de 3 s): la
alerta mira la proporción porque es lo único sobre lo que se calcula un
presupuesto.

**No** es una caída: las peticiones lentas responden. La caída la vigila
`GatewayAvailabilityFastBurn` ([gateway-availability-burn.md](gateway-availability-burn.md)).
El Gateway tiene un techo de 5 s por petición (request/reply), así que un comando
que pasa de 3 s está cerca de convertirse en un `504`.

**SLO-7 se mide contra el bucket de 2.5 s**, no de 3 s: los límites del
histograma `http.server.request.duration` son 0.005 … 1, 2.5, 5, 7.5 y 10, y no
hay uno en 3. Es una aproximación conservadora — una petición de 2.7 s cuenta
como mala —, así que esta alerta puede dispararse un poco antes de que el
objetivo real se incumpla.

## Cómo diagnosticarla

1. **Cuánto y desde cuándo.**
   ```promql
   slo:gateway_reads_under_1s:ratio_rate5m
   slo:gateway_commands_under_3s:ratio_rate5m
   sli:gateway_latency:seconds_p95
   ```
2. **Qué ruta.** La proporción es agregada; el detalle está en la serie cruda:
   ```promql
   histogram_quantile(0.95, sum by (le, http_route) (
     rate(http_server_request_duration_seconds_bucket{service_name="gateway", http_request_method="POST"}[5m])
   ))
   ```
3. **¿Espera a un servicio?** Casi toda ruta del Gateway es un request/reply por
   el broker. Si el Gateway está lento sin estar ocupado, el lento es quien
   contesta:
   ```promql
   sli:message_process:seconds_p95
   sli:broker_consumer_lag:messages
   ```
   En Tempo, el span del Gateway tiene como hijo el `publish` y, en otra parte de
   la misma traza, el `process` del servicio: la diferencia entre los dos es la
   cola.
4. **¿Es el Gateway?** CPU y réplicas en el dashboard «CPU, memoria, pods y
   HPA». Las dos rutas que componen (`GET /api/accounts`, `GET /api/dashboard`)
   esperan a varios servicios a la vez y son las primeras en subir.

## Cómo mitigarla

- **Un servicio lento detrás** → su runbook: [consumer-lag.md](consumer-lag.md)
  si es la cola, [transfer-latency.md](transfer-latency.md) si es la Saga.
- **El Gateway saturado** → el HPA escala al 80 % de CPU; si está en su máximo,
  subir `autoscaling.maxReplicas` en `infra/k8s/helm/bank-usac/values.yaml`
  (hoy 5, común a los componentes), no escalar a mano: el siguiente despliegue
  lo desharía.
- **Una sola ruta** → es un defecto de esa ruta, no del sistema: abrir el
  incidente con la traza más lenta.
