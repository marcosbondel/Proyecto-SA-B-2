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
 *   k6 run -e PARTNER_BANK_CODE=BANK99 -e PARTNER_ACCOUNT=99-000000123 test/load/interbank.js
 *
 * Es el escenario que §4.1 exige —«el banco pareja no responde, responde lento
 * o rechaza depósitos (simulado con el mock)»— y la carga es la mitad que
 * importa: un rechazo aislado se ve en una prueba E2E, pero lo que hay que
 * saber es si **la compensación aguanta en volumen**. Cien depósitos
 * rechazados son cien débitos que hay que devolver, y si el sistema se queda
 * uno, el dinero se perdió.
 *
 * El fallo se inyecta **con el mock propio**, en caliente y sin reiniciarlo
 * (`PUT /admin/config` de apps/partner-bank-mock; `scenario.sh` lo hace y
 * confirma el modo por su `/health`). El modo inicial del release es
 * `partnerMock.callbackMode`:
 *
 *   ACCEPT       → el camino feliz
 *   REJECT       → el otro banco dice no, y cada depósito compensa
 *   TIMEOUT      → el otro banco no contesta: tras los 180 s del contrato se
 *                  consulta, se cancela y se compensa (minutos, no segundos)
 *   SLOW         → el otro banco tarda; mide la latencia de confirmación (p95)
 *   UNAVAILABLE  → el otro banco contesta 503: hay que reintentar sin duplicar
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

/** El código del banco de enfrente: `^BANK[0-9]{2}$` en el contrato oficial; BANK99 es el mock. */
const PARTNER_BANK_CODE = __ENV.PARTNER_BANK_CODE || 'BANK99';
/**
 * La cuenta de allá, en el formato del banco dueño (`^[A-Za-z0-9-]{1,34}$`).
 * El mock acredita cualquiera salvo las que terminan en `999999999`
 * (ACCOUNT_NOT_FOUND) y `000000000` (ACCOUNT_INACTIVE), como fija el acuerdo.
 */
const PARTNER_ACCOUNT = __ENV.PARTNER_ACCOUNT || '99-000000123';

/**
 * Cuánto se espera a que cada Saga cierre, y el umbral de p95 sobre eso.
 * 45 s alcanza para ACCEPT, REJECT y SLOW; con el mock en TIMEOUT el protocolo
 * del contrato espera los 180 s de `expiresAt` antes de consultar y cancelar,
 * así que `scenario.sh sin-respuesta` los sube (y baja la tasa: cada iteración
 * ocupa un VU mientras espera).
 */
const SAGA_WAIT_MS = Number(__ENV.SAGA_WAIT_MS || 45_000);
const SAGA_P95_MS = Number(__ENV.SAGA_P95_MS || 40_000);

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
      // k6 exige un entero en `rate`: por minuto admite tasas como 0.5/s (30/min).
      rate: Math.max(1, Math.round(TASA * 60)),
      timeUnit: '1m',
      duration: DURACION,
      preAllocatedVUs: 10,
      // Con esperas largas (TIMEOUT) cada iteración retiene su VU hasta que la
      // Saga cierra: hacen falta tantos como llegadas haya en esa espera.
      maxVUs: SAGA_WAIT_MS > 60_000 ? Math.ceil(TASA * (SAGA_WAIT_MS / 1000)) + 10 : 30,
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
    interbank_saga_ms: [`p(95)<${SAGA_P95_MS}`],
    checks: ['rate>0.99'],
  },
};

export function setup() {
  const token = login(SEEDED.cliente);
  const accounts = pickAccounts(token);

  console.log(
    `origen ${accounts.sourceAccount} -> ${PARTNER_BANK_CODE}:${PARTNER_ACCOUNT} (modo del mock: el que tenga armado; su GET /health lo dice)`,
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
   * Hasta `SAGA_WAIT_MS` (45 s por defecto): con el mock en `TIMEOUT`, la Saga
   * no puede cerrar antes de que venza el depósito (180 s del contrato) más la
   * consulta, la cancelación y la compensación. Esperar menos contaría como
   * «sin resolver» algo que estaba funcionando.
   */
  awaitTerminal(data.token, res.json('transactionId'), saga, SAGA_WAIT_MS);
}
