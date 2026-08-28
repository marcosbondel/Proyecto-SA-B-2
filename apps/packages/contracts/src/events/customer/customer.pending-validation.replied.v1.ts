import { z } from 'zod';

import { isoTimestamp, uuidV4 } from '../../schemas/primitives';
import { defineContract } from '../contract';

/**
 * The answer to `customer.pending-validation.query.v1`, matched by
 * `correlationId`.
 *
 * A bounded list — `omitted` says how many more were left out — so one very
 * large queue cannot produce a reply that blows the request/reply ceiling. The
 * summary carries only what a teller needs to pick the next case; the full
 * record and the document are read separately.
 */
export const customerPendingValidationRepliedV1 = defineContract({
  name: 'customer.pending-validation.replied.v1',
  category: 'reply',
  producer: 'customer-service',
  consumers: ['gateway'],
  schema: z.object({
    customers: z.array(
      z.object({
        customerId: uuidV4,
        fullName: z.string(),
        email: z.email(),
        registeredAt: isoTimestamp,
      }),
    ),
    omitted: z.number().int().nonnegative(),
  }),
});

export type CustomerPendingValidationRepliedV1 = z.infer<
  typeof customerPendingValidationRepliedV1.schema
>;
