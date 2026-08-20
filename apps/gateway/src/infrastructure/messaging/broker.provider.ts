import { EXCHANGES } from '@bank/contracts';
import { MessageBroker } from '@bank/messaging';

/**
 * The exchanges the gateway declares on connect.
 *
 * The names come from `@bank/contracts`, which owns the topology; the gateway
 * neither invents them nor keeps a second copy (T-05, R10).
 */
export const GATEWAY_EXCHANGES = [EXCHANGES.commands, EXCHANGES.events, EXCHANGES.replies] as const;

/**
 * Builds the broker the gateway publishes through.
 *
 * Constructing it does not open a socket — `start()` does. The skeleton boots
 * in health-check mode without a broker on purpose: the local RabbitMQ stack
 * arrives with T-06, and until then a failed connection must not stop the
 * process from reporting its own liveness.
 */
export function createMessageBroker(rabbitmqUrl: string): MessageBroker {
  return new MessageBroker({
    url: rabbitmqUrl,
    exchanges: GATEWAY_EXCHANGES,
    errorExchange: EXCHANGES.errors,
  });
}
