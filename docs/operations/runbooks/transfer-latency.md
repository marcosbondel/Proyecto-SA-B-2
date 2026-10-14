# TransferLatencyBreach

**SLO-2** — transferencias que terminan en menos de **5.0 s**, objetivo
**≥ 95 %** sobre 7 días corridos.

## Qué significa

Más del 5 % de las transferencias tarda más de cinco segundos en alcanzar un
estado final. **No** significa que se haya perdido dinero: una transferencia
lenta sigue siendo correcta, y una que falla acaba en `COMPENSATED` con el saldo
devuelto. Lo que se degradó es la experiencia, y el tiempo extra es tiempo en el
que la Saga tiene dinero reservado.

## Cómo diagnosticarla

1. **Cuánto y desde cuándo.**
   ```promql
   slo:transfer_under_5s:ratio_rate5m
   sli:transfer_latency:seconds_p50
   sli:transfer_latency:seconds_p95
   sli:transfer_latency:seconds_p99
   ```
   Si el p50 está bien y el p99 explotó, es una cola de unas pocas; si el p50
   subió, es el flujo entero.
2. **En qué paso.** La traza de la Saga tiene un span por paso
   (`saga.step <paso>`), así que el paso lento se ve a simple vista. En Grafana,
   *Explore → Tempo*, buscar por nombre de span `transfer` y ordenar por
   duración. El sospechoso habitual es `saga.payment attempt`: el proveedor
   externo tiene una escalera de 1 s / 5 s / 30 s, y un solo reintento ya
   empuja la transferencia por encima del objetivo.
   ```promql
   sli:payment_provider:seconds_p95
   sli:payment_provider_failure:ratio_rate5m
   ```
3. **¿Es simulación?** `source` distingue el fallo real del inyectado por un
   administrador. Si alguien dejó encendida una simulación de latencia, esto no
   es un incidente:
   ```bash
   curl -s "$GATEWAY/api/payments/simulation" -H "Authorization: Bearer $JWT_ADMIN"
   ```
4. **¿O es el broker?** Cada salto de la Saga es un mensaje. Con lag, todo se
   hace lento sin que ningún servicio esté lento:
   ```promql
   sli:broker_consumer_lag:messages
   sli:message_process:seconds_p95
   ```
5. **¿O la base de datos?** Las trazas incluyen los spans de `pg`. Una
   transferencia que espera un `SELECT … FOR UPDATE` lo muestra en su traza.

## Cómo mitigarla

- **Simulación encendida** → apagarla: `PUT /api/payments/simulation` con
  `mode=SUCCESS` (sólo administrador). No hace falta desplegar.
- **Proveedor externo lento de verdad** → la escalera ya hace su trabajo; lo que
  se decide es si se acorta el techo. Es un cambio de `PAYMENT_SIM_*` /
  configuración por ConfigMap, no de código.
- **Consumer lag** → [consumer-lag.md](consumer-lag.md).
- **Base de datos** → mirar las conexiones y los bloqueos de
  `account-service`; su ruta de saldo serializa por fila a propósito, así que
  una cuenta muy usada es un punto de contención esperado.
- **Carga** → comprobar el HPA. El objetivo es el 80 % de CPU.

## Lo que NO hay que hacer

- Mirar el **promedio**. El enunciado lo prohíbe por una razón: un promedio de
  2 s con un p99 de 40 s se ve sano y no lo está. Los paneles están en
  percentiles.
- Cancelar transferencias "colgadas" a mano. La Saga tiene seis estados y una
  función pura que rechaza cualquier transición fuera del diagrama; lo que
  parece colgado suele estar esperando un reintento cuyo vencimiento está
  guardado en una columna, y se reanuda solo tras un reinicio.
