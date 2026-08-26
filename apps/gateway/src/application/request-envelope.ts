import { createEnvelope } from '@bank/contracts';
import type { Identity, MessageEnvelope } from '@bank/contracts';

export interface EnvelopeExtras {
  /**
   * The caller's own key, carried untouched.
   *
   * The gateway never interprets it. Recognising that two requests mean the
   * same thing needs to know what the payload *means*, and the gateway
   * deliberately does not (constitution V). Left out, `createEnvelope` mints
   * one, which is right for a request nobody will retry.
   */
  readonly idempotencyKey?: string;
}

/**
 * Wraps an inbound HTTP payload for the broker.
 *
 * This is the gateway's whole job on the write path: give the request a
 * correlation id, a message type and the identity it just verified, then hand
 * it to a service. It decides nothing about what the payload means
 * (constitution V), and it imports the shared transport shape rather than any
 * service code.
 *
 * The gateway is the only producer allowed to originate a flow, because it is
 * the only component that has verified who the caller is (ADR-010).
 */
export function envelopeForRequest<TPayload>(
  payload: TPayload,
  messageType: string,
  identity: Identity | null,
  correlationId?: string,
  extras: EnvelopeExtras = {},
): MessageEnvelope<TPayload> {
  return createEnvelope(payload, {
    messageType,
    producer: 'gateway',
    identity,
    correlationId,
    ...(extras.idempotencyKey === undefined ? {} : { idempotencyKey: extras.idempotencyKey }),
  });
}
