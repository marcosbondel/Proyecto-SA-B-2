'use strict';

/**
 * A component in miniature, run as its own process by
 * `telemetry.integration.spec.ts`.
 *
 * It does what every `src/instrumentation.ts` does — start the SDK before
 * anything else is required — and then serves HTTP, so the test can observe the
 * real thing from the outside: what leaves the process over OTLP, and what it
 * writes to stdout. Plain JavaScript on purpose: it is the compiled package
 * (`dist/`) that runs in an image, so it is the compiled package that is tested.
 */

const { startTelemetry, JsonLogger } = require('../../dist');

const telemetry = startTelemetry({ serviceName: 'fixture-service' });

// Required only now, after the SDK — exactly the ordering `main.ts` relies on.
const http = require('node:http');
const { metrics, trace } = require('@opentelemetry/api');
// Node's global fetch is undici's; the SDK instruments it through diagnostics_channel.
const { fetch } = globalThis;

const logger = new JsonLogger({ service: 'fixture-service' });
const tracer = trace.getTracer('fixture');

// Un instrumento del banco, con la forma EXACTA del catálogo
// (`docs/sre/telemetry-catalog.md`): nombre con prefijo `bank.`, unidad
// explícita y una etiqueta de conjunto cerrado. El test lo observa **en el
// cable**, que es donde se decide cómo se llamará la serie en Prometheus: el
// sufijo `_seconds` sale de `unit`, no del nombre.
const meter = metrics.getMeter('fixture');
const duracion = meter.createHistogram('bank.transfer.duration', {
  unit: 's',
  description: 'Time from transfer.requested to a final state.',
  advice: { explicitBucketBoundaries: [0.1, 1, 5, 30] },
});

// An error whose message quotes what a driver would: a token and an address.
const SECRET_MESSAGE = 'cannot verify token=SECRET-TOKEN-123 for a.person@example.com';

const server = http.createServer((request, response) => {
  if (request.url === '/health') {
    response.writeHead(200).end('ok');
    return;
  }

  if (request.url === '/fail') {
    response.writeHead(500).end('nope');
    return;
  }

  if (request.url === '/work') {
    tracer.startActiveSpan('fixture.child', (span) => {
      logger.info('work done', { correlationId: 'corr-fixture' });
      // El identificador va al span y al log, nunca a la métrica.
      span.setAttribute('bank.transfer.id', '7f2b1c42-0000-4000-8000-000000000001');
      duracion.record(1.75, { result: 'COMPLETED' });
      span.end();
    });
    response.writeHead(200).end('done');
    return;
  }

  // The activation link, as the Gateway receives it: the secret is in the
  // query string, the NestJS instrumentation writes `url.full` from it, and the
  // handler fails with a message that quotes the secret.
  if (request.url.startsWith('/verify-email')) {
    tracer.startActiveSpan(
      'fixture.nest',
      { attributes: { 'url.full': request.url } },
      (span) => {
        span.recordException(new Error(SECRET_MESSAGE));
        span.setStatus({ code: 2, message: SECRET_MESSAGE });
        span.end();
      },
    );
    response.writeHead(200).end('verified');
    return;
  }

  // Reports every `traceparent` that reached it, header by header.
  if (request.url.startsWith('/echo')) {
    const received = [];
    for (let index = 0; index < request.rawHeaders.length; index += 2) {
      if (request.rawHeaders[index].toLowerCase() === 'traceparent') {
        received.push(request.rawHeaders[index + 1]);
      }
    }
    response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(received));
    return;
  }

  // An outbound `fetch` (undici) that sets its own `traceparent`, the way the
  // payment service's partner-bank client does, with a secret in the URL.
  if (request.url === '/outbound') {
    const port = server.address().port;
    tracer.startActiveSpan('fixture.caller', async (span) => {
      try {
        const reply = await fetch(`http://127.0.0.1:${String(port)}/echo?token=OUTBOUND-SECRET-456`, {
          headers: { traceparent: '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01' },
        });
        const body = await reply.text();
        response.writeHead(200, { 'content-type': 'application/json' }).end(body);
      } finally {
        span.end();
      }
    });
    return;
  }

  if (request.url === '/shutdown') {
    response.writeHead(200).end('bye');
    server.close();
    telemetry.shutdown().then(() => process.exit(0));
    return;
  }

  response.writeHead(404).end();
});

server.listen(0, '127.0.0.1', () => {
  const address = server.address();
  // Not through the logger: this is the handshake with the parent, not a log line.
  process.stdout.write(`READY ${String(address.port)}\n`);
});
