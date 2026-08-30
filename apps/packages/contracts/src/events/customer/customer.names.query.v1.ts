import { z } from 'zod';

import { uuidV4 } from '../../schemas/primitives';
import { defineContract } from '../contract';

/** How many holders one screen may ask about at once. */
export const MAX_NAME_LOOKUPS = 100;

/**
 * Ask for the display names behind a set of customer ids.
 *
 * This exists to close TD-026: the account tables show a `customerId` where the
 * prototype shows the holder's name, and Account Service holds only the opaque
 * reference — resolving it there would mean reading Customer Service's database,
 * which §8.2 (2.3) forbids outright. So the Gateway asks the owning service, and
 * composes two replies. That is aggregation, which is what an entry point is
 * for; it computes nothing and decides nothing.
 *
 * **A batch rather than one query per row.** A listing of forty accounts would
 * otherwise be forty request/reply round trips, each with a five-second ceiling,
 * to build one table. One question with forty ids is two round trips in total.
 *
 * It deliberately carries **only the name** back. A screen that needs the
 * document, the address or the email asks `customer.get.query.v1` for one
 * customer, where the authorisation is per-record; this one is the narrowest
 * thing that makes a table readable.
 */
export const customerNamesQueryV1 = defineContract({
  name: 'customer.names.query.v1',
  category: 'command',
  producer: 'gateway',
  consumers: ['customer-service'],
  schema: z.object({
    customerIds: z.array(uuidV4).min(1).max(MAX_NAME_LOOKUPS),
  }),
});

export type CustomerNamesQueryV1 = z.infer<typeof customerNamesQueryV1.schema>;
