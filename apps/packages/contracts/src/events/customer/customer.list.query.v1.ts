import { z } from 'zod';

import { defineContract } from '../contract';

/**
 * Ask for the list of registered customers.
 *
 * Staff work: CAJERO_RECEPTOR and ADMINISTRADOR can query the customer list.
 */
export const customerListQueryV1 = defineContract({
  name: 'customer.list.query.v1',
  category: 'command',
  producer: 'gateway',
  consumers: ['customer-service'],
  schema: z.object({
    limit: z.coerce.number().int().positive().max(100).optional().default(50),
  }),
});

export type CustomerListQueryV1 = z.infer<typeof customerListQueryV1.schema>;
