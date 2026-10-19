/**
 * Utilidades de las pruebas del mock: un mock levantado de verdad, un «nuestro
 * banco» falso que captura lo que el mock le manda, y llamadas HTTP reales.
 * Nada aquí dobla el transporte: el mock y el banco falso hablan por sockets.
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';

import { DEFAULT_FAULTS } from '../src/config.mjs';
import { validate } from '../src/contract.mjs';
import { createPartnerBankMock } from '../src/app.mjs';
import { createTelemetry } from '../src/telemetry.mjs';

export const REQUIRE_KEY = 'llave-que-el-mock-exige-de-mas-de-32-caracteres';
export const SEND_KEY = 'llave-que-el-mock-envia-a-nuestro-banco-largas';
export const ADMIN_TOKEN = 'token-de-administracion-del-mock-para-pruebas';
export const MOCK_CODE = 'BANK99';
export const OUR_CODE = 'BANK02';

const opened = [];

export async function listen(server) {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  opened.push(server);
  return `http://127.0.0.1:${server.address().port}`;
}

export async function closeAll() {
  await Promise.all(
    opened.splice(0).map(
      (server) =>
        new Promise((resolve) => {
          server.closeAllConnections?.();
          server.close(resolve);
        }),
    ),
  );
}

export function traceparent(traceId = 'a'.repeat(32), spanId = 'b'.repeat(16)) {
  return `00-${traceId}-${spanId}-01`;
}

/**
 * «Nuestro banco»: lo que el mock llama (callbacks, depósitos, devoluciones).
 * Captura cada petición y contesta con `respond`, que una prueba puede cambiar.
 */
export async function startOurBank() {
  const requests = [];
  const bank = {
    requests,
    url: '',
    /** `(request) => {status, body}`; por defecto un banco que contesta bien. */
    respond(request) {
      if (request.path.endsWith('/result')) {
        return {
          status: 200,
          body: { interbankTransferId: request.body.interbankTransferId, received: true },
        };
      }
      return {
        status: 202,
        body: {
          interbankTransferId: request.body.interbankTransferId,
          status: 'PROCESSING',
          receivedAt: new Date().toISOString(),
        },
      };
    },
    of(suffix) {
      return requests.filter((request) => request.path.endsWith(suffix));
    },
  };
  const server = createServer(async (incoming, outgoing) => {
    const chunks = [];
    for await (const chunk of incoming) chunks.push(chunk);
    const text = Buffer.concat(chunks).toString('utf8');
    const request = {
      method: incoming.method,
      path: incoming.url,
      headers: incoming.headers,
      body: text.length === 0 ? undefined : JSON.parse(text),
    };
    requests.push(request);
    const { status, body } = bank.respond(request);
    outgoing.writeHead(status, { 'content-type': 'application/json' });
    outgoing.end(JSON.stringify(body));
  });
  bank.url = `${await listen(server)}/interbank/v1`;
  return bank;
}

export const FAST_FAULTS = { ...DEFAULT_FAULTS, delayMs: 20, slowMs: 400 };

/** Arranca un mock real apuntando a `ourBank`. `faults` y `settings` pisan los valores de prueba. */
export async function startMock({
  ourBank,
  faults = {},
  settings = {},
  telemetry,
  fetchImpl,
} = {}) {
  const lines = [];
  const resolvedSettings = {
    port: 0,
    bankCode: MOCK_CODE,
    ourBankCode: OUR_CODE,
    ourBaseUrl: ourBank?.url ?? '',
    requireApiKey: REQUIRE_KEY,
    sendApiKey: SEND_KEY,
    adminToken: ADMIN_TOKEN,
    originAccount: '99-000000001',
    requireTraceparent: true,
    callbackRetryBaseMs: 10,
    callbackRetryMaxMs: 40,
    callbackMaxAttempts: 6,
    callbackTimeoutMs: 1_000,
    otlpEndpoint: '',
    telemetryDisabled: true,
    ...settings,
  };
  const server = createPartnerBankMock({
    settings: resolvedSettings,
    faults: { ...FAST_FAULTS, ...faults },
    log: {
      info: (event, fields) => lines.push({ level: 'info', event, ...fields }),
      warn: (event, fields) => lines.push({ level: 'warn', event, ...fields }),
      error: (event, fields) => lines.push({ level: 'error', event, ...fields }),
    },
    ...(telemetry === undefined ? {} : { telemetry }),
    ...(fetchImpl === undefined ? {} : { fetchImpl }),
  });
  const url = await listen(server);

  const call = (
    method,
    path,
    { body, headers = {}, key = REQUIRE_KEY, trace = traceparent() } = {},
  ) =>
    fetch(`${url}${path}`, {
      method,
      headers: {
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        ...(key === null ? {} : { 'x-api-key': key }),
        ...(trace === null ? {} : { traceparent: trace }),
        ...headers,
      },
      body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
    });

  const mock = {
    url,
    server,
    lines,
    call,
    /** POST /interbank/v1/transfers con Idempotency-Key = el id. */
    async send(request, options = {}) {
      return call('POST', '/interbank/v1/transfers', {
        body: request,
        headers: { 'idempotency-key': request.interbankTransferId, ...options.headers },
        ...options,
      });
    },
    async admin(method, path, body) {
      const response = await fetch(`${url}${path}`, {
        method,
        headers: {
          'x-admin-token': ADMIN_TOKEN,
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      return { status: response.status, body: await response.json() };
    },
    configure: (patch) => mock.admin('PUT', '/admin/config', patch),
  };
  return mock;
}

export function transferRequest(overrides = {}) {
  const createdAt = new Date();
  const iso = (date) => date.toISOString().replace(/\.\d{3}Z$/, 'Z');
  return {
    interbankTransferId: randomUUID(),
    originBankCode: OUR_CODE,
    destinationBankCode: MOCK_CODE,
    originAccount: '02-000000052',
    destinationAccount: '99-000000123',
    amount: '150.00',
    currency: 'GTQ',
    description: 'Pago de prueba',
    createdAt: iso(createdAt),
    expiresAt: iso(new Date(createdAt.getTime() + 180_000)),
    ...overrides,
  };
}

/** La respuesta cumple el esquema del contrato — la prueba que importa de un mock. */
export async function expectContract(schema, response, status) {
  const body = await response.json();
  if (status !== undefined) assert.equal(response.status, status, JSON.stringify(body));
  assert.deepEqual(validate(schema, body), [], `${schema} inválido: ${JSON.stringify(body)}`);
  return body;
}

export async function eventually(check, { timeoutMs = 4_000, intervalMs = 10 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    try {
      const value = await check();
      if (value !== false && value !== undefined) return value;
    } catch (error) {
      last = error;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw last ?? new Error('eventually: la condición no se cumplió a tiempo');
}

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export { createTelemetry };
