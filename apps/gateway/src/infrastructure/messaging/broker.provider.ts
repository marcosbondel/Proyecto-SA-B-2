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
export function createMessageBroker(rabbitmqUrl: string, replyTimeoutMs?: number): MessageBroker {
  return new MessageBroker({
    url: rabbitmqUrl,
    // A publish that the broker has not confirmed must give up **before** the
    // caller's reply ceiling, so a flapping connection ends as
    // BROKER_UNAVAILABLE ("nothing was accepted") and not as REPLY_TIMEOUT
    // ("it may have been"). The library default equals the ceiling, which is
    // exactly the tie that lost on 2026-10-19.
    ...(replyTimeoutMs === undefined
      ? {}
      : { publishTimeoutMs: Math.max(250, Math.floor(replyTimeoutMs * 0.6)) }),
    exchanges: GATEWAY_EXCHANGES,
    errorExchange: EXCHANGES.errors,
  });
}
