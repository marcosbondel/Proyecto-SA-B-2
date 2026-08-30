import { z } from 'zod';

import { failureCode, isoTimestamp } from '../../schemas/primitives';
import { defineContract } from '../contract';

/**
 * The reset link did not work.
 *
 * Expired and invalid are separate codes for the reason
 * `customer.email.verification.rejected.v1` separates them: the audit record
 * needs to tell a link that timed out from one that was never issued. What the
 * person is told collapses both into one sentence — the Gateway does that —
 * because distinguishing them in a browser would confirm that a link was once
 * issued for an address.
 */
export const customerPasswordResetRejectedV1 = defineContract({
  name: 'customer.password-reset.rejected.v1',
  category: 'event',
  producer: 'customer-service',
  consumers: ['notification-audit-service'],
  schema: z.object({
    reason: failureCode.extract(['RESET_TOKEN_EXPIRED', 'RESET_TOKEN_INVALID']),
    occurredAt: isoTimestamp,
  }),
});

export type CustomerPasswordResetRejectedV1 = z.infer<
  typeof customerPasswordResetRejectedV1.schema
>;
