import { z } from 'zod';

import {
  customerStatus,
  identityStatus,
  isoTimestamp,
  role,
  uuidV4,
} from '../../schemas/primitives';
import { defineContract } from '../contract';

/**
 * A customer now exists.
 *
 * Carries no credential and no document number: the audit record needs to know
 * that a registration happened, not to hold a second copy of the customer.
 */
export const customerRegisteredV1 = defineContract({
  name: 'customer.registered.v1',
  category: 'event',
  producer: 'customer-service',
  consumers: ['notification-audit-service'],
  schema: z.object({
    customerId: uuidV4,
    username: z.string().min(1).max(100),
    email: z.email(),
    role,
    status: customerStatus,
    identityStatus,
    registeredAt: isoTimestamp,
  }),
});

export type CustomerRegisteredV1 = z.infer<typeof customerRegisteredV1.schema>;
