import { z } from 'zod';

import { photoReference } from '../../dto/photo-reference.dto';
import { failureCode } from '../../schemas/primitives';
import { defineContract } from '../contract';

/**
 * The answer to `customer.identity-document.query.v1`, matched by
 * `correlationId`.
 *
 * **No image bytes here, ever.** ADR-012 and the payload-size ceiling
 * (SC-009a) hold for a reply exactly as they hold for a command — ninety
 * contracts stay under 64 KB, and a reply carrying a base64 photo would be the
 * one message two orders of magnitude larger than the rest, which is precisely
 * what the object store exists to avoid. `FOUND` therefore carries a
 * `PhotoReference`, the same transfer-buffer shape the write path uses, run in
 * reverse: Customer Service stages its own stored bytes back into the object
 * store for this one answer, and the Gateway fetches them from there — the
 * object store remains what ADR-012 says it is, a buffer nobody queries to
 * decide anything; the teller's decision is still recorded through
 * `customer.set-identity-verdict.v1`, unchanged.
 *
 * `IDENTITY_OBJECT_NOT_FOUND` covers a customer with no document on file — a
 * registration submitted with no photo is legal (`customer.register.v1`
 * accepts `photo: null`) and this is that customer's ordinary answer, not a
 * fault. `CUSTOMER_NOT_FOUND` covers both an unknown id and a caller who may
 * not see this customer, indistinguishable on purpose — the same collapse
 * `customer.get.replied.v1` makes, and for the same reason: a distinguishable
 * refusal here would be a way to discover which customer ids exist.
 */
export const customerIdentityDocumentRepliedV1 = defineContract({
  name: 'customer.identity-document.replied.v1',
  category: 'reply',
  producer: 'customer-service',
  consumers: ['gateway'],
  schema: z.discriminatedUnion('outcome', [
    z.object({
      outcome: z.literal('FOUND'),
      photo: photoReference,
    }),
    z.object({
      outcome: z.literal('NOT_FOUND'),
      reason: failureCode.extract(['CUSTOMER_NOT_FOUND', 'IDENTITY_OBJECT_NOT_FOUND']),
    }),
  ]),
});

export type CustomerIdentityDocumentRepliedV1 = z.infer<
  typeof customerIdentityDocumentRepliedV1.schema
>;
