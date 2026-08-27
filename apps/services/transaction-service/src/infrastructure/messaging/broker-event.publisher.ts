import { EXCHANGES, catalogByName, followUpEnvelope, routingKeyFor } from '@bank/contracts';
import type { MessageEnvelope } from '@bank/contracts';
import type { MessageBroker } from '@bank/messaging';

import type { EventPublisher, OutboundMessage } from '../../application/ports';

/**
 * Everything this service says, on the exchange the catalogue assigns it.
 *
 * The exchange is not a parameter of each call: `catalogByName` already records
 * whether a message is a command, an event or a reply, so a handler cannot
 * publish a command onto the events exchange by writing the wrong argument. A
 * message this service has no contract for is refused outright rather than sent
 * somewhere plausible.
 *
 * **This service is the only one that publishes all three kinds**, because it
 * is the only one that orders work from others. That is what a choreographed
 * Saga looks like from the inside: not a coordinator calling services, but a
 * participant that reacts to an event by ordering the next command and then
 * stepping back out of the way.
 *
 * Everything it publishes is a follow-up to the message being handled, so the
 * correlation and the verified identity are carried forward and the causal
 * chain stays reconstructible end to end (constitution VIII). There is no
 * `forSystem` counterpart here: nothing in this service acts on its own
 * initiative, so there is no message it could publish that no request caused.
 */
export class BrokerEventPublisher implements EventPublisher {
  readonly #broker: MessageBroker;
  readonly #cause: MessageEnvelope<unknown> | null;

  constructor(broker: MessageBroker, cause: MessageEnvelope<unknown> | null = null) {
    this.#broker = broker;
    this.#cause = cause;
  }

  /**
   * Binds the publisher to the message being handled.
   *
   * A per-delivery instance, created by the router. A single mutable "current
   * cause" on a shared instance would attribute one Saga's commands to
   * another's correlation the first time two transfers were in flight at once —
   * which, for a service whose whole job is one flow per correlation, would
   * make the audit trail useless exactly when it is needed.
   */
  public forCause(cause: MessageEnvelope<unknown>): BrokerEventPublisher {
    return new BrokerEventPublisher(this.#broker, cause);
  }

  /** A command: addressed to one handler, on the commands exchange. */
  public async send(message: OutboundMessage): Promise<void> {
    await this.#dispatch(message, 'command');
  }

  /** An event: narrated to whoever cares. */
  public async publish(message: OutboundMessage): Promise<void> {
    await this.#dispatch(message, 'event');
  }

  /** A reply: addressed to whoever asked. */
  public async reply(message: OutboundMessage): Promise<void> {
    await this.#dispatch(message, 'reply');
  }

  async #dispatch(
    message: OutboundMessage,
    expected: 'command' | 'event' | 'reply',
  ): Promise<void> {
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
     * that reaches the broker is a message some other service will fail on, far
     * from the code that built it — and in a Saga that means a compensation
     * that never runs.
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
      EXCHANGE_FOR[expected],
      routingKeyFor(message.messageType),
      followUpEnvelope(this.#cause, parsed.data, {
        messageType: message.messageType,
        producer: 'transaction-service',
      }),
    );
  }
}

const EXCHANGE_FOR = {
  command: EXCHANGES.commands,
  event: EXCHANGES.events,
  reply: EXCHANGES.replies,
} as const;
