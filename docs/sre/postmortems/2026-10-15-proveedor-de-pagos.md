# Postmortem — El proveedor de pagos falla y expira

**Fecha:** 2026-10-15, 20:32–20:34 UTC
**Entorno:** `kind-bank-usac`, namespace `bank-usac`
**Tipo:** **escenario inyectado a propósito**
**Escenario del enunciado:** §4.1 — «fallos y timeouts de Payment Service (T-44)»
**Inyectado con:** `PUT /api/payments/simulation`, **en caliente**: 30 % de
fallos y 10 % de expiraciones, sin reiniciar nada y sin desplegar nada.

## 1. Resumen en tres líneas

Con el proveedor fallando el 30 % de las veces y expirando otro 10 %, de 224
transferencias **218 se completaron y 6 compensaron**. La escalera de reintentos
absorbió 134 de los 140 intentos fallidos. El precio fue el p95 de la Saga:
**8,25 s contra un SLO-2 de 5 s** — el único objetivo roto, y roto por diseño.

## 2. Cronología

| Hora (UTC) | Qué |
| --- | --- |
| 20:32:00 | `PUT /api/payments/simulation` → `{failureRatePercent: 30, timeoutRatePercent: 10, latencyMs: 0}`, aceptado |
| 20:32:05 | arranca `transfer.js`: rampa 1 → 5 → 15 VUs sobre 80 s |
| 20:33:21 | k6 cruza el umbral de `transfer_saga_ms` (p95 8,25 s) y **ningún otro** |
| 20:34:07 | el `trap` del script devuelve la simulación a ceros |
| 20:34 | recuento: 218 `COMPLETED`, 6 `COMPENSATED`, ninguna atascada |

## 3. Impacto en los SLO

| Indicador | Objetivo | Medido | |
| --- | --- | --- | --- |
| SLO-7 — aceptación del comando, p95 | < 3 s | 42,4 ms | ✓ |
| **SLO-2 — Saga cerrada, p95** | **< 5 s** | **8,25 s** | **✗** |
| Saga cerrada, máximo | — | 15,43 s | |
| SLO-27 — respuestas 5xx | < 1 % | 0,00 % | ✓ |
| Comprobaciones de k6 | > 99 % | 100 % (448/448) | ✓ |
| Transferencias compensadas | — | 6 de 224 (2,7 %) | |
| **Dinero descuadrado** | **0** | **0** | ✓ |

El contador del proveedor, en Prometheus, explica el reparto:

```
bank_payment_provider_calls_total:  success=769  failure=110  timeout=30
```

140 intentos fallidos produjeron **6** transferencias compensadas. Es decir: la
escalera resolvió el 96 % de los fallos reintentando, y el cliente nunca supo
que su pago había fallado dos veces. Eso es exactamente lo que la escalera
existe para hacer.

## 4. Causa raíz del SLO roto

No es un defecto: es una **inconsistencia entre dos números que se eligieron por
separado**.

`PAYMENT_RETRY_DELAYS_MS` son `1000,5000,30000`. Un solo reintento mete
1 segundo de espera y el segundo mete 5 más. Como el SLO-2 pide que la
transferencia **entera** cierre en menos de 5 s, basta con que un pago llegue al
segundo escalón para que esa transferencia incumpla el objetivo, por mucho que
termine bien. Con el proveedor al 30 % de fallos eso le pasa a una de cada tres.

Dicho al revés: **el SLO-2 asume implícitamente que el proveedor no falla.** Son
dos decisiones correctas que nadie comparó — y compararlas es justamente lo que
una prueba de carga con fallo inyectado sirve para forzar. Queda como
[TD-094](../../TECH_DEBT.md).

## 5. El runbook que se siguió

[`transfer-latency.md`](../../operations/runbooks/transfer-latency.md), y esta
vez funcionó en el paso en el que estaba pensado:

| Paso | Qué dijo |
| --- | --- |
| 1. ¿Cuánto y desde cuándo? | p50 en 1,06 s y p95 en 8,25 s: **una cola de unas pocas**, no el flujo entero — el diagnóstico correcto |
| 2. ¿En qué paso? | `saga.payment attempt`, el sospechoso que el propio runbook nombra |
| 3. **¿Es simulación?** | **sí** — y el runbook dice textualmente «si alguien dejó encendida una simulación de latencia, esto no es un incidente». `source: RUNTIME` lo distingue de un fallo real |

El paso 3 es el que convierte este postmortem en un escenario y no en una
avería, y es la razón de que T-44 guarde el `source` de la simulación.

## 6. Acciones

| # | Acción | Estado |
| --- | --- | --- |
| 1 | **TD-094**: reconciliar el SLO-2 con la escalera de reintentos — o el objetivo sube, o la escalera baja su primer escalón, o el SLO se mide excluyendo los reintentos del proveedor externo. Es una decisión de producto, no un arreglo | **abierto** |
| 2 | El script del escenario pide la simulación con el token de **ADMINISTRADOR** y **comprueba el código de respuesta** | hecho |
| 3 | El restablecimiento escribe en otro archivo, para no borrar la evidencia de lo inyectado | hecho |

La acción 2 viene de un fallo de método: la primera corrida salió con **560
transferencias perfectas y cero fallos** porque la perilla se pidió con el token
del cliente, `PUT /api/payments/simulation` devolvió `403` por D-06, y el script
no miraba la respuesta. Un escenario de fallo que no inyecta nada se parece
mucho a un sistema muy robusto.
