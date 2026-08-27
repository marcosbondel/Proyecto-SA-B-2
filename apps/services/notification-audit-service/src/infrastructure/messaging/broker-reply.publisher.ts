import { EXCHANGES, catalogByName, followUpEnvelope, routingKeyFor } from '@bank/contracts';
import type { MessageEnvelope } from '@bank/contracts';
import type { MessageBroker } from '@bank/messaging';

import type { OutboundMessage, ReplyPublisher } from '../../application/ports';

/**
 * Everything this service says — which is replies, and only replies.
 *
 * There is no `send` and no `publish` here, and their absence is criterion 6
 * made structural rather than promised. This service consumes events and
 * answers questions; a method that could put a command on `bank.commands` would
 * be a method some future handler could use to move money, and no amount of
 * documentation is as convincing as the method not existing.
 *
 * The category is checked against the catalogue rather than taken as an
 * argument, so a reply cannot be published onto the wrong exchange by writing
 * the wrong string, and a message with no contract is refused outright rather
 * than sent somewhere plausible.
 *
 * Every reply is a follow-up to the question being answered, so the correlation
 * and the verified identity travel with it and the Gateway's reply waiter can
 * match the answer to the caller still holding an HTTP connection open.
 */
export class BrokerReplyPublisher implements ReplyPublisher {
  readonly #broker: MessageBroker;
  readonly #cause: MessageEnvelope<unknown> | null;

  constructor(broker: MessageBroker, cause: MessageEnvelope<unknown> | null = null) {
    this.#broker = broker;
    this.#cause = cause;
  }

  /**
   * Binds the publisher to the question being answered.
   *
   * A per-delivery instance, created by the router. A single mutable "current
   * cause" on a shared instance would answer one administrator's audit query
   * with another's correlation the first time two people looked something up at
   * once — which, for the service whose whole job is correlating, would be the
   * most embarrassing bug available.
   */
  public forCause(cause: MessageEnvelope<unknown>): BrokerReplyPublisher {
    return new BrokerReplyPublisher(this.#broker, cause);
  }

  public async reply(message: OutboundMessage): Promise<void> {
    const contract = catalogByName.get(message.messageType);

    if (contract === undefined) {
      throw new Error(`No contract named "${message.messageType}" exists in the catalogue.`);
    }

    if (contract.category !== 'reply') {
      throw new Error(
        `"${message.messageType}" is a ${contract.category}; this service publishes only replies.`,
      );
    }

    /**
     * Parsed against its own contract before it leaves. A malformed reply that
     * reaches the broker fails at the Gateway, which turns it into an
     * `INTERNAL_ERROR` far from the code that built it — and for this service
     * that means an audit screen that says the system broke when what actually
     * happened is that a timestamp was formatted wrong.
     */
    const parsed = contract.schema.safeParse(message.payload);

    if (!parsed.success) {
      throw new Error(
        `Payload for "${message.messageType}" does not satisfy its contract: ${parsed.error.issues[0]?.message ?? 'unknown reason'}`,
      );
    }

    if (this.#cause === null) {
      throw new Error('BrokerReplyPublisher was used without binding it to a cause.');
    }

    await this.#broker.publish(
      EXCHANGES.replies,
      routingKeyFor(message.messageType),
      followUpEnvelope(this.#cause, parsed.data, {
        messageType: message.messageType,
        producer: 'notification-audit-service',
      }),
    );
  }
}
