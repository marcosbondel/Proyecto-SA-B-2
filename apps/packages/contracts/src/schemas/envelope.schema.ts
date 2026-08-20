import { z } from 'zod';

import {
  idempotencyKey,
  isoTimestamp,
  messageTypeName,
  producer,
  role,
  uuidV4,
  versionOf,
} from './primitives';

/** The verified identity, or its explicit absence. */
export const identitySchema = z.object({
  customerId: uuidV4,
  role,
});

/**
 * The envelope, validated before any domain logic runs (FR-023).
 *
 * `payload` is deliberately unvalidated here: this schema answers "is this a
 * well-formed message at all", and the contract for the specific `messageType`
 * answers "is this payload the one that name promises". Splitting them is what
 * lets a consumer reject an unknown type without owning every contract.
 */
export const envelopeSchema = z
  .object({
    messageId: uuidV4,
    messageType: messageTypeName,
    messageVersion: z.int().positive(),
    producer,
    correlationId: uuidV4,
    causationId: uuidV4.nullable(),
    idempotencyKey,
    occurredAt: isoTimestamp,
    identity: identitySchema.nullable(),
    payload: z.unknown(),
  })
  // The version lives in the name and in the field. The redundancy only buys
  // anything if disagreeing is an error, so here it is one.
  .refine((envelope) => versionOf(envelope.messageType) === envelope.messageVersion, {
    message: 'messageVersion does not match the version suffix of messageType',
    path: ['messageVersion'],
  });

export type ValidatedEnvelope = z.infer<typeof envelopeSchema>;
