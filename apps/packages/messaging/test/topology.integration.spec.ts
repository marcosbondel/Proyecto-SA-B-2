import { randomUUID } from 'node:crypto';

import { QUEUES, createEnvelope } from '@bank/contracts';
import amqp from 'amqplib';

import { MessageBroker } from '../src/broker';

/**
 * Integration test against a live RabbitMQ broker, proving what `broker.spec.ts`
 * cannot: that the *real* topology `@bank/contracts` describes — the ten
 * queues in `QUEUES`, and specifically the `audit.*` family T-20 split so a
 * malformed `payment.*` event cannot hold up `customer.*` behind it — actually
 * declares and routes the way the data says it does, on the actual broker.
 *
 * Requires the local Docker stack to be running and RABBITMQ_URL set.
 *
 * This suite deliberately does **not** declare or bind to the production
 * queue/exchange names (`bank.events`, `bank.commands`, `customer.commands`,
 * `audit.customer`, …). This checkout is shared with other agents running
 * their own service integration suites against the same broker container at
 * the same time (see AGENTS.md / the session's concurrent `*-integ` agents).
 * Declaring a queue under a *production* name is safe (idempotent, same
 * arguments), but publishing a probe message on `bank.events`/`bank.commands`
 * with a routing key that matches a real binding pattern (`customer.#`,
 * `account.#`, …) would fan out a real copy into whatever service or audit
 * queue is already bound there — polluting another agent's assertions with a
 * message it never expected. So every queue and exchange this file touches is
 * suffixed with `randomUUID()`, and the *pattern strings* are copied verbatim
 * out of `QUEUES` so the routing logic under test is identical to production,
 * just wired to a private exchange nobody else is listening on.
 */

jest.setTimeout(70_000);

const RABBITMQ_URL = process.env.RABBITMQ_URL;
const runIntegrationTests = !!RABBITMQ_URL;

(runIntegrationTests ? describe : describe.skip)('broker topology integration', () => {
  beforeAll(() => {
    if (!RABBITMQ_URL) {
      console.warn('Skipping topology integration tests: RABBITMQ_URL is not set.');
    }
  });

  it('declares a queue on the broker for each entry in the real QUEUES topology', async () => {
    // `QUEUES` has ten entries at time of writing (five domain-command/saga
    // queues plus the five-way `audit.*`/`audit.query` split). Declaring all
    // ten adds no real cost — `subscribe` is one setup call per queue — so
    // this exercises the *whole* list rather than a hand-picked slice; the
    // only reason it is still worth calling "representative" is that every
    // entry shares the same declaration code path in `broker.ts`, so this is
    // really one behaviour checked ten times over real data, not ten
    // independent behaviours.
    const suffix = randomUUID();
    const broker = new MessageBroker({
      url: RABBITMQ_URL!,
      exchanges: [],
      errorExchange: `test.topology.errors.${suffix}`,
    });
    await broker.start();

    const declaredNames: string[] = [];

    try {
      for (const queue of QUEUES) {
        const isolatedName = `${queue.name}.integ.${suffix}`;
        declaredNames.push(isolatedName);

        await broker.subscribe(
          {
            queue: isolatedName,
            // Same pattern strings as production, wired to a private exchange
            // per queue so bindings from different queues cannot cross.
            bindings: queue.bindings.map((binding) => ({
              exchange: `test.topology.${queue.name}.${suffix}`,
              pattern: binding.pattern,
            })),
          },
          async () => {},
        );
      }

      const connection = await amqp.connect(RABBITMQ_URL!);
      const channel = await connection.createChannel();

      try {
        for (const name of declaredNames) {
          // `checkQueue` throws if the queue does not exist on the server —
          // this is the assertion, not a setup step.
          await expect(channel.checkQueue(name)).resolves.toBeDefined();
        }
      } finally {
        await channel.close();
        await connection.close();
      }
    } finally {
      await broker.stop().catch(() => {});
      await cleanup(suffix, declaredNames, [
        `test.topology.errors.${suffix}`,
        ...QUEUES.map((queue) => `test.topology.${queue.name}.${suffix}`),
      ]);
    }
  });

  it('routes an event to only the queue(s) whose pattern matches it, never a sibling on the same exchange', async () => {
    // This is the property the T-20 audit family split exists to buy: an
    // event about a customer must land in the queue bound to `customer.#`
    // and nowhere else — specifically not in a queue also declared on the
    // same exchange for `account.#` or `payment.#`. Reproduced here against a
    // private exchange, using the exact pattern strings audit.customer and
    // audit.account bind in production.
    const suffix = randomUUID();
    const exchange = `test.audit-split.${suffix}`;
    const customerQueue = `test.audit.customer.${suffix}`;
    const accountQueue = `test.audit.account.${suffix}`;
    const paymentQueue = `test.audit.payment.${suffix}`;

    const broker = new MessageBroker({
      url: RABBITMQ_URL!,
      exchanges: [exchange],
      errorExchange: `test.audit-split.errors.${suffix}`,
    });
    await broker.start();

    const seenBy = { customer: 0, account: 0, payment: 0 };

    try {
      await broker.subscribe({ queue: customerQueue, bindings: [{ exchange, pattern: 'customer.#' }] }, async () => {
        seenBy.customer += 1;
      });
      await broker.subscribe({ queue: accountQueue, bindings: [{ exchange, pattern: 'account.#' }] }, async () => {
        seenBy.account += 1;
      });
      await broker.subscribe({ queue: paymentQueue, bindings: [{ exchange, pattern: 'payment.#' }] }, async () => {
        seenBy.payment += 1;
      });

      const envelope = createEnvelope(
        { value: 1 },
        { messageType: 'customer.registered.v1', producer: 'customer-service', identity: null },
      );

      await broker.publish(exchange, 'customer.registered.v1', envelope);

      await waitFor(() => seenBy.customer === 1, 8_000);

      // Margin of extra wait so a delivery leaking into a sibling queue would
      // have had time to arrive before we assert its absence.
      await new Promise((resolve) => setTimeout(resolve, 1_500));

      expect(seenBy).toEqual({ customer: 1, account: 0, payment: 0 });
    } finally {
      await broker.stop().catch(() => {});
      await cleanup(
        suffix,
        [customerQueue, accountQueue, paymentQueue],
        [exchange, `test.audit-split.errors.${suffix}`],
      );
    }
  });

  it('declares a retry queue with the TTL and dead-letter-exchange arguments the ladder depends on', async () => {
    // Waiting out the real 1s/5s/30s ladder to prove a message eventually
    // dead-letters is already covered (and costed) by
    // `broker.integration.spec.ts`. This proves the same fact about the
    // *topology* in under a second: a mismatched `assertQueue` call on an
    // already-declared queue is rejected by RabbitMQ with `PRECONDITION_FAILED`
    // only if the arguments genuinely differ from what is on the server, so a
    // passing assertion here is proof of the real `x-message-ttl` and
    // `x-dead-letter-exchange` the retry queue was created with.
    const suffix = randomUUID();
    const queue = `test.retry-args.${suffix}`;
    const exchange = `test.retry-args.exchange.${suffix}`;
    const retryQueue = `${queue}.retry.1s`;

    const broker = new MessageBroker({
      url: RABBITMQ_URL!,
      exchanges: [exchange],
      errorExchange: `test.retry-args.errors.${suffix}`,
    });
    await broker.start();

    try {
      await broker.subscribe(
        { queue, bindings: [{ exchange, pattern: 'retry.args.v1' }] },
        async () => {},
      );

      const connection = await amqp.connect(RABBITMQ_URL!);
      const channel = await connection.createChannel();
      // The server closes the channel on PRECONDITION_FAILED and amqplib
      // re-emits that as an 'error' event on the channel in addition to
      // rejecting the pending call — an EventEmitter that emits 'error' with
      // no listener throws in Node, which would otherwise surface as jest's
      // "Unhandled error" instead of the rejection we are asserting on below.
      channel.on('error', () => {});

      try {
        // The queue exists with SOME arguments — checkQueue alone would pass
        // even if the TTL were wrong. Asserting with a deliberately wrong TTL
        // is what actually pins down the real value on the server.
        await expect(
          channel.assertQueue(retryQueue, {
            durable: true,
            arguments: {
              'x-message-ttl': 999_999, // wrong on purpose — real value is 1_000
              'x-dead-letter-exchange': '',
              'x-dead-letter-routing-key': queue,
            },
          }),
        ).rejects.toThrow(/PRECONDITION_FAILED/);
      } finally {
        // The channel above is already closed by the broker after the
        // PRECONDITION_FAILED error (AMQP closes the channel on a channel
        // exception), so clean up with a fresh one.
        await connection.close().catch(() => {});
      }

      const verifyConnection = await amqp.connect(RABBITMQ_URL!);
      const verifyChannel = await verifyConnection.createChannel();
      try {
        // The correct arguments, reasserted, must succeed — confirming the
        // rejection above was really about the TTL and not something else.
        await expect(
          verifyChannel.assertQueue(retryQueue, {
            durable: true,
            arguments: {
              'x-message-ttl': 1_000,
              'x-dead-letter-exchange': '',
              'x-dead-letter-routing-key': queue,
            },
          }),
        ).resolves.toBeDefined();
      } finally {
        await verifyChannel.close();
        await verifyConnection.close();
      }
    } finally {
      await broker.stop().catch(() => {});
      await cleanup(
        suffix,
        [queue, retryQueue, `${queue}.retry.5s`, `${queue}.retry.30s`, `${queue}.dlq`],
        [exchange, `test.retry-args.errors.${suffix}`],
      );
    }
  });

  /** Deletes every queue and exchange this suite created, tolerating NOT_FOUND. */
  async function cleanup(
    _suffix: string,
    queueNames: readonly string[],
    exchangeNames: readonly string[],
  ): Promise<void> {
    const connection = await amqp.connect(RABBITMQ_URL!);
    const channel = await connection.createChannel();

    for (const name of queueNames) {
      try {
        await channel.deleteQueue(name, { ifUnused: false });
      } catch (error) {
        if (!String(error).includes('NOT_FOUND')) {
          throw error;
        }
      }
    }

    for (const name of exchangeNames) {
      try {
        await channel.deleteExchange(name, { ifUnused: false });
      } catch (error) {
        if (!String(error).includes('NOT_FOUND')) {
          throw error;
        }
      }
    }

    await channel.close();
    await connection.close();
  }

  async function waitFor(condition: () => boolean | Promise<boolean>, timeoutMs: number): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (await condition()) {
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw new Error(`Condition not met within ${timeoutMs}ms`);
  }
});
