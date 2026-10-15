import { check, fail, sleep } from 'k6';
import http from 'k6/http';

/**
 * Lo compartido por las pruebas de carga (T-51, §4.1 — Pruebas de carga y
 * escenarios de fallo).
 *
 * **Contra el Gateway, no contra un servicio.** La carga tiene que entrar por
 * donde entra un cliente: medir `payment-service` directamente daría números
 * bonitos de un servicio que nadie usa así, y dejaría fuera la cola de réplica
 * del Gateway, el `request/reply` de cinco segundos y el broker — que es donde
 * un sistema asíncrono se degrada primero.
 *
 * Los umbrales de cada script son los **mismos números** que los SLO de
 * `docs/sre/sli-slo-sla.md` §5.3 y las alertas de T-50. No es simetría: es la
 * única forma de que «la prueba de carga pasó» y «el SLO se cumplió» signifiquen
 * lo mismo. Un umbral inventado aquí sería una segunda definición de
 * confiabilidad que nadie reconcilia.
 */

/**
 * Qué cuenta como petición fallida, y por qué no es lo que k6 cree por defecto.
 *
 * Para k6, «fallida» es cualquier cosa que no sea `2xx`. Para **SLO-27** es una
 * respuesta `5xx`, y la diferencia no es un detalle: el bucle que sigue una
 * transferencia recién aceptada recibe `404` legítimos —el `202` llega antes de
 * que otro servicio escriba la fila— y con el criterio de k6 una prueba
 * perfectamente sana cruzaba el umbral con un 6 % de «fallos» que eran el
 * sistema funcionando como está diseñado.
 *
 * Así que la prueba de carga usa la definición del SLO. Si las dos se
 * contradijeran, «la carga pasó» y «el SLO se cumplió» dejarían de significar
 * lo mismo, que es justo lo que estos umbrales existen para evitar.
 *
 * **Se llama desde el ámbito del módulo, no desde `options`.** `options`
 * acepta un campo `responseCallback` sin quejarse... y lo ignora: k6 sólo lo
 * avisa como «unknown field» por consola. Con esa forma el umbral seguía
 * midiendo la definición de k6 y parecía configurado. Es el tipo de error que
 * no falla: simplemente no hace nada.
 */
export function useSloFailureDefinition() {
  http.setResponseCallback(http.expectedStatuses({ min: 200, max: 499 }));
}

export const GATEWAY = __ENV.GATEWAY_URL || 'http://localhost:3000';
const SEED_PASSWORD = __ENV.SEED_PASSWORD || 'BankUsac#2026';

/** Los tres usuarios que siembra `SEED_DEMO_DATA`. */
export const SEEDED = {
  admin: { email: 'admin@bankusac.gt', credential: SEED_PASSWORD },
  cajero: { email: 'cajero@bankusac.gt', credential: SEED_PASSWORD },
  cliente: { email: 'cliente@bankusac.gt', credential: SEED_PASSWORD },
};

/**
 * Inicia sesión una vez, en `setup()`.
 *
 * Que el login quede fuera del bucle es deliberado: si cada iteración se
 * autenticara, la mitad de la carga serían logins y el p95 de la transferencia
 * mediría scrypt en vez de la Saga. El escenario «qué pasa si todos entran a la
 * vez» es una prueba distinta y no es la que §4.1 pide.
 *
 * El campo es `credential`, no `password`: lo nombra así el DTO del Gateway, y
 * mandar `password` da un 400 que parece un login fallido.
 */
export function login(user) {
  const res = http.post(`${GATEWAY}/api/auth/login`, JSON.stringify(user), {
    headers: { 'Content-Type': 'application/json' },
    tags: { name: 'POST /api/auth/login' },
  });

  if (res.status !== 200) {
    fail(`el login de ${user.email} devolvio ${res.status}: ${res.body}`);
  }

  return res.json('token');
}

export function authHeaders(token, idempotencyKey) {
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  };

  if (idempotencyKey !== undefined) {
    // Única por iteración. Repetirla haría que el sistema reconociera la misma
    // transferencia — que es correcto, y convertiría la prueba de carga en una
    // prueba de idempotencia con una sola transferencia de verdad.
    headers['Idempotency-Key'] = idempotencyKey;
  }

  return headers;
}

/**
 * Las dos cuentas de la carga, **descubiertas** y no compiladas.
 *
 * Un identificador de cuenta escrito en un script es un identificador que está
 * mal la primera vez que alguien resiembra la base — la misma razón por la que
 * el catálogo de billers existe en vez de estar en el bundle del navegador.
 *
 * Elige la de mayor saldo como origen y otra activa del mismo titular como
 * destino. Prefiere una MONETARIA como origen: debitar una AHORRO cobra
 * comisión por movimiento (la regla de tipo de cuenta de la Fase 2), y una
 * prueba de carga que la pague estaría midiendo también el drenaje del saldo.
 */
export function pickAccounts(token) {
  const res = http.get(`${GATEWAY}/api/accounts`, {
    headers: authHeaders(token),
    tags: { name: 'GET /api/accounts' },
  });

  if (res.status !== 200) {
    fail(`GET /api/accounts devolvio ${res.status}`);
  }

  const active = res.json('accounts').filter((a) => a.status === 'ACTIVE');
  const monetarias = active
    .filter((a) => a.accountType === 'MONETARIA')
    .sort((a, b) => b.balance.amountMinor - a.balance.amountMinor);
  const source = monetarias[0];

  if (source === undefined) {
    fail('el cliente sembrado no tiene ninguna cuenta MONETARIA activa');
  }

  const target = active.find(
    (a) => a.accountId !== source.accountId && a.customerId === source.customerId,
  );

  if (target === undefined) {
    fail('el cliente sembrado solo tiene una cuenta activa: no hay destino propio');
  }

  return {
    sourceAccount: source.accountId,
    targetAccount: target.accountId,
    sourceBalanceMinor: source.balance.amountMinor,
  };
}

/** Un identificador por iteración, suficiente para no repetir claves. */
export function iterationKey(prefix) {
  return `${prefix}-${__VU}-${__ITER}-${Date.now()}`;
}

/**
 * Sigue una transferencia hasta un estado final, o se rinde.
 *
 * Se rinde **sin fallar la iteración**: un `202` significa aceptada, y que la
 * Saga tarde más que la paciencia de este bucle no es un error del sistema.
 * Lo que mide es cuánto tardó en cerrarse, que es el SLI de SLO-2; lo que no
 * hace es declarar roto lo que simplemente sigue en curso.
 */
export function awaitTerminal(token, transactionId, sagaDuration, budgetMs = 15_000) {
  const TERMINAL = ['COMPLETED', 'COMPENSATED', 'FAILED'];
  const startedAt = Date.now();

  while (Date.now() - startedAt < budgetMs) {
    const res = http.get(`${GATEWAY}/api/transfers/${transactionId}`, {
      headers: authHeaders(token),
      // Una sola etiqueta para todos los sondeos: sin esto, cada
      // transactionId seria una serie distinta en el informe de k6.
      tags: { name: 'GET /api/transfers/{id}' },
    });

    if (res.status === 200) {
      const status = res.json('status');

      if (TERMINAL.includes(status)) {
        sagaDuration.add(Date.now() - startedAt, { result: status });

        return status;
      }
    }

    /*
     * Un segundo, y no 250 ms.
     *
     * `GET /api/transfers/{id}` es request/reply: cada sondeo es un viaje de
     * ida y vuelta por el MISMO broker que la Saga necesita para avanzar. A
     * 250 ms por sondeo y quince usuarios, la prueba se metía sesenta
     * peticiones por segundo de competencia contra el sistema que estaba
     * midiendo — y el número que salía era peor por culpa del medidor.
     *
     * Un segundo es resolución de sobra para un SLO de cinco.
     *
     * El `404` también cae aquí: el `202` llega antes de que otro servicio
     * escriba la fila, y eso no es un error de nadie.
     */
    sleep(1);
  }

  sagaDuration.add(Date.now() - startedAt, { result: 'UNSETTLED' });

  return 'UNSETTLED';
}

/** Las dos comprobaciones que toda iteración hace, para que el informe las cuente. */
export function checkAccepted(res) {
  return check(res, {
    'la transferencia fue aceptada (202)': (r) => r.status === 202,
    'la respuesta trae su transactionId': (r) => r.json('transactionId') !== undefined,
  });
}
