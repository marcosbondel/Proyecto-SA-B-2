import type { MessageEnvelope } from '@bank/contracts';

/**
 * Puts one envelope on the broker.
 *
 * Named as a port rather than taken as a `MessageBroker` because the
 * application layer is not allowed to choose a transport — that is
 * infrastructure's job, and `pnpm lint` enforces it. What the application
 * needs to say is "send this"; how it travels is somebody else's decision.
 */
export interface MessagePublisherPort {
  /**
   * @throws a `BROKER_UNAVAILABLE` GatewayError when the broker refuses the
   * message. Nothing is retried here: the caller holds an HTTP connection open
   * and their idempotency key already makes a retry of theirs harmless.
   */
  publish(envelope: MessageEnvelope<unknown>): Promise<void>;
}

export const MESSAGE_PUBLISHER = Symbol('MessagePublisherPort');
