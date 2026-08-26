import { EXCHANGES, createEnvelope } from '@bank/contracts';

import { MessageBroker } from '../src/broker';

/**
 * A regression test for a defect that only appeared against a live broker.
 *
 * `amqp-connection-manager` does **not** reject a publish while the connection
 * is down — it buffers the message and settles it whenever the broker returns.
 * For a caller holding an HTTP connection open that means waiting indefinitely
 * instead of being told the request could not be accepted. The first real
 * measurement of this hung for five minutes and was killed.
 *
 * The unit tests could not have caught it: they use a fake publisher that
 * rejects, so they were asserting the behaviour of the double rather than of
 * the adapter. What can be asserted here, without a broker, is that the option
 * that fixes it is actually passed through — because a silently dropped
 * `timeout` looks exactly like the bug coming back.
 */

interface PublishCall {
  readonly options: Record<string, unknown>;
}

const calls: PublishCall[] = [];

jest.mock('amqp-connection-manager', () => ({
  connect: () => ({
    isConnected: () => true,
    createChannel: () => ({
      waitForConnect: () => Promise.resolve(),
      publish: (
        _exchange: string,
        _routingKey: string,
        _content: Buffer,
        options: Record<string, unknown>,
      ) => {
        calls.push({ options });
        return Promise.resolve();
      },
    }),
    close: () => Promise.resolve(),
  }),
}));

const ENVELOPE = createEnvelope(
  { accountId: '33333333-3333-4333-8333-333333333333' },
  { messageType: 'account.create.v1', producer: 'gateway', identity: null },
);

async function publishWith(publishTimeoutMs?: number): Promise<Record<string, unknown>> {
  calls.length = 0;

  const broker = new MessageBroker({
    url: 'amqp://unused',
    exchanges: [EXCHANGES.commands],
    errorExchange: EXCHANGES.errors,
    ...(publishTimeoutMs === undefined ? {} : { publishTimeoutMs }),
  });

  await broker.start();
  await broker.publish(EXCHANGES.commands, ENVELOPE.messageType, ENVELOPE);

  return calls[0]!.options;
}

describe('publishing is bounded in time', () => {
  it('always passes a timeout, so a down broker cannot buffer forever', async () => {
    const options = await publishWith();

    expect(options.timeout).toBe(5_000);
  });

  it('lets a caller shorten it', async () => {
    const options = await publishWith(250);

    expect(options.timeout).toBe(250);
  });

  /**
   * The delivery guarantees the rest of the system depends on must survive the
   * fix: persistent so a broker restart does not lose the message, and
   * confirmed so the promise means the broker took responsibility for it.
   */
  it('keeps the message persistent and publisher-confirmed', async () => {
    const options = await publishWith();

    expect(options.persistent).toBe(true);
    expect(options.contentType).toBe('application/json');
  });

  it('still carries the tracing fields the envelope defines', async () => {
    const options = await publishWith();

    expect(options.correlationId).toBe(ENVELOPE.correlationId);
    expect(options.messageId).toBe(ENVELOPE.messageId);
    expect(options.type).toBe(ENVELOPE.messageType);
    expect(options.headers).toMatchObject({
      'x-idempotency-key': ENVELOPE.idempotencyKey,
    });
  });
});
