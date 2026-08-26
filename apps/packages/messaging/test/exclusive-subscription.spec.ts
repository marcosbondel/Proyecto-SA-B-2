import { EXCHANGES } from '@bank/contracts';

import { MessageBroker } from '../src/broker';

/**
 * The exclusive subscription is defined by what it refuses to declare, and
 * none of that is observable from the outside once a broker is involved. So
 * the connection is faked and the setup callback the adapter hands to
 * `createChannel` is run against a recording channel.
 *
 * This is the whole point of the test: a reply queue that quietly came back
 * durable, or quietly grew a retry ladder, would still pass every integration
 * test — and would only fail in production, with two replicas, intermittently.
 */

type SetupFn = (channel: RecordingChannel) => Promise<void>;

interface AssertedQueue {
  readonly name: string;
  readonly options: Record<string, unknown>;
}

class RecordingChannel {
  public readonly assertedQueues: AssertedQueue[] = [];
  public readonly assertedExchanges: string[] = [];
  public readonly bindings: { queue: string; exchange: string; pattern: string }[] = [];
  public prefetchValue: number | undefined;
  public consumedQueue: string | undefined;

  assertQueue(name: string, options: Record<string, unknown> = {}): Promise<void> {
    this.assertedQueues.push({ name, options });
    return Promise.resolve();
  }

  assertExchange(name: string): Promise<void> {
    this.assertedExchanges.push(name);
    return Promise.resolve();
  }

  bindQueue(queue: string, exchange: string, pattern: string): Promise<void> {
    this.bindings.push({ queue, exchange, pattern });
    return Promise.resolve();
  }

  prefetch(value: number): Promise<void> {
    this.prefetchValue = value;
    return Promise.resolve();
  }

  consume(queue: string): Promise<void> {
    this.consumedQueue = queue;
    return Promise.resolve();
  }
}

const createdChannels: { setup: SetupFn }[] = [];

jest.mock('amqp-connection-manager', () => ({
  connect: () => ({
    createChannel: (options: { setup: SetupFn }) => {
      createdChannels.push(options);
      return { waitForConnect: () => Promise.resolve(), publish: () => Promise.resolve() };
    },
    close: () => Promise.resolve(),
  }),
}));

async function runSetup(
  subscribe: (broker: MessageBroker) => Promise<void>,
): Promise<RecordingChannel> {
  createdChannels.length = 0;

  const broker = new MessageBroker({
    url: 'amqp://unused',
    exchanges: [EXCHANGES.replies],
    errorExchange: EXCHANGES.errors,
  });

  await subscribe(broker);

  const channel = new RecordingChannel();
  // The last channel created is the subscription's.
  await createdChannels[createdChannels.length - 1]!.setup(channel);

  return channel;
}

const REPLY_QUEUE = 'gateway.replies.gw-1';

describe('subscribeExclusive', () => {
  it('declares a queue that no other replica can share and that dies with the process', async () => {
    const channel = await runSetup((broker) =>
      broker.subscribeExclusive(
        { queue: REPLY_QUEUE, bindings: [{ exchange: EXCHANGES.replies, pattern: '#' }] },
        () => undefined,
      ),
    );

    expect(channel.assertedQueues).toHaveLength(1);
    expect(channel.assertedQueues[0]).toEqual({
      name: REPLY_QUEUE,
      options: { durable: false, exclusive: true, autoDelete: true },
    });
  });

  /**
   * Retrying a reply finds the same absent waiter, and a dead-letter queue of
   * replies accumulates nothing anyone will ever read.
   */
  it('declares no retry ladder and no dead-letter queue', async () => {
    const channel = await runSetup((broker) =>
      broker.subscribeExclusive(
        { queue: REPLY_QUEUE, bindings: [{ exchange: EXCHANGES.replies, pattern: '#' }] },
        () => undefined,
      ),
    );

    const names = channel.assertedQueues.map((queue) => queue.name);

    expect(names.some((name) => name.includes('.retry.'))).toBe(false);
    expect(names.some((name) => name.endsWith('.dlq'))).toBe(false);
  });

  it('binds every pattern it was given and consumes its own queue', async () => {
    const channel = await runSetup((broker) =>
      broker.subscribeExclusive(
        {
          queue: REPLY_QUEUE,
          bindings: [
            { exchange: EXCHANGES.replies, pattern: '#' },
            { exchange: EXCHANGES.events, pattern: 'customer.email.verified.v1' },
          ],
        },
        () => undefined,
      ),
    );

    expect(channel.bindings).toEqual([
      { queue: REPLY_QUEUE, exchange: EXCHANGES.replies, pattern: '#' },
      { queue: REPLY_QUEUE, exchange: EXCHANGES.events, pattern: 'customer.email.verified.v1' },
    ]);
    expect(channel.consumedQueue).toBe(REPLY_QUEUE);
  });
});

/**
 * The durable path is what six services depend on. Adding the exclusive mode
 * must not have changed a single thing about it.
 */
describe('subscribe, unchanged', () => {
  it('still declares a durable queue, its dead-letter queue and its three retry rungs', async () => {
    const channel = await runSetup((broker) =>
      broker.subscribe(
        { queue: 'account.commands', bindings: [{ exchange: EXCHANGES.commands, pattern: '#' }] },
        () => undefined,
      ),
    );

    const names = channel.assertedQueues.map((queue) => queue.name);

    expect(names).toContain('account.commands');
    expect(names).toContain('account.commands.dlq');
    expect(names.filter((name) => name.includes('.retry.'))).toHaveLength(3);

    const work = channel.assertedQueues.find((queue) => queue.name === 'account.commands');
    expect(work?.options).toEqual({ durable: true });
  });
});
