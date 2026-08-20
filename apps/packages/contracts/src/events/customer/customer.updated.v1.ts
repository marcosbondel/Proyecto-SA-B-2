import { z } from 'zod';

import { isoTimestamp, uuidV4 } from '../../schemas/primitives';
import { defineContract } from '../contract';

/**
 * A customer's data changed.
 *
 * Carries the **names of the fields** that changed, not their values. The audit
 * record needs to show that an update happened and what it touched; copying the
 * new address into an event would put personal data in a second store for no
 * decision that depends on it.
 */
export const customerUpdatedV1 = defineContract({
  name: 'customer.updated.v1',
  category: 'event',
  producer: 'customer-service',
  consumers: ['notification-audit-service'],
  schema: z.object({
    customerId: uuidV4,
    changedFields: z.array(z.enum(['fullName', 'address', 'dateOfBirth'])).min(1),
    updatedAt: isoTimestamp,
  }),
});

export type CustomerUpdatedV1 = z.infer<typeof customerUpdatedV1.schema>;
