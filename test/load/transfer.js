import { Trend } from 'k6/metrics';
import http from 'k6/http';

import {
  GATEWAY,
  SEEDED,
  useSloFailureDefinition,
  authHeaders,
  awaitTerminal,
  checkAccepted,
  iterationKey,
  login,
  pickAccounts,
} from './support.js';

/**
 * La carga sobre el flujo de transferencia (T-51, §4.1).
 *
 *   k6 run test/load/transfer.js
 *   k6 run -e GATEWAY_URL=http://localhost:3000 --vus 10 --duration 2m test/load/transfer.js
 *
 * Qué mide, y por qué esas dos cosas y no una:
 *
 * - **Aceptar** la transferencia (`POST /api/transfers` → `202`). Es síncrono y
 *   es lo que una persona espera mirando la pantalla. Su umbral es SLO-7:
 *   p95 < 3 s para un comando.
 * - **Cerrarla** (la Saga, hasta `COMPLETED` / `COMPENSATED` / `FAILED`). Es
 *   asíncrono y es lo que de verdad mueve el dinero. Su umbral es SLO-2:
 *   p95 < 5 s.
 *
 * Medir sólo la primera daría un sistema que acepta rapidísimo y tarda un
 * minuto en mover nada; medir sólo la segunda esconde al Gateway. Las dos juntas
 * son las dos mitades del `bank.transfer.duration` que T-43 emite, vistas desde
 * fuera.
 *
 * El dinero circula entre dos cuentas del MISMO titular, con montos de Q 1.00:
 * una prueba de carga que drene la cuenta origen deja de medir latencia y
 * empieza a medir el rechazo por saldo insuficiente, que es otra prueba.
 */

const aceptacion = new Trend('transfer_accept_ms', true);
const saga = new Trend('transfer_saga_ms', true);

// La definición de «fallida» es la de SLO-27 (5xx), no la de k6 (no-2xx). En el
// ámbito del módulo y NO en `options`, donde k6 la ignora en silencio.
useSloFailureDefinition();

export const options = {
  scenarios: {
    /*
     * Rampa y no carga constante: el escalón es lo que hace visible el HPA
     * —escala al 80 % de CPU y tarda en reaccionar— y lo que distingue «el
     * sistema es lento» de «el sistema se degrada cuando sube la carga».
     */
    transferencias: {
      executor: 'ramping-vus',
      startVUs: 1,
      stages: [
        { duration: '20s', target: 5 },
        { duration: '40s', target: 15 },
        { duration: '20s', target: 0 },
      ],
      gracefulRampDown: '10s',
    },
  },
  /*
   * Los mismos números que los SLO (§5.3) y que las alertas de T-50. Si esto
   * falla, el SLO se incumplió — no «el script era exigente».
   */
  thresholds: {
    // SLO-27: disponibilidad del Gateway, respuestas distintas de 5xx ≥ 99 %.
    http_req_failed: ['rate<0.01'],
    // SLO-7: un comando en menos de 3 s (p95).
    transfer_accept_ms: ['p(95)<3000'],
    // SLO-2: la transferencia cerrada en menos de 5 s (p95).
    transfer_saga_ms: ['p(95)<5000'],
    // Que las comprobaciones de cada iteración no se caigan en silencio.
    checks: ['rate>0.99'],
  },
};

export function setup() {
  const token = login(SEEDED.cliente);
  const accounts = pickAccounts(token);

  console.log(
    `origen ${accounts.sourceAccount} (${String(accounts.sourceBalanceMinor)} centavos) -> destino ${accounts.targetAccount}`,
  );

  return { token, ...accounts };
}

export default function (data) {
  const res = http.post(
    `${GATEWAY}/api/transfers`,
    JSON.stringify({
      sourceAccount: data.sourceAccount,
      targetAccount: data.targetAccount,
      amount: { amountMinor: 100, currency: 'GTQ' },
    }),
    {
      headers: authHeaders(data.token, iterationKey('load-transfer')),
      tags: { name: 'POST /api/transfers' },
    },
  );

  aceptacion.add(res.timings.duration);

  if (!checkAccepted(res)) {
    return;
  }

  awaitTerminal(data.token, res.json('transactionId'), saga);
}
