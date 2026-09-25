import { z } from 'zod';

import { kycStatus, uuidV4 } from '../../schemas/primitives';
import { defineContract } from '../contract';

/**
 * The verdict on `customer.kyc.check.requested.v1`.
 *
 * `allowed` is carried explicitly rather than derived by the consumer from
 * `kycStatus`: the rule that only `VERIFIED` may transact
 * (`mayInitiateTransactions`, Customer Service's own domain) belongs to the
 * service that owns the customer, and re-deriving it in Transaction Service
 * from the raw status would let the two domains' answers drift apart the day
 * either one adds a fourth status.
 *
 * Published even for a customer this service cannot find at all — `allowed:
 * false`, `kycStatus: 'PENDING'` — so the Saga always gets an answer and never
 * waits out its own retry ladder on a transfer whose customer reference was
 * bad from the start.
 */
export const customerKycCheckedV1 = defineContract({
  name: 'customer.kyc.checked.v1',
  category: 'event',
  producer: 'customer-service',
  consumers: ['transaction-service', 'notification-audit-service'],
  schema: z.object({
    transactionId: uuidV4,
    customerId: uuidV4,
    kycStatus,
    allowed: z.boolean(),
  }),
});

export type CustomerKycCheckedV1 = z.infer<typeof customerKycCheckedV1.schema>;
