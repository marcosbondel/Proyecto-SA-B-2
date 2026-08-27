import { z } from 'zod';

import {
  accountStatus,
  accountType,
  isoTimestamp,
  money,
  uuidV4,
} from '../../schemas/primitives';
import { defineContract } from '../contract';

/**
 * The answer to `account.list.query.v1`, matched by `correlationId`.
 *
 * There is no `NOT_FOUND` outcome and that is deliberate: "no accounts you may
 * see" and "no accounts exist" must be indistinguishable from outside, or the
 * emptiness of the list becomes a way to probe for other people's accounts.
 * An empty array is the whole answer.
 *
 * Each row carries `customerId` because the administrator's screen has to say
 * whose account it is. It is the opaque reference and nothing more — this
 * service does not know the holder's name and must not learn it (§8.2, 2.3).
 */
export const accountListRepliedV1 = defineContract({
  name: 'account.list.replied.v1',
  category: 'reply',
  producer: 'account-service',
  consumers: ['gateway'],
  schema: z.object({
    accounts: z.array(
      z.object({
        accountId: uuidV4,
        customerId: uuidV4,
        accountType,
        balance: money,
        status: accountStatus,
        /** Last confirmed movement, not last read (A-4). */
        lastActivityAt: isoTimestamp.nullable(),
        openedAt: isoTimestamp,
      }),
    ),
  }),
});

export type AccountListRepliedV1 = z.infer<typeof accountListRepliedV1.schema>;
