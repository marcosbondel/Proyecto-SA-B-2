import type { MessageEnvelope } from '@bank/contracts';

import type { ReplyKind } from '../errors/gateway-error';

/**
 * Waits for the answer to one question, or gives up.
 *
 * Every wait ends. A registry that could leak an entry would leak a promise
 * with it, and a gateway accumulating unresolved promises fails slowly and
 * confusingly rather than loudly.
 */
export interface ReplyWaiterPort {
  /**
   * Registers interest in `correlationId` **before** the question is published,
   * so an unusually fast reply cannot arrive before anyone is listening.
   *
   * @param kind Whether the question changes state or only reads it. Defaults
   * to `'command'`, the more cautious of the two — a caller that forgets to
   * say otherwise gets the warning that assumes something might still be in
   * flight, not the one that assumes nothing was.
   * @throws a `REPLY_TIMEOUT` GatewayError when nothing arrives in time. That
   * means the caller stopped waiting — never that the operation was cancelled.
   * There is no cancellation message in the catalogue.
   */
  waitFor(correlationId: string, kind?: ReplyKind): Promise<MessageEnvelope<unknown>>;
}

export const REPLY_WAITER = Symbol('ReplyWaiterPort');
