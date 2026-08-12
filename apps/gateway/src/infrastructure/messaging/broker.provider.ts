import { MessageBroker } from '@bank/messaging';

/** Topic exchange every message in the system passes through. */
export const BANK_EXCHANGE = 'bank.events';

/**
 * Builds the broker the gateway publishes through.
 *
 * Constructing it does not open a socket — `start()` does. The skeleton boots
 * in health-check mode without a broker on purpose: the local RabbitMQ stack
 * arrives with T-06, and until then a failed connection must not stop the
 * process from reporting its own liveness.
 */
export function createMessageBroker(rabbitmqUrl: string): MessageBroker {
  return new MessageBroker({ url: rabbitmqUrl, exchange: BANK_EXCHANGE });
}
