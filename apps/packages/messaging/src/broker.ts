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

  /**
   * How long a publish may wait for the broker to take responsibility for a
   * message before it is rejected.
   *
   * This is not a tuning knob, it is a correctness requirement. Without it,
   * `amqp-connection-manager` **buffers** a publish while the connection is
   * down and settles it whenever the broker returns — which for a caller
   * holding an HTTP connection open means waiting indefinitely instead of
   * being told the request could not be accepted.
   */
  readonly publishTimeoutMs?: number;

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
 * One subscription to answers meant for **this process alone**.
 *
 * Same shape as `SubscriptionOptions`, different type so the two cannot be
 * passed to the wrong method by accident — the durability difference between
 * them is the whole point.
 */
export interface ExclusiveSubscriptionOptions {
  readonly queue: string;
  readonly bindings: readonly Binding[];
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

/**
 * Long enough that a momentary reconnection is survived, short enough that a
 * caller is not left hanging. A publish that has not been confirmed in five
 * seconds is not going to be confirmed usefully.
 */
const DEFAULT_PUBLISH_TIMEOUT_MS = 5_000;
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
  readonly #publishTimeoutMs: number;
  #publisher: ChannelWrapper | undefined;

  constructor(options: BrokerOptions) {
    this.#exchanges = options.exchanges;
    this.#errorExchange = options.errorExchange;
    this.#retryPolicy = options.retryPolicy ?? new RetryPolicy();
    this.#publishTimeoutMs = options.publishTimeoutMs ?? DEFAULT_PUBLISH_TIMEOUT_MS;
    this.#connection = connect([options.url], {
      reconnectTimeInSeconds: Math.ceil(
        (options.reconnectDelayMs ?? DEFAULT_RECONNECT_DELAY_MS) / 1000,
      ),
    });
  }

  /**
   * Whether the connection is currently up.
   *
   * For readiness probes. The adapter reconnects on its own, so this answers
   * "can I serve traffic right now", not "is something permanently broken".
   */
  public isConnected(): boolean {
    return this.#connection.isConnected();
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
      // Rejects rather than buffering forever while the broker is unreachable.
      timeout: this.#publishTimeoutMs,
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

  /**
   * Subscribes to answers addressed to this process, on a queue nobody else
   * shares.
   *
   * Everything `subscribe` does deliberately, this does the opposite of, and
   * each reversal has the same cause: a reply is only meaningful to the caller
   * still waiting for it.
   *
   * - **Exclusive and auto-deleting**, so two replicas cannot share it. A
   *   durable shared queue would have the broker deliver replies round-robin,
   *   and an answer would reach an instance that never asked the question.
   * - **No retry ladder and no dead-letter queue.** Redelivering a reply finds
   *   the same absent waiter, and a dead-letter queue of replies accumulates
   *   nothing anyone will ever read.
   * - **A delivery nobody is waiting for is discarded**, not treated as a
   *   fault: a reply that outlived its timeout, or one meant for another
   *   replica, are both expected outcomes.
   *
   * The queue does not survive a restart, and that is correct — neither do the
   * in-memory waiters it serves.
   */
  public async subscribeExclusive(
    options: ExclusiveSubscriptionOptions,
    handler: MessageHandler,
    validate?: MessageValidator,
  ): Promise<void> {
    const consumer = this.#connection.createChannel({
      json: false,
      setup: async (channel: ConfirmChannel) => {
        await channel.assertQueue(options.queue, {
          durable: false,
          exclusive: true,
          autoDelete: true,
        });

        await channel.prefetch(options.prefetch ?? DEFAULT_PREFETCH);

        for (const binding of options.bindings) {
          await channel.assertExchange(binding.exchange, 'topic', { durable: true });
          await channel.bindQueue(options.queue, binding.exchange, binding.pattern);
        }

        await channel.consume(options.queue, (message: ConsumeMessage | null) => {
          if (message === null) {
            return;
          }

          void this.#deliverReply(channel, message, handler, validate);
        });
      },
    });

    await consumer.waitForConnect();
  }

  /** Closes the connection and every channel opened from it. */
  public async stop(): Promise<void> {
    await this.#connection.close();
  }

  /**
   * Hands one reply to its waiter, and acknowledges it whatever happens.
   *
   * There is no failure mode here worth keeping the message for. Unparseable,
   * unrecognised, or nobody waiting — all three mean this delivery has no
   * future, and holding it would only stop the queue.
   */
  async #deliverReply(
    channel: ConfirmChannel,
    message: ConsumeMessage,
    handler: MessageHandler,
    validate: MessageValidator | undefined,
  ): Promise<void> {
    try {
      const envelope = parseEnvelope(message.content);

      if (validate?.(envelope).ok ?? true) {
        await handler(envelope);
      }
    } catch {
      // Swallowed on purpose: see the method comment. A reply that cannot be
      // delivered is dropped, never retried and never dead-lettered.
    } finally {
      channel.ack(message);
    }
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
