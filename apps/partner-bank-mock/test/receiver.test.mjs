/**
 * El rol de receptor: lo que NUESTRO banco le manda al mock, ruta por ruta.
 * Cada cuerpo que el mock devuelve se valida contra el esquema del contrato.
 */
import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { validate } from '../src/contract.mjs';
import {
  MOCK_CODE,
  OUR_CODE,
  SEND_KEY,
  closeAll,
  eventually,
  expectContract,
  sleep,
  startMock,
  startOurBank,
  traceparent,
  transferRequest,
} from './support.mjs';

afterEach(closeAll);

const examples = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'contract-examples');

async function started(options = {}) {
  const ourBank = await startOurBank();
  const mock = await startMock({ ourBank, ...options });
  return { ourBank, mock };
}

async function accepted(mock, ourBank, overrides) {
  const request = transferRequest(overrides);
  await expectContract('TransferAck', await mock.send(request), 202);
  await eventually(() => ourBank.of(`${request.interbankTransferId}/result`).length > 0);
  return request;
}

test('health: sin autenticación, y /health dice qué fallo está armado', async () => {
  const { mock } = await started({ faults: { mode: 'REJECT', delayMs: 7 } });

  const contract = await mock.call('GET', '/interbank/v1/health', { key: null, trace: null });
  assert.deepEqual(await contract.json(), { status: 'UP', bankCode: MOCK_CODE });

  const own = await (await fetch(`${mock.url}/health`)).json();
  assert.equal(own.status, 'ok');
  assert.equal(own.callbackMode, 'REJECT');
  assert.equal(own.callbackDelayMs, 7);
  assert.equal(own.faults.mode, 'REJECT');
});

test('POST /transfers: 202 con TransferAck y un callback TransferResult que continúa la traza', async () => {
  const { mock, ourBank } = await started();
  const incoming = traceparent('1'.repeat(32), '2'.repeat(16));
  const request = transferRequest();

  const ack = await expectContract(
    'TransferAck',
    await mock.send(request, { trace: incoming }),
    202,
  );
  assert.equal(ack.interbankTransferId, request.interbankTransferId);
  assert.equal(ack.status, 'PROCESSING');

  const [callback] = await eventually(() =>
    ourBank.of('/result').length > 0 ? ourBank.of('/result') : false,
  );
  assert.equal(callback.method, 'POST');
  assert.equal(callback.path, `/interbank/v1/transfers/${request.interbankTransferId}/result`);
  assert.equal(callback.headers['x-api-key'], SEND_KEY);
  assert.deepEqual(validate('TransferResult', callback.body), []);
  assert.equal(callback.body.status, 'ACCEPTED');
  assert.equal(callback.body.destinationBankCode, MOCK_CODE);
  // La misma traza, con un span nuevo: el callback continúa la traza de la petición.
  const [, traceId, spanId] = callback.headers.traceparent.split('-');
  assert.equal(traceId, '1'.repeat(32));
  assert.notEqual(spanId, '2'.repeat(16));

  const status = await expectContract(
    'TransferStatus',
    await mock.call('GET', `/interbank/v1/transfers/${request.interbankTransferId}`),
    200,
  );
  assert.equal(status.status, 'ACCEPTED');
});

test('idempotencia: el mismo contenido da 200 con el estado actual y no acredita dos veces', async () => {
  const { mock, ourBank } = await started();
  const request = await accepted(mock, ourBank);

  const repeated = await expectContract('TransferStatus', await mock.send(request), 200);
  assert.equal(repeated.status, 'ACCEPTED');
  // Con las claves en otro orden sigue siendo el mismo contenido.
  const shuffled = Object.fromEntries(Object.entries(request).reverse());
  await expectContract('TransferStatus', await mock.send(shuffled), 200);

  await sleep(100);
  assert.equal(ourBank.of('/result').length, 1, 'un callback por depósito, no uno por reenvío');
  const list = await mock.admin('GET', '/admin/received');
  assert.equal(list.body.items.length, 1);
});

test('idempotencia: el mismo id con contenido distinto es 409', async () => {
  const { mock, ourBank } = await started();
  const request = await accepted(mock, ourBank);

  const conflict = await expectContract(
    'Error',
    await mock.send({ ...request, amount: '999.00' }),
    409,
  );
  assert.equal(conflict.code, 'IDEMPOTENCY_CONFLICT');
});

test('400: Idempotency-Key distinto de interbankTransferId, ausente o con otro formato', async () => {
  const { mock } = await started();
  const request = transferRequest();

  const different = await expectContract(
    'Error',
    await mock.send(request, { headers: { 'idempotency-key': randomUUID() } }),
    400,
  );
  assert.equal(different.code, 'VALIDATION_ERROR');
  assert.match(different.message, /Idempotency-Key/);

  const missing = await mock.call('POST', '/interbank/v1/transfers', { body: request });
  assert.equal(missing.status, 400);
  const notUuid = await mock.send(request, { headers: { 'idempotency-key': 'abc' } });
  assert.equal(notUuid.status, 400);
});

test('400: cada ejemplo inválido del contrato se rechaza con un Error del contrato', async () => {
  const { mock } = await started();
  const invalidDir = join(examples, 'TransferRequest', 'invalid');
  const files = readdirSync(invalidDir);
  assert.ok(files.length >= 9);
  for (const file of files) {
    const body = JSON.parse(readFileSync(join(invalidDir, file), 'utf8'));
    const response = await mock.call('POST', '/interbank/v1/transfers', {
      body,
      headers: { 'idempotency-key': body.interbankTransferId },
    });
    const error = await expectContract('Error', response, 400);
    assert.equal(error.code, 'VALIDATION_ERROR', file);
  }
  const received = await mock.admin('GET', '/admin/received');
  assert.equal(received.body.items.length, 0, 'ningún inválido se registra');
});

test('400: JSON roto, monto 0.00 y traceparent ausente o mal formado', async () => {
  const { mock } = await started();
  const request = transferRequest();
  const broken = await mock.call('POST', '/interbank/v1/transfers', {
    body: '{no es json',
    headers: { 'idempotency-key': request.interbankTransferId },
  });
  assert.equal(broken.status, 400);

  const zero = await mock.send({ ...request, amount: '0.00' });
  assert.equal(zero.status, 400);

  assert.equal((await mock.send(request, { trace: null })).status, 400);
  assert.equal((await mock.send(request, { trace: 'no-es-traceparent' })).status, 400);
});

test('401: sin X-Api-Key o con otra, en todas las rutas con autenticación', async () => {
  const { mock } = await started();
  const id = randomUUID();
  const routes = [
    ['POST', '/interbank/v1/transfers', transferRequest()],
    ['GET', `/interbank/v1/transfers/${id}`],
    [
      'POST',
      `/interbank/v1/transfers/${id}/cancel`,
      { originBankCode: OUR_CODE, reason: 'TIMEOUT' },
    ],
    ['POST', `/interbank/v1/transfers/${id}/result`, {}],
    ['POST', '/interbank/v1/reversals', {}],
    ['GET', `/interbank/v1/reversals/${id}`],
    ['GET', '/interbank/v1/reconciliation?date=2026-10-20'],
  ];
  for (const [method, path, body] of routes) {
    for (const key of [null, 'otra-llave']) {
      const error = await expectContract(
        'Error',
        await mock.call(method, path, { body, key }),
        401,
      );
      assert.equal(error.code, 'UNAUTHORIZED', `${method} ${path}`);
    }
  }
});

test('401: un mock sin PARTNER_MOCK_API_KEY configurada falla cerrado', async () => {
  const { mock } = await started({ settings: { requireApiKey: '' } });
  const response = await mock.call('GET', `/interbank/v1/transfers/${randomUUID()}`, { key: '' });
  assert.equal(response.status, 401);
});

test('401: un depósito de otro banco de origen no participa', async () => {
  const { mock } = await started();
  const response = await mock.send(transferRequest({ originBankCode: 'BANK05' }));
  await expectContract('Error', response, 401);
});

test('422: un mensaje que llega después de expiresAt no se procesa', async () => {
  const { mock, ourBank } = await started();
  const past = new Date(Date.now() - 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');
  const request = transferRequest({ expiresAt: past });

  const error = await expectContract('Error', await mock.send(request), 422);
  assert.equal(error.code, 'EXPIRED');
  await sleep(80);
  assert.equal(ourBank.requests.length, 0, 'no hay callback de lo que no se procesó');
  const status = await mock.call('GET', `/interbank/v1/transfers/${request.interbankTransferId}`);
  assert.equal(status.status, 404);
});

test('reglas de negocio del acuerdo: cuenta inexistente, inactiva, monto excedido y banco ajeno', async () => {
  const { mock, ourBank } = await started();
  const cases = [
    [{ destinationAccount: '99-999999999' }, 'ACCOUNT_NOT_FOUND'],
    [{ destinationAccount: '99-000000000' }, 'ACCOUNT_INACTIVE'],
    [{ amount: '10000.01' }, 'AMOUNT_LIMIT_EXCEEDED'],
    [{ destinationBankCode: 'BANK55' }, 'PROCESSING_ERROR'],
  ];
  for (const [overrides, reasonCode] of cases) {
    const request = transferRequest(overrides);
    await expectContract('TransferAck', await mock.send(request), 202);
    const callback = await eventually(() =>
      ourBank.of(`${request.interbankTransferId}/result`).at(0),
    );
    assert.equal(callback.body.status, 'REJECTED');
    assert.equal(callback.body.reasonCode, reasonCode);
    assert.deepEqual(validate('TransferResult', callback.body), []);
  }
  // El máximo exacto sí se acredita.
  const max = await accepted(mock, ourBank, { amount: '10000.00' });
  const status = await mock.call('GET', `/interbank/v1/transfers/${max.interbankTransferId}`);
  assert.equal((await status.json()).status, 'ACCEPTED');
});

test('GET /transfers/{id}: 404 si nunca llegó y 400 si el id no es un UUID', async () => {
  const { mock } = await started();
  const unknown = await expectContract(
    'Error',
    await mock.call('GET', `/interbank/v1/transfers/${randomUUID()}`),
    404,
  );
  assert.equal(unknown.code, 'NOT_FOUND');
  await expectContract('Error', await mock.call('GET', '/interbank/v1/transfers/no-uuid'), 400);
});

test('rutas desconocidas: 404 con el cuerpo de error del contrato', async () => {
  const { mock } = await started();
  const response = await mock.call('GET', '/api/interbank/deposits');
  assert.equal((await expectContract('Error', response, 404)).code, 'NOT_FOUND');
  // El contrato provisional está retirado: no hay Bearer ni /deposits.
  const retired = await mock.call('POST', '/deposits', { body: {} });
  assert.equal(retired.status, 404);
});

test('cancel: un depósito en vuelo queda CANCELLED y ya no genera callback', async () => {
  const { mock, ourBank } = await started({ faults: { delayMs: 150 } });
  const request = transferRequest();
  await mock.send(request);

  const cancel = await expectContract(
    'CancelResponse',
    await mock.call('POST', `/interbank/v1/transfers/${request.interbankTransferId}/cancel`, {
      body: { originBankCode: OUR_CODE, reason: 'TIMEOUT' },
    }),
    200,
  );
  assert.equal(cancel.result, 'CANCELLED');
  // Idempotente.
  const again = await expectContract(
    'CancelResponse',
    await mock.call('POST', `/interbank/v1/transfers/${request.interbankTransferId}/cancel`, {
      body: { originBankCode: OUR_CODE, reason: 'CLIENT_REQUEST' },
    }),
    200,
  );
  assert.equal(again.result, 'CANCELLED');

  await sleep(300);
  assert.equal(ourBank.requests.length, 0);
  const status = await mock.call('GET', `/interbank/v1/transfers/${request.interbankTransferId}`);
  assert.equal((await status.json()).status, 'CANCELLED');
});

test('cancel: ALREADY_ACCEPTED y ALREADY_REJECTED cuando ya hubo desenlace', async () => {
  const { mock, ourBank } = await started();
  const credited = await accepted(mock, ourBank);
  const refused = transferRequest({ destinationAccount: '99-999999999' });
  await mock.send(refused);
  await eventually(() => ourBank.of(`${refused.interbankTransferId}/result`).length > 0);

  const body = { originBankCode: OUR_CODE, reason: 'TIMEOUT' };
  const first = await mock.call(
    'POST',
    `/interbank/v1/transfers/${credited.interbankTransferId}/cancel`,
    { body },
  );
  assert.equal((await expectContract('CancelResponse', first, 200)).result, 'ALREADY_ACCEPTED');
  const second = await mock.call(
    'POST',
    `/interbank/v1/transfers/${refused.interbankTransferId}/cancel`,
    { body },
  );
  assert.equal((await expectContract('CancelResponse', second, 200)).result, 'ALREADY_REJECTED');
});

test('cancel de un id que nunca llegó: CANCELLED, y la llegada tardía del original se rechaza con CANCELLED', async () => {
  const { mock, ourBank } = await started();
  const request = transferRequest();
  const cancel = await mock.call(
    'POST',
    `/interbank/v1/transfers/${request.interbankTransferId}/cancel`,
    {
      body: { originBankCode: OUR_CODE, reason: 'TIMEOUT' },
    },
  );
  assert.equal((await cancel.json()).result, 'CANCELLED');

  // Mientras no llegue el original, no hay depósito que consultar.
  const before = await mock.call('GET', `/interbank/v1/transfers/${request.interbankTransferId}`);
  assert.equal(before.status, 404);

  await expectContract('TransferAck', await mock.send(request), 202);
  const callback = await eventually(() => ourBank.of('/result').at(0));
  assert.equal(callback.body.status, 'REJECTED');
  assert.equal(callback.body.reasonCode, 'CANCELLED');
  assert.deepEqual(validate('TransferResult', callback.body), []);
  const status = await (
    await mock.call('GET', `/interbank/v1/transfers/${request.interbankTransferId}`)
  ).json();
  assert.equal(status.status, 'CANCELLED', 'nunca se acredita');
});

test('cancel: campos de más son válidos; el motivo desconocido, no', async () => {
  const { mock } = await started();
  const id = randomUUID();
  const dir = join(examples, 'CancelRequest');
  const extra = JSON.parse(readFileSync(join(dir, 'with-extra-field.json'), 'utf8'));
  const ok = await mock.call('POST', `/interbank/v1/transfers/${id}/cancel`, { body: extra });
  assert.equal(ok.status, 200);
  const invalid = JSON.parse(readFileSync(join(dir, 'invalid', 'unknown-reason.json'), 'utf8'));
  const bad = await mock.call('POST', `/interbank/v1/transfers/${randomUUID()}/cancel`, {
    body: invalid,
  });
  await expectContract('Error', bad, 400);
});

test('reversals: devuelve el dinero con un depósito NUEVO hacia nuestro banco y es idempotente', async () => {
  const { mock, ourBank } = await started();
  const original = await accepted(mock, ourBank, { amount: '75.50' });
  const reversal = {
    reversalId: randomUUID(),
    originalTransferId: original.interbankTransferId,
    originBankCode: OUR_CODE,
    amount: '75.50',
    currency: 'GTQ',
  };

  const accepted202 = await expectContract(
    'ReversalStatus',
    await mock.call('POST', '/interbank/v1/reversals', { body: reversal }),
    202,
  );
  assert.equal(accepted202.status, 'PROCESSING');

  const completed = await eventually(async () => {
    const body = await expectContract(
      'ReversalStatus',
      await mock.call('GET', `/interbank/v1/reversals/${reversal.reversalId}`),
      200,
    );
    return body.status === 'COMPLETED' ? body : false;
  });
  const refund = ourBank.of('/transfers')[0];
  assert.equal(refund.body.interbankTransferId, completed.refundTransferId);
  assert.deepEqual(validate('TransferRequest', refund.body), []);
  assert.equal(refund.body.originBankCode, MOCK_CODE);
  assert.equal(refund.body.destinationBankCode, OUR_CODE);
  assert.equal(refund.body.destinationAccount, original.originAccount);
  assert.equal(refund.body.amount, '75.50');
  assert.equal(refund.headers['idempotency-key'], refund.body.interbankTransferId);
  assert.equal(refund.headers['x-api-key'], SEND_KEY);

  const replay = await expectContract(
    'ReversalStatus',
    await mock.call('POST', '/interbank/v1/reversals', { body: reversal }),
    202,
  );
  assert.equal(replay.status, 'COMPLETED');
  assert.equal(ourBank.of('/transfers').length, 1, 'un reverso, un depósito de devolución');
});

test('reversals: original desconocido es 404; monto distinto o sin acreditar, FAILED; 400 con el ejemplo inválido', async () => {
  const { mock, ourBank } = await started();
  const base = { originBankCode: OUR_CODE, amount: '10.00', currency: 'GTQ' };

  const unknown = await mock.call('POST', '/interbank/v1/reversals', {
    body: { ...base, reversalId: randomUUID(), originalTransferId: randomUUID() },
  });
  await expectContract('Error', unknown, 404);
  await expectContract(
    'Error',
    await mock.call('GET', `/interbank/v1/reversals/${randomUUID()}`),
    404,
  );

  const original = await accepted(mock, ourBank, { amount: '10.00' });
  const mismatch = {
    ...base,
    amount: '11.00',
    reversalId: randomUUID(),
    originalTransferId: original.interbankTransferId,
  };
  await mock.call('POST', '/interbank/v1/reversals', { body: mismatch });
  const failed = await eventually(async () => {
    const body = await (
      await mock.call('GET', `/interbank/v1/reversals/${mismatch.reversalId}`)
    ).json();
    return body.status === 'FAILED' ? body : false;
  });
  assert.deepEqual(validate('ReversalStatus', failed), []);
  assert.match(failed.reasonMessage, /monto/i);

  const refused = transferRequest({ destinationAccount: '99-999999999' });
  await mock.send(refused);
  await eventually(() => ourBank.of(`${refused.interbankTransferId}/result`).length > 0);
  const notCredited = {
    ...base,
    amount: '150.00',
    reversalId: randomUUID(),
    originalTransferId: refused.interbankTransferId,
  };
  await mock.call('POST', '/interbank/v1/reversals', { body: notCredited });
  await eventually(async () => {
    const body = await (
      await mock.call('GET', `/interbank/v1/reversals/${notCredited.reversalId}`)
    ).json();
    return body.status === 'FAILED';
  });

  for (const file of readdirSync(join(examples, 'ReversalRequest', 'invalid'))) {
    const body = JSON.parse(
      readFileSync(join(examples, 'ReversalRequest', 'invalid', file), 'utf8'),
    );
    await expectContract(
      'Error',
      await mock.call('POST', '/interbank/v1/reversals', { body }),
      400,
    );
  }
  // Un campo de más sí es válido por contrato.
  const extra = JSON.parse(
    readFileSync(join(examples, 'ReversalRequest', 'with-extra-field.json'), 'utf8'),
  );
  const response = await mock.call('POST', '/interbank/v1/reversals', { body: extra });
  assert.notEqual(response.status, 400);
});

test('reconciliation: lista los depósitos del día UTC, paginados, con el esquema del contrato', async () => {
  const { mock, ourBank } = await started();
  for (const amount of ['1.00', '2.00', '3.00']) await accepted(mock, ourBank, { amount });
  const today = new Date().toISOString().slice(0, 10);

  const all = await expectContract(
    'ReconciliationPage',
    await mock.call('GET', `/interbank/v1/reconciliation?date=${today}`),
    200,
  );
  assert.equal(all.totalItems, 3);
  assert.equal(all.page, 1);
  assert.equal(all.pageSize, 100);
  assert.deepEqual(all.items.map((item) => item.amount).sort(), ['1.00', '2.00', '3.00']);

  const second = await expectContract(
    'ReconciliationPage',
    await mock.call('GET', `/interbank/v1/reconciliation?date=${today}&page=2&pageSize=2`),
    200,
  );
  assert.equal(second.items.length, 1);
  assert.equal(second.totalItems, 3);

  const other = await expectContract(
    'ReconciliationPage',
    await mock.call('GET', '/interbank/v1/reconciliation?date=2020-01-01'),
    200,
  );
  assert.deepEqual(other.items, []);

  for (const query of [
    '',
    '?date=ayer',
    `?date=${today}&page=0`,
    `?date=${today}&pageSize=501`,
    `?date=${today}&page=x`,
  ]) {
    await expectContract(
      'Error',
      await mock.call('GET', `/interbank/v1/reconciliation${query}`),
      400,
    );
  }
});

test('logs estructurados: una línea por petición y por cambio de estado, sin secretos', async () => {
  const { mock, ourBank } = await started();
  await accepted(mock, ourBank);
  await mock.call('GET', `/interbank/v1/transfers/${randomUUID()}`, { key: 'llave-equivocada' });

  const events = mock.lines.map((line) => line.event);
  assert.ok(events.includes('http_request'));
  assert.ok(events.includes('transfer_state'));
  assert.ok(events.includes('callback_attempt'));
  const serialized = JSON.stringify(mock.lines);
  assert.ok(!serialized.includes(SEND_KEY), 'la llave que el mock envía no se loguea');
  assert.ok(!serialized.includes('llave-equivocada'), 'la llave presentada no se loguea');
  assert.ok(
    !serialized.includes('token-de-administracion'),
    'el token de administración no se loguea',
  );
  const request = mock.lines.find((line) => line.event === 'http_request');
  assert.match(request.traceId, /^[0-9a-f]{32}$/);
});
