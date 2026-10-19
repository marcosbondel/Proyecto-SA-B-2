import { createEnvelope } from '@bank/contracts';
import type { MessageEnvelope } from '@bank/contracts';

import { GatewayError } from '../src/application/errors/gateway-error';
import type { MessagePublisherPort, ReplyWaiterPort } from '../src/application/ports';
import { askAndWait } from '../src/application/request-reply';

const CEILING_MS = 5_000;

/**
 * What the production incident of 2026-10-19 looked like from inside the
 * process: RabbitMQ scaled to zero, `publish` neither resolved nor rejected
 * (amqp-connection-manager buffers it), and the five-second reply ceiling —
 * registered *before* the publish, by design — fired first. Nobody had
 * attached a handler to that promise yet, so Node saw an unhandled rejection
 * and exited with code 1 in every pod.
 */
describe('askAndWait while the broker never answers the publish', () => {
  const unhandled: unknown[] = [];
  const onUnhandled = (reason: unknown): void => {
    unhandled.push(reason);
  };

  /** A wait that rejects at the ceiling, as `ReplyQueueAdapter.waitFor` does. */
  function waiterWithCeiling(): ReplyWaiterPort {
    return {
      waitFor: () =>
        new Promise<MessageEnvelope<unknown>>((_resolve, reject) => {
          setTimeout(() => {
            reject(GatewayError.replyTimeout());
          }, CEILING_MS);
        }),
    };
  }

  const neverSettles: MessagePublisherPort = {
    publish: () => new Promise<void>(() => undefined),
  };

  const envelope = createEnvelope(
    { accountId: '8b7e5d21-9c2e-4a71-b8f5-2d6e7c0a1b93' },
    {
      messageType: 'account.balance.query.v1',
      producer: 'gateway',
      identity: null,
      correlationId: '6f1c8a30-9c2e-4a71-b8f5-2d6e7c0a1b93',
    },
  );

  beforeEach(() => {
    unhandled.length = 0;
    jest.useFakeTimers();
    process.on('unhandledRejection', onUnhandled);
  });

  afterEach(() => {
    process.off('unhandledRejection', onUnhandled);
    jest.useRealTimers();
  });

  /** Lets Node run its unhandled-rejection pass, which happens after microtasks. */
  async function drainRejections(): Promise<void> {
    jest.useRealTimers();
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
  }

  it('settles with the reply timeout at the ceiling instead of hanging with the publish', async () => {
    const outcome = askAndWait(neverSettles, waiterWithCeiling(), envelope).then(
      () => 'resolved',
      (error: unknown) => error,
    );

    await jest.advanceTimersByTimeAsync(CEILING_MS + 1);

    const error = await outcome;
    expect(error).toBeInstanceOf(GatewayError);
    expect((error as GatewayError).type).toBe('REPLY_TIMEOUT');
  });

  it('leaves no unhandled rejection behind when the ceiling fires first', async () => {
    const outcome = askAndWait(neverSettles, waiterWithCeiling(), envelope).then(
      () => undefined,
      () => undefined,
    );

    await jest.advanceTimersByTimeAsync(CEILING_MS + 1);
    await outcome;
    await drainRejections();

    expect(unhandled).toEqual([]);
  });

  it('answers BROKER_UNAVAILABLE when the publish is the first thing to fail', async () => {
    const failing: MessagePublisherPort = {
      publish: () => Promise.reject(GatewayError.brokerUnavailable()),
    };

    const outcome = askAndWait(failing, waiterWithCeiling(), envelope).then(
      () => 'resolved',
      (error: unknown) => error,
    );
    await jest.advanceTimersByTimeAsync(CEILING_MS + 1);
    const error = await outcome;
    await drainRejections();

    expect((error as GatewayError).type).toBe('BROKER_UNAVAILABLE');
    expect(unhandled).toEqual([]);
  });

  it('still returns the reply when it beats a slow publish confirmation', async () => {
    const reply = { messageType: 'x.replied.v1' } as unknown as MessageEnvelope<unknown>;
    const replies: ReplyWaiterPort = { waitFor: () => Promise.resolve(reply) };

    await expect(askAndWait(neverSettles, replies, envelope)).resolves.toBe(reply);
  });
});
