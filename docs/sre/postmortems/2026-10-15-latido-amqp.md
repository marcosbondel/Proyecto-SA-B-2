# Postmortem — Los siete servicios se reiniciaron a la vez durante la carga

**Fecha del incidente:** 2026-10-15, 18:51–18:53 UTC
**Entorno:** `kind-bank-usac`, namespace `bank-usac` (local; ver §7)
**Detectado por:** la primera corrida de carga interbancaria de T-51
**Severidad:** total — ninguna transferencia se aceptó durante ~20 s
**Escenario del enunciado:** «latencia o caída temporal del broker» (§4.1), que
no hubo que inyectar: ocurrió solo.

> **Blameless.** Nadie configuró mal nada. El valor que causó la caída es el
> valor por defecto de una librería, nunca se escribió en este repositorio y
> ninguna prueba lo miraba. El defecto es que no lo miraba ninguna prueba.

> **Relectura T-61 (2026-10-21):** informe histórico local, sin sustituir sus
> logs o cifras. Las alertas de reinicio se añadieron después del incidente.
> El estado pendiente descrito al final de la corrida no equivale a una
> compensación ya demostrada: para cerrar su recuperación se necesita evidencia
> posterior. Los plazos interbancarios actuales son 180 s más el protocolo de
> consulta/cancelación; este informe conserva los anteriores.

## 1. Resumen en tres líneas

Una carga de 4 depósitos interbancarios por segundo bloqueó el bucle de eventos
de los servicios lo suficiente para que dejaran de mandar latidos AMQP. RabbitMQ
cerró las conexiones por latidos perdidos, `amqplib` emitió un error de socket,
y los siete procesos terminaron en 1 y fueron reiniciados por Kubernetes — todos
dentro de seis segundos. Ninguna sonda falló, ningún contenedor se quedó sin
memoria y en los eventos del namespace no hay un solo `Unhealthy` que lo explique.

## 2. Cronología

| Hora (UTC) | Qué |
| --- | --- |
| 18:51:19 | arranca `k6 run test/load/interbank.js`: 4 iter/s durante 60 s, `constant-arrival-rate` |
| 18:51:2x | los primeros depósitos se aceptan en 2,9–4,6 ms y la Saga cierra en ~2,0 s |
| ~18:51:40 | la aceptación empieza a degradarse; k6 sube de 4 a 30 VUs para sostener la tasa |
| 18:52:16 | RabbitMQ: `missed heartbeats from client, timeout: 5s` — primera conexión cerrada |
| 18:52:19 | fin de la ventana de carga; dos conexiones más cerradas por lo mismo |
| 18:52:25 | cuarta conexión cerrada por latidos perdidos |
| 18:52:31 | `transaction-service` termina en 1: `Connection.onSocketError` de `amqplib` |
| 18:52:36 | `payment-service` termina en 1 |
| 18:52:37 | el Gateway contesta `INTERNAL_ERROR` en ráfaga y termina en 0 |
| 18:52:37 | los siete contenedores reiniciados por Kubernetes |
| 18:53:3x | los siete `1/1 Ready` otra vez, sin intervención |

## 3. Impacto en los SLO

Medido por k6 sobre 240 iteraciones programadas:

| Indicador | Objetivo | Medido | |
| --- | --- | --- | --- |
| SLO-2 — aceptación de la transferencia, p95 | < 3 s (umbral del script; el SLO es 5 s) | **29,03 s** | ✗ |
| p90 de la aceptación | — | 24,60 s | |
| máximo de la aceptación | — | 33,25 s | |
| tasa de respuestas fallidas | < 1 % | **32,39 %** (335 de 1034) | ✗ |
| Saga completa, p95 | < 40 s | 2,20 s | ✓ |
| Saga completa, máximo | — | 45,99 s | |
| iteraciones completadas | 240 | 173 | |
| iteraciones descartadas por falta de VU | 0 | **47** | ✗ |

**Lo que no se perdió:** de los 193 depósitos que alcanzaron a entrar, 188
quedaron `ACCEPTED` y 5 vencieron a `TIMEOUT`; de esos 5, **4 transferencias
quedaron `COMPENSATED`** —el dinero volvió— y 1 quedó en `PAYMENT_PENDING`
cuando el proceso murió a mitad de la decisión. El saldo de la cuenta de origen
cuadra con esa cuenta. Es decir: el incidente costó disponibilidad, no dinero,
y la Saga hizo su trabajo incluso mientras los servicios se reiniciaban. La fila
`PAYMENT_PENDING` la cierra el barrido, y el barrido es una columna y no un
temporizador precisamente para sobrevivir a esto.

## 4. Evidencia

Log del broker — la línea que lo explica todo:

```
2026-10-15 18:52:16.556956+00:00 [error] <0.15894.0> closing AMQP connection
  (172.25.0.9:49348 -> 172.25.0.8:5672, duration: '1M, 36s'):
2026-10-15 18:52:16.556956+00:00 [error] <0.15894.0> missed heartbeats from client, timeout: 5s
```

Log de `transaction-service` (instancia anterior):

```
at Connection.onSocketError (/app/node_modules/.pnpm/amqplib@2.0.1/node_modules/amqplib/lib/connection.js:301:17)
...
Node.js v24.19.0
```

Estado de los pods medio minuto después, con los reinicios alineados al segundo:

```
bank-usac-customer-service-…     1/1  Running  4 (49s ago)  27m
bank-usac-gateway-…             1/1  Running  4 (49s ago)  27m
bank-usac-transaction-service-… 1/1  Running  4 (55s ago)  27m
```

Lo que **no** hay, y es la parte que costó tiempo: ni un evento `Unhealthy`, ni
`OOMKilled`, ni `Evicted`. El Gateway terminó con código 0 — un `SIGTERM`
limpio — y los demás con 1. Buscar la causa en las sondas fue el primer camino y
fue el camino equivocado.

Lo que el servidor proponía, para descartarlo como causa:

```
$ docker exec rabbitmq rabbitmqctl environment | grep -i heartbeat
      {heartbeat_interval,100},
      {heartbeat,60},
```

## 5. El runbook que se siguió, y dónde se quedó corto

El síntoma —latencia de transferencias por encima del objetivo— lleva a
[`transfer-latency.md`](../../operations/runbooks/transfer-latency.md), y sus
cuatro pasos se recorrieron en orden:

| Paso | Qué dijo |
| --- | --- |
| 1. ¿Cuánto y desde cuándo? | el p95 de aceptación en 29 s, y no un p99 de unas pocas: el flujo entero |
| 2. ¿En qué paso? | ninguno en particular; no había Saga lenta, había Sagas que no avanzaban |
| 3. ¿Es simulación? | no: `PAYMENT_SIM_FAILURE_RATE`, `PAYMENT_SIM_TIMEOUT_RATE` y `PAYMENT_SIM_LATENCY_MS` en `0` en el ConfigMap, y nadie había tocado `PUT /api/payments/simulation` |
| 4. ¿O es el broker? | **aquí estaba**, pero el runbook pregunta por *lag* (`sli:broker_consumer_lag:messages`) y el lag estaba bajo — porque el problema no era que los mensajes esperaran, era que nadie estaba conectado para consumirlos |

El paso 4 apuntaba al lugar correcto con la pregunta equivocada. La causa se
encontró leyendo el log del contenedor **anterior** (`kubectl logs --previous`),
que es un paso que ningún runbook nombra y que resultó ser el único que
importaba. Las dos lagunas —una alerta de reinicios y la pregunta «¿se cayeron
las conexiones?»— son TD-091.

## 6. Causa raíz

`amqp-connection-manager@5.0.0` manda un latido **cada 5 segundos** por defecto:

```
node_modules/.../amqp-connection-manager/dist/types/AmqpConnectionManager.d.ts:39
  /** Interval to send heartbeats to broker. Defaults to 5 seconds. */
  heartbeatIntervalInSeconds?: number;
```

El valor efectivo de un latido AMQP es el **menor** entre lo que propone el
servidor y lo que pide el cliente. El servidor proponía 60; el cliente pedía 5
sin que nadie lo escribiera; ganó el 5. RabbitMQ cierra la conexión al perder
dos latidos seguidos, así que el margen real era de **diez segundos**.

Un servicio NestJS es de un solo hilo y en este despliegue corre con un límite
de 250 mCPU. Diez segundos de bucle de eventos ocupado bajo carga no son una
caída — son un martes. Pero con ese margen el broker los lee como muerte, y
estos servicios **fallan rápido** ante una conexión perdida: terminan en 1 en vez
de esperar la reconexión. Como los siete comparten `@bank/messaging`, se
reinician los siete.

Tres decisiones correctas por separado que juntas hacen una caída total:

1. el latido por defecto de la librería, que nadie eligió;
2. terminar el proceso cuando el broker se va, que es lo correcto para un
   servicio cuya única entrada son mensajes;
3. límites de CPU ajustados, que es lo correcto en un clúster compartido.

La que estaba mal no es ninguna de las tres: es que **la primera no era visible**.

## 7. Acciones

| # | Acción | Estado |
| --- | --- | --- |
| 1 | `heartbeatSeconds` en `BrokerOptions`, con **30 s** por defecto en vez de los 5 de la librería — tolera un minuto de bucle bloqueado y sigue por debajo de los 60 s que propone el servidor | hecho (`apps/packages/messaging/src/broker.ts`) |
| 2 | `test/heartbeat.spec.ts`: la opción llega y no vale 5 | hecho, 3 casos |
| 3 | `test/heartbeat.integration.spec.ts`: contra el broker real, un bucle bloqueado 15 s mata la conexión de 5 s y no la de 30 s — el mecanismo, no el número | hecho, 2 casos |
| 4 | Repetir la carga con el arreglo y comparar | hecho — ver [la evidencia de T-51](../../qa/backend/T-51-load-and-failures-evidence.md) |
| 5 | Una alerta sobre reinicios de contenedor: hoy nada avisa de que los siete pods se reiniciaron, y es la señal más clara que existió | **pendiente** — TD-091 |
| 6 | Revisar si los servicios deben morir ante una conexión perdida o esperar la reconexión que el adaptador ya sabe hacer | **pendiente** — TD-092, es una decisión de diseño, no un arreglo |

La primera versión de la acción 3 leía el `timeout` negociado por la API de
gestión de RabbitMQ. Contestó **401**: el usuario de la aplicación no tiene
permisos de gestión, y el `catch` de la prueba la dejaba pasar sin haber mirado
nada. Se reescribió para medir comportamiento. Una prueba que pasa porque no
pudo mirar es peor que una que se omite.

## 8. Dónde corrió, y por qué importa (TD-070)

Esta carga corrió contra **kind en la máquina de desarrollo**, no contra GCP, y
no por comodidad: `dev` y `prod` comparten las cinco bases de datos (TD-070), así
que una prueba de carga contra `dev` escribiría en las filas de producción. Hasta
que TD-070 se cierre, la carga no se corre en el clúster de la nube.

La contrapartida es honesta y hay que decirla: en kind **no hay metrics-server**,
así que los siete HPA están en `FailedGetResourceMetric` permanente y no escalan.
El criterio de T-51 «el HPA escala bajo carga y se ve en el dashboard» **no queda
cubierto por esta corrida** y necesita el entorno de nube (T-54). Lo que sí
queda cubierto es lo que la nube habría escondido: con réplicas creciendo
automáticamente, este incidente podría haber pasado por «un pico» en vez de por
lo que era.
