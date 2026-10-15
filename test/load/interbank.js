import { Trend } from 'k6/metrics';
import http from 'k6/http';

import {
  GATEWAY,
  SEEDED,
  authHeaders,
  awaitTerminal,
  checkAccepted,
  iterationKey,
  login,
  pickAccounts,
  useSloFailureDefinition,
} from './support.js';

/**
 * La carga sobre el depósito al banco pareja (T-51, escenario obligatorio).
 *
 *   k6 run test/load/interbank.js
 *   k6 run -e PARTNER_BANK_CODE=PARTNER_MOCK test/load/interbank.js
 *
 * Es el escenario que §4.1 exige —«el banco pareja no responde, responde lento
 * o rechaza depósitos (simulado con el mock)»— y la carga es la mitad que
 * importa: un rechazo aislado se ve en una prueba E2E, pero lo que hay que
 * saber es si **la compensación aguanta en volumen**. Cien depósitos
 * rechazados son cien débitos que hay que devolver, y si el sistema se queda
 * uno, el dinero se perdió.
 *
 * El fallo se inyecta **con el mock propio**, cambiando `partnerMock.callbackMode`:
 *
 *   ACCEPT   → el camino feliz
 *   REJECT   → el otro banco dice no, y cada depósito compensa
 *   TIMEOUT  → el otro banco no contesta, y el vencimiento compensa
 *   SLOW     → el otro banco tarda; mide la latencia de confirmación (p95)
 *
 * Nunca apagando ni alterando el sistema del otro grupo, que es la regla
 * explícita del enunciado.
 *
 * Los umbrales son distintos a los de `transfer.js` a propósito: aquí se espera
 * que la Saga **termine**, no que termine bien. Un `COMPENSATED` es éxito del
 * sistema — el dinero volvió — y contarlo como fallo haría que el escenario de
 * rechazo pareciera una avería.
 */

const aceptacion = new Trend('interbank_accept_ms', true);
const saga = new Trend('interbank_saga_ms', true);

/**
 * La tasa y la duración, por entorno.
 *
 * Cuatro por segundo durante un minuto responde «¿aguanta la compensación en
 * volumen?». Lo que **no** responde es «¿suena la alerta?»: `PartnerBankSendDegraded`
 * exige el SLI por debajo del 95 % durante cinco minutos, y una ráfaga de
 * sesenta segundos sólo lo sostiene mientras la ventana de `rate(…[5m])` la
 * recuerda. Para esa pregunta hace falta una corrida larga:
 *
 *   TASA=2 DURACION=7m k6 run test/load/interbank.js
 */
const TASA = Number(__ENV.TASA || 4);
const DURACION = __ENV.DURACION || '60s';

const PARTNER_BANK_CODE = __ENV.PARTNER_BANK_CODE || 'PARTNER_MOCK';
/** La cuenta de allá. El mock no la valida; el banco pareja real sí lo hará. */
const PARTNER_ACCOUNT = __ENV.PARTNER_ACCOUNT || 'cuenta-de-carga-1';

useSloFailureDefinition();

export const options = {
  scenarios: {
    depositos: {
      /*
       * Tasa constante y no rampa: para el escenario de fallo lo que importa
       * es cuántas compensaciones por segundo tiene que sostener el sistema,
       * no cómo reacciona a un escalón. Con `arrival-rate` ese número es el
       * que se pide, no el que salga de la latencia.
       */
      executor: 'constant-arrival-rate',
      rate: TASA,
      timeUnit: '1s',
      duration: DURACION,
      preAllocatedVUs: 10,
      maxVUs: 30,
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],
    interbank_accept_ms: ['p(95)<3000'],
    /*
     * Más holgado que SLO-2 (5 s) y es deliberado: con `TIMEOUT` el
     * vencimiento de la confirmación es de 30 s por configuración, así que una
     * Saga que compensa correctamente tarda eso. Lo que este umbral vigila es
     * que **termine**, no que sea rápida — el número de 5 s es para
     * transferencias internas, y aplicarlo aquí haría fallar al sistema por
     * esperar exactamente lo que se le configuró esperar.
     */
    interbank_saga_ms: ['p(95)<40000'],
    checks: ['rate>0.99'],
  },
};

export function setup() {
  const token = login(SEEDED.cliente);
  const accounts = pickAccounts(token);

  console.log(
    `origen ${accounts.sourceAccount} -> ${PARTNER_BANK_CODE}:${PARTNER_ACCOUNT} (modo del mock: el que tenga el release)`,
  );

  return { token, sourceAccount: accounts.sourceAccount };
}

export default function (data) {
  const res = http.post(
    `${GATEWAY}/api/interbank/transfers`,
    JSON.stringify({
      sourceAccount: data.sourceAccount,
      destinationBankCode: PARTNER_BANK_CODE,
      destinationAccount: PARTNER_ACCOUNT,
      amount: { amountMinor: 100, currency: 'GTQ' },
    }),
    {
      headers: authHeaders(data.token, iterationKey('load-interbank')),
      tags: { name: 'POST /api/interbank/transfers' },
    },
  );

  aceptacion.add(res.timings.duration);

  if (!checkAccepted(res)) {
    return;
  }

  /*
   * Hasta 45 s: con el mock en `TIMEOUT`, la Saga no puede cerrar antes de que
   * venza la confirmación (30 s por configuración) más la compensación.
   * Esperar menos contaría como «sin resolver» algo que estaba funcionando.
   */
  awaitTerminal(data.token, res.json('transactionId'), saga, 45_000);
}
