import { randomUUID } from 'node:crypto';

import request from 'supertest';
import {
  GATEWAY_REPLY_BINDINGS,
  createEnvelope,
  gatewayReplyQueueName,
  validateMessage,
} from '@bank/contracts';

import { ROUTE_REQUESTS } from './support/route-fixtures';
import {
  bearerFor,
  buildBrokerHarness,
  closeBrokerHarness,
  waitFor,
} from './support/broker-harness';
import type { BrokerHarness } from './support/broker-harness';
import { ServiceDouble } from './support/service-double';

/**
 * The two things a doubled port cannot be asked about: the **bytes** the
 * gateway actually put on the wire, and the **queue** RabbitMQ actually
 * created for it.
 *
 * `test/support/harness.ts` can prove the gateway called `publish` with an
 * object of the right shape. It cannot prove that object survives JSON, that
 * the broker marked it persistent, or that a reply queue named after this
 * replica exists and disappears when the replica does — those are facts about
 * a server, and the only way to learn them is to ask the server.
 *
 * Requires `RABBITMQ_URL`. Skipped otherwise, like every other suite here that
 * needs something real on the other end.
 */

const RABBITMQ_URL = process.env.RABBITMQ_URL;
const describeBroker = RABBITMQ_URL ? describe : describe.skip;

jest.setTimeout(70_000);

describeBroker('the envelope on the wire, and the reply queue behind it', () => {
  let harness: BrokerHarness;
  let double: ServiceDouble;

  beforeAll(async () => {
    if (!RABBITMQ_URL) {
      console.warn('Skipping envelope-and-replies.integration.spec.ts: RABBITMQ_URL is not set.');

      return;
    }

    harness = await buildBrokerHarness({ replyTimeoutMs: 400 });
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
   * One request whose correlation is unique, so the message can be found among
   * whatever else is on `bank.commands` — the five services publish there too
   * when someone has the stack up.
   */
  const publishVia = async (route: string) => {
    const correlationId = randomUUID();
    const builder = ROUTE_REQUESTS[route];

    if (builder === undefined) {
      throw new Error(`No fixture request for ${route}; the table and the suite disagree.`);
    }

    await builder(harness).set('x-correlation-id', correlationId).catch(() => undefined);
    await waitFor(() => findCaptured(correlationId) !== undefined, 10_000);

    const captured = findCaptured(correlationId);

    if (captured === undefined || captured.envelope === undefined) {
      throw new Error(`Nothing with correlation ${correlationId} reached the broker for ${route}.`);
    }

    // Narrowed for the callers: past this point the envelope is known to have
    // parsed, which is what lets each assertion read one field instead of
    // re-proving the body was JSON.
    return { ...captured, envelope: captured.envelope };
  };

  /** A message of this suite's own, found by correlation among ambient traffic. */
  const findCaptured = (correlationId: string) =>
    double.captured.find((message) => message.envelope?.correlationId === correlationId);

  /** A balance reply as a service would publish it, addressed to one waiter. */
  const balanceReply = (correlationId: string) =>
    createEnvelope(
      { accountId: randomUUID(), amountMinor: 1_000, currency: 'GTQ', version: 1 },
      {
        messageType: 'account.balance.replied.v1',
        producer: 'account-service',
        identity: null,
        correlationId,
      },
    );

  describe('AMQP properties the publisher sets and nobody else can', () => {
    it('marks every message persistent, so a broker restart does not lose a command', async () => {
      const captured = await publishVia('POST /api/accounts');

      expect(captured.properties.deliveryMode).toBe(2);
    });

    it('declares the body as JSON rather than leaving the consumer to guess', async () => {
      const captured = await publishVia('POST /api/accounts');

      expect(captured.properties.contentType).toBe('application/json');
    });

    it('carries a messageId, which is what every consumer deduplicates on', async () => {
      const captured = await publishVia('POST /api/accounts');

      expect(captured.envelope.messageId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
      );
    });

    it('stamps occurredAt as an ISO-8601 instant close to now, not a local string', async () => {
      const captured = await publishVia('POST /api/accounts');
      const occurredAt = new Date(captured.envelope.occurredAt);

      expect(captured.envelope.occurredAt).toBe(occurredAt.toISOString());
      expect(Math.abs(Date.now() - occurredAt.getTime())).toBeLessThan(60_000);
    });
  });

  describe('what the envelope says about who asked', () => {
    it('carries the role and the customerId from the session, and no other identity field', async () => {
      const captured = await publishVia('POST /api/accounts');
      const identity = captured.envelope.identity as Record<string, unknown> | null;

      expect(identity).not.toBeNull();
      expect(Object.keys(identity ?? {}).sort()).toEqual(['customerId', 'role']);
    });

    it('publishes identity: null for a route no session guards', async () => {
      const captured = await publishVia('POST /api/auth/password-reset');

      expect(captured.envelope.identity).toBeNull();
    });

    it('names itself as the producer, so the trail can tell a gateway command from a service event', async () => {
      const captured = await publishVia('POST /api/accounts');

      expect(captured.envelope.producer).toBe('gateway');
    });
  });

  describe('what the credential does and does not do on the wire', () => {
    /**
     * The plaintext credential **does** travel to `customer-service`, and has
     * to: the gateway holds no hash and does not verify passwords — ADR-010
     * makes it the signer of sessions, not the keeper of secrets — so the only
     * component that can check a password is the one that stored the scrypt
     * digest. What matters is therefore not that the credential never exists on
     * the broker, but that it goes to exactly one message and no further.
     *
     * The first version of this test asserted the opposite and failed. Kept as
     * a positive assertion rather than deleted, because the reading is easy to
     * get wrong twice and the cost of getting it wrong is a credential quietly
     * fanned out to `bank.events`.
     */
    it('reaches the authenticate command, which is the one consumer that can verify it', async () => {
      const correlationId = randomUUID();
      const credential = `plaintext-${randomUUID()}`;

      await request(harness.app.getHttpServer())
        .post('/api/auth/login')
        .set('x-correlation-id', correlationId)
        .send({ email: 'ana@example.com', credential })
        .catch(() => undefined);

      await waitFor(() => findCaptured(correlationId) !== undefined, 10_000);
      const captured = findCaptured(correlationId);

      expect(captured?.envelope?.messageType).toBe('customer.authenticate.v1');
      expect(captured?.raw.toString('utf8')).toContain(credential);
    });

    it('goes to exactly one message, never fanned out to a second', async () => {
      const correlationId = randomUUID();
      const credential = `plaintext-${randomUUID()}`;

      await request(harness.app.getHttpServer())
        .post('/api/auth/login')
        .set('x-correlation-id', correlationId)
        .send({ email: 'ana@example.com', credential })
        .catch(() => undefined);

      await waitFor(() => findCaptured(correlationId) !== undefined, 10_000);
      await new Promise((resolve) => setTimeout(resolve, 500));

      const carrying = double.captured.filter((message) =>
        message.raw.toString('utf8').includes(credential),
      );

      expect(carrying).toHaveLength(1);
      expect(carrying[0]?.exchange).toBe('bank.commands');
    });

    it('rides inside an envelope the catalogue still accepts', async () => {
      const captured = await publishVia('POST /api/auth/login');

      expect(validateMessage(captured.envelope)).toMatchObject({ ok: true });
    });
  });

  describe('the reply queue, asked of the adapter that owns it', () => {
    /*
     * Every fact here is read from the adapter, never from a raw channel.
     * `checkQueue` against an exclusive queue held by another connection
     * answers RESOURCE_LOCKED and takes the channel down with it — which is
     * both why the queue is right and why it cannot be inspected from outside.
     * `apps/packages/messaging/test/broker.integration.spec.ts` records the
     * same lesson, having deleted a test that provoked it.
     */
    it('is named as the contract derives it from this replica id', () => {
      expect(harness.runtime.replyQueue.queueName).toBe(gatewayReplyQueueName(harness.instanceId));
    });

    it('holds nobody at rest', () => {
      expect(harness.runtime.replyQueue.pendingCount).toBe(0);
    });

    it('gives a different queue to a different replica, which is what lets the chart scale', async () => {
      const other = await buildBrokerHarness({ replyTimeoutMs: 400 });

      try {
        expect(other.runtime.replyQueue.queueName).not.toBe(harness.runtime.replyQueue.queueName);
      } finally {
        await closeBrokerHarness(other);
      }
    });

    it.each(GATEWAY_REPLY_BINDINGS.map((binding) => [binding.exchange, binding.pattern] as const))(
      'declares its binding on %s for %s exactly as the contract publishes it',
      (exchange, pattern) => {
        expect(GATEWAY_REPLY_BINDINGS).toContainEqual({ exchange, pattern });
      },
    );
  });

  describe('a reply that nobody is waiting for', () => {
    it('is swallowed without disturbing the count of those who are', async () => {
      const before = harness.runtime.replyQueue.pendingCount;

      await double.publishEnvelope(
        'bank.replies',
        'account.balance.replied.v1',
        balanceReply(randomUUID()),
      );
      await new Promise((resolve) => setTimeout(resolve, 500));

      expect(harness.runtime.replyQueue.pendingCount).toBe(before);
    });

    it('leaves the next real request answerable, so an orphan reply is not poison', async () => {
      const captured = await publishVia('POST /api/accounts');

      expect(captured.envelope.correlationId).toBeDefined();
    });
  });

  describe('the ceiling, asked of the adapter rather than of a route', () => {
    /*
     * Deliberately not through HTTP. This broker is shared: with `pnpm
     * dev:host` up, a real account-service consumes the query and answers it,
     * so a route that should have timed out returns a perfectly good 404 and
     * the assertion breaks for a reason that has nothing to do with the
     * gateway. A correlation nobody will ever publish cannot be answered by
     * accident, which buys the same facts without the ambient noise.
     */
    it('gives up on a correlation nobody answers', async () => {
      await expect(harness.runtime.replyQueue.waitFor(randomUUID())).rejects.toThrow();
    });

    it('gives up within the configured ceiling rather than hanging', async () => {
      const started = Date.now();

      await harness.runtime.replyQueue.waitFor(randomUUID()).catch(() => undefined);

      expect(Date.now() - started).toBeLessThan(5_000);
    });

    it('registers a waiter while it waits, and releases it when it gives up', async () => {
      const before = harness.runtime.replyQueue.pendingCount;
      const pending = harness.runtime.replyQueue.waitFor(randomUUID()).catch(() => undefined);

      await waitFor(() => harness.runtime.replyQueue.pendingCount > before, 2_000);
      expect(harness.runtime.replyQueue.pendingCount).toBeGreaterThan(before);

      await pending;
      expect(harness.runtime.replyQueue.pendingCount).toBe(before);
    });

    it('is not settled by an answer addressed to somebody else', async () => {
      const pending = harness.runtime.replyQueue.waitFor(randomUUID()).catch(() => 'gave-up');

      await double.publishEnvelope(
        'bank.replies',
        'account.balance.replied.v1',
        balanceReply(randomUUID()),
      );

      await expect(pending).resolves.toBe('gave-up');
    });

    it('is settled by an answer that does carry its correlation', async () => {
      const mine = randomUUID();
      const pending = harness.runtime.replyQueue.waitFor(mine);

      await double.publishEnvelope('bank.replies', 'account.balance.replied.v1', balanceReply(mine));

      await expect(pending).resolves.toMatchObject({ correlationId: mine });
    });

    it('is not settled by a body that does not parse, even with the right correlation', async () => {
      const mine = randomUUID();
      const pending = harness.runtime.replyQueue.waitFor(mine).catch(() => 'gave-up');

      await double.publishRaw(
        'bank.replies',
        'account.balance.replied.v1',
        Buffer.from('{"this":"is not an envelope"'),
        { correlationId: mine },
      );

      await expect(pending).resolves.toBe('gave-up');
    });
  });

  describe('the broker going away underneath a live gateway', () => {
    it('reports ready while the connection holds', async () => {
      const response = await request(harness.app.getHttpServer()).get('/ready');

      expect(response.status).toBe(200);
    });

    it('keeps answering /health when the broker is gone, so liveness is not a restart loop', async () => {
      const ephemeral = await buildBrokerHarness({ replyTimeoutMs: 300 });

      try {
        await ephemeral.runtime.broker.stop();

        const health = await request(ephemeral.app.getHttpServer()).get('/health');
        expect(health.status).toBe(200);
      } finally {
        await closeBrokerHarness(ephemeral);
      }
    });

    it('reports not-ready once the broker is gone, which is the difference the probes exist for', async () => {
      const ephemeral = await buildBrokerHarness({ replyTimeoutMs: 300 });

      try {
        await ephemeral.runtime.broker.stop();
        await waitFor(async () => {
          const ready = await request(ephemeral.app.getHttpServer()).get('/ready');

          return ready.status === 503;
        }, 10_000);

        const ready = await request(ephemeral.app.getHttpServer()).get('/ready');
        expect(ready.status).toBe(503);
      } finally {
        await closeBrokerHarness(ephemeral);
      }
    });

    it('refuses a command with BROKER_UNAVAILABLE rather than pretending it was accepted', async () => {
      const ephemeral = await buildBrokerHarness({ replyTimeoutMs: 300 });

      try {
        await ephemeral.runtime.broker.stop();

        const response = await request(ephemeral.app.getHttpServer())
          .post('/api/accounts')
          .set('Authorization', bearerFor(ephemeral, 'CLIENTE'))
          .send({ accountType: 'MONETARIA' });

        expect(response.status).toBeGreaterThanOrEqual(500);
        expect(JSON.stringify(response.body)).toContain('BROKER_UNAVAILABLE');
      } finally {
        await closeBrokerHarness(ephemeral);
      }
    });
  });
});
