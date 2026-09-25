import { randomUUID } from 'node:crypto';

import amqp from 'amqplib';
import type { Channel, ChannelModel, ConsumeMessage, Options } from 'amqplib';
import { EXCHANGES, createEnvelope } from '@bank/contracts';
import type { MessageEnvelope, Producer } from '@bank/contracts';

import { waitFor } from './broker-harness';

/**
 * A downstream service, played by a raw `amqplib` channel.
 *
 * Deliberately **not** `@bank/messaging`'s `MessageBroker`: the point of this
 * suite is to prove what the Gateway does against the actual broker, and a
 * double built from the same adapter under test would just be testing itself.
 * A raw channel is also what the exclusivity hazard documented in
 * `apps/packages/messaging/test/broker.integration.spec.ts` requires — an
 * `amqp-connection-manager` connection retries forever on `RESOURCE_LOCKED`
 * and leaks that retry loop into the next test.
 *
 * One instance is one spy: it binds one queue, records every delivery that
 * reaches it, and can publish a reply or an event back onto the exchanges the
 * Gateway's own reply queue listens on. Every queue it declares is exclusive
 * and auto-deleting, so nothing survives it beyond `close()`.
 */

export interface CapturedMessage {
  readonly exchange: string;
  readonly routingKey: string;
  readonly raw: Buffer;
  readonly properties: ConsumeMessage['properties'];
  /** `undefined` when the body did not even parse as JSON. */
  readonly envelope: MessageEnvelope<unknown> | undefined;
}

interface Waiter {
  readonly predicate: (envelope: MessageEnvelope<unknown>) => boolean;
  readonly resolve: (message: CapturedMessage) => void;
}

export class ServiceDouble {
  readonly #connection: ChannelModel;
  readonly #channel: Channel;
  readonly #captured: CapturedMessage[] = [];
  readonly #waiters = new Set<Waiter>();
  readonly #assertedExchanges = new Set<string>();
  #queueName: string | undefined;

  private constructor(connection: ChannelModel, channel: Channel) {
    this.#connection = connection;
    this.#channel = channel;
  }

  public static async connect(rabbitmqUrl: string): Promise<ServiceDouble> {
    const connection = await amqp.connect(rabbitmqUrl);
    const channel = await connection.createChannel();
    const double = new ServiceDouble(connection, channel);

    // Declared once, up front, rather than on the first `publish()` inside
    // `reply()`/`event()` — those are on the hot path of a race against
    // whatever else is consuming the same command on this broker (see
    // `reply-correlation.integration.spec.ts`), and `assertExchange` is a
    // synchronous round trip to the broker that a warmed-up production
    // channel never pays per message.
    await Promise.all(
      [EXCHANGES.commands, EXCHANGES.events, EXCHANGES.replies, EXCHANGES.errors].map((exchange) =>
        double.#prepareExchange(exchange),
      ),
    );

    return double;
  }

  async #prepareExchange(exchange: string): Promise<void> {
    if (this.#assertedExchanges.has(exchange)) {
      return;
    }
    await this.#channel.assertExchange(exchange, 'topic', { durable: true });
    this.#assertedExchanges.add(exchange);
  }

  /** The raw channel, for a test that needs to declare or inspect something itself. */
  public get channel(): Channel {
    return this.#channel;
  }

  public get queueName(): string | undefined {
    return this.#queueName;
  }

  public get captured(): readonly CapturedMessage[] {
    return this.#captured;
  }

  /**
   * Binds this double's queue to one or more exchange/pattern pairs and starts
   * recording every delivery. `test.spy.<uuid>` names it, matching the
   * `test.spy.` convention the task names for this suite.
   */
  public async spyOn(
    bindings: readonly { readonly exchange: string; readonly pattern: string }[],
  ): Promise<string> {
    const queue = `test.spy.${randomUUID()}`;
    this.#queueName = queue;

    await this.#channel.assertQueue(queue, { exclusive: true, autoDelete: true, durable: false });

    for (const binding of bindings) {
      await this.#prepareExchange(binding.exchange);
      await this.#channel.bindQueue(queue, binding.exchange, binding.pattern);
    }

    await this.#channel.consume(queue, (message) => {
      if (message === null) {
        return;
      }

      const captured: CapturedMessage = {
        exchange: message.fields.exchange,
        routingKey: message.fields.routingKey,
        raw: message.content,
        properties: message.properties,
        envelope: tryParseEnvelope(message.content),
      };
      this.#captured.push(captured);
      this.#channel.ack(message);

      // Notified synchronously, in the consumer callback itself, rather than
      // discovered by a poll. `reply-correlation.integration.spec.ts` answers
      // a command this double just received while the *real* domain services
      // may also be consuming it on this shared broker (see that file's own
      // note); a poll interval is latency this double can never get back, and
      // losing that race is not a flaky test; it is one answering a question
      // nobody asked it to.
      if (captured.envelope !== undefined) {
        const envelope = captured.envelope;
        for (const waiter of [...this.#waiters]) {
          if (waiter.predicate(envelope)) {
            this.#waiters.delete(waiter);
            waiter.resolve(captured);
          }
        }
      }
    });

    return queue;
  }

  /** Every commands+events publication the Gateway makes, in one spy. */
  public async spyOnEverythingPublished(): Promise<string> {
    return await this.spyOn([
      { exchange: EXCHANGES.commands, pattern: '#' },
      { exchange: EXCHANGES.events, pattern: '#' },
    ]);
  }

  /**
   * Waits for a captured message whose envelope matches `predicate` —
   * something already captured, or the next matching delivery, whichever
   * comes first. Resolved from inside the `consume` callback itself (see
   * `spyOn`), not by polling: a poll adds up to its own interval of latency
   * on top of the network round trip, which is latency this double cannot
   * afford when a live competing consumer may answer the same command.
   */
  public async waitForEnvelope(
    predicate: (envelope: MessageEnvelope<unknown>) => boolean,
    timeoutMs = 5_000,
  ): Promise<CapturedMessage> {
    const already = this.#captured.find((m) => m.envelope !== undefined && predicate(m.envelope));
    if (already !== undefined) {
      return already;
    }

    return await new Promise<CapturedMessage>((resolve, reject) => {
      const waiter: Waiter = { predicate, resolve: settle };
      const timer = setTimeout(() => {
        this.#waiters.delete(waiter);
        reject(new Error(`No captured envelope matched the predicate within ${String(timeoutMs)}ms`));
      }, timeoutMs);

      function settle(message: CapturedMessage): void {
        clearTimeout(timer);
        resolve(message);
      }

      this.#waiters.add(waiter);
    });
  }

  /** Waits until at least `count` messages have been captured. */
  public async waitForCount(count: number, timeoutMs = 5_000): Promise<void> {
    await waitFor(() => this.#captured.length >= count, timeoutMs);
  }

  /**
   * Answers a command the Gateway is waiting on, the way a service reply
   * would: same `correlationId`, `causationId` pointing at the command, and
   * published to `bank.replies` with the reply's own name as the routing key.
   *
   * `GATEWAY_REPLY_BINDINGS` binds `bank.replies` with pattern `#`, so any
   * routing key on that exchange reaches every replica's reply queue; the
   * reply's own message name is used because that is what a real producer
   * publishes it as (`destinationFor`), not because the binding requires it.
   */
  public async reply(
    cause: MessageEnvelope<unknown>,
    messageType: string,
    payload: unknown,
    options: { readonly producer?: Producer } = {},
  ): Promise<void> {
    await this.publishFollowUp(EXCHANGES.replies, cause, messageType, payload, options);
  }

  /**
   * Publishes one of the two-event verdicts the Gateway correlates directly
   * (email verification, password reset, password change, registration, a
   * deposit) — an **event**, not a reply, so it goes on `bank.events` under
   * its own name, exactly like `notification-audit-service`'s ordinary
   * consumption of it.
   */
  public async event(
    cause: MessageEnvelope<unknown>,
    messageType: string,
    payload: unknown,
    options: { readonly producer?: Producer } = {},
  ): Promise<void> {
    await this.publishFollowUp(EXCHANGES.events, cause, messageType, payload, options);
  }

  private async publishFollowUp(
    exchange: string,
    cause: MessageEnvelope<unknown>,
    messageType: string,
    payload: unknown,
    options: { readonly producer?: Producer },
  ): Promise<void> {
    const envelope = createEnvelope(payload, {
      messageType,
      producer: options.producer ?? 'customer-service',
      identity: cause.identity,
      correlationId: cause.correlationId,
      causationId: cause.messageId,
    });

    await this.publishEnvelope(exchange, messageType, envelope);
  }

  /** Publishes a well-formed envelope, in the exact shape `MessageBroker.publish` does. */
  public async publishEnvelope(
    exchange: string,
    routingKey: string,
    envelope: MessageEnvelope<unknown>,
  ): Promise<void> {
    await this.publishRaw(exchange, routingKey, Buffer.from(JSON.stringify(envelope)), {
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

  /** Publishes an arbitrary buffer, for the malformed/poison-message cases. */
  public async publishRaw(
    exchange: string,
    routingKey: string,
    content: Buffer,
    properties: Options.Publish = {},
  ): Promise<void> {
    await this.#prepareExchange(exchange);
    this.#channel.publish(exchange, routingKey, content, properties);
  }

  /** Declares (or asserts against) a queue by name, without binding or consuming it. */
  public async assertQueue(
    name: string,
    options?: Options.AssertQueue,
  ): Promise<amqp.Replies.AssertQueue> {
    return await this.#channel.assertQueue(name, options);
  }

  public async close(): Promise<void> {
    try {
      await this.#channel.close();
    } catch {
      // Already gone — the exclusive queue auto-deletes with the channel.
    }
    await this.#connection.close();
  }
}

function tryParseEnvelope(content: Buffer): MessageEnvelope<unknown> | undefined {
  try {
    const parsed: unknown = JSON.parse(content.toString('utf8'));
    return parsed as MessageEnvelope<unknown>;
  } catch {
    return undefined;
  }
}

/**
 * A raw, unmanaged connection for cleanup work in `afterEach` — declaring and
 * deleting a queue, or checking one exists — exactly the pattern
 * `broker.integration.spec.ts` uses, swallowing `NOT_FOUND` because a previous
 * run or the broker's own auto-delete may already have removed it.
 */
export async function withRawChannel<T>(
  rabbitmqUrl: string,
  work: (channel: Channel) => Promise<T>,
): Promise<T> {
  const connection = await amqp.connect(rabbitmqUrl);
  const channel = await connection.createChannel();
  try {
    return await work(channel);
  } finally {
    await channel.close().catch(() => undefined);
    await connection.close().catch(() => undefined);
  }
}

export async function deleteQueueIfExists(channel: Channel, name: string): Promise<void> {
  try {
    await channel.deleteQueue(name, { ifUnused: false });
  } catch (error) {
    if (!String(error).includes('NOT_FOUND')) {
      throw error;
    }
  }
}
