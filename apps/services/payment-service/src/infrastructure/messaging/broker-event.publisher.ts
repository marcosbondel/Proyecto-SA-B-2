import {
  EXCHANGES,
  catalogByName,
  createEnvelope,
  followUpEnvelope,
  routingKeyFor,
} from '@bank/contracts';
import type { MessageEnvelope } from '@bank/contracts';
import type { MessageBroker } from '@bank/messaging';

import type { EventPublisher, OutboundMessage, OutboxMessage } from '../../application/ports';

/**
 * Everything this service says, on the exchange the catalogue assigns it.
 *
 * The exchange is not a parameter of each call: `catalogByName` already records
 * whether a message is an event or a reply, so a handler cannot publish an
 * event onto the replies exchange by writing the wrong argument. A message this
 * service has no contract for is refused outright rather than sent somewhere
 * plausible.
 *
 * **There is no `send`.** This service orders nothing from anybody: it is the
 * end of the command chain. If a `send` ever appears here, Payment Service has
 * begun telling another service what to do, and `test/isolation.spec.ts` fails
 * the build.
 *
 * Two ways to bind it:
 *
 * - **`forCause`** — a message being handled. The correlation and the verified
 *   identity are carried forward, so the causal chain stays reconstructible end
 *   to end (constitution VIII).
 * - **`forRetry`** — an attempt the sweeper made, which no message caused. It
 *   is *not* a fresh correlation: the payment carries the one its transfer
 *   began under, and a retry that started its own would break the trail at
 *   exactly the point somebody is trying to follow — "why did my transfer take
 *   thirty seconds" is a question about one correlation, not four.
 */
export class BrokerEventPublisher implements EventPublisher {
  readonly #broker: MessageBroker;
  #cause: MessageEnvelope<unknown> | null = null;
  #retryCorrelationId: string | null = null;

  constructor(broker: MessageBroker) {
    this.#broker = broker;
  }

  /**
   * A per-delivery instance, created by the router. A single mutable "current
   * cause" on a shared instance would attribute one payment's events to
   * another's correlation the first time two transfers were in flight at once.
   */
  public forCause(cause: MessageEnvelope<unknown>): BrokerEventPublisher {
    const bound = new BrokerEventPublisher(this.#broker);
    bound.#cause = cause;

    return bound;
  }

  /** Binds it to the correlation the payment's transfer began under. */
  public forRetry(correlationId: string): BrokerEventPublisher {
    const bound = new BrokerEventPublisher(this.#broker);
    bound.#retryCorrelationId = correlationId;

    return bound;
  }

  public async publish(message: OutboundMessage): Promise<void> {
    await this.#dispatch(message, 'event');
  }

  public async reply(message: OutboundMessage): Promise<void> {
    await this.#dispatch(message, 'reply');
  }

  /**
   * The durable form of an event, built but not sent — the seam the outbox hangs
   * on. Everything `#dispatch` does up to the publish, and then it stops: the
   * caller writes this to the outbox in the attempt's transaction, and the relay
   * is what finally hands it to the broker.
   */
  public envelopeFor(message: OutboundMessage): OutboxMessage {
    return this.#build(message, 'event');
  }

  async #dispatch(message: OutboundMessage, expected: 'event' | 'reply'): Promise<void> {
    const { exchange, routingKey, envelope } = this.#build(message, expected);

    await this.#broker.publish(exchange, routingKey, envelope);
  }

  /** Validates the message against its contract and wraps it in an envelope. */
  #build(message: OutboundMessage, expected: 'event' | 'reply'): OutboxMessage {
    const contract = catalogByName.get(message.messageType);

    if (contract === undefined) {
      throw new Error(`No contract named "${message.messageType}" exists in the catalogue.`);
    }

    if (contract.category !== expected) {
      throw new Error(
        `"${message.messageType}" is a ${contract.category}; it cannot be sent as a ${expected}.`,
      );
    }

    /**
     * Parsed against its own contract before it leaves. A malformed payload
     * that reaches the broker is a message Transaction Service will fail on,
     * far from the code that built it — and in a Saga that means a compensation
     * that never runs while the money stays debited.
     */
    const parsed = contract.schema.safeParse(message.payload);

    if (!parsed.success) {
      throw new Error(
        `Payload for "${message.messageType}" does not satisfy its contract: ${parsed.error.issues[0]?.message ?? 'unknown reason'}`,
      );
    }

    return {
      exchange: expected === 'reply' ? EXCHANGES.replies : EXCHANGES.events,
      routingKey: routingKeyFor(message.messageType),
      envelope: this.#envelopeFor(message.messageType, parsed.data),
    };
  }

  #envelopeFor(messageType: string, payload: unknown): MessageEnvelope<unknown> {
    if (this.#cause !== null) {
      return followUpEnvelope(this.#cause, payload, {
        messageType,
        producer: 'payment-service',
      });
    }

    if (this.#retryCorrelationId !== null) {
      /**
       * A `null` identity, and deliberately. A retry is this service acting on
       * its own timer; attributing it to whoever requested the transfer would
       * claim they asked for a fourth attempt they never made, written
       * permanently into an append-only trail.
       */
      return {
        ...createEnvelope(payload, {
          messageType,
          producer: 'payment-service',
          identity: null,
        }),
        correlationId: this.#retryCorrelationId,
      };
    }

    throw new Error('BrokerEventPublisher was used without binding it to a cause.');
  }
}
