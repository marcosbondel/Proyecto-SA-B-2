import type { Category, MessageContract } from '../events/contract';

/**
 * The four exchanges. All topic, all durable.
 *
 * Commands and events are separated because they are different kinds of
 * statement with different rules — one handler versus many — and collapsing
 * them into one exchange erases that distinction exactly where the broker
 * would otherwise enforce it.
 */
export const EXCHANGES = {
  commands: 'bank.commands',
  events: 'bank.events',
  replies: 'bank.replies',
  errors: 'bank.errors',
} as const;

export type ExchangeName = (typeof EXCHANGES)[keyof typeof EXCHANGES];

/**
 * The routing key **is** the message name, version suffix included.
 *
 * No translation table, no per-message special case. The consequence is the
 * point: a consumer bound to `account.debited.v1` never receives
 * `account.debited.v2`, so migrating a version is a change of binding rather
 * than a branch inside a handler.
 */
export function routingKeyFor(messageType: string): string {
  return messageType;
}

/** Which exchange carries a message, decided by what kind of statement it is. */
export function exchangeFor(category: Category): ExchangeName {
  switch (category) {
    case 'command':
      return EXCHANGES.commands;
    case 'event':
      return EXCHANGES.events;
    case 'reply':
      return EXCHANGES.replies;
  }
}

/** Where a contract is published: its exchange and its routing key. */
export function destinationFor(contract: MessageContract): {
  readonly exchange: ExchangeName;
  readonly routingKey: string;
} {
  return {
    exchange: exchangeFor(contract.category),
    routingKey: routingKeyFor(contract.name),
  };
}
