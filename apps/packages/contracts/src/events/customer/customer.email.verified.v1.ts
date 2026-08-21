import { z } from 'zod';

import { customerStatus, isoTimestamp, uuidV4 } from '../../schemas/primitives';
import { defineContract } from '../contract';

/**
 * The email was verified and the account is active.
 *
 * `status` and `emailVerifiedAt` are both present on purpose: invariant C-4
 * ties them together, and the redundancy is what makes a violation visible in
 * the audit record rather than inferable.
 */
export const customerEmailVerifiedV1 = defineContract({
  name: 'customer.email.verified.v1',
  category: 'event',
  producer: 'customer-service',
  consumers: ['notification-audit-service'],
  schema: z.object({
    customerId: uuidV4,
    emailVerifiedAt: isoTimestamp,
    status: customerStatus.extract(['ACTIVE']),
  }),
});

export type CustomerEmailVerifiedV1 = z.infer<typeof customerEmailVerifiedV1.schema>;
