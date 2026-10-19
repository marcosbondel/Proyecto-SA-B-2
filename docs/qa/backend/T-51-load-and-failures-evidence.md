# T-51 — Pruebas de carga, escenarios de fallo y postmortems: evidencia

Fecha: **2026-10-15**. Rama `feature/T-51`.

## 1. Qué pedía el ticket y qué hay

| Criterio de aceptación | Estado |
| --- | --- |
| Al menos **3 postmortems**, uno de ellos del banco pareja | **4**, en [`docs/sre/postmortems/`](../../sre/postmortems/README.md) — y el del banco pareja es el obligatorio |
| **El HPA escala bajo carga** y se ve en el dashboard | **no cubierto**: kind no trae `metrics-server` y los siete HPA están en `FailedGetResourceMetric`. Necesita la nube (T-54). Ver §6 |
| **Al menos una alerta se dispara** durante una prueba y su runbook se sigue | **`PartnerBankSendDegraded`**, `firing` a las 20:01:50, con su runbook recorrido paso por paso |
| **Ningún fallo se inyecta apagando o alterando el sistema del otro grupo** | se inyectó todo con el **mock propio** (`partnerMock.callbackMode`) y la **perilla propia** de T-44 |
| Scripts de carga con k6, versionados | `test/load/` — dos scripts y un corredor de escenarios |
| Decidir y documentar **dónde corre la carga**, dado TD-070 | §6 |

## 2. Los scripts

```bash
pnpm load:transfer              # la transferencia interna
pnpm load:interbank             # el depósito al banco pareja
pnpm load:scenario <escenario>  # un escenario completo, de principio a fin
```

Seis escenarios: `base`, `rechazo`, `sin-respuesta`, `lento`, `proveedor`, `pod`.

`scenario.sh` existe porque **`k6 run` no demuestra nada por sí solo** en un
banco. Lo que hay que poder afirmar no es «k6 dio estos números», es «el dinero
volvió» — así que cada escenario arma el fallo, comprueba que está armado, mide
el saldo antes, corre la carga, espera a que cierre lo que quedó en vuelo,
vuelve a medir el saldo, cuenta los estados **en las filas** y devuelve la
perilla a su sitio con un `trap`, incluso si se interrumpe.

Dos parámetros por entorno: `TASA` y `DURACION`. Cuatro por segundo durante un
minuto responde «¿aguanta la compensación en volumen?»; para «¿suena la
alerta?» hace falta sostener el SLI bajo el umbral más de los cinco minutos del
`for`, y eso son `TASA=2 DURACION=7m`.

## 3. Lo medido

Todas las corridas contra el clúster local de T-57, con los siete componentes a
una réplica. `saldo` en centavos, de `GET /api/accounts`; los recuentos, de
`interbank_sends` y `transactions`.

| Escenario | Carga | Resultado de los depósitos/pagos | Transferencias | Saldo antes → después | Umbrales de k6 |
| --- | --- | --- | --- | --- | --- |
| `base` | 4/s · 60 s | 240 `ACCEPTED` | 240 `COMPLETED` | 250 000 → 226 000 *(el dinero sale, correcto)* | todos ✓ |
| `rechazo` | 4/s · 60 s | 241 `REJECTED` | 241 `COMPENSATED` | 220 900 → **220 900** | todos ✓ |
| `rechazo` | 2/s · 7 min | 841 `REJECTED` | 841 `COMPENSATED` | 220 900 → **220 900** | todos ✓ |
| `rechazo` | 2/s · 7 min | 840 `REJECTED` | 840 `COMPENSATED` | 220 900 → **220 900** | todos ✓ |
| `sin-respuesta` | 1/s · 2 min | 99 `TIMEOUT` | 99 `COMPENSATED` | 220 900 → **220 900** | todos ✓ |
| `proveedor` | 4/s · 60 s | 769 `success`, 110 `failure`, 30 `timeout` | 218 `COMPLETED`, 6 `COMPENSATED` | movimiento entre cuentas propias | **`transfer_saga_ms` ✗** |
| `pod` | 4/s · 60 s | — | 531 `COMPLETED` | movimiento entre cuentas propias | todos ✓ |

Latencias, por escenario:

| Escenario | Aceptación p95 | Saga p95 | Saga máx. | 5xx |
| --- | --- | --- | --- | --- |
| `base` | 18,05 ms | 2,13 s | 2,25 s | 0 % |
| `rechazo` | 6,54 ms | 2,11 s | 2,21 s | 0 % |
| `sin-respuesta` | 9,81 ms | **31,75 s** *(el plazo son 30 s)* | 31,91 s | 0 % |
| `proveedor` | 42,40 ms | **8,25 s** *(SLO-2 roto)* | 15,43 s | 0 % |
| `pod` | 42,30 ms | 1,22 s | **3,87 s** | 0 % |

**1.980 depósitos fallidos, 1.980 compensaciones, y el saldo idéntico antes y
después en las cuatro corridas de fallo del banco pareja.** Esa es la afirmación
del ticket, y está medida sobre el dinero y no sobre un estado.

## 4. Lo que la carga encontró

Siete defectos. Ninguno lo habría visto una prueba funcional, y seis están
arreglados en esta rama.

| # | Defecto | Dónde | Estado |
| --- | --- | --- | --- |
| 1 | **El chart no tenía `interbank.sendUrl`**, así que ningún despliegue enviaba depósitos: la ruta contestaba `202`, la Saga terminaba `COMPLETED` y el dinero se quedaba en la cuenta de liquidación | `bank-usac/values.yaml`, el ConfigMap, el Deployment, los dos compose | arreglado |
| 2 | **El mock no sabía contestar un depósito nuestro**: tenía la dirección entrante y no la saliente | `apps/partner-bank-mock` | arreglado, `POST /deposits` con sus cuatro modos |
| 3 | **Latido AMQP de 5 s** (el de la librería): un bucle de eventos ocupado 10 s costaba la conexión, el proceso y los **siete pods a la vez** | `@bank/messaging` | arreglado, 30 s + 5 casos de prueba |
| 4 | **Las reglas de ratio devolvían vacío en el peor caso**: con 241 de 241 rechazados el SLI no era 0, era nada — y una alerta sobre un SLI vacío se queda en OK | 5 reglas de `bank-observability` | arreglado con `or 0 *`, verificado contra Prometheus |
| 5 | **El webhook de alertas apuntaba al namespace `prod`**: la alerta se veía en Grafana y no llegaba a la bitácora | la política de notificación | arreglado, receptor `bank-audit-local` |
| 6 | **`kubectl rollout status` miente lo suficiente**: devuelve éxito con el pod anterior todavía en los Endpoints, y media medición salió contra el modo viejo (113 aceptados / 120 rechazados) | `scenario.sh` y el `/health` del mock | arreglado |
| 7 | **El veredicto de un depósito se publica fuera de la transacción que lo decide.** Un crash entre las dos pierde la compensación: **Q1,00 salió de una cuenta y no volvió** | `payment-service` | **abierto — [TD-093](../../TECH_DEBT.md)** |

Y dos tensiones de diseño, no defectos: [TD-091](../../TECH_DEBT.md) (nada avisa
de un reinicio de contenedor, que fue la señal que faltó en el incidente del
latido), [TD-092](../../TECH_DEBT.md) (los servicios mueren ante un corte de
broker en vez de esperar la reconexión que el adaptador ya sabe hacer) y
[TD-094](../../TECH_DEBT.md) (SLO-2 y la escalera de reintentos se contradicen).

### El defecto 7, con nombre y apellido

```
transacción 40dc1076-f560-4928-9c8d-991eb092402f   Q1.00   PAYMENT_PENDING
  creada   2026-10-15 18:52:01
depósito   4c5ac8ee-48e5-48a9-a8f0-17e114cd433a
  state       TIMEOUT
  reason      CONFIRMATION_TIMEOUT
  decided_at  2026-10-15 18:52:32
  reversed_at (nulo)
```

Payment murió a las 18:52:36 por el incidente del latido, entre escribir el
veredicto y publicarlo. `claimSendable` busca `state = 'PENDING'` y
`claimExpired` busca `state IN ('PENDING','SENT')`: una fila ya decidida queda
fuera de los dos barridos **para siempre**. Es la única pérdida de dinero de
1.259 transferencias, y no se arregla a mano porque el runbook lo prohíbe por
una razón — se deja como evidencia hasta que TD-093 esté cerrado.

## 5. La alerta, y su runbook

```
PartnerBankSendDegraded   state=firing   startsAt=2026-10-15T20:01:50Z
  severity=warning   slo=SLO-28
  runbook=…/docs/operations/runbooks/partner-bank.md
```

Cinco minutos exactos después de que el SLI cruzara el 95 %, que es su `for`. Y
en la bitácora, que es el canal visible que pide §4.1:

```
alert.slo.received.v1 | WARNING | PROCESSED
  {"alerts":[{"slo":"SLO-28","alertName":"PartnerBankSendDegraded",…}],"source":"grafana"}
```

El recorrido del runbook está en
[el postmortem del banco pareja](../../sre/postmortems/2026-10-15-banco-pareja.md),
§5. Dos de los escenarios lo hicieron crecer: no cubría la dirección saliente,
ni la perilla del mock, ni el caso de `sendUrl` vacío.

`DeadLetterGrowing` también quedó en `pending` (SLO-1 al 96,6 %, con 285
mensajes a la cola muerta durante el incidente del latido). No se cuenta como
evidencia del criterio porque no se dejó llegar a `firing`.

## 6. Dónde corre la carga, y qué no se puede medir aquí (TD-070)

**En kind, en la máquina de desarrollo. No en GCP, y no por comodidad.**
`dev` y `prod` comparten las cinco bases de datos ([TD-070](../../TECH_DEBT.md)),
así que una prueba de carga contra `dev` escribiría en las filas de producción:
mil doscientas transferencias de prueba en la contabilidad real. Hasta que
TD-070 se cierre, la carga no se corre en el clúster de la nube.

Lo que eso cuesta, dicho claro:

- **El HPA no escala.** Sin `metrics-server`, los siete HPA están en
  `FailedGetResourceMetric` permanente. El criterio «el HPA escala bajo carga y
  se ve en el dashboard» **queda abierto** y necesita T-54.
- **El error budget de 7 días no se puede observar**: la retención local es de
  dos horas.
- **El entorno es más frágil que la nube, y eso contaminó una medición.** Con
  dos clústeres de kind compartiendo una VM de 7,7 GB, los clientes de AMQP
  perdieron 60 segundos de latidos seguidos —con el latido ya en 30 s— y los
  servicios se reiniciaron. Se borró el clúster de pruebas sobrante
  (`bank-obs-test`) y la medición se repitió limpia. Una corrida de carga no se
  solapa con una construcción de imágenes.

Lo que la nube **habría escondido**: con réplicas creciendo automáticamente, el
incidente del latido habría pasado por «un pico» en vez de por lo que era.

## 7. Validación

| Comando | Resultado |
| --- | --- |
| `pnpm lint` | 14 de 14 |
| `pnpm typecheck` | 14 de 14 |
| `pnpm --filter @bank/messaging test` | 60 pasan, + los 2 de integración del latido contra el broker real |
| `pnpm --filter partner-bank-mock test` | 13 pasan |
| `pnpm obs:lint` | 1 chart, 0 fallos |
| `promtool check rules` | **34 reglas** (eran 30) |
| `pnpm obs:check:dashboards` | pasa: 9 dashboards, 34 reglas citadas, 5 runbooks en disco |
| `pnpm test:pyramid` | las dos desviaciones del sistema (unitarias 72,7 %, e2e 6,6 %) **ya estaban en `HEAD`**; los números del sistema no cambian, porque `@bank/messaging` no es una de las siete aplicaciones desplegables |

`pnpm test:e2e` no se corrió en esta rama: apunta a la web en `:3010` y la
imagen de `web` no se reconstruyó (no depende de `@bank/messaging`, así que el
arreglo del latido no la toca), de modo que el despliegue local la tiene escalada
a cero. Es una omisión consciente y no un resultado.
