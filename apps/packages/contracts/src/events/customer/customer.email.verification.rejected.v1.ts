import { z } from 'zod';

import { failureCode, isoTimestamp } from '../../schemas/primitives';
import { defineContract } from '../contract';

/**
 * The activation link did not work.
 *
 * Expired and invalid are **different codes** because they need different
 * answers: an expired link should offer to resend, an invalid one should not
 * admit that a token was ever issued. Collapsing them into one code would make
 * the first case unhelpful or the second case a disclosure.
 */
export const customerEmailVerificationRejectedV1 = defineContract({
  name: 'customer.email.verification.rejected.v1',
  category: 'event',
  producer: 'customer-service',
  consumers: ['notification-audit-service'],
  schema: z.object({
    reason: failureCode.extract(['ACTIVATION_TOKEN_EXPIRED', 'ACTIVATION_TOKEN_INVALID']),
    occurredAt: isoTimestamp,
  }),
});

export type CustomerEmailVerificationRejectedV1 = z.infer<
  typeof customerEmailVerificationRejectedV1.schema
>;
