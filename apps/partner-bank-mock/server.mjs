import { createServer } from 'node:http';
import { randomUUID, createHash, timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

export function createPartnerBankMock(options) {
  const {
    gatewayUrl = 'http://localhost:3000',
    token = '',
    bankCode = 'PARTNER_MOCK',
    destinationBankCode = 'BANK_USAC',
    callbackMode = 'ACCEPT',
    callbackDelayMs = 1000,
    callbackFailCount = 0,
    timeoutFloorMs = 4000,
  } = options;
  if (!['ACCEPT', 'REJECT', 'TIMEOUT', 'SLOW'].includes(callbackMode))
    throw new Error('Invalid PARTNER_CALLBACK_MODE');
  if (
    !Number.isInteger(callbackDelayMs) ||
    callbackDelayMs < 0 ||
    !Number.isInteger(callbackFailCount) ||
    callbackFailCount < 0
  ) {
    throw new Error('Invalid partner callback timing');
  }
  let failuresLeft = callbackFailCount;
  const transfers = new Map();
  /** Los depósitos que este banco ENVIÓ al mock, por clave de idempotencia. */
  const deposits = new Map();

  /**
   * Devolverle a nuestro Gateway la decisión sobre un depósito que le enviamos.
   *
   * No reintenta. Es deliberado: si el callback no llega, lo correcto es que
   * nuestro plazo de confirmación venza y compense — y un mock que reintenta
   * hasta lograrlo esconde exactamente el fallo que hay que poder inyectar.
   */
  async function answerBack(interbankTransferId, decision, traceparent) {
    try {
      await fetch(new URL('/api/interbank/callbacks', gatewayUrl), {
        method: 'POST',
        redirect: 'error',
        signal: AbortSignal.timeout(5_000),
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${token}`,
          ...(typeof traceparent === 'string' &&
          /^00-[\da-f]{32}-[\da-f]{16}-[\da-f]{2}$/i.test(traceparent)
            ? { traceparent }
            : {}),
        },
        body: JSON.stringify({
          interbankTransferId,
          ...decision,
          receivedAt: new Date().toISOString(),
        }),
      });
    } catch {
      /* Un callback que no sale es un depósito que vence. Así está diseñado. */
    }
  }

  function authorized(request) {
    if (token.length === 0) return false;
    const match = /^Bearer\s+(\S+)$/i.exec(request.headers.authorization ?? '');
    if (match === null) return false;
    const expected = createHash('sha256').update(token).digest();
    const actual = createHash('sha256').update(match[1]).digest();
    return timingSafeEqual(expected, actual);
  }

  async function bodyOf(request) {
    let text = '';
    for await (const chunk of request) {
      text += chunk;
      if (text.length > 16_384) throw new Error('Body too large');
    }
    return JSON.parse(text);
  }

  function answer(response, status, body) {
    response.writeHead(status, { 'content-type': 'application/json' });
    response.end(JSON.stringify(body));
  }

  return createServer(async (request, response) => {
    const path = new URL(request.url ?? '/', 'http://localhost').pathname;
    /*
     * `/health` dice además **qué fallo está armado**, sin token.
     *
     * No es un secreto y sí es la pregunta que se hace cualquiera que vea un
     * depósito rechazado: ¿está el mock en REJECT o es el otro banco? Durante
     * la primera corrida de T-51 esa pregunta costó una medición entera: el
     * modo se cambió con `kubectl set env`, `rollout status` dijo que había
     * terminado mientras el pod viejo seguía en los Endpoints, y la mitad de la
     * carga se midió contra el modo anterior.
     */
    if (path === '/health')
      return answer(response, 200, { status: 'ok', callbackMode, callbackDelayMs });
    if (!authorized(request)) return answer(response, 401, { error: 'unauthorized' });

    try {
      if (request.method === 'POST' && path === '/transfers') {
        const body = await bodyOf(request);
        const interbankTransferId = body.interbankTransferId ?? randomUUID();
        const idempotencyKey = body.idempotencyKey ?? interbankTransferId;
        const traceparent = request.headers.traceparent;
        const upstream = await fetch(new URL('/api/interbank/deposits', gatewayUrl), {
          method: 'POST',
          redirect: 'error',
          signal: AbortSignal.timeout(5_000),
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${token}`,
            ...(typeof traceparent === 'string' &&
            /^00-[\da-f]{32}-[\da-f]{16}-[\da-f]{2}$/i.test(traceparent)
              ? { traceparent }
              : {}),
          },
          body: JSON.stringify({
            interbankTransferId,
            idempotencyKey,
            originBankCode: bankCode,
            destinationBankCode,
            accountId: body.accountId,
            amount: body.amount,
          }),
        });
        const result = await upstream.json();
        if (upstream.status === 202)
          transfers.set(interbankTransferId, { ...result, status: 'PENDING' });
        return answer(response, upstream.status, { interbankTransferId, ...result });
      }

      if (request.method === 'POST' && path === '/callbacks/interbank') {
        const body = await bodyOf(request);
        if (
          typeof body.interbankTransferId !== 'string' ||
          !['ACCEPTED', 'REJECTED'].includes(body.status)
        ) {
          return answer(response, 400, { error: 'invalid callback' });
        }
        if (failuresLeft > 0) {
          failuresLeft -= 1;
          return answer(response, 503, { error: 'simulated callback failure' });
        }
        if (callbackMode === 'REJECT')
          return answer(response, 503, { error: 'simulated callback rejection' });
        if (callbackMode === 'TIMEOUT')
          await new Promise((done) => setTimeout(done, Math.max(callbackDelayMs, timeoutFloorMs)));
        if (callbackMode === 'SLOW') await new Promise((done) => setTimeout(done, callbackDelayMs));
        transfers.set(body.interbankTransferId, body);
        return answer(response, 200, { received: true });
      }

      /*
       * Un depósito que ESTE banco ENVÍA al pareja (T-47).
       *
       * Es la dirección contraria a `/transfers`, y la distinción es la razón
       * de que sean dos rutas y no una: en `/transfers` el mock hace de banco
       * que *origina* un depósito hacia nosotros, y en `/deposits` hace de
       * banco que *recibe* uno nuestro. Hasta T-51 sólo existía la primera, así
       * que un envío nuestro no tenía a quién preguntarle y vencía siempre.
       *
       * `202` y nunca `200`: un `200` significaría que el otro banco ya decidió,
       * y entonces su callback —de donde sale la decisión— no llegaría nunca.
       * Es la misma regla que `HttpPartnerBankClient` exige del lado nuestro.
       *
       * La decisión sale de `callbackMode`, que es el único interruptor de
       * inyección de fallos de todo el mock:
       *
       *   ACCEPT   → ACCEPTED tras `callbackDelayMs`
       *   REJECT   → REJECTED tras `callbackDelayMs`
       *   SLOW     → ACCEPTED tras `max(callbackDelayMs, timeoutFloorMs)`
       *   TIMEOUT  → sin callback, nunca; que venza el plazo de los 30 s
       */
      if (request.method === 'POST' && path === '/deposits') {
        const body = await bodyOf(request);
        if (
          typeof body.interbankTransferId !== 'string' ||
          typeof body.accountId !== 'string' ||
          typeof body.amount?.amountMinor !== 'number'
        ) {
          return answer(response, 400, { error: 'invalid deposit' });
        }
        const key = body.idempotencyKey ?? body.interbankTransferId;
        /*
         * Intake idempotente: el mismo `idempotencyKey` no se decide dos veces
         * ni programa un segundo callback. Un banco real contesta así, y si
         * contestara dos veces estaríamos midiendo nuestra deduplicación en vez
         * de la compensación, que es lo que este escenario viene a medir.
         */
        if (deposits.has(key)) {
          return answer(response, 202, { ...deposits.get(key), duplicate: true });
        }
        const decision =
          callbackMode === 'REJECT'
            ? { status: 'REJECTED', reason: 'ACCOUNT_NOT_FOUND' }
            : { status: 'ACCEPTED' };
        const record = { interbankTransferId: body.interbankTransferId, ...decision };
        deposits.set(key, record);

        if (callbackMode !== 'TIMEOUT') {
          const delay =
            callbackMode === 'SLOW' ? Math.max(callbackDelayMs, timeoutFloorMs) : callbackDelayMs;
          /*
           * Sin `await`: el acuse de recibo sale ya, y la decisión viaja
           * después por su propio camino. Esperar aquí convertiría el callback
           * en una respuesta sincrónica, que es precisamente lo que este flujo
           * no es.
           */
          setTimeout(() => {
            void answerBack(body.interbankTransferId, decision, request.headers.traceparent);
          }, delay).unref();
        }
        return answer(response, 202, record);
      }

      if (request.method === 'GET' && path.startsWith('/deposits/')) {
        const id = decodeURIComponent(path.slice('/deposits/'.length));
        const deposit = deposits.get(id);
        return answer(
          response,
          deposit === undefined ? 404 : 200,
          deposit ?? { error: 'unknown deposit' },
        );
      }

      if (request.method === 'GET' && path.startsWith('/transfers/')) {
        const id = decodeURIComponent(path.slice('/transfers/'.length));
        const transfer = transfers.get(id);
        return answer(
          response,
          transfer === undefined ? 404 : 200,
          transfer ?? { error: 'unknown transfer' },
        );
      }
      return answer(response, 404, { error: 'not found' });
    } catch {
      return answer(response, 502, { error: 'partner mock request failed' });
    }
  });
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PARTNER_MOCK_PORT ?? 3021);
  createPartnerBankMock({
    gatewayUrl: process.env.PARTNER_GATEWAY_URL,
    token: process.env.INTERBANK_PARTNER_TOKEN,
    bankCode: process.env.INTERBANK_PARTNER_BANK_CODE,
    destinationBankCode: process.env.INTERBANK_BANK_CODE,
    callbackMode: process.env.PARTNER_CALLBACK_MODE,
    callbackDelayMs: Number(process.env.PARTNER_CALLBACK_DELAY_MS ?? 1000),
    callbackFailCount: Number(process.env.PARTNER_CALLBACK_FAIL_COUNT ?? 0),
  }).listen(port, () => process.stdout.write(`partner-bank-mock listening on ${port}\n`));
}
