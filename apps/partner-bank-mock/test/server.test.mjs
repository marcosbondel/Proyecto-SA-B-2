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
