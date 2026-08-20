import { z } from 'zod';

import { accountType, uuidV4 } from '../../schemas/primitives';
import { defineContract } from '../contract';

/**
 * Open an account.
 *
 * `accountType` is required and closed to the two the assignment names (§4.1
 * NOTE, page 7). In this phase it is a classification and nothing else —
 * decision D-02 of T-02 — but recording it now is what makes it possible to
 * attach behaviour later without a version bump on every account message.
 *
 * Only `role = CLIENTE` may hold accounts (C-6); that is checked by the service
 * that knows the customer, not by this shape.
 */
export const accountCreateV1 = defineContract({
  name: 'account.create.v1',
  category: 'command',
  producer: 'gateway',
  consumers: ['account-service'],
  schema: z.object({
    accountId: uuidV4,
    customerId: uuidV4,
    accountType,
  }),
});

export type AccountCreateV1 = z.infer<typeof accountCreateV1.schema>;
