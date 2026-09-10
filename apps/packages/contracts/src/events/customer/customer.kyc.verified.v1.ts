import { z } from 'zod';

import { isoTimestamp, kycStatus, uuidV4 } from '../../schemas/primitives';
import { defineContract } from '../contract';

/**
 * The customer's KYC status was verified.
 *
 * The Saga's own enforcement of "a non-verified customer cannot initiate a
 * transaction" is T-31's job: it consumes this event (or asks by
 * request/reply) rather than querying this service's table (X-1).
 */
export const customerKycVerifiedV1 = defineContract({
  name: 'customer.kyc.verified.v1',
  category: 'event',
  producer: 'customer-service',
  consumers: ['notification-audit-service'],
  schema: z.object({
    customerId: uuidV4,
    kycStatus: kycStatus.extract(['VERIFIED']),
    verifiedAt: isoTimestamp,
  }),
});

export type CustomerKycVerifiedV1 = z.infer<typeof customerKycVerifiedV1.schema>;
