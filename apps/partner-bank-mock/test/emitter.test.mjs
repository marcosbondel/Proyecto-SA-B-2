/**
 * El rol de emisor: el mock ORIGINA depósitos hacia nuestro banco para probar
 * nuestra ruta de entrada, y recibe nuestro callback.
 */
import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { validate } from '../src/contract.mjs';
import {
  ADMIN_TOKEN,
  MOCK_CODE,
  OUR_CODE,
  REQUIRE_KEY,
  SEND_KEY,
  closeAll,
  expectContract,
  startMock,
  startOurBank,
} from './support.mjs';

afterEach(closeAll);

const examples = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'contract-examples');

/** Un «nuestro banco» que es idempotente de verdad: 202 la primera vez y 200 con el estado en un reenvío. */
async function idempotentBank() {
  const ourBank = await startOurBank();
  const seen = new Map();
  ourBank.respond = (request) => {
    const id = request.body.interbankTransferId;
    const first = !seen.has(id);
    seen.set(id, request.body);
    return {
      status: first ? 202 : 200,
      body: first
        ? { interbankTransferId: id, status: 'PROCESSING', receivedAt: new Date().toISOString() }
        : { interbankTransferId: id, status: 'PROCESSING', updatedAt: new Date().toISOString() },
    };
  };
  return ourBank;
}

test('POST /admin/transfers: origina un TransferRequest del contrato hacia nuestro banco', async () => {
  const ourBank = await idempotentBank();
  const mock = await startMock({ ourBank });

  const response = await mock.admin('POST', '/admin/transfers', {
    destinationAccount: '02-000000052',
    amount: '150.00',
    description: 'prueba del emisor',
  });
  assert.equal(response.status, 202);
  assert.equal(response.body.sends.length, 1);
  assert.equal(response.body.sends[0].httpStatus, 202);
  assert.deepEqual(validate('TransferAck', response.body.sends[0].body), []);

  const [sent] = ourBank.requests;
  assert.equal(sent.method, 'POST');
  assert.equal(sent.path, '/interbank/v1/transfers');
  assert.equal(sent.headers['x-api-key'], SEND_KEY);
  assert.equal(sent.headers['idempotency-key'], sent.body.interbankTransferId);
  assert.equal(sent.headers['idempotency-key'], response.body.interbankTransferId);
  assert.match(sent.headers.traceparent, /^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/);
  assert.equal(sent.headers.traceparent.split('-')[1], response.body.traceId);
  assert.deepEqual(validate('TransferRequest', sent.body), []);
  assert.equal(sent.body.originBankCode, MOCK_CODE);
  assert.equal(sent.body.destinationBankCode, OUR_CODE);
  assert.equal(sent.body.originAccount, '99-000000001');
  assert.equal(sent.body.currency, 'GTQ');
  assert.equal(sent.body.description, 'prueba del emisor');
  assert.equal(Date.parse(sent.body.expiresAt) - Date.parse(sent.body.createdAt), 180_000);
});

test('amount numérico se normaliza a texto con dos decimales', async () => {
  const ourBank = await idempotentBank();
  const mock = await startMock({ ourBank });
  await mock.admin('POST', '/admin/transfers', {
    destinationAccount: '02-000000052',
    amount: 12.5,
  });
  assert.equal(ourBank.requests[0].body.amount, '12.50');
});

test('repeat: reenvía la solicitud IDÉNTICA con la misma Idempotency-Key', async () => {
  const ourBank = await idempotentBank();
  const mock = await startMock({ ourBank });

  const response = await mock.admin('POST', '/admin/transfers', {
    destinationAccount: '02-000000052',
    amount: '20.00',
    repeat: 2,
  });
  assert.equal(response.status, 202);
  assert.deepEqual(
    response.body.sends.map((send) => send.httpStatus),
    [202, 200, 200],
  );
  assert.equal(ourBank.requests.length, 3);
  const [first, ...copies] = ourBank.requests;
  for (const copy of copies) {
    assert.deepEqual(copy.body, first.body);
    assert.equal(copy.headers['idempotency-key'], first.headers['idempotency-key']);
  }

  const record = await mock.admin('GET', `/admin/transfers/${response.body.interbankTransferId}`);
  assert.equal(record.body.sends.length, 3);
  assert.equal(record.body.status, 'SENT');
});

test('repeat fuera de rango o destino ausente: 400', async () => {
  const mock = await startMock({ ourBank: await idempotentBank() });
  assert.equal(
    (
      await mock.admin('POST', '/admin/transfers', {
        destinationAccount: 'x',
        amount: '1.00',
        repeat: -1,
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await mock.admin('POST', '/admin/transfers', {
        destinationAccount: 'x',
        amount: '1.00',
        repeat: 99,
      })
    ).status,
    400,
  );
  assert.equal((await mock.admin('POST', '/admin/transfers', { amount: '1.00' })).status, 400);
  assert.equal(
    (await mock.admin('POST', '/admin/transfers', { destinationAccount: 'x' })).status,
    400,
  );
});

test('un id repetido con contenido distinto llega a nuestro banco con la misma clave (prueba de nuestro 409)', async () => {
  const ourBank = await startOurBank();
  const mock = await startMock({ ourBank });
  const id = randomUUID();
  await mock.admin('POST', '/admin/transfers', {
    interbankTransferId: id,
    destinationAccount: '02-000000052',
    amount: '10.00',
  });
  await mock.admin('POST', '/admin/transfers', {
    interbankTransferId: id,
    destinationAccount: '02-000000052',
    amount: '99.00',
  });

  assert.equal(ourBank.requests.length, 2);
  assert.deepEqual(
    ourBank.requests.map((request) => request.body.amount),
    ['10.00', '99.00'],
  );
  assert.equal(ourBank.requests[1].headers['idempotency-key'], id);
});

test('overrides, idempotencyKey y apiKey: mandar a propósito algo inválido', async () => {
  const ourBank = await startOurBank();
  const mock = await startMock({ ourBank });
  await mock.admin('POST', '/admin/transfers', {
    destinationAccount: '02-000000052',
    amount: '10.00',
    overrides: { expiresAt: null, senderName: 'Ana' },
    idempotencyKey: randomUUID(),
    apiKey: null,
  });
  const [sent] = ourBank.requests;
  assert.equal('expiresAt' in sent.body, false);
  assert.equal(sent.body.senderName, 'Ana');
  assert.notEqual(sent.headers['idempotency-key'], sent.body.interbankTransferId);
  assert.equal(sent.headers['x-api-key'], undefined);
  assert.notEqual(validate('TransferRequest', sent.body).length, 0);
});

test('si nuestro banco no responde, la respuesta del admin lo dice en lugar de fallar', async () => {
  const mock = await startMock({ settings: { ourBaseUrl: 'http://127.0.0.1:1/interbank/v1' } });
  const response = await mock.admin('POST', '/admin/transfers', {
    destinationAccount: '02-000000052',
    amount: '1.00',
  });
  assert.equal(response.status, 202);
  assert.ok(response.body.sends[0].error);
  assert.equal(response.body.sends[0].httpStatus, undefined);
});

test('nuestro callback: se registra, es idempotente y GET /admin/transfers/{id} muestra lo que contestamos', async () => {
  const ourBank = await idempotentBank();
  const mock = await startMock({ ourBank });
  const { body } = await mock.admin('POST', '/admin/transfers', {
    destinationAccount: '02-000000052',
    amount: '5.00',
  });
  const id = body.interbankTransferId;
  const result = {
    interbankTransferId: id,
    destinationBankCode: OUR_CODE,
    status: 'ACCEPTED',
    processedAt: '2026-10-20T15:00:04Z',
  };

  const first = await mock.call('POST', `/interbank/v1/transfers/${id}/result`, { body: result });
  assert.equal((await expectContract('CallbackAck', first, 200)).received, true);
  const second = await mock.call('POST', `/interbank/v1/transfers/${id}/result`, { body: result });
  await expectContract('CallbackAck', second, 200);

  const record = await mock.admin('GET', `/admin/transfers/${id}`);
  assert.equal(record.body.status, 'ACCEPTED');
  assert.equal(record.body.callbacks.length, 2);
  assert.equal(record.body.callbacks[0].duplicate, false);
  assert.equal(record.body.callbacks[1].duplicate, true);
  assert.equal((await mock.admin('GET', '/admin/transfers')).body.items.length, 1);

  // Un resultado contradictorio se acepta (corta los reintentos) pero queda registrado como incidente.
  await mock.call('POST', `/interbank/v1/transfers/${id}/result`, {
    body: { ...result, status: 'REJECTED', reasonCode: 'PROCESSING_ERROR' },
  });
  assert.ok(mock.lines.some((line) => line.event === 'conflicting_callback'));
  assert.equal((await mock.admin('GET', `/admin/transfers/${id}`)).body.status, 'ACCEPTED');
});

test('nuestro callback: 404 de un id ajeno, 400 con los ejemplos inválidos, 401 de otro banco', async () => {
  const mock = await startMock({ ourBank: await idempotentBank() });
  const { body } = await mock.admin('POST', '/admin/transfers', {
    destinationAccount: '02-000000052',
    amount: '5.00',
  });
  const id = body.interbankTransferId;
  const result = {
    interbankTransferId: id,
    destinationBankCode: OUR_CODE,
    status: 'ACCEPTED',
    processedAt: '2026-10-20T15:00:04Z',
  };

  const unknownId = randomUUID();
  await expectContract(
    'Error',
    await mock.call('POST', `/interbank/v1/transfers/${unknownId}/result`, {
      body: { ...result, interbankTransferId: unknownId },
    }),
    404,
  );
  await expectContract(
    'Error',
    await mock.call('POST', `/interbank/v1/transfers/${randomUUID()}/result`, { body: result }),
    400,
  );
  await expectContract(
    'Error',
    await mock.call('POST', `/interbank/v1/transfers/${id}/result`, {
      body: { ...result, destinationBankCode: 'BANK55' },
    }),
    401,
  );
  for (const file of readdirSync(join(examples, 'TransferResult', 'invalid'))) {
    const invalid = JSON.parse(
      readFileSync(join(examples, 'TransferResult', 'invalid', file), 'utf8'),
    );
    const response = await mock.call('POST', `/interbank/v1/transfers/${id}/result`, {
      body: invalid,
    });
    await expectContract('Error', response, 400);
  }
});

test('failTargets=result: nuestro callback recibe 503 N veces (para probar NUESTROS reintentos) y luego 200', async () => {
  const mock = await startMock({
    ourBank: await idempotentBank(),
    faults: { failCount: 2, failTargets: ['result'] },
  });
  const { body } = await mock.admin('POST', '/admin/transfers', {
    destinationAccount: '02-000000052',
    amount: '5.00',
  });
  const id = body.interbankTransferId;
  const result = {
    interbankTransferId: id,
    destinationBankCode: OUR_CODE,
    status: 'ACCEPTED',
    processedAt: '2026-10-20T15:00:04Z',
  };

  const statuses = [];
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await mock.call('POST', `/interbank/v1/transfers/${id}/result`, {
      body: result,
    });
    statuses.push(response.status);
    if (response.status === 503) assert.equal(response.headers.get('retry-after'), '1');
  }
  assert.deepEqual(statuses, [503, 503, 200]);
});

test('administración: sin token configurado es 403, con token equivocado 401, y el token de la API no sirve', async () => {
  const disabled = await startMock({ settings: { adminToken: '' } });
  const noToken = await fetch(`${disabled.url}/admin/config`, {
    headers: { 'x-admin-token': ADMIN_TOKEN },
  });
  assert.equal(noToken.status, 403);

  const mock = await startMock();
  for (const headers of [
    {},
    { 'x-admin-token': 'otro' },
    { 'x-api-key': REQUIRE_KEY },
    { authorization: `Bearer ${ADMIN_TOKEN}` },
  ]) {
    for (const [method, path] of [
      ['GET', '/admin/config'],
      ['PUT', '/admin/config'],
      ['POST', '/admin/reset'],
      ['GET', '/admin/received'],
      ['POST', '/admin/transfers'],
      ['GET', '/admin/transfers'],
    ]) {
      const response = await fetch(`${mock.url}${path}`, { method, headers });
      assert.equal(response.status, 401, `${method} ${path}`);
    }
  }
  assert.equal((await mock.admin('GET', '/admin/config')).status, 200);
});
