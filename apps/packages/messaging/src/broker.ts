import { connect } from 'amqp-connection-manager';
import type { AmqpConnectionManager, ChannelWrapper } from 'amqp-connection-manager';
import type { ConfirmChannel, ConsumeMessage } from 'amqplib';

import type { MessageEnvelope } from '@bank/contracts';

/** What a caller needs to open a connection. Nothing about the business. */
export interface BrokerOptions {
  /** `amqp://user:password@host:port`, straight from `RABBITMQ_URL`. */
  readonly url: string;

  /** Topic exchange every message is published to and bound from. */
  readonly exchange: string;

  /** Milliseconds between reconnection attempts after a drop. */
  readonly reconnectDelayMs?: number;
}

/** One subscription: a durable queue bound to a set of routing patterns. */
export interface SubscriptionOptions {
  readonly queue: string;
  readonly routingKeys: readonly string[];
  /** Unacknowledged messages allowed in flight. Guards against a slow consumer. */
  readonly prefetch?: number;
}

/**
 * Called for each delivery. Returning normally acknowledges the message;
 * throwing rejects it without requeue, so a broken message goes to the
 * dead-letter path instead of spinning forever.
 */
export type MessageHandler = (envelope: MessageEnvelope<unknown>) => Promise<void> | void;

const DEFAULT_RECONNECT_DELAY_MS = 5_000;
const DEFAULT_PREFETCH = 10;

/**
 * A thin, reconnecting wrapper over RabbitMQ.
 *
 * Deliberately ignorant: it moves envelopes, and it has no opinion on what a
 * `messageType` means or which service should hear it. Routing keys and
 * payloads come from the caller, so no business decision leaks into shared
 * infrastructure (FR-010).
 */
export class MessageBroker {
  readonly #connection: AmqpConnectionManager;
  readonly #exchange: string;
  #publisher: ChannelWrapper | undefined;

  constructor(options: BrokerOptions) {
    this.#exchange = options.exchange;
    this.#connection = connect([options.url], {
      reconnectTimeInSeconds: Math.ceil(
        (options.reconnectDelayMs ?? DEFAULT_RECONNECT_DELAY_MS) / 1000,
      ),
    });
  }

  /** Resolves once the exchange exists and the channel is ready to publish. */
  public async start(): Promise<void> {
    this.#publisher = this.#connection.createChannel({
      json: false,
      setup: async (channel: ConfirmChannel) => {
        await channel.assertExchange(this.#exchange, 'topic', { durable: true });
      },
    });

    await this.#publisher.waitForConnect();
  }

  /**
   * Publishes one envelope. Persistent and publisher-confirmed: the promise
   * settles only once the broker has taken responsibility for the message.
   */
  public async publish(routingKey: string, envelope: MessageEnvelope<unknown>): Promise<void> {
    const publisher = this.#publisher;
    if (publisher === undefined) {
      throw new Error('MessageBroker.publish called before start().');
    }

    await publisher.publish(this.#exchange, routingKey, Buffer.from(JSON.stringify(envelope)), {
      contentType: 'application/json',
      persistent: true,
      messageId: envelope.messageId,
      correlationId: envelope.correlationId,
      type: envelope.messageType,
      timestamp: Date.parse(envelope.occurredAt),
      headers: {
        'x-causation-id': envelope.causationId,
        'x-idempotency-key': envelope.idempotencyKey,
      },
    });
  }

  /** Binds a durable queue to the exchange and streams deliveries to `handler`. */
  public async subscribe(options: SubscriptionOptions, handler: MessageHandler): Promise<void> {
    const consumer = this.#connection.createChannel({
      json: false,
      setup: async (channel: ConfirmChannel) => {
        await channel.assertExchange(this.#exchange, 'topic', { durable: true });
        await channel.assertQueue(options.queue, { durable: true });
        await channel.prefetch(options.prefetch ?? DEFAULT_PREFETCH);

        for (const routingKey of options.routingKeys) {
          await channel.bindQueue(options.queue, this.#exchange, routingKey);
        }

        await channel.consume(options.queue, (message: ConsumeMessage | null) => {
          if (message === null) {
            return;
          }

          void this.#dispatch(channel, message, handler);
        });
      },
    });

    await consumer.waitForConnect();
  }

  /** Closes the connection and every channel opened from it. */
  public async stop(): Promise<void> {
    await this.#connection.close();
  }

  async #dispatch(
    channel: ConfirmChannel,
    message: ConsumeMessage,
    handler: MessageHandler,
  ): Promise<void> {
    try {
      await handler(parseEnvelope(message.content));
      channel.ack(message);
    } catch {
      // No requeue: a message this consumer cannot read will not become
      // readable on the next attempt. Dead-lettering is configured on the
      // queue by the deployment (T-06).
      channel.nack(message, false, false);
    }
  }
}

/** Reads a delivery body back into an envelope, or refuses it. */
export function parseEnvelope(content: Buffer): MessageEnvelope<unknown> {
  const parsed: unknown = JSON.parse(content.toString('utf8'));

  if (!isEnvelope(parsed)) {
    throw new Error('Delivery body is not a well-formed message envelope.');
  }

  return parsed;
}

function isEnvelope(value: unknown): value is MessageEnvelope<unknown> {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const candidate = value as Partial<MessageEnvelope<unknown>>;

  return (
    typeof candidate.messageId === 'string' &&
    typeof candidate.messageType === 'string' &&
    typeof candidate.correlationId === 'string' &&
    typeof candidate.idempotencyKey === 'string' &&
    typeof candidate.occurredAt === 'string' &&
    (candidate.causationId === null || typeof candidate.causationId === 'string')
  );
}
