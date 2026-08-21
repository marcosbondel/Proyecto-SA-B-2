import { z } from 'zod';

import { accountStatus, failureCode, isoTimestamp, money, uuidV4 } from '../../schemas/primitives';
import { defineContract } from '../contract';

/** The answer to `account.balance.query.v1`, matched by `correlationId`. */
export const accountBalanceRepliedV1 = defineContract({
  name: 'account.balance.replied.v1',
  category: 'reply',
  producer: 'account-service',
  consumers: ['gateway'],
  schema: z.discriminatedUnion('outcome', [
    z.object({
      outcome: z.literal('FOUND'),
      accountId: uuidV4,
      balance: money,
      status: accountStatus,
      /** Last confirmed movement, not last read (A-4). */
      lastActivityAt: isoTimestamp.nullable(),
    }),
    z.object({
      outcome: z.literal('NOT_FOUND'),
      reason: failureCode.extract(['ACCOUNT_NOT_FOUND']),
    }),
  ]),
});

export type AccountBalanceRepliedV1 = z.infer<typeof accountBalanceRepliedV1.schema>;
