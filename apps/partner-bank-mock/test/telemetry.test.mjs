/**
 * La traza del mock: el `traceId` de `traceparent` es el mismo de punta a punta,
 * y los spans salen por OTLP/HTTP cuando hay colector.
 */
import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';

import { createTelemetry, parseTraceparent } from '../src/telemetry.mjs';
import {
  closeAll,
  eventually,
  listen,
  startMock,
  startOurBank,
  traceparent,
  transferRequest,
} from './support.mjs';

afterEach(closeAll);

/** Un colector OTLP falso que guarda los spans que recibe. */
async function startCollector() {
  const spans = [];
  const resources = [];
  const server = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    assert.equal(request.url, '/v1/traces');
    for (const resource of body.resourceSpans) {
      resources.push(resource.resource);
      for (const scope of resource.scopeSpans) spans.push(...scope.spans);
    }
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end('{}');
  });
  return { spans, resources, url: await listen(server) };
}

test('parseTraceparent: acepta el formato W3C y rechaza lo demás', () => {
  assert.deepEqual(parseTraceparent(traceparent()), {
    traceId: 'a'.repeat(32),
    spanId: 'b'.repeat(16),
    flags: '01',
  });
  for (const bad of [
    undefined,
    '',
    'x',
    `00-${'0'.repeat(32)}-${'b'.repeat(16)}-01`,
    `01-${'a'.repeat(32)}-${'b'.repeat(16)}-01`,
  ]) {
    assert.equal(parseTraceparent(bad), null);
  }
});

test('un span hijo conserva el traceId, cambia el spanId y lleva su propio traceparent', () => {
  const telemetry = createTelemetry({ disabled: true });
  const server = telemetry.startSpan({ name: 's', parent: parseTraceparent(traceparent()) });
  const client = telemetry.startSpan({
    name: 'c',
    kind: 'client',
    parent: parseTraceparent(server.traceparent),
  });
  assert.equal(server.traceId, 'a'.repeat(32));
  assert.equal(client.traceId, server.traceId);
  assert.notEqual(server.spanId, 'b'.repeat(16));
  assert.notEqual(client.spanId, server.spanId);
  assert.equal(client.traceparent, `00-${client.traceId}-${client.spanId}-01`);
  assert.equal(telemetry.startSpan({ name: 'raíz' }).traceId.length, 32);
});

test('sin endpoint o con OTEL_SDK_DISABLED no se exporta nada, pero el traceparent se propaga', async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return { ok: true };
  };
  for (const options of [{ endpoint: '' }, { endpoint: 'http://colector:4318', disabled: true }]) {
    const telemetry = createTelemetry({ ...options, fetchImpl });
    const span = telemetry.startSpan({ name: 's' });
    span.end();
    await telemetry.shutdown();
    assert.equal(telemetry.exporting, false);
    assert.match(span.traceparent, /^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/);
  }
  assert.equal(calls, 0);
});

test('un colector caído no rompe nada y se avisa una sola vez', async () => {
  const warnings = [];
  const telemetry = createTelemetry({
    endpoint: 'http://127.0.0.1:1',
    onExportError: (error) => warnings.push(error),
  });
  for (let index = 0; index < 3; index += 1) {
    telemetry.startSpan({ name: 's' }).end();
    await telemetry.flush();
  }
  await telemetry.shutdown();
  assert.equal(warnings.length, 1);
});

test('la traza cruza el mock: SERVER hijo de la petición, CLIENT hijo del SERVER, y el callback lleva el mismo traceId', async () => {
  const collector = await startCollector();
  const telemetry = createTelemetry({
    endpoint: collector.url,
    flushIntervalMs: 20,
    version: 'abc123',
    environment: 'dev',
  });
  const ourBank = await startOurBank();
  const mock = await startMock({ ourBank, telemetry });
  const incoming = traceparent('c'.repeat(32), 'd'.repeat(16));
  const request = transferRequest();

  await mock.send(request, { trace: incoming });
  const callback = await eventually(() => ourBank.of('/result').at(0));
  const [, traceId, callbackParent] = callback.headers.traceparent.split('-');
  assert.equal(traceId, 'c'.repeat(32));

  const spans = await eventually(() => {
    const found = collector.spans.filter((span) => span.traceId === 'c'.repeat(32));
    return found.length >= 2 ? found : false;
  });
  const server = spans.find(
    (span) => span.kind === 2 && span.name === 'POST /interbank/v1/transfers',
  );
  const client = spans.find((span) => span.kind === 3);
  assert.ok(server && client, JSON.stringify(spans.map((span) => [span.name, span.kind])));
  assert.equal(server.parentSpanId, 'd'.repeat(16));
  assert.equal(client.parentSpanId, server.spanId);
  assert.equal(callbackParent, client.spanId, 'nuestro banco recibe el span CLIENT como padre');
  assert.equal(client.name, 'POST /interbank/v1/transfers/{id}/result');
  assert.match(server.startTimeUnixNano, /^\d{19}$/);
  assert.equal(server.status.code, 1);

  const attributes = Object.fromEntries(
    server.attributes.map(({ key, value }) => [key, Object.values(value)[0]]),
  );
  assert.equal(attributes['http.response.status_code'], '202');
  const resource = Object.fromEntries(
    collector.resources[0].attributes.map(({ key, value }) => [key, value.stringValue]),
  );
  assert.equal(resource['service.name'], 'partner-bank-mock');
  assert.equal(resource['service.version'], 'abc123');
});

test('el emisor lleva una traza nueva en cada depósito que origina', async () => {
  const ourBank = await startOurBank();
  const mock = await startMock({ ourBank });
  await mock.admin('POST', '/admin/transfers', {
    destinationAccount: '02-000000052',
    amount: '1.00',
  });
  await mock.admin('POST', '/admin/transfers', {
    destinationAccount: '02-000000052',
    amount: '1.00',
  });
  const [a, b] = ourBank.requests.map((request) => parseTraceparent(request.headers.traceparent));
  assert.notEqual(a.traceId, b.traceId);
});
