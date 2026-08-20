import { z } from 'zod';

import { identityStatus, isoTimestamp, uuidV4 } from '../../schemas/primitives';
import { defineContract } from '../contract';

/** The identity document was accepted. Independent of email activation (C-4/C-6). */
export const customerIdentityValidatedV1 = defineContract({
  name: 'customer.identity.validated.v1',
  category: 'event',
  producer: 'customer-service',
  consumers: ['notification-audit-service'],
  schema: z.object({
    customerId: uuidV4,
    identityStatus: identityStatus.extract(['VALIDATED']),
    validatedAt: isoTimestamp,
  }),
});

export type CustomerIdentityValidatedV1 = z.infer<typeof customerIdentityValidatedV1.schema>;
