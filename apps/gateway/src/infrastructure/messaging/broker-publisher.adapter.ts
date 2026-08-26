import { catalogByName, destinationFor } from '@bank/contracts';
import type { MessageEnvelope } from '@bank/contracts';
import type { MessageBroker } from '@bank/messaging';

import { GatewayError } from '../../application/errors/gateway-error';
import type { MessagePublisherPort } from '../../application/ports';

/**
 * Publishes onto the broker, deriving the destination from the catalogue.
 *
 * `destinationFor` is used rather than a local table on purpose: the routing
 * key **is** the message name and the exchange follows from the category, so
 * there is nothing for the gateway to decide and therefore nothing for it to
 * get out of step with. A second copy of the topology living here is exactly
 * how a consumer ends up bound to a key nobody publishes.
 */
export class BrokerPublisherAdapter implements MessagePublisherPort {
  readonly #broker: MessageBroker;

  constructor(broker: MessageBroker) {
    this.#broker = broker;
  }

  public async publish(envelope: MessageEnvelope<unknown>): Promise<void> {
    const contract = catalogByName.get(envelope.messageType);
    if (contract === undefined) {
      // Unreachable from a route, which always names a contract it imported.
      // Reaching it means the catalogue and the routes disagree, which is a
      // defect here rather than anything the caller did.
      throw GatewayError.internal();
    }

    const { exchange, routingKey } = destinationFor(contract);

    try {
      await this.#broker.publish(exchange, routingKey, envelope);
    } catch {
      // Deliberately swallowing the cause: it carries the broker URL, and the
      // caller has no use for it. The correlated log keeps the detail (FR-029).
      throw GatewayError.brokerUnavailable();
    }
  }
}
