import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';

import { paymentInterbankReceiveV1 } from '@bank/contracts';

import { createPartnerBankMock } from '../server.mjs';

const TOKEN = 'a-local-partner-token-of-more-than-32-characters';
const opened = [];

async function listen(server) {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  opened.push(server);
  return `http://127.0.0.1:${server.address().port}`;
}

afterEach(async () => {
  await Promise.all(
    opened.splice(0).map((server) => new Promise((resolve) => server.close(resolve))),
  );
});

function call(url, path, body, signal, traceparent) {
  return fetch(`${url}${path}`, {
    method: 'POST',
    signal,
    headers: {
      authorization: `Bearer ${TOKEN}`,
      'content-type': 'application/json',
      ...(traceparent === undefined ? {} : { traceparent }),
    },
    body: JSON.stringify(body),
  });
}

test('forwards a transfer that satisfies the provisional contract', async () => {
  const traceparent = '00-0123456789abcdef0123456789abcdef-0123456789abcdef-01';
  let forwarded;
  const gateway = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    forwarded = {
      path: request.url,
      authorization: request.headers.authorization,
      traceparent: request.headers.traceparent,
      body: JSON.parse(Buffer.concat(chunks).toString('utf8')),
    };
    response.writeHead(202, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ depositId: randomUUID(), correlationId: randomUUID() }));
  });
  const gatewayUrl = await listen(gateway);
  const mockUrl = await listen(createPartnerBankMock({ token: TOKEN, gatewayUrl }));
  const accountId = randomUUID();

  const response = await call(
    mockUrl,
    '/transfers',
    {
      interbankTransferId: 'partner-1',
      accountId,
      amount: { amountMinor: 12500, currency: 'GTQ' },
    },
    undefined,
    traceparent,
  );

  assert.equal(response.status, 202);
  assert.equal(forwarded.path, '/api/interbank/deposits');
  assert.equal(forwarded.authorization, `Bearer ${TOKEN}`);
  assert.equal(forwarded.traceparent, traceparent);
  assert.equal(
    paymentInterbankReceiveV1.schema.safeParse({
      ...forwarded.body,
      depositId: randomUUID(),
      requestedAt: new Date().toISOString(),
    }).success,
    true,
  );
  assert.equal(forwarded.body.accountId, accountId);
});

test('requires the shared token for transfer status and callback', async () => {
  const url = await listen(createPartnerBankMock({ token: TOKEN }));
  assert.equal((await fetch(`${url}/transfers/one`)).status, 401);
  assert.equal((await fetch(`${url}/callbacks/interbank`, { method: 'POST' })).status, 401);
});

test('rejects a callback when configured to simulate a partner outage', async () => {
  const url = await listen(createPartnerBankMock({ token: TOKEN, callbackMode: 'REJECT' }));
  const response = await call(url, '/callbacks/interbank', {
    interbankTransferId: 'one',
    status: 'ACCEPTED',
  });
  assert.equal(response.status, 503);
});

test('delays a slow callback by the configured duration', async () => {
  const url = await listen(
    createPartnerBankMock({ token: TOKEN, callbackMode: 'SLOW', callbackDelayMs: 35 }),
  );
  const start = Date.now();
  const response = await call(url, '/callbacks/interbank', {
    interbankTransferId: 'one',
    status: 'ACCEPTED',
  });
  assert.equal(response.status, 200);
  assert.ok(Date.now() - start >= 30);
});

test('lets the caller time out when configured to delay beyond its deadline', async () => {
  const url = await listen(
    createPartnerBankMock({
      token: TOKEN,
      callbackMode: 'TIMEOUT',
      callbackDelayMs: 0,
      timeoutFloorMs: 60,
    }),
  );
  await assert.rejects(
    call(
      url,
      '/callbacks/interbank',
      { interbankTransferId: 'one', status: 'ACCEPTED' },
      AbortSignal.timeout(10),
    ),
  );
});

test('fails the first callback and then accepts a retry', async () => {
  const url = await listen(createPartnerBankMock({ token: TOKEN, callbackFailCount: 1 }));
  const body = { interbankTransferId: 'one', status: 'ACCEPTED' };
  assert.equal((await call(url, '/callbacks/interbank', body)).status, 503);
  assert.equal((await call(url, '/callbacks/interbank', body)).status, 200);
  const status = await fetch(`${url}/transfers/one`, {
    headers: { authorization: `Bearer ${TOKEN}` },
  });
  assert.equal((await status.json()).status, 'ACCEPTED');
});

/**
 * Los cuatro modos del depósito que este banco ENVÍA (T-51).
 *
 * Es la dirección que el mock no sabía contestar hasta este ticket, y la que el
 * escenario obligatorio de carga necesita poder romper: el enunciado pide
 * «el banco pareja no responde, responde lento o rechaza depósitos», y pide que
 * se simule — nunca tocando el sistema del otro grupo.
 */
function captureCallbacks() {
  const received = [];
  const server = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    received.push({
      path: request.url,
      authorization: request.headers.authorization,
      body: JSON.parse(Buffer.concat(chunks).toString('utf8')),
    });
    response.writeHead(202, { 'content-type': 'application/json' });
    response.end('{}');
  });
  return { received, server };
}

function deposit(id) {
  return {
    interbankTransferId: id,
    idempotencyKey: id,
    originBankCode: 'BANK_USAC',
    destinationBankCode: 'PARTNER_MOCK',
    accountId: 'cuenta-de-alla-1',
    amount: { amountMinor: 12500, currency: 'GTQ' },
    timestamp: new Date().toISOString(),
  };
}

async function until(predicate, budgetMs = 2_000) {
  const deadline = Date.now() + budgetMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await new Promise((done) => setTimeout(done, 10));
  }
  return predicate();
}

test('acknowledges a sent deposit with 202 and accepts it by callback', async () => {
  const { received, server } = captureCallbacks();
  const gatewayUrl = await listen(server);
  const url = await listen(
    createPartnerBankMock({ token: TOKEN, gatewayUrl, callbackMode: 'ACCEPT', callbackDelayMs: 0 }),
  );

  const response = await call(url, '/deposits', deposit('send-1'));

  // 202 y no 200: la decisión llega después, por callback.
  assert.equal(response.status, 202);
  assert.equal(await until(() => received.length === 1), true);
  assert.equal(received[0].path, '/api/interbank/callbacks');
  assert.equal(received[0].authorization, `Bearer ${TOKEN}`);
  assert.equal(received[0].body.interbankTransferId, 'send-1');
  assert.equal(received[0].body.status, 'ACCEPTED');
  assert.equal(typeof received[0].body.receivedAt, 'string');
});

test('rejects a sent deposit with a reason when configured to', async () => {
  const { received, server } = captureCallbacks();
  const gatewayUrl = await listen(server);
  const url = await listen(
    createPartnerBankMock({ token: TOKEN, gatewayUrl, callbackMode: 'REJECT', callbackDelayMs: 0 }),
  );

  assert.equal((await call(url, '/deposits', deposit('send-2'))).status, 202);
  assert.equal(await until(() => received.length === 1), true);
  assert.equal(received[0].body.status, 'REJECTED');
  // Un REJECTED sin motivo no lo acepta el contrato del callback.
  assert.equal(received[0].body.reason, 'ACCOUNT_NOT_FOUND');
});

test('never answers a sent deposit when configured to time out', async () => {
  const { received, server } = captureCallbacks();
  const gatewayUrl = await listen(server);
  const url = await listen(
    createPartnerBankMock({
      token: TOKEN,
      gatewayUrl,
      callbackMode: 'TIMEOUT',
      callbackDelayMs: 0,
    }),
  );

  assert.equal((await call(url, '/deposits', deposit('send-3'))).status, 202);
  await new Promise((done) => setTimeout(done, 150));
  // El acuse salió y la decisión no: es el plazo de confirmación el que corta.
  assert.equal(received.length, 0);
});

test('answers a sent deposit late when configured to be slow', async () => {
  const { received, server } = captureCallbacks();
  const gatewayUrl = await listen(server);
  const url = await listen(
    createPartnerBankMock({
      token: TOKEN,
      gatewayUrl,
      callbackMode: 'SLOW',
      callbackDelayMs: 120,
      timeoutFloorMs: 120,
    }),
  );

  assert.equal((await call(url, '/deposits', deposit('send-4'))).status, 202);
  assert.equal(received.length, 0);
  assert.equal(await until(() => received.length === 1), true);
  assert.equal(received[0].body.status, 'ACCEPTED');
});

test('decides a resent deposit once, by its idempotency key', async () => {
  const { received, server } = captureCallbacks();
  const gatewayUrl = await listen(server);
  const url = await listen(
    createPartnerBankMock({ token: TOKEN, gatewayUrl, callbackMode: 'ACCEPT', callbackDelayMs: 0 }),
  );

  const first = await call(url, '/deposits', deposit('send-5'));
  const again = await call(url, '/deposits', deposit('send-5'));

  assert.equal(first.status, 202);
  assert.equal(again.status, 202);
  assert.equal((await again.json()).duplicate, true);
  assert.equal(await until(() => received.length === 1), true);
  await new Promise((done) => setTimeout(done, 100));
  // Un reenvío no es una segunda decisión, ni un segundo callback.
  assert.equal(received.length, 1);
});

test('refuses a malformed deposit and requires the shared token', async () => {
  const url = await listen(createPartnerBankMock({ token: TOKEN }));
  assert.equal((await call(url, '/deposits', { interbankTransferId: 'x' })).status, 400);
  assert.equal((await fetch(`${url}/deposits`, { method: 'POST' })).status, 401);
});

test('says which failure is armed, and says it without a token', async () => {
  const url = await listen(
    createPartnerBankMock({ token: TOKEN, callbackMode: 'REJECT', callbackDelayMs: 700 }),
  );

  const response = await fetch(`${url}/health`);
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.status, 'ok');
  // Es lo que vuelve a un escenario de carga reproducible: se puede esperar a
  // que el modo sea el pedido en vez de confiar en `kubectl rollout status`.
  assert.equal(body.callbackMode, 'REJECT');
  assert.equal(body.callbackDelayMs, 700);
});
