import { z } from 'zod';

import { accountStatus, accountType, uuidV4 } from '../../schemas/primitives';
import { defineContract } from '../contract';

/**
 * "Which accounts are there?" — asked by the Gateway, answered by the owner.
 *
 * Added by T-17. Every filter is optional and every one of them is a *request*,
 * not a permission: the Gateway holds no account table and cannot know which
 * accounts the asker is entitled to see. Account Service intersects these
 * filters with what decision D-06 allows the envelope's identity — "own
 * accounts" for a `CLIENTE`, any account for staff — and answers with what
 * survives. A caller who names somebody else's `customerId` gets an empty list,
 * not somebody else's balances.
 */
export const accountListQueryV1 = defineContract({
  name: 'account.list.query.v1',
  category: 'command',
  producer: 'gateway',
  consumers: ['account-service'],
  schema: z.object({
    /** Whose accounts. Absent means "whatever this identity may see". */
    customerId: uuidV4.optional(),
    status: accountStatus.optional(),
    accountType: accountType.optional(),
  }),
});

export type AccountListQueryV1 = z.infer<typeof accountListQueryV1.schema>;
