import { connect } from 'amqp-connection-manager';
import type { AmqpConnectionManager, ChannelWrapper } from 'amqp-connection-manager';
import type { ConfirmChannel, ConsumeMessage } from 'amqplib';

import type { MessageEnvelope } from '@bank/contracts';

import { deadLetterHeaders, deadLetterQueueFor } from './dead-letter';
import { ATTEMPT_HEADER, RetryPolicy } from './retry-policy';

/** What a caller needs to open a connection. Nothing about the business. */
export interface BrokerOptions {
  /** `amqp://user:password@host:port`, straight from `RABBITMQ_URL`. */
  readonly url: string;

  /**
   * Every exchange to declare, passed in by the caller.
   *
   * The names live in `@bank/contracts`, not here: this adapter moves envelopes
   * and has no opinion about what a `bank.events` is. Hard-coding them would
   * make the transport layer a place where domain vocabulary lives.
   */
  readonly exchanges: readonly string[];

  /** Where messages go when they stop being retried. */
  readonly errorExchange: string;

  /** Milliseconds between reconnection attempts after a drop. */
  readonly reconnectDelayMs?: number;

  /** Overrides the 1s/5s/30s ladder. */
  readonly retryPolicy?: RetryPolicy;
}

/** One binding of a queue to an exchange. */
export interface Binding {
  readonly exchange: string;
  readonly pattern: string;
}

/** One subscription: a durable queue, its bindings, and its retry ladder. */
export interface SubscriptionOptions {
  readonly queue: string;
  readonly bindings: readonly Binding[];
  /** Unacknowledged messages allowed in flight. Guards against a slow consumer. */
  readonly prefetch?: number;
}

/**
 * Decides whether a delivery is understandable at all, before the handler runs.
 *
 * Injected rather than imported so the adapter stays free of the catalogue. A
 * validator that returns `invalid` sends the message straight to the error
 * exchange: retrying a message that cannot be parsed never repairs it.
 */
export type MessageValidator = (
  envelope: MessageEnvelope<unknown>,
) => { readonly ok: true } | { readonly ok: false; readonly reason: string };

/**
 * Called for each delivery. Returning normally acknowledges the message;
 * throwing sends it down the retry ladder, and then to the dead-letter queue.
 */
export type MessageHandler = (envelope: MessageEnvelope<unknown>) => Promise<void> | void;

const DEFAULT_RECONNECT_DELAY_MS = 5_000;
const DEFAULT_PREFETCH = 10;

/**
 * A thin, reconnecting wrapper over RabbitMQ.
 *
 * Deliberately ignorant: it moves envelopes, and it has no opinion on what a
 * `messageType` means or which service should hear it. Exchanges, bindings and
 * payload validation come from the caller, so no business decision leaks into
 * shared infrastructure (FR-010).
 */
export class MessageBroker {
  readonly #connection: AmqpConnectionManager;
  readonly #exchanges: readonly string[];
  readonly #errorExchange: string;
  readonly #retryPolicy: RetryPolicy;
  #publisher: ChannelWrapper | undefined;

  constructor(options: BrokerOptions) {
    this.#exchanges = options.exchanges;
    this.#errorExchange = options.errorExchange;
    this.#retryPolicy = options.retryPolicy ?? new RetryPolicy();
    this.#connection = connect([options.url], {
      reconnectTimeInSeconds: Math.ceil(
        (options.reconnectDelayMs ?? DEFAULT_RECONNECT_DELAY_MS) / 1000,
      ),
    });
  }

  /** Resolves once every exchange exists and the channel is ready to publish. */
  public async start(): Promise<void> {
    this.#publisher = this.#connection.createChannel({
      json: false,
      setup: async (channel: ConfirmChannel) => {
        for (const exchange of [...this.#exchanges, this.#errorExchange]) {
          await channel.assertExchange(exchange, 'topic', { durable: true });
        }
      },
    });

    await this.#publisher.waitForConnect();
  }

  /**
   * Publishes one envelope. Persistent and publisher-confirmed: the promise
   * settles only once the broker has taken responsibility for the message.
   */
  public async publish(
    exchange: string,
    routingKey: string,
    envelope: MessageEnvelope<unknown>,
    options: { readonly replyTo?: string; readonly headers?: Record<string, unknown> } = {},
  ): Promise<void> {
    const publisher = this.#publisher;
    if (publisher === undefined) {
      throw new Error('MessageBroker.publish called before start().');
    }

    await publisher.publish(exchange, routingKey, Buffer.from(JSON.stringify(envelope)), {
      contentType: 'application/json',
      persistent: true,
      messageId: envelope.messageId,
      correlationId: envelope.correlationId,
      type: envelope.messageType,
      timestamp: Date.parse(envelope.occurredAt),
      ...(options.replyTo === undefined ? {} : { replyTo: options.replyTo }),
      headers: {
        'x-causation-id': envelope.causationId,
        'x-idempotency-key': envelope.idempotencyKey,
        ...options.headers,
      },
    });
  }

  /** Declares a queue with its retry ladder and streams deliveries to `handler`. */
  public async subscribe(
    options: SubscriptionOptions,
    handler: MessageHandler,
    validate?: MessageValidator,
  ): Promise<void> {
    const consumer = this.#connection.createChannel({
      json: false,
      setup: async (channel: ConfirmChannel) => {
        await channel.assertQueue(options.queue, { durable: true });
        await channel.assertQueue(deadLetterQueueFor(options.queue), { durable: true });

        // Each rung waits, then hands the message back to the queue it failed
        // in — through the default exchange, so no other consumer sees it again.
        for (let attempt = 1; attempt <= this.#retryPolicy.maxRetries; attempt += 1) {
          const decision = this.#retryPolicy.decide(attempt);
          if (decision.kind !== 'retry') {
            continue;
          }

          await channel.assertQueue(
            this.#retryPolicy.retryQueueFor(options.queue, decision.delayMs),
            {
              durable: true,
              arguments: {
                'x-message-ttl': decision.delayMs,
                'x-dead-letter-exchange': '',
                'x-dead-letter-routing-key': options.queue,
              },
            },
          );
        }

        await channel.prefetch(options.prefetch ?? DEFAULT_PREFETCH);

        for (const binding of options.bindings) {
          await channel.assertExchange(binding.exchange, 'topic', { durable: true });
          await channel.bindQueue(options.queue, binding.exchange, binding.pattern);
        }

        await channel.consume(options.queue, (message: ConsumeMessage | null) => {
          if (message === null) {
            return;
          }

          void this.#dispatch(channel, options.queue, message, handler, validate);
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
    queue: string,
    message: ConsumeMessage,
    handler: MessageHandler,
    validate: MessageValidator | undefined,
  ): Promise<void> {
    const routingKey = message.fields.routingKey;
    const originalRoutingKey =
      (message.properties.headers?.['x-original-routing-key'] as string | undefined) ?? routingKey;
    const attempt = this.#retryPolicy.attemptOf(message.properties.headers);

    let envelope: MessageEnvelope<unknown>;
    try {
      envelope = parseEnvelope(message.content);
    } catch (error) {
      // Unparseable. No ladder: waiting will not make it parse.
      this.#park(channel, message, {
        attempt,
        kind: 'invalid',
        reason: describe(error),
        routingKey: originalRoutingKey,
      });
      return;
    }

    const verdict = validate?.(envelope) ?? { ok: true };
    if (!verdict.ok) {
      this.#park(channel, message, {
        attempt,
        kind: 'invalid',
        reason: verdict.reason,
        routingKey: originalRoutingKey,
      });
      return;
    }

    try {
      await handler(envelope);
      channel.ack(message);
    } catch (error) {
      const decision = this.#retryPolicy.decide(attempt);

      if (decision.kind === 'dead-letter') {
        this.#park(channel, message, {
          attempt,
          kind: 'handler-error',
          reason: describe(error),
          routingKey: originalRoutingKey,
        });
        return;
      }

      channel.sendToQueue(
        this.#retryPolicy.retryQueueFor(queue, decision.delayMs),
        message.content,
        {
          ...message.properties,
          headers: {
            ...message.properties.headers,
            [ATTEMPT_HEADER]: attempt + 1,
            'x-original-routing-key': originalRoutingKey,
          },
        },
      );
      channel.ack(message);
    }
  }

  /** Sends a delivery to the error exchange and acknowledges the original. */
  #park(
    channel: ConfirmChannel,
    message: ConsumeMessage,
    context: Parameters<typeof deadLetterHeaders>[0],
  ): void {
    channel.publish(this.#errorExchange, context.routingKey, message.content, {
      ...message.properties,
      headers: { ...message.properties.headers, ...deadLetterHeaders(context) },
    });
    channel.ack(message);
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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
    'payload' in candidate
  );
}
