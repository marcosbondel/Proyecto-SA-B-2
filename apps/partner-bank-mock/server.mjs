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
    if (path === '/health') return answer(response, 200, { status: 'ok' });
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
