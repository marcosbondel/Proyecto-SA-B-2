import { z } from 'zod';

import { failureCode, identityStatus, isoTimestamp, uuidV4 } from '../../schemas/primitives';
import { defineContract } from '../contract';

/**
 * The identity document was refused.
 *
 * The three codes are separate because they are three different situations: the
 * image was unreadable, the object was not there at all, or the digest did not
 * match what the command claimed. Only the first is the customer's problem.
 */
export const customerIdentityRejectedV1 = defineContract({
  name: 'customer.identity.rejected.v1',
  category: 'event',
  producer: 'customer-service',
  consumers: ['notification-audit-service'],
  schema: z.object({
    customerId: uuidV4,
    identityStatus: identityStatus.extract(['REJECTED']),
    reason: failureCode.extract([
      'IDENTITY_DOCUMENT_UNREADABLE',
      'IDENTITY_OBJECT_NOT_FOUND',
      'IDENTITY_DIGEST_MISMATCH',
    ]),
    rejectedAt: isoTimestamp,
    email: z.string().email().optional(),
    fullName: z.string().optional(),
  }),
});

export type CustomerIdentityRejectedV1 = z.infer<typeof customerIdentityRejectedV1.schema>;
