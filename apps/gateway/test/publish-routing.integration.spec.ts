import { randomUUID } from 'node:crypto';

import request from 'supertest';
import { catalogByName, destinationFor, validateMessage } from '@bank/contracts';

import { ROUTE_MESSAGES } from '../src/openapi/route-messages';
import type { RouteMessages } from '../src/openapi/route-messages';
import { ACCOUNT_ID, ROUTE_REQUESTS, SOURCE_ACCOUNT, TARGET_ACCOUNT } from './support/route-fixtures';
import {
  bearerFor,
  buildBrokerHarness,
  closeBrokerHarness,
  fire,
  waitFor,
} from './support/broker-harness';
import type { BrokerHarness } from './support/broker-harness';
import { ServiceDouble } from './support/service-double';

/**
 * Every route in `ROUTE_MESSAGES`, driven against a **real** RabbitMQ, proving
 * what `test/commands-publish.spec.ts` and friends cannot: the exchange a
 * message actually lands on, the routing key it actually carries, and that the
 * bytes on the wire are a well-formed member of the catalogue rather than
 * whatever shape `RecordingPublisher` happened to record.
 *
 * The reply ceiling is cut to 300ms for this whole suite. Nothing here reads
 * the HTTP response body — only what reached the broker — so there is no
 * reason to let fourteen awaiting routes each cost this suite five real
 * seconds waiting for a reply nobody is scripted to send.
 */
const RABBITMQ_URL = process.env.RABBITMQ_URL;
const describeBroker = RABBITMQ_URL ? describe : describe.skip;

jest.setTimeout(70_000);

describeBroker('publishing onto the real broker', () => {
  let harness: BrokerHarness;
  let double: ServiceDouble;

  beforeAll(async () => {
    if (!RABBITMQ_URL) {
      console.warn('Skipping publish-routing.integration.spec.ts: RABBITMQ_URL is not set.');
      return;
    }

    harness = await buildBrokerHarness({ replyTimeoutMs: 300 });
    double = await ServiceDouble.connect(RABBITMQ_URL);
    await double.spyOnEverythingPublished();
  });

  afterAll(async () => {
    if (!RABBITMQ_URL) {
      return;
    }
    await double.close();
    await closeBrokerHarness(harness);
  });

  /**
   * `GET /api/dashboard` is excluded here and covered by its own `describe`
   * below: it is the one route whose published envelopes do not carry the
   * request's own correlation, so it cannot be asserted by the same predicate
   * as the other thirty.
   */
  const routeEntries = (Object.entries(ROUTE_MESSAGES) as [string, RouteMessages][]).filter(
    ([key]) => key !== 'GET /api/dashboard',
  );

  /**
   * Matched by **`correlationId`**, never by array position or a window of
   * time. `bank.commands` and `bank.events` are shared with whatever else is
   * connected to this broker — the five domain services, if they happen to be
   * running, publish and consume on the same exchanges — so a spy bound to
   * `#` sees more than this suite's own traffic. A freshly minted
   * `correlationId` is globally unique, which is what makes a match immune to
   * that ambient noise instead of merely unlikely to catch it.
   *
   * Every route the fixture table has a request for gets one, and the table
   * failing to cover a route is itself a failure — `ROUTE_REQUESTS[key]` being
   * `undefined` throws rather than silently skipping.
   */
  it.each(routeEntries)(
    '%s publishes on the catalogue’s own exchange and routing key',
    async (routeKey, messages) => {
      const builder = ROUTE_REQUESTS[routeKey];
      if (builder === undefined) {
        throw new Error(`route-fixtures.ts has no request builder for "${routeKey}"`);
      }

      const contract = catalogByName.get(messages.publishes);
      if (contract === undefined) {
        throw new Error(`@bank/contracts has no contract named "${messages.publishes}"`);
      }
      const { exchange, routingKey } = destinationFor(contract);

      /*
       * El envío interbancario pregunta primero a Account el número de la cuenta
       * origen (T-60): sin quien conteste, la petición se queda esperando y nunca
       * publica la Saga que esta prueba busca. Account se dobla aquí con una
       * respuesta, como lo haría el servicio.
       */
      const contestar = routeKey === 'POST /api/interbank/transfers';
      const desde = Date.now() - 50;
      const pending = fire(builder(harness));
      if (contestar) {
        const consulta = await double.waitForEnvelope(
          (envelope) =>
            envelope.messageType === 'account.balance.query.v1' &&
            (envelope.payload as { accountId?: string }).accountId === SOURCE_ACCOUNT &&
            Date.parse(envelope.occurredAt) >= desde,
          5_000,
        );
        await double.reply(
          consulta.envelope!,
          'account.balance.replied.v1',
          {
            outcome: 'FOUND',
            accountId: SOURCE_ACCOUNT,
            accountNumber: '02-000000052',
            balance: { amountMinor: 10_000_000, currency: 'GTQ' },
            status: 'ACTIVE',
            lastActivityAt: null,
          },
          { producer: 'account-service' },
        );
      }
      const response = await pending;
      const correlationHeader = response.headers['x-correlation-id'] as string | undefined;
      expect(correlationHeader).toBeDefined();

      /*
       * Por correlación **y** por tipo: una ruta puede hacer una pregunta antes
       * de su mensaje (el envío interbancario pregunta a Account el número de la
       * cuenta origen, T-60), y las dos comparten la correlación de la petición.
       */
      const captured = await double.waitForEnvelope(
        (envelope) =>
          envelope.correlationId === correlationHeader &&
          envelope.messageType === messages.publishes,
        5_000,
      );

      expect(captured.exchange).toBe(exchange);
      expect(captured.routingKey).toBe(routingKey);
      expect(captured.envelope?.messageType).toBe(messages.publishes);

      const validation = validateMessage(captured.envelope);
      expect(validation.ok).toBe(true);
      expect(captured.envelope?.producer).toBe('gateway');
      expect(captured.envelope?.correlationId).toBe(correlationHeader);
    },
  );

  /**
   * `bank.commands` and `bank.events` may carry traffic from whatever else is
   * connected to this broker, so the dashboard's own five messages are found
   * by the one thing that is certain to be unique to this test: the actor's
   * `customerId`, minted fresh per case and never reused by anything else on
   * the broker.
   */
  describe('GET /api/dashboard, the one route that asks five questions at once', () => {
    const DASHBOARD_QUERIES = [
      'account.stats.query.v1',
      'audit.stats.query.v1',
      'customer.stats.query.v1',
      'payment.stats.query.v1',
      'transaction.stats.query.v1',
    ];

    it('puts five distinct queries on the broker for one HTTP request', async () => {
      const actorId = randomUUID();

      await request(harness.app.getHttpServer())
        .get('/api/dashboard')
        .set('Authorization', bearerFor(harness, 'CLIENTE', actorId));

      await waitFor(() => {
        return double.captured.filter((m) => m.envelope?.identity?.customerId === actorId).length >= 5;
      }, 5_000);

      const own = double.captured.filter((m) => m.envelope?.identity?.customerId === actorId);
      const types = own.map((m) => m.envelope?.messageType).sort();

      expect(types).toEqual([...DASHBOARD_QUERIES].sort());
    });

    /**
     * Documented and asserted rather than assumed: each of the five questions
     * is its **own** correlation root (see the use-case's `#section` doc
     * comment), because five concurrent waits sharing the request's single
     * correlation would settle each other's promise. This is the opposite of
     * the usual rule ("one flow, one correlation") and is exactly the kind of
     * fact a fake publisher cannot surface — `RecordingPublisher` never
     * exercises real concurrent waits racing on a shared registry.
     */
    it('gives each of the five its own correlation, none of them the request’s', async () => {
      const actorId = randomUUID();

      const response = await request(harness.app.getHttpServer())
        .get('/api/dashboard')
        .set('Authorization', bearerFor(harness, 'CLIENTE', actorId));

      await waitFor(() => {
        return double.captured.filter((m) => m.envelope?.identity?.customerId === actorId).length >= 5;
      }, 5_000);

      const own = double.captured
        .filter((m) => m.envelope?.identity?.customerId === actorId)
        .map((m) => m.envelope?.correlationId)
        .filter((id): id is string => id !== undefined);

      expect(new Set(own).size).toBe(own.length);
      expect(own).not.toContain(response.headers['x-correlation-id']);
    });
  });

  /**
   * Each case here uses a `correlationId` it chose itself (never the caller's
   * default, which the gateway would otherwise mint) and asserts that id
   * never appears on the broker. Checking a global capture count would be
   * flaky against ambient traffic; a freshly minted id never appearing is
   * exact regardless of what else is on the exchange.
   */
  describe('a request the gateway refuses before asking anyone', () => {
    async function neverPublished(correlationId: string): Promise<void> {
      // A window generous enough to catch a publish that happened despite the
      // refusal — the assertion is that nothing with this id ever shows up,
      // not that none showed up yet.
      await new Promise((resolve) => setTimeout(resolve, 500));
      const leaked = double.captured.some((m) => m.envelope?.correlationId === correlationId);
      expect(leaked).toBe(false);
    }

    it('leaves the broker untouched on a malformed body (400)', async () => {
      const correlationId = randomUUID();

      const response = await request(harness.app.getHttpServer())
        .post('/api/transfers')
        .set('Authorization', bearerFor(harness, 'CLIENTE'))
        .set('X-Correlation-Id', correlationId)
        .send({
          sourceAccount: SOURCE_ACCOUNT,
          targetAccount: TARGET_ACCOUNT,
          amount: { amountMinor: 0, currency: 'GTQ' },
        });

      expect(response.status).toBe(400);
      await neverPublished(correlationId);
    });

    it('leaves the broker untouched on an anonymous call to a protected route (401)', async () => {
      const correlationId = randomUUID();

      const response = await request(harness.app.getHttpServer())
        .get(`/api/accounts/${ACCOUNT_ID}/balance`)
        .set('X-Correlation-Id', correlationId);

      expect(response.status).toBe(401);
      await neverPublished(correlationId);
    });

    it('leaves the broker untouched on a role D-06 refuses (403)', async () => {
      const correlationId = randomUUID();

      const response = await request(harness.app.getHttpServer())
        .get('/api/payments')
        .set('Authorization', bearerFor(harness, 'CLIENTE'))
        .set('X-Correlation-Id', correlationId);

      expect(response.status).toBe(403);
      await neverPublished(correlationId);
    });
  });

  it('names every route this table is supposed to cover, so a new route fails loudly here', () => {
    const missing = Object.keys(ROUTE_MESSAGES).filter((key) => ROUTE_REQUESTS[key] === undefined);
    expect(missing).toEqual([]);
  });

  it('mints a fresh messageId and idempotencyKey per publish, never reused', async () => {
    const firstCorrelation = randomUUID();
    const secondCorrelation = randomUUID();

    await request(harness.app.getHttpServer())
      .post('/api/accounts')
      .set('Authorization', bearerFor(harness, 'CLIENTE'))
      .set('X-Correlation-Id', firstCorrelation)
      .send({ accountType: 'MONETARIA' });
    await request(harness.app.getHttpServer())
      .post('/api/accounts')
      .set('Authorization', bearerFor(harness, 'CLIENTE'))
      .set('X-Correlation-Id', secondCorrelation)
      .send({ accountType: 'MONETARIA' });

    const first = await double.waitForEnvelope((e) => e.correlationId === firstCorrelation, 5_000);
    const second = await double.waitForEnvelope((e) => e.correlationId === secondCorrelation, 5_000);

    expect(first.envelope?.messageId).not.toBe(second.envelope?.messageId);
    expect(first.envelope?.idempotencyKey).not.toBe(second.envelope?.idempotencyKey);
    expect(first.envelope?.correlationId).not.toBe(second.envelope?.correlationId);
  });
});
