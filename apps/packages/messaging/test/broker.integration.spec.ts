import { randomUUID } from 'node:crypto';

import { createEnvelope, EXCHANGES } from '@bank/contracts';
import type { MessageEnvelope } from '@bank/contracts';
import amqp from 'amqplib';

import { MessageBroker } from '../src/broker';
import type { ParkedMessage } from '../src/broker';

/**
 * Integration test against a live RabbitMQ broker. This test closes TD-014 by
 * exercising the real adapter: connection, publish, consume, correlationId
 * propagation, retry ladder, and dead-letter headers.
 *
 * Requires the local Docker stack to be running and RABBITMQ_URL set.
 */

jest.setTimeout(70_000);

const RABBITMQ_URL = process.env.RABBITMQ_URL;

const runIntegrationTests = !!RABBITMQ_URL;

(runIntegrationTests ? describe : describe.skip)('MessageBroker integration', () => {
  const TEST_QUEUE = 'test.integration';
  const TEST_ROUTING_KEY = 'test.integration.v1';
  const TEST_EXCHANGE = EXCHANGES.events;

  beforeAll(() => {
    if (!RABBITMQ_URL) {
      console.warn('Skipping broker integration tests: RABBITMQ_URL is not set.');
    }
  });

  afterEach(async () => {
    // Clean up the test queue and its retry/DLQ artefacts. Ignore missing
    // objects because a previous run may already have removed them.
    const connection = await amqp.connect(RABBITMQ_URL!);
    const channel = await connection.createChannel();

    async function deleteQueueIfExists(name: string): Promise<void> {
      try {
        await channel.deleteQueue(name, { ifUnused: false });
      } catch (error) {
        if (!String(error).includes('NOT_FOUND')) {
          throw error;
        }
      }
    }

    await deleteQueueIfExists(`${TEST_QUEUE}.retry.1s`);
    await deleteQueueIfExists(`${TEST_QUEUE}.retry.5s`);
    await deleteQueueIfExists(`${TEST_QUEUE}.retry.30s`);
    await deleteQueueIfExists(`${TEST_QUEUE}.dlq`);
    await deleteQueueIfExists(TEST_QUEUE);
    await deleteQueueIfExists('test.integration.errors');
    await deleteQueueIfExists('bank.errors.drain');

    try {
      await channel.deleteExchange(TEST_EXCHANGE, { ifUnused: false });
    } catch (error) {
      if (!String(error).includes('NOT_FOUND')) {
        throw error;
      }
    }

    await channel.close();
    await connection.close();
  });

  it('publishes and consumes a message with a visible correlationId', async () => {
    const broker = new MessageBroker({
      url: RABBITMQ_URL!,
      exchanges: [TEST_EXCHANGE],
      errorExchange: EXCHANGES.errors,
    });

    await broker.start();

    const expectedCorrelationId = randomUUID();
    const received: MessageEnvelope<unknown>[] = [];

    await broker.subscribe(
      {
        queue: TEST_QUEUE,
        bindings: [{ exchange: TEST_EXCHANGE, pattern: TEST_ROUTING_KEY }],
      },
      async (envelope) => {
        received.push(envelope);
      },
    );

    const envelope = createEnvelope(
      { value: 42 },
      {
        messageType: TEST_ROUTING_KEY,
        producer: 'gateway',
        identity: null,
        correlationId: expectedCorrelationId,
      },
    );

    await broker.publish(TEST_EXCHANGE, TEST_ROUTING_KEY, envelope);

    await waitFor(() => received.length === 1, 5_000);

    expect(received[0]!.correlationId).toBe(expectedCorrelationId);
    expect(received[0]!.messageType).toBe(TEST_ROUTING_KEY);

    await broker.stop();
  });

  it('dead-letters a failing message with the required headers after retries', async () => {
    const broker = new MessageBroker({
      url: RABBITMQ_URL!,
      exchanges: [TEST_EXCHANGE],
      errorExchange: EXCHANGES.errors,
    });

    await broker.start();

    let attempts = 0;

    await broker.subscribe(
      {
        queue: TEST_QUEUE,
        bindings: [{ exchange: TEST_EXCHANGE, pattern: TEST_ROUTING_KEY }],
      },
      async () => {
        attempts += 1;
        throw new Error('Intentional handler failure');
      },
    );

    const envelope = createEnvelope(
      { value: 42 },
      {
        messageType: TEST_ROUTING_KEY,
        producer: 'gateway',
        identity: null,
      },
    );

    await broker.publish(TEST_EXCHANGE, TEST_ROUTING_KEY, envelope);

    // Wait for the message to traverse 1s, 5s, 30s retry queues and land in DLQ.
    const deadLetters: amqp.ConsumeMessage[] = [];
    const closeErrorQueue = await bindErrorQueue('test.integration.errors', deadLetters);

    // Wait for the message to traverse 1s, 5s, 30s retry queues and be published to bank.errors.
    await waitFor(() => deadLetters.length === 1, 60_000);

    await closeErrorQueue();

    const dlqMessage = deadLetters[0];
    expect(dlqMessage).toBeDefined();
    expect(dlqMessage!.properties.headers).toMatchObject({
      'x-attempt': 4,
      'x-failure-reason': expect.stringContaining('Intentional handler failure'),
      'x-failed-at': expect.any(String),
      'x-original-routing-key': TEST_ROUTING_KEY,
    });

    expect(attempts).toBe(4);

    await broker.stop();
  });

  it('drains a message that reached the error exchange, raw', async () => {
    const broker = new MessageBroker({
      url: RABBITMQ_URL!,
      exchanges: [TEST_EXCHANGE],
      errorExchange: EXCHANGES.errors,
    });

    await broker.start();

    const drained: ParkedMessage[] = [];
    await broker.drainErrors(async (parked) => {
      drained.push(parked);
    });

    // A poison body — not even JSON — published straight to the error exchange,
    // the way `#park` publishes anything it could not process. The drain must
    // hand it over untouched rather than let it vanish.
    const connection = await amqp.connect(RABBITMQ_URL!);
    const channel = await connection.createChannel();
    await channel.assertExchange(EXCHANGES.errors, 'topic', { durable: true });
    channel.publish(EXCHANGES.errors, 'poison.routing.key.v1', Buffer.from('not an envelope'), {
      headers: {
        'x-failure-reason': 'invalid: body is not a well-formed message envelope.',
        'x-original-routing-key': 'poison.routing.key.v1',
      },
    });
    await channel.close();
    await connection.close();

    await waitFor(() => drained.length === 1, 10_000);

    expect(drained[0]!.content.toString('utf8')).toBe('not an envelope');
    expect(drained[0]!.routingKey).toBe('poison.routing.key.v1');
    expect(drained[0]!.headers['x-failure-reason']).toContain('not a well-formed');

    await broker.stop();
  });

  async function bindErrorQueue(
    queueName: string,
    captured: amqp.ConsumeMessage[],
  ): Promise<() => Promise<void>> {
    const connection = await amqp.connect(RABBITMQ_URL!);
    const channel = await connection.createChannel();
    await channel.assertQueue(queueName, { durable: true });
    await channel.bindQueue(queueName, EXCHANGES.errors, '#');

    const consumer = await channel.consume(queueName, (message) => {
      if (message) {
        channel.ack(message);
        captured.push(message);
      }
    });

    return async () => {
      await channel.cancel(consumer.consumerTag);
      await channel.deleteQueue(queueName, { ifUnused: false });
      await channel.close();
      await connection.close();
    };
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
