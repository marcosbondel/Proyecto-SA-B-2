import { z } from 'zod';

import { isoTimestamp, uuidV4 } from '../../schemas/primitives';
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
      }),
    ),
    omitted: z.number().int().nonnegative(),
  }),
});

export type CustomerListRepliedV1 = z.infer<typeof customerListRepliedV1.schema>;
