import { randomUUID } from 'node:crypto';

import type { Producer, Role } from './schemas/primitives';
import { versionOf } from './schemas/primitives';

/**
 * The identity of whoever the system is acting for, already verified.
 *
 * The Gateway is the only component that signs and validates the session token
 * (ADR-010); by the time a message reaches the broker the token is gone and
 * only this remains. Services trust it rather than re-verifying it, which is
 * what keeps authentication out of five codebases.
 */
export interface Identity {
  readonly customerId: string;
  readonly role: Role;
}

/**
 * The envelope every message travels in, whatever it carries.
 *
 * The tracing fields are the reason this package exists. Without a single
 * shared shape each service would grow its own, the copies would drift, and a
 * request would stop being traceable across the system (constitution VIII).
 */
export interface MessageEnvelope<TPayload> {
  /** Unique id of this message. Never reused, not even on a redelivery. */
  readonly messageId: string;

  /** Dotted name of the contract carried in `payload`, e.g. `account.debited.v1`. */
  readonly messageType: string;

  /**
   * The version repeated as a number, so a consumer can refuse a version it
   * does not understand instead of half-interpreting it. It must agree with
   * the suffix of `messageType`; a disagreement is an invalid message.
   */
  readonly messageVersion: number;

  /** Which application published this. Closed set — see `primitives.producer`. */
  readonly producer: Producer;

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

  /**
   * Who the system is acting for, or `null` when nobody originated the work —
   * the automatic deactivation of an idle account has no user behind it.
   */
  readonly identity: Identity | null;

  /** The contract itself. This package never inspects it. */
  readonly payload: TPayload;
}

/**
 * What a caller must set when wrapping a payload; the rest is derived.
 *
 * `identity` is required rather than optional on purpose: omitting it would be
 * indistinguishable from deciding there is none, and those are different
 * statements.
 */
export interface EnvelopeOptions {
  readonly messageType: string;
  readonly producer: Producer;
  readonly identity: Identity | null;
  readonly correlationId?: string;
  readonly causationId?: string | null;
  readonly idempotencyKey?: string;
  readonly occurredAt?: string;
}

/**
 * Wraps a payload in a well-formed envelope, filling in the fields the caller
 * left out. Generating ids and reading the version is all this does — no
 * routing, no transport and no decision about what the payload means.
 *
 * @throws if `messageType` carries no version suffix, because a message that
 * cannot be versioned cannot be routed by version either.
 */
export function createEnvelope<TPayload>(
  payload: TPayload,
  options: EnvelopeOptions,
): MessageEnvelope<TPayload> {
  const messageVersion = versionOf(options.messageType);
  if (messageVersion === null) {
    throw new Error(
      `Message type "${options.messageType}" has no version suffix; expected a name ending in .vN.`,
    );
  }

  const messageId = randomUUID();

  return {
    messageId,
    messageType: options.messageType,
    messageVersion,
    producer: options.producer,
    // A flow that starts here is its own correlation root.
    correlationId: options.correlationId ?? messageId,
    causationId: options.causationId ?? null,
    idempotencyKey: options.idempotencyKey ?? messageId,
    occurredAt: options.occurredAt ?? new Date().toISOString(),
    identity: options.identity,
    payload,
  };
}

/**
 * Builds the envelope for a message produced while handling `cause`, keeping
 * the correlation and the verified identity, and recording what triggered it.
 * This is the call that keeps a Saga traceable end to end.
 *
 * The identity is copied, never re-decided: a service reacting to an event does
 * not get to change who the system is acting for.
 */
export function followUpEnvelope<TPayload>(
  cause: MessageEnvelope<unknown>,
  payload: TPayload,
  options: Omit<EnvelopeOptions, 'correlationId' | 'causationId' | 'identity'> & {
    readonly identity?: Identity | null;
  },
): MessageEnvelope<TPayload> {
  return createEnvelope(payload, {
    ...options,
    identity: options.identity ?? cause.identity,
    correlationId: cause.correlationId,
    causationId: cause.messageId,
  });
}
