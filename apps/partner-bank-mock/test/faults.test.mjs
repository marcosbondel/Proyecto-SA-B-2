/**
 * La inyección de fallos: cada modo, el cambio en caliente, los contadores, la
 * tasa aleatoria, los reintentos del callback y el ACCEPTED tardío.
 */
import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { REASON_CODES, validate } from '../src/contract.mjs';
import {
  OUR_CODE,
  closeAll,
  eventually,
  expectContract,
  sleep,
  startMock,
  startOurBank,
  transferRequest,
} from './support.mjs';

afterEach(closeAll);

async function started(options = {}) {
  const ourBank = await startOurBank();
  const mock = await startMock({ ourBank, ...options });
  return { ourBank, mock };
}

const statusOf = async (mock, id) =>
  (await mock.call('GET', `/interbank/v1/transfers/${id}`)).json();
const callbacksOf = (ourBank, request) => ourBank.of(`${request.interbankTransferId}/result`);

test('REJECT: rechaza con cada uno de los siete motivos del contrato', async () => {
  const { mock, ourBank } = await started({ faults: { mode: 'REJECT' } });
  assert.equal(REASON_CODES.length, 7);
  for (const reason of REASON_CODES) {
    const patched = await mock.configure({ rejectReason: reason });
    assert.equal(patched.status, 200);
    const request = transferRequest();
    await expectContract('TransferAck', await mock.send(request), 202);
    const [callback] = await eventually(() =>
      callbacksOf(ourBank, request).length > 0 ? callbacksOf(ourBank, request) : false,
    );
    assert.equal(callback.body.status, 'REJECTED');
    assert.equal(callback.body.reasonCode, reason);
    assert.deepEqual(validate('TransferResult', callback.body), []);
    assert.equal((await statusOf(mock, request.interbankTransferId)).reasonCode, reason);
  }
});

test('REJECT por defecto usa ACCOUNT_NOT_FOUND', async () => {
  const { mock, ourBank } = await started({ faults: { mode: 'REJECT' } });
  const request = transferRequest();
  await mock.send(request);
  const callback = await eventually(() => callbacksOf(ourBank, request).at(0));
  assert.equal(callback.body.reasonCode, 'ACCOUNT_NOT_FOUND');
});

test('TIMEOUT: acepta con 202 y nunca manda callback; GET contesta PROCESSING', async () => {
  const { mock, ourBank } = await started({ faults: { mode: 'TIMEOUT', delayMs: 10 } });
  const request = transferRequest();
  await expectContract('TransferAck', await mock.send(request), 202);
  await sleep(250);

  assert.equal(ourBank.requests.length, 0);
  const status = await expectContract(
    'TransferStatus',
    await mock.call('GET', `/interbank/v1/transfers/${request.interbankTransferId}`),
    200,
  );
  assert.equal(status.status, 'PROCESSING');
});

test('TIMEOUT: statusBehavior NOT_FOUND hace que GET diga 404 y que el cancel funcione', async () => {
  const { mock } = await started({ faults: { mode: 'TIMEOUT', statusBehavior: 'NOT_FOUND' } });
  const request = transferRequest();
  await mock.send(request);

  await expectContract(
    'Error',
    await mock.call('GET', `/interbank/v1/transfers/${request.interbankTransferId}`),
    404,
  );
  const cancel = await mock.call(
    'POST',
    `/interbank/v1/transfers/${request.interbankTransferId}/cancel`,
    {
      body: { originBankCode: OUR_CODE, reason: 'TIMEOUT' },
    },
  );
  assert.equal((await cancel.json()).result, 'CANCELLED');
});

test('TIMEOUT: statusBehavior UNREACHABLE corta la conexión en GET y en cancel, pero /health sigue', async () => {
  const { mock } = await started({ faults: { mode: 'TIMEOUT', statusBehavior: 'UNREACHABLE' } });
  const request = transferRequest();
  await mock.send(request);

  await assert.rejects(mock.call('GET', `/interbank/v1/transfers/${request.interbankTransferId}`));
  await assert.rejects(
    mock.call('POST', `/interbank/v1/transfers/${request.interbankTransferId}/cancel`, {
      body: { originBankCode: OUR_CODE, reason: 'TIMEOUT' },
    }),
  );
  assert.equal((await fetch(`${mock.url}/health`)).status, 200);

  // En caliente: al volver a PROCESSING el banco «reaparece».
  await mock.configure({ statusBehavior: 'PROCESSING' });
  assert.equal((await statusOf(mock, request.interbankTransferId)).status, 'PROCESSING');
});

test('SLOW: el callback sale después de slowMs y no antes', async () => {
  const { mock, ourBank } = await started({ faults: { mode: 'SLOW', slowMs: 350, delayMs: 5 } });
  const request = transferRequest();
  const startedAt = Date.now();
  await mock.send(request);

  await sleep(150);
  assert.equal(callbacksOf(ourBank, request).length, 0, 'aún no debía haber callback');
  assert.equal((await statusOf(mock, request.interbankTransferId)).status, 'PROCESSING');

  const callback = await eventually(() => callbacksOf(ourBank, request).at(0));
  assert.ok(Date.now() - startedAt >= 340);
  assert.equal(callback.body.status, 'ACCEPTED');
});

test('SLOW con ackDelayMs: también el 202 llega tarde', async () => {
  const { mock } = await started({ faults: { ackDelayMs: 250 } });
  const startedAt = Date.now();
  await expectContract('TransferAck', await mock.send(transferRequest()), 202);
  assert.ok(Date.now() - startedAt >= 240);
});

test('UNAVAILABLE: todo el contrato responde 503 con Retry-After, y /health del mock sigue en 200', async () => {
  const { mock } = await started({ faults: { mode: 'UNAVAILABLE' } });
  const request = transferRequest();

  const response = await mock.send(request);
  assert.equal(response.status, 503);
  assert.equal(response.headers.get('retry-after'), '1');
  assert.equal((await expectContract('Error', response.clone(), 503)).code, 'SERVICE_UNAVAILABLE');
  assert.equal((await mock.call('GET', `/interbank/v1/transfers/${randomUUID()}`)).status, 503);
  assert.equal((await mock.call('GET', '/interbank/v1/health', { key: null })).status, 503);
  assert.equal((await fetch(`${mock.url}/health`)).status, 200);
  // Sin llave sigue siendo 401: la autenticación va antes que la disponibilidad.
  assert.equal(
    (await mock.call('GET', `/interbank/v1/transfers/${randomUUID()}`, { key: null })).status,
    401,
  );

  await mock.configure({ mode: 'ACCEPT' });
  assert.equal((await mock.send(request)).status, 202);
});

test('cambio de modo en caliente: el depósito en vuelo conserva su plan y el siguiente usa el nuevo', async () => {
  const { mock, ourBank } = await started({ faults: { mode: 'ACCEPT', delayMs: 120 } });
  const first = transferRequest();
  await mock.send(first);

  const patched = await mock.configure({
    mode: 'REJECT',
    rejectReason: 'ACCOUNT_INACTIVE',
    delayMs: 10,
  });
  assert.equal(patched.body.faults.mode, 'REJECT');
  assert.equal((await (await fetch(`${mock.url}/health`)).json()).callbackMode, 'REJECT');

  const second = transferRequest();
  await mock.send(second);
  const rejected = await eventually(() => callbacksOf(ourBank, second).at(0));
  assert.equal(rejected.body.status, 'REJECTED');
  assert.equal(rejected.body.reasonCode, 'ACCOUNT_INACTIVE');
  const credited = await eventually(() => callbacksOf(ourBank, first).at(0));
  assert.equal(credited.body.status, 'ACCEPTED');
});

test('PUT /admin/config: valida el parche y no cambia nada si es inválido', async () => {
  const { mock } = await started();
  for (const patch of [
    { mode: 'EXPLOTAR' },
    { rejectReason: 'PORQUE_SI' },
    { delayMs: -5 },
    { nuevo: 1 },
    { failureRate: 101 },
  ]) {
    const response = await mock.configure(patch);
    assert.equal(response.status, 400, JSON.stringify(patch));
    assert.equal(response.body.code, 'VALIDATION_ERROR');
  }
  const config = await mock.admin('GET', '/admin/config');
  assert.equal(config.body.faults.mode, 'ACCEPT');
  assert.equal(config.body.settings.requireApiKeyConfigured, true);
  assert.ok(
    !JSON.stringify(config.body).includes('llave-que-el-mock'),
    'la config no expone llaves',
  );
});

test('failTargets=callback, failCount=3: el mock reintenta con espera creciente y entrega al cuarto intento', async () => {
  const { mock, ourBank } = await started({ faults: { failCount: 3, failTargets: ['callback'] } });
  const request = transferRequest();
  await mock.send(request);

  await eventually(async () => {
    const record = await mock.admin('GET', `/admin/received/${request.interbankTransferId}`);
    return record.body.callback.state === 'DELIVERED' ? record.body : false;
  });
  const record = await mock.admin('GET', `/admin/received/${request.interbankTransferId}`);
  assert.equal(record.body.callback.attempts, 4);
  assert.equal(
    callbacksOf(ourBank, request).length,
    1,
    'tres intentos inyectados no salieron a la red',
  );
});

test('el mock reintenta cuando NUESTRO banco contesta 503, y se rinde ante un 4xx', async () => {
  const { mock, ourBank } = await started();
  let failures = 2;
  const respond = ourBank.respond;
  ourBank.respond = (request) => {
    if (request.path.endsWith('/result') && failures > 0) {
      failures -= 1;
      return {
        status: 503,
        body: { code: 'SERVICE_UNAVAILABLE', message: 'x', timestamp: new Date().toISOString() },
      };
    }
    return respond(request);
  };
  const flaky = transferRequest();
  await mock.send(flaky);
  await eventually(async () => {
    const record = await mock.admin('GET', `/admin/received/${flaky.interbankTransferId}`);
    return record.body.callback.state === 'DELIVERED';
  });
  assert.equal(callbacksOf(ourBank, flaky).length, 3);

  ourBank.respond = () => ({
    status: 404,
    body: { code: 'NOT_FOUND', message: 'x', timestamp: new Date().toISOString() },
  });
  const unknown = transferRequest();
  await mock.send(unknown);
  await eventually(async () => {
    const record = await mock.admin('GET', `/admin/received/${unknown.interbankTransferId}`);
    return record.body.callback.state === 'GAVE_UP';
  });
  assert.equal(callbacksOf(ourBank, unknown).length, 1, 'un 404 no se reintenta');
});

test('sin red hacia nuestro banco, el mock agota los intentos y lo registra', async () => {
  const { mock } = await started({
    settings: { ourBaseUrl: 'http://127.0.0.1:1/interbank/v1', callbackMaxAttempts: 3 },
  });
  const request = transferRequest();
  await mock.send(request);
  const record = await eventually(async () => {
    const found = await mock.admin('GET', `/admin/received/${request.interbankTransferId}`);
    return found.body.callback.state === 'GAVE_UP' ? found.body : false;
  });
  assert.equal(record.callback.attempts, 3);
  assert.ok(mock.lines.some((line) => line.event === 'callback_gave_up'));
});

test('failTargets=transfer: los primeros N depósitos reciben 503 y el siguiente 202', async () => {
  const { mock } = await started({ faults: { failCount: 2, failTargets: ['transfer'] } });
  const request = transferRequest();
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = await mock.send(request);
    assert.equal(response.status, 503);
    assert.equal(response.headers.get('retry-after'), '1');
    assert.deepEqual(validate('Error', await response.json()), []);
  }
  await expectContract('TransferAck', await mock.send(request), 202);
  const config = await mock.admin('GET', '/admin/config');
  assert.equal(config.body.remaining.transfer, 0);
});

test('failTargets=status: los primeros N sondeos fallan con 503 y después responde', async () => {
  const { mock } = await started({
    faults: { mode: 'TIMEOUT', failCount: 1, failTargets: ['status'] },
  });
  const request = transferRequest();
  await mock.send(request);
  assert.equal(
    (await mock.call('GET', `/interbank/v1/transfers/${request.interbankTransferId}`)).status,
    503,
  );
  assert.equal(
    (await mock.call('GET', `/interbank/v1/transfers/${request.interbankTransferId}`)).status,
    200,
  );
});

test('failureRate: 100 falla siempre y 0 nunca (con el azar inyectado)', async () => {
  const { mock } = await started({ faults: { failureRate: 100, failTargets: ['transfer'] } });
  for (let index = 0; index < 5; index += 1)
    assert.equal((await mock.send(transferRequest())).status, 503);
  await mock.configure({ failureRate: 0 });
  for (let index = 0; index < 5; index += 1)
    assert.equal((await mock.send(transferRequest())).status, 202);
});

test('failureRate intermedio: hay fallos y hay éxitos', async () => {
  const { mock } = await started({ faults: { failureRate: 50, failTargets: ['transfer'] } });
  const statuses = new Set();
  for (let index = 0; index < 60; index += 1)
    statuses.add((await mock.send(transferRequest())).status);
  assert.deepEqual([...statuses].sort(), [202, 503]);
});

test('cambiar failCount o failTargets rearma los contadores', async () => {
  const { mock } = await started({ faults: { failCount: 1, failTargets: ['transfer'] } });
  assert.equal((await mock.send(transferRequest())).status, 503);
  assert.equal((await mock.send(transferRequest())).status, 202);
  await mock.configure({ failCount: 2 });
  assert.equal((await mock.send(transferRequest())).status, 503);
  assert.equal((await mock.send(transferRequest())).status, 503);
  assert.equal((await mock.send(transferRequest())).status, 202);
});

test('vencimiento: con honorExpiry el receptor rechaza con EXPIRED; sin él acredita tarde', async () => {
  const { mock, ourBank } = await started({ faults: { delayMs: 450 } });
  // Con milisegundos: truncar a segundos podría dejar la hora en el pasado.
  const soon = () => new Date(Date.now() + 250).toISOString();

  const honored = transferRequest({ expiresAt: soon() });
  await expectContract('TransferAck', await mock.send(honored), 202);
  const expired = await eventually(() => callbacksOf(ourBank, honored).at(0));
  assert.equal(expired.body.status, 'REJECTED');
  assert.equal(expired.body.reasonCode, 'EXPIRED');

  await mock.configure({ honorExpiry: false });
  const late = transferRequest({ expiresAt: soon() });
  await expectContract('TransferAck', await mock.send(late), 202);
  const credited = await eventually(() => callbacksOf(ourBank, late).at(0));
  assert.equal(
    credited.body.status,
    'ACCEPTED',
    'el ACCEPTED tardío que prueba nuestro camino de reverso',
  );
  assert.ok(Date.now() > Date.parse(late.expiresAt), 'el callback llegó después de expiresAt');
});

test('callback forzado: un depósito en TIMEOUT recibe después un ACCEPTED tardío cuando se pide', async () => {
  const { mock, ourBank } = await started({ faults: { mode: 'TIMEOUT' } });
  const request = transferRequest();
  await mock.send(request);
  await sleep(60);
  assert.equal(callbacksOf(ourBank, request).length, 0);

  const forced = await mock.admin(
    'POST',
    `/admin/received/${request.interbankTransferId}/callback`,
    {
      status: 'ACCEPTED',
    },
  );
  assert.equal(forced.status, 202);
  const callback = await eventually(() => callbacksOf(ourBank, request).at(0));
  assert.equal(callback.body.status, 'ACCEPTED');
  assert.deepEqual(validate('TransferResult', callback.body), []);
  assert.equal((await statusOf(mock, request.interbankTransferId)).status, 'ACCEPTED');

  const refused = await mock.admin(
    'POST',
    `/admin/received/${request.interbankTransferId}/callback`,
    {
      status: 'REJECTED',
      reasonCode: 'PROCESSING_ERROR',
    },
  );
  assert.equal(refused.status, 202);
  await eventually(() => callbacksOf(ourBank, request).length === 2);

  assert.equal(
    (
      await mock.admin('POST', `/admin/received/${request.interbankTransferId}/callback`, {
        status: 'HOLA',
      })
    ).status,
    400,
  );
  assert.equal(
    (await mock.admin('POST', `/admin/received/${randomUUID()}/callback`, { status: 'ACCEPTED' }))
      .status,
    404,
  );
});

test('reversal FAIL y STALL se inyectan en caliente', async () => {
  const { mock, ourBank } = await started();
  const original = transferRequest();
  await mock.send(original);
  await eventually(() => callbacksOf(ourBank, original).length > 0);
  const body = (id) => ({
    reversalId: id,
    originalTransferId: original.interbankTransferId,
    originBankCode: OUR_CODE,
    amount: original.amount,
    currency: 'GTQ',
  });

  await mock.configure({ reversal: 'FAIL' });
  const failing = randomUUID();
  await mock.call('POST', '/interbank/v1/reversals', { body: body(failing) });
  await eventually(
    async () =>
      (await (await mock.call('GET', `/interbank/v1/reversals/${failing}`)).json()).status ===
      'FAILED',
  );

  await mock.configure({ reversal: 'STALL' });
  const stalled = randomUUID();
  await mock.call('POST', '/interbank/v1/reversals', { body: body(stalled) });
  await sleep(120);
  assert.equal(
    (await (await mock.call('GET', `/interbank/v1/reversals/${stalled}`)).json()).status,
    'PROCESSING',
  );
  assert.equal(ourBank.of('/transfers').length, 0, 'ni FAIL ni STALL mandan la devolución');
});

test('POST /admin/reset borra el estado y restaura los fallos iniciales', async () => {
  const { mock } = await started({ faults: { mode: 'ACCEPT' } });
  await mock.send(transferRequest());
  await mock.configure({ mode: 'TIMEOUT', failCount: 4 });

  const reset = await mock.admin('POST', '/admin/reset');
  assert.equal(reset.status, 200);
  assert.equal(reset.body.faults.mode, 'ACCEPT');
  assert.equal(reset.body.faults.failCount, 0);
  assert.deepEqual((await mock.admin('GET', '/admin/received')).body.items, []);
});
