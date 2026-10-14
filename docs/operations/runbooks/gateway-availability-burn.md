# GatewayAvailabilityFastBurn / GatewayAvailabilitySlowBurn

**SLO-27** — disponibilidad del API Gateway: respuestas distintas de 5xx,
objetivo **≥ 99 %** sobre 7 días corridos.

## Qué significa

No dice "el Gateway está caído". Dice que **el error budget se está gastando más
rápido de lo que la ventana admite**:

| Alerta | Umbral | Qué implica |
| --- | --- | --- |
| `…FastBurn` | burn rate > **14.4×** durante 1 h | a este ritmo el presupuesto de 7 días se agota en ~12 h. Es una caída en curso |
| `…SlowBurn` | burn rate > **6×** durante 6 h | se agota antes de cerrar la ventana. No es urgente esta hora, pero no se puede dejar pasar |

Dos ventanas porque una sola corta alerta de cada pico y una sola larga avisa
cuando el presupuesto ya se gastó.

## Cómo diagnosticarla

1. **¿Cuánto presupuesto queda?** Si es negativo, el SLO ya se incumplió en la
   ventana.
   ```promql
   slo:gateway_availability:budget_remaining7d
   ```
2. **¿Qué ruta falla?** La disponibilidad es agregada; el detalle está en la
   serie cruda.
   ```promql
   sum by (http_route, http_response_status_code) (
     rate(http_server_request_duration_seconds_count{service_name="gateway", http_response_status_code=~"5.."}[5m])
   )
   ```
3. **¿Es el Gateway o es lo que hay detrás?** El Gateway devuelve `504` con
   `REPLY_TIMEOUT` cuando un servicio no contesta en 5 s, y `503` con
   `BROKER_UNAVAILABLE` cuando no hay broker. No son el mismo incidente:
   ```promql
   sum by (service_name) (rate(messaging_client_consumed_messages_total{bank_delivery_outcome!="ack"}[5m]))
   sli:broker_consumer_lag:messages
   ```
4. **Los errores, con su causa, en los logs.** En Grafana, *Explore → Loki*:
   ```logql
   {service_name="gateway"} | level="error"
   ```
   Cada línea lleva `correlationId` y `traceId`: el botón «Ver la traza» muestra
   en qué salto se perdió la petición.
5. **¿Hay pods reiniciándose?**
   ```bash
   kubectl get pods -n prod
   kubectl get hpa -n prod
   ```

## Cómo mitigarla

- **Un servicio detrás que no responde** → mirar su `/ready`; si está en rojo
  por la base de datos o el broker, el Gateway está informando bien y el
  incidente es del servicio. El pod se recupera solo cuando su dependencia
  vuelve: el puerto abre antes de las migraciones a propósito, así que una base
  de datos ausente no provoca un bucle de reinicios.
- **Saturación** → el HPA escala al 80 % de CPU. Si está en el máximo de
  réplicas, subir `maxReplicas` del componente en `values.yaml` y desplegar por
  el pipeline. **Ojo**: `account-service` debe quedarse en **una** réplica, porque
  también corre el barrido de cuentas inactivas sin elección de líder.
- **El broker** → ver [consumer-lag.md](consumer-lag.md).
- **Un despliegue reciente** → el panel de SLO lleva los despliegues como
  anotaciones. Si la caída empieza en una de ellas, `helm rollback bank-usac -n prod`.
- **Nada de lo anterior** → declarar el incidente y abrir el postmortem (T-51).
  Un burn rate alto sin causa encontrada es exactamente lo que un postmortem
  blameless existe para explicar.

## Lo que NO hay que hacer

- Subir el umbral de la alerta para que deje de sonar. El umbral sale del error
  budget de `docs/sre/sli-slo-sla.md` §5.3; cambiarlo es cambiar el SLO, y eso
  se decide, no se silencia.
- Incluir `/health` y `/ready` en la consulta para "mejorar" el número: los pide
  el kubelet cada diez segundos y esconderían la caída real.
