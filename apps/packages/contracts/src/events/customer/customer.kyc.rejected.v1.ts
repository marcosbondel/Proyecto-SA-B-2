import { z } from 'zod';

import { isoTimestamp, kycStatus, uuidV4 } from '../../schemas/primitives';
import { defineContract } from '../contract';

/**
 * The customer's KYC status was rejected.
 *
 * `REJECTED → PENDING` remains legal (a new review reopens it), so this event
 * may be followed by a later `customer.kyc.verified.v1` for the same
 * customer — unlike `VERIFIED`, this status is not terminal.
 */
export const customerKycRejectedV1 = defineContract({
  name: 'customer.kyc.rejected.v1',
  category: 'event',
  producer: 'customer-service',
  consumers: ['notification-audit-service'],
  schema: z.object({
    customerId: uuidV4,
    kycStatus: kycStatus.extract(['REJECTED']),
    rejectedAt: isoTimestamp,
  }),
});

export type CustomerKycRejectedV1 = z.infer<typeof customerKycRejectedV1.schema>;
