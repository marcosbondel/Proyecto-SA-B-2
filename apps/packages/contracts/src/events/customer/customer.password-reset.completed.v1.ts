import { z } from 'zod';

import { isoTimestamp, uuidV4 } from '../../schemas/primitives';
import { defineContract } from '../contract';

/**
 * The password was changed and every reset link for that account is now dead.
 *
 * Two consumers, and the second is the point. Notification & Audit records it
 * and tells the customer their password changed — a message that matters
 * precisely when the person reading it did not ask for the change. The Gateway
 * observes it to answer whoever is holding the HTTP connection open, the same
 * way it correlates `customer.email.verified.v1`; observing an event on a topic
 * exchange takes nothing away from its declared consumer.
 *
 * No credential and no token appear here. The event says that it happened, not
 * what was chosen.
 */
export const customerPasswordResetCompletedV1 = defineContract({
  name: 'customer.password-reset.completed.v1',
  category: 'event',
  producer: 'customer-service',
  consumers: ['notification-audit-service'],
  schema: z.object({
    customerId: uuidV4,
    changedAt: isoTimestamp,
  }),
});

export type CustomerPasswordResetCompletedV1 = z.infer<
  typeof customerPasswordResetCompletedV1.schema
>;
