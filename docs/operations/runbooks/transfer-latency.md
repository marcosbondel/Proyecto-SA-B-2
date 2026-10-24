# TransferLatencyBreach / TransferLatencyFastBurn / TransferLatencySlowBurn

**SLO-2** — cierres de transferencia observados hasta **5.0 s**, objetivo
**≥ 95 %** sobre 7 días corridos.

Tres alertas sobre el mismo objetivo:

| Alerta | Condición | Severidad |
| --- | --- | --- |
| `TransferLatencyBreach` | SLI < 95 % durante 30 min | `warning` |
| `TransferLatencyFastBurn` | burn rate > **14.4×** en 1 h **y** 5 min, `for: 2m` | `critical` |
| `TransferLatencySlowBurn` | burn rate > **6×** en 6 h **y** 30 min, `for: 15m` | `warning` |

Las de *burn rate* tienen dos ventanas cada una (SRE Workbook): la larga dice
que el gasto es real, la corta que sigue ocurriendo — sin ella la alerta seguiría
disparada media hora después de arreglar la causa. A 14.4× el presupuesto de 7
días se agota en unas 12 h; a 6×, en 28 h. En una ventana de 7 d, 14.4× gasta 8.57 % por hora; 6×, 21.43 % en seis horas.

```promql
slo:transfer_under_5s:burn_rate5m
slo:transfer_under_5s:burn_rate30m
slo:transfer_under_5s:burn_rate1h
slo:transfer_under_5s:burn_rate6h
slo:transfer_under_5s:budget_remaining7d
```

**Ojo con la escalera del proveedor (TD-094).** La primera espera del pago es 1 s; alcanzar el **segundo reintento** acumula
**6 s**, por encima de 5 s antes de procesar, así que un
escenario de fallos del proveedor dispara estas alertas aunque la Saga esté
haciendo exactamente lo que debe. Mirar `source` en el paso 3 antes de nada.

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
   externo tiene una escalera de 1 s / 5 s / 30 s, y llegar al segundo reintento acumula 6 s de espera antes del procesamiento.
   ```promql
   sli:payment_provider:seconds_p95
   sli:payment_provider_failure:ratio_rate5m
   ```
3. **¿Es simulación?** `source` distingue `scenario`, `configuration` y `runtime`; **todos son
   resultados del proveedor simulado**. La configuración runtime puede explicar
   la degradación, pero si afecta usuarios fuera de una prueba sigue requiriendo
   atención. Registrar los valores actuales antes de cambiarlos:
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

- **Simulación encendida** → restaurar el estado previo aprobado. El cuerpo
  de `PUT /api/payments/simulation` es la terna completa
  `{"failureRatePercent":0,"timeoutRatePercent":0,"latencyMs":0}` para una
  línea base sin fallos, o `{"reset":true}` para volver a los defaults de
  arranque (que pueden contener fallos). Sólo administrador. No existe
  `mode=SUCCESS` en ese contrato.
- **Proveedor simulado bajo fallo esperado** → comprobar recuperación y
  compensación sin cambiar el umbral de SLO-2. El banco pareja HTTP usa su
  [runbook propio](partner-bank.md). Cambiar esperas de la escalera o el SLO
  requiere una decisión explícita (TD-094).
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

## Población medida y recuperación

La regla desplegada incluye `completed`, `failed` y `compensated` en el
histograma y excluye Sagas que aún no llegaron a estado final. Difiere de la
línea base de exitosas completadas: una negativa rápida puede mejorar el ratio,
y una Saga detenida puede no aparecer. Revisar también el historial, intentos,
trazas y saldos de las operaciones afectadas. El bucket acumulativo incluye
exactamente 5 s. Ver [SLO §5.3](../../sre/sli-slo-sla.md#53-los-slo-que-la-fase-3-mide-con-datos-reales-t-58).

Cerrar con simulación restaurada, transferencias resueltas, balances conciliados
y alerta `resolved` recibida en auditoría; conservar la ventana de degradación.
