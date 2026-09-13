import { z } from 'zod';

import { isoTimestamp, kycStatus, uuidV4 } from '../../schemas/primitives';
import { defineContract } from '../contract';

export const customerListRepliedV1 = defineContract({
  name: 'customer.list.replied.v1',
  category: 'reply',
  producer: 'customer-service',
  consumers: ['gateway'],
  schema: z.object({
    customers: z.array(
      z.object({
        customerId: uuidV4,
        fullName: z.string(),
        email: z.string(),
        username: z.string(),
        documentNumber: z.string(),
        identityStatus: z.string(),
        role: z.string(),
        status: z.string(),
        registeredAt: isoTimestamp,
        /**
         * Added by T-31, optional and additive — a reply that omits it
         * validates exactly as before. `undefined` on a producer older than
         * this field; never inferred from `identityStatus`, a different fact
         * (Fase 1's document review) from this one (Fase 2's compliance
         * verdict, C-8).
         */
        kycStatus: kycStatus.optional(),
      }),
    ),
    omitted: z.number().int().nonnegative(),
  }),
});

export type CustomerListRepliedV1 = z.infer<typeof customerListRepliedV1.schema>;
