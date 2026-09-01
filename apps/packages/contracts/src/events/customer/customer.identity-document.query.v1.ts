import { z } from 'zod';

import { uuidV4 } from '../../schemas/primitives';
import { defineContract } from '../contract';

/**
 * Ask to view a customer's identity-document photo — the read
 * `customer.pending-validation.replied.v1` promised separately: "the full
 * record and the document are read separately."
 *
 * Staff only, enforced by the owning service from the envelope identity, the
 * same way `customer.get.query.v1` is: a `CLIENTE`, or a caller asking about a
 * customer that does not exist, gets `NOT_FOUND` from
 * `customer.identity-document.replied.v1`, indistinguishable, so this query
 * cannot be turned into a way to discover which customer ids exist.
 */
export const customerIdentityDocumentQueryV1 = defineContract({
  name: 'customer.identity-document.query.v1',
  category: 'command',
  producer: 'gateway',
  consumers: ['customer-service'],
  schema: z.object({
    customerId: uuidV4,
  }),
});

export type CustomerIdentityDocumentQueryV1 = z.infer<
  typeof customerIdentityDocumentQueryV1.schema
>;
