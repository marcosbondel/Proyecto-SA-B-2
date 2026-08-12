import { randomUUID } from 'node:crypto';

/**
 * The envelope every message travels in, whatever it carries.
 *
 * The three tracing fields are the reason this package exists. Without a
 * single shared shape each service would grow its own, the five copies would
 * drift, and a request would stop being traceable across the system
 * (constitution VIII).
 */
export interface MessageEnvelope<TPayload> {
  /** Unique id of this message. Never reused, not even on a redelivery. */
  readonly messageId: string;

  /** Dotted name of the contract carried in `payload`, e.g. `account.opened.v1`. */
  readonly messageType: string;

  /**
   * Shared by every message produced while handling one external request.
   * Set once at the gateway and copied, never regenerated downstream.
   */
  readonly correlationId: string;

  /**
   * The `messageId` of the message that directly caused this one. `null` for
   * the first message of a flow. Together with `correlationId` it reconstructs
   * the causal chain of a Saga.
   */
  readonly causationId: string | null;

  /**
   * Lets a consumer recognise a redelivery of work it already did and skip it.
   * Equal keys mean "the same intent", so a broker retry stays harmless.
   */
  readonly idempotencyKey: string;

  /** When the sender produced the message, as an ISO-8601 UTC timestamp. */
  readonly occurredAt: string;

  /** The contract itself. This package never inspects it. */
  readonly payload: TPayload;
}

/** What a caller may set when wrapping a payload; the rest is derived. */
export interface EnvelopeOptions {
  readonly messageType: string;
  readonly correlationId?: string;
  readonly causationId?: string | null;
  readonly idempotencyKey?: string;
  readonly occurredAt?: string;
}

/**
 * Wraps a payload in a well-formed envelope, filling in the fields the caller
 * left out. Generating ids is all this does — no routing, no transport and no
 * decision about what the payload means.
 */
export function createEnvelope<TPayload>(
  payload: TPayload,
  options: EnvelopeOptions,
): MessageEnvelope<TPayload> {
  const messageId = randomUUID();

  return {
    messageId,
    messageType: options.messageType,
    // A flow that starts here is its own correlation root.
    correlationId: options.correlationId ?? messageId,
    causationId: options.causationId ?? null,
    idempotencyKey: options.idempotencyKey ?? messageId,
    occurredAt: options.occurredAt ?? new Date().toISOString(),
    payload,
  };
}

/**
 * Builds the envelope for a message produced while handling `cause`, keeping
 * the correlation and recording what triggered it. This is the call that keeps
 * a Saga traceable end to end.
 */
export function followUpEnvelope<TPayload>(
  cause: MessageEnvelope<unknown>,
  payload: TPayload,
  options: Omit<EnvelopeOptions, 'correlationId' | 'causationId'>,
): MessageEnvelope<TPayload> {
  return createEnvelope(payload, {
    ...options,
    correlationId: cause.correlationId,
    causationId: cause.messageId,
  });
}
