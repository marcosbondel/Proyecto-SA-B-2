import type { MessageEnvelope } from '@bank/contracts';

/**
 * What every inbound message handler in this service implements.
 *
 * The service reaches the rest of the system through envelopes and nothing
 * else: no HTTP call to a sibling, no import of a sibling's code
 * (constitution IV, FR-007).
 */
export interface InboundMessageHandler {
  /** The `messageType` this handler claims, e.g. `account.opened.v1`. */
  readonly messageType: string;

  handle(envelope: MessageEnvelope<unknown>): Promise<void>;
}

/**
 * Routes a delivery to the handler that claimed its `messageType`.
 *
 * An unclaimed message is reported as unhandled rather than thrown away or
 * treated as a failure: a queue bound to a broad pattern will legitimately see
 * messages this service does not care about.
 */
export class InboundMessageRouter {
  readonly #handlers: ReadonlyMap<string, InboundMessageHandler>;

  constructor(handlers: readonly InboundMessageHandler[]) {
    const byType = new Map<string, InboundMessageHandler>();

    for (const handler of handlers) {
      if (byType.has(handler.messageType)) {
        throw new Error(`Two handlers claim the message type "${handler.messageType}".`);
      }
      byType.set(handler.messageType, handler);
    }

    this.#handlers = byType;
  }

  /** `true` when a handler took the message, `false` when none claimed it. */
  public async route(envelope: MessageEnvelope<unknown>): Promise<boolean> {
    const handler = this.#handlers.get(envelope.messageType);

    if (handler === undefined) {
      return false;
    }

    await handler.handle(envelope);
    return true;
  }
}
