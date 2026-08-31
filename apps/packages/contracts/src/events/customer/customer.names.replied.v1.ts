import { z } from 'zod';

import { uuidV4 } from '../../schemas/primitives';
import { defineContract } from '../contract';

/**
 * The answer to `customer.names.query.v1`, matched by `correlationId`.
 *
 * **Staff only, and an id nobody may see simply does not come back.** The reply
 * carries the pairs the asker is entitled to and says nothing about the rest —
 * no `NOT_FOUND` entry, no count of what was withheld. An absent id is
 * therefore ambiguous between "no such customer" and "not yours", which is the
 * same refusal `customer.get.replied.v1` makes and for the same reason: a
 * distinguishable answer is a way to discover which customer ids exist.
 *
 * A `CLIENTE` asking gets an empty list, whatever they asked about. There is no
 * screen where a client needs somebody else's name, and the one place they see
 * their own is their own profile.
 */
export const customerNamesRepliedV1 = defineContract({
  name: 'customer.names.replied.v1',
  category: 'reply',
  producer: 'customer-service',
  consumers: ['gateway'],
  schema: z.object({
    names: z.array(
      z.object({
        customerId: uuidV4,
        fullName: z.string(),
      }),
    ),
  }),
});

export type CustomerNamesRepliedV1 = z.infer<typeof customerNamesRepliedV1.schema>;
