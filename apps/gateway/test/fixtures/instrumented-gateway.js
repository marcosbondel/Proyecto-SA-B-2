'use strict';

/**
 * The Gateway's first two middlewares, run for real under the real SDK, as their
 * own process, for `server-span-correlation.integration.spec.ts`.
 *
 * It is what `main.ts` does, minus the broker: start the SDK before anything is
 * required, then serve HTTP through Express with the **compiled** correlation
 * and access-log middlewares from `dist/`. A mocked "active span" cannot answer
 * the question this fixture exists for — which span is active inside the
 * middleware, and is it the HTTP SERVER span `HttpInstrumentation` opened —
 * because that depends on how the instrumentations nest, and only a process
 * with them registered nests them.
 */

const { startTelemetry, JsonLogger } = require('@bank/observability');

const telemetry = startTelemetry({ serviceName: 'gateway-fixture' });

// After the SDK, exactly the ordering `main.ts` relies on.
require('reflect-metadata');
const http = require('node:http');
const express = require(
  require.resolve('express', { paths: [require.resolve('@nestjs/platform-express')] }),
);
const {
  CorrelationMiddleware,
} = require('../../dist/interfaces/middleware/correlation.middleware');
const { accessLogMiddleware } = require('../../dist/interfaces/middleware/access-log.middleware');

const app = express();
const correlation = new CorrelationMiddleware();

app.use(correlation.use.bind(correlation));
app.use(accessLogMiddleware(new JsonLogger({ service: 'gateway' })));

app.get('/api/accounts/:accountId/balance', (_request, response) => {
  response.status(200).json({ ok: true });
});
app.get('/api/customers/verify-email', (_request, response) => {
  response.status(200).json({ ok: true });
});
app.get('/shutdown', (_request, response) => {
  response.status(200).end('bye');
  server.close();
  telemetry.shutdown().then(() => process.exit(0));
});

const server = http.createServer(app);

server.listen(0, '127.0.0.1', () => {
  process.stdout.write(`READY ${String(server.address().port)}\n`);
});
