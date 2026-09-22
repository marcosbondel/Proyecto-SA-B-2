import { z } from 'zod';

import { isoTimestamp, uuidV4 } from '../../schemas/primitives';
import { defineContract } from '../contract';

/**
 * A signed-in customer changed their own password.
 *
 * Separate from `customer.password-reset.completed.v1` on purpose, even though
 * both end with a new credential stored. They answer different questions in the
 * trail — "somebody who could not sign in proved control of the inbox" against
 * "somebody who was already signed in knew the old password" — and an
 * investigation into a compromised account cares a great deal which of the two
 * happened.
 *
 * No credential appears here. The event says that it happened, not what was
 * chosen.
 */
export const customerPasswordChangedV1 = defineContract({
  name: 'customer.password-changed.v1',
  category: 'event',
  producer: 'customer-service',
  consumers: ['notification-audit-service'],
  schema: z.object({
    customerId: uuidV4,
    email: z.string().email().optional(),
    fullName: z.string().optional(),
    changedAt: isoTimestamp,
  }),
});

export type CustomerPasswordChangedV1 = z.infer<typeof customerPasswordChangedV1.schema>;
