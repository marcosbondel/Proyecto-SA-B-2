# Postmortem — El banco pareja rechaza y no contesta

**Fecha:** 2026-10-15, 19:34–20:28 UTC
**Entorno:** `kind-bank-usac`, namespace `bank-usac` (local; ver §7 del
[postmortem del latido](2026-10-15-latido-amqp.md))
**Tipo:** **escenario inyectado a propósito**, no un incidente
**Escenario del enunciado:** §4.1 — «el banco pareja no responde, responde lento
o rechaza depósitos (simulado con el mock)». **Obligatorio.**
**Inyectado con:** `partnerMock.callbackMode`, el mock propio. **En ningún
momento se apagó ni se alteró el sistema del otro grupo.**

> **Blameless, y además sin culpable posible**: el banco pareja es un sistema
> que no controlamos, y la regla de evaluación del enunciado lo dice — sus
> fallos no restan si el banco propio reacciona bien. Así que la pregunta de
> este postmortem no es «¿por qué rechazó?» sino **«¿volvió el dinero?»**.

> **Relectura T-61 (2026-10-21):** corrida histórica de kind con el protocolo
> anterior. Se conservan cifras y plazos originales. El contrato vigente usa
> TTL 180 s, consulta/cancelación y 300 s adicionales antes de una liberación
> no verificada; los timeouts actuales no entran al histograma de confirmación.
> Estos resultados no prueban ese protocolo ni una corrida GKE actual.

## 1. Resumen en tres líneas

Se hizo que el banco pareja rechazara el 100 % de los depósitos que este banco
le envía, y después que no contestara ninguno. **1.980 depósitos fallidos,
1.980 compensaciones, y el saldo de la cuenta de origen idéntico antes y después
en las tres corridas.** El coste fue latencia y una alerta; no hubo un centavo
perdido ni una Saga atascada.

## 2. Cronología

| Hora (UTC) | Qué |
| --- | --- |
| 19:34 | **línea base**: el pareja acepta. 240 depósitos, 240 `ACCEPTED`, saldo 2 509,00 → 2 260,00 — el dinero sale, que es lo correcto |
| 19:48 | `callbackMode=REJECT`. 4 depósitos/s durante 60 s |
| 19:49 | 241 `REJECTED`, 241 `COMPENSATED`, saldo 2 209,00 → **2 209,00** |
| 19:56 | la misma inyección, 2/s durante **7 minutos**, para sostener el SLI bajo el umbral |
| 20:03 | 841 `REJECTED`, 841 `COMPENSATED`, saldo **sin cambio** |
| 20:01:50 | **`PartnerBankSendDegraded` pasa a `firing`** — cinco minutos exactos después de que el SLI cruzara el 95 %, que es su `for` |
| 20:07 | tercera corrida igual, ya con la ruta del webhook arreglada: 840 `REJECTED`, 840 `COMPENSATED` |
| 20:26 | `callbackMode=TIMEOUT`. 1 depósito/s durante 2 minutos |
| 20:28 | 99 `TIMEOUT`, 99 `COMPENSATED`, saldo **sin cambio**. p95 de la Saga: **31,75 s** |
| 20:29 | `callbackMode=ACCEPT` restablecido por el `trap` del script |

## 3. Impacto en los SLO

| Indicador | Objetivo | REJECT (7 min) | TIMEOUT (2 min) |
| --- | --- | --- | --- |
| SLO-28 saliente — depósitos confirmados | ≥ 95 % | **0 %** | **0 %** |
| SLO-7 — aceptación del comando, p95 | < 3 s | 6,5 ms ✓ | 9,8 ms ✓ |
| Saga cerrada, p95 | < 40 s (umbral del escenario) | 2,11 s ✓ | **31,75 s** ✓ |
| Respuestas 5xx | < 1 % | 0,00 % ✓ | 0,00 % ✓ |
| Comprobaciones de k6 | > 99 % | 100 % ✓ | 100 % ✓ |
| **Dinero devuelto** | **100 %** | **841/841** | **99/99** |

**Los 31,75 s del caso `TIMEOUT` no son una degradación: son la configuración.**
`INTERBANK_CONFIRMATION_TIMEOUT_MS` son 30 s, y una Saga que compensa en 31,75 s
esperó exactamente lo que se le dijo y luego devolvió el dinero. Medirla contra
el SLO-2 de 5 s —el de las transferencias internas— haría que el sistema
«fallara» por cumplir su propia configuración; de ahí que el umbral del
escenario sea 40 s y esté justificado en `test/load/interbank.js`.

## 4. Evidencia

Los tres resúmenes que deja `pnpm load:scenario`, recortados a lo que importa:

```
escenario:      rechazo            escenario:      sin-respuesta
carga:          2/s durante 7m     carga:          1/s durante 2m
saldo antes:    220900             saldo antes:    220900
saldo después:  220900             saldo después:  220900
envíos:         REJECTED=841       envíos:         TIMEOUT=99
interbancarias: COMPENSATED=841    interbancarias: COMPENSATED=99
```

El saldo sale de `GET /api/accounts` y los recuentos de las filas
(`interbank_sends`, `transactions`), no de una respuesta que pudiera estar
sirviendo una proyección atrasada. **Es la afirmación que vale**: no «el estado
dice COMPENSATED» sino «el dinero está donde estaba».

La alerta, por la API de Grafana:

```
PartnerBankSendDegraded  state=firing  startsAt=2026-10-15T20:01:50Z
  severity=warning  slo=SLO-28
  runbook=…/docs/operations/runbooks/partner-bank.md
  summary=Menos del 95 % de los depósitos que este banco ENVÍA se confirman;
          el pareja rechaza o no contesta y la Saga está compensando.
```

Y la bitácora, que es el «canal visible» que pide §4.1:

```
alert.slo.received.v1 | WARNING | PROCESSED | {"alerts":[{"slo":"SLO-28",
  "alertName":"PartnerBankSendDegraded","status":"firing",…}],"source":"grafana"}
```

En la auditoría quedan además 5.519 `payment.interbank.sent.v1` y 1.316
`transaction.compensated.v1` de la sesión: cada compensación es visible en la
traza y en la bitácora, no sólo en el saldo.

## 5. El runbook que se siguió

[`partner-bank.md`](../../operations/runbooks/partner-bank.md), y su paso 4
—«¿el dinero volvió?»— es el que decidió el veredicto. Los pasos 1 a 3
distinguieron correctamente «rechaza» de «tarda»: en `REJECT` cae la tasa y el
p95 no se mueve; en `TIMEOUT` el p95 sube a 31 s. Esa distinción es la razón de
que haya dos alertas y no una.

El runbook **creció por este escenario**: no cubría la dirección saliente, ni la
perilla del mock, ni el caso de `sendUrl` vacío. Ahora sí.

## 6. Causa raíz

Ninguna en el banco propio. El fallo era el inyectado y el sistema hizo lo que
debía. Lo que **sí** salió mal, y es el valor real de haber hecho este
escenario, son cuatro cosas que nadie habría visto con una prueba funcional:

| # | Lo que se encontró | Por qué no se veía antes |
| --- | --- | --- |
| 1 | **El chart no tenía `interbank.sendUrl`**, así que *ningún* despliegue enviaba depósitos: la ruta contestaba `202`, la Saga terminaba `COMPLETED` y el dinero se quedaba en la cuenta de liquidación | el camino feliz es indistinguible de una transferencia interna correcta; el único rastro era una línea al arrancar |
| 2 | **El mock no sabía contestar un depósito nuestro** — tenía `POST /transfers` (él nos origina uno) y no la dirección contraria | T-46 sólo necesitaba la entrante, y T-47 se probó con dobles |
| 3 | **Las reglas de ratio devolvían vacío en el peor caso**: con 241 de 241 rechazados, `slo:interbank_sent_accepted:ratio_rate5m` no daba 0, daba nada — y una alerta con `noDataState: OK` sobre un SLI vacío se queda en OK | hace falta un fallo **total** para que el numerador desaparezca; cualquier fallo parcial funcionaba |
| 4 | **El webhook de alertas apuntaba al namespace `prod`**, que en local no existe, así que la alerta se veía en Grafana y no llegaba a la bitácora | la política enruta `dev` a dev y *todo lo demás* a prod, y `local` no era ninguno de los dos |

Los cuatro están arreglados. El tercero es el que más se parece a un defecto de
diseño y no a un olvido: **el fallo total se parece a la ausencia de tráfico**, y
es el mismo error que T-58 encontró con el `le="5"` de SLO-2, en otra forma.

Y un quinto, de método más que de sistema: la primera corrida de `REJECT` salió
con 113 aceptados y 120 rechazados, porque `kubectl rollout status` devuelve
éxito mientras el pod anterior sigue en los Endpoints del Service. Media
medición contra el modo viejo. El script ahora espera a que el propio `/health`
del mock confirme el modo armado.

## 7. Acciones

| # | Acción | Estado |
| --- | --- | --- |
| 1 | `interbank.sendUrl` y `interbank.confirmationTimeoutMs` en el chart, el ConfigMap, el Deployment y los dos compose | hecho |
| 2 | `POST /deposits` en el mock, con los cuatro modos y el callback a nuestro Gateway | hecho, 6 casos nuevos |
| 3 | `or 0 *` en las cinco reglas de ratio, para que el fallo total valga 0 y no vacío | hecho, verificado contra Prometheus (`0`, antes vacío) |
| 4 | Receptor y ruta `bank-audit-local` para el webhook de alertas | hecho, verificado en la bitácora |
| 5 | Cuatro reglas y dos alertas de la dirección saliente, seis paneles en `08-banco-pareja.json` | hecho |
| 6 | `/health` del mock dice el modo armado; el script lo espera | hecho |
| 7 | **TD-093** — el veredicto del depósito se publica fuera de la transacción que lo decide, y un crash entre las dos pierde la compensación | **abierto**, con una pérdida real de Q1,00 documentada |

## 8. Lo que este escenario no cubre

El **HPA**. En kind no hay `metrics-server`, los siete HPA están en
`FailedGetResourceMetric` permanente y no escalan, así que el criterio «el HPA
escala bajo carga y se ve en el dashboard» necesita el entorno de nube (T-54).
Lo que esta corrida sí demuestra es que **no hizo falta escalar**: 2 depósitos/s
sostenidos siete minutos con una réplica de cada servicio, sin un 5xx.
