import { createEnvelope } from '@bank/contracts';
import type { Identity, MessageEnvelope } from '@bank/contracts';

/**
 * Wraps an inbound HTTP payload for the broker.
 *
 * This is the gateway's whole job on the write path: give the request a
 * correlation id, a message type and the identity it just verified, then hand
 * it to a service. It decides nothing about what the payload means
 * (constitution V), and it imports the shared transport shape rather than any
 * service code (FR-007).
 *
 * The gateway is the only producer allowed to originate a flow, because it is
 * the only component that has verified who the caller is (ADR-010).
 */
export function envelopeForRequest<TPayload>(
  payload: TPayload,
  messageType: string,
  identity: Identity | null,
  correlationId?: string,
): MessageEnvelope<TPayload> {
  return createEnvelope(payload, {
    messageType,
    producer: 'gateway',
    identity,
    correlationId,
  });
}
