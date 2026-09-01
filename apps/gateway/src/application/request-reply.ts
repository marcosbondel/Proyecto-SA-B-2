import type { MessageEnvelope } from '@bank/contracts';

import type { ReplyKind } from './errors/gateway-error';
import type { MessagePublisherPort, ReplyWaiterPort } from './ports';

/**
 * Asks a question and waits for its answer, or gives up after the ceiling.
 *
 * The ordering is the whole reason this exists as one function rather than two
 * calls at five call sites: **the wait is registered before the question is
 * published.** Publish first and a fast responder can answer before anyone is
 * listening, and the caller then waits the full five seconds for a reply that
 * already came and went. That race is rare, load-dependent, and miserable to
 * diagnose after the fact.
 *
 * `kind` only decides which of the two honest `REPLY_TIMEOUT` messages a
 * caller gets if nobody answers (`GatewayError.replyTimeout`); it changes
 * nothing about the asking. It defaults to `'command'` so every existing call
 * site keeps its current wording without having to say so.
 */
export async function askAndWait(
  publisher: MessagePublisherPort,
  replies: ReplyWaiterPort,
  envelope: MessageEnvelope<unknown>,
  kind?: ReplyKind,
): Promise<MessageEnvelope<unknown>> {
  const waiting = replies.waitFor(envelope.correlationId, kind);

  try {
    await publisher.publish(envelope);
  } catch (error) {
    // The question never left. Nothing will ever settle that wait, and leaving
    // it unobserved would surface later as an unhandled rejection in a request
    // that already failed for a different, clearer reason.
    void waiting.catch(() => undefined);
    throw error;
  }

  return await waiting;
}
