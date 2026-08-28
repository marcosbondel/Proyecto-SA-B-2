import { z } from 'zod';

import { uuidV4 } from '../../schemas/primitives';
import { defineContract } from '../contract';

/**
 * Ask for a customer's record.
 *
 * Asynchronous request/reply — Customer Service's first read path. Who may see
 * whom is the owning service's decision, made from the envelope identity: a
 * `CLIENTE` may read only their own record, staff may read anyone. A record the
 * caller may not see is answered `NOT_FOUND`, not "forbidden", so the query
 * cannot be turned into a way to discover which customer ids exist.
 */
export const customerGetQueryV1 = defineContract({
  name: 'customer.get.query.v1',
  category: 'command',
  producer: 'gateway',
  consumers: ['customer-service'],
  schema: z.object({
    customerId: uuidV4,
  }),
});

export type CustomerGetQueryV1 = z.infer<typeof customerGetQueryV1.schema>;
