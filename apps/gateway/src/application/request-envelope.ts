import { createEnvelope } from '@bank/contracts';
import type { MessageEnvelope } from '@bank/contracts';

/**
 * Wraps an inbound HTTP payload for the broker.
 *
 * This is the gateway's whole job on the write path: give the request a
 * correlation id and a message type, then hand it to a service. It decides
 * nothing about what the payload means (constitution V), and it imports the
 * shared transport shape rather than any service code (FR-007).
 */
export function envelopeForRequest<TPayload>(
  payload: TPayload,
  messageType: string,
  correlationId?: string,
): MessageEnvelope<TPayload> {
  return createEnvelope(payload, { messageType, correlationId });
}
