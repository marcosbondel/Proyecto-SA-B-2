import { EXCHANGES, catalogByName, followUpEnvelope, routingKeyFor } from '@bank/contracts';
import type { MessageEnvelope } from '@bank/contracts';
import type { MessageBroker } from '@bank/messaging';

import type { EventPublisher, OutboundMessage } from '../../application/ports';

/**
 * Everything this service says, on the exchange the catalogue assigns it.
 *
 * The exchange is not a parameter of each call: `catalogByName` already records
 * whether a message is an event or a reply, and deriving it here means a
 * handler cannot publish a reply onto the events exchange by writing the wrong
 * argument. A message this service does not have a contract for is refused
 * outright rather than sent somewhere plausible.
 *
 * Everything published is a **follow-up** to the command being handled, so the
 * correlation id and the verified identity are carried forward and the
 * causation chain stays intact. That chain is what makes the audit trail able
 * to answer "what did this request cause", which is the entire point of T-20.
 */
export class BrokerEventPublisher implements EventPublisher {
  readonly #broker: MessageBroker;
  #cause: MessageEnvelope<unknown> | null = null;

  constructor(broker: MessageBroker) {
    this.#broker = broker;
  }

  /**
   * Binds the publisher to the message being handled.
   *
   * A per-delivery instance is created by the router, so this is never shared
   * between two concurrent handlers — a single mutable "current cause" on a
   * shared instance would attribute one request's events to another's
   * correlation under any concurrency at all.
   */
  public forCause(cause: MessageEnvelope<unknown>): BrokerEventPublisher {
    const bound = new BrokerEventPublisher(this.#broker);
    bound.#cause = cause;

    return bound;
  }

  public async publish(message: OutboundMessage): Promise<void> {
    await this.#send(message, 'event');
  }

  public async reply(message: OutboundMessage): Promise<void> {
    await this.#send(message, 'reply');
  }

  async #send(message: OutboundMessage, expected: 'event' | 'reply'): Promise<void> {
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
     * that reaches the broker is a message some other service will fail on,
     * far from the code that built it.
     */
    const parsed = contract.schema.safeParse(message.payload);

    if (!parsed.success) {
      throw new Error(
        `Payload for "${message.messageType}" does not satisfy its contract: ${parsed.error.issues[0]?.message ?? 'unknown reason'}`,
      );
    }

    if (this.#cause === null) {
      throw new Error('BrokerEventPublisher was used without binding it to a cause.');
    }

    await this.#broker.publish(
      expected === 'reply' ? EXCHANGES.replies : EXCHANGES.events,
      routingKeyFor(message.messageType),
      followUpEnvelope(this.#cause, parsed.data, {
        messageType: message.messageType,
        producer: 'customer-service',
      }),
    );
  }
}
