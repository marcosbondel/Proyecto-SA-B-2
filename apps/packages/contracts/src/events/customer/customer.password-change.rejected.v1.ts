import { z } from 'zod';

import { failureCode, isoTimestamp, uuidV4 } from '../../schemas/primitives';
import { defineContract } from '../contract';

/**
 * The password was not changed, and why.
 *
 * Two reasons, and unlike the reset family they are safe to tell apart in a
 * browser. Nobody reaches this without a session, so neither answer reveals
 * whether an account exists: `INVALID_CREDENTIALS` means the current password
 * was wrong, and `FORBIDDEN_ACCOUNT_ACCESS` means the actor tried to change
 * somebody else's — which the owning service refuses and the audit record
 * should be able to find later.
 *
 * `customerId` is the **subject** that was asked about, so the trail can answer
 * "who was targeted", which is the interesting question when the second reason
 * appears more than once.
 */
export const customerPasswordChangeRejectedV1 = defineContract({
  name: 'customer.password-change.rejected.v1',
  category: 'event',
  producer: 'customer-service',
  consumers: ['notification-audit-service'],
  schema: z.object({
    customerId: uuidV4,
    reason: failureCode.extract(['INVALID_CREDENTIALS', 'FORBIDDEN_ACCOUNT_ACCESS']),
    occurredAt: isoTimestamp,
  }),
});

export type CustomerPasswordChangeRejectedV1 = z.infer<
  typeof customerPasswordChangeRejectedV1.schema
>;
