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

  // The wait is registered first, so its ceiling is already running while the
  // publish is in flight. If the publish outlives the ceiling — a broker that
  // is gone makes `publish` neither resolve nor reject for seconds — the wait
  // rejects while nothing is observing it, and Node ends the process on an
  // unhandled rejection. That is how one scaled-down RabbitMQ took every
  // Gateway pod down on 2026-10-19. A derived no-op handler marks it handled;
  // the rejection itself still reaches the caller through `waiting` below.
  const quietWait = waiting.then(
    () => undefined,
    () => undefined,
  );

  const publishing = publisher.publish(envelope);
  // Same reason, other direction: if the wait settles first, nobody awaits the
  // publish any more and a later rejection would be unobserved.
  void publishing.then(
    () => undefined,
    () => undefined,
  );

  // Whichever happens first decides what the caller hears. A publish that
  // fails is "the question never left" and is thrown as it is; a wait that
  // gives up first means the ceiling was reached with the publish still
  // pending, and the honest answer is the reply timeout — the caller must not
  // be held past its ceiling by a broker that will not confirm.
  await Promise.race([publishing, quietWait]);

  return await waiting;
}
