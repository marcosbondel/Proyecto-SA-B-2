import { z } from 'zod';

import { isoTimestamp, uuidV4 } from '../../schemas/primitives';
import { defineContract } from '../contract';

/**
 * Send the activation email carrying the verification link.
 *
 * The email address is the single exception to T-02's "does not cross" list
 * (coherence check M-5): Notification cannot deliver a message without an
 * address. The **token never travels here** — only the moment it expires, so
 * the notification can say so. The link itself is composed by the service that
 * owns the token.
 */
export const customerActivationRequestedV1 = defineContract({
  name: 'customer.activation.requested.v1',
  category: 'event',
  producer: 'customer-service',
  consumers: ['notification-audit-service'],
  schema: z.object({
    customerId: uuidV4,
    email: z.email(),
    /** The link stops working here. Twenty-four hours by default. */
    expiresAt: isoTimestamp,
  }),
});

export type CustomerActivationRequestedV1 = z.infer<typeof customerActivationRequestedV1.schema>;
