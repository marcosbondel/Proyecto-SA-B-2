import { z } from 'zod';

import { defineContract } from '../contract';

/**
 * Validate the token from the activation link.
 *
 * The token appears in this message and nowhere else — not in the event that
 * requested the email, not in the audit record, not in the rejection. It is a
 * bearer credential for the duration of its life.
 */
export const customerVerifyEmailV1 = defineContract({
  name: 'customer.verify-email.v1',
  category: 'command',
  producer: 'gateway',
  consumers: ['customer-service'],
  schema: z.object({
    /** Opaque to everyone but the service that signed it. Never logged. */
    activationToken: z.string().min(16).max(512),
  }),
});

export type CustomerVerifyEmailV1 = z.infer<typeof customerVerifyEmailV1.schema>;
