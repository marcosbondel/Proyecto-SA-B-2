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
const { trace } = require('@opentelemetry/api');

const logger = new JsonLogger({ service: 'fixture-service' });
const tracer = trace.getTracer('fixture');

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
      span.end();
    });
    response.writeHead(200).end('done');
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
