import { z } from 'zod';

import { accountStatus, accountType, isoTimestamp, money, uuidV4 } from '../../schemas/primitives';
import { defineContract } from '../contract';

/** An account now exists, with a zero balance. */
export const accountOpenedV1 = defineContract({
  name: 'account.opened.v1',
  category: 'event',
  producer: 'account-service',
  consumers: ['notification-audit-service'],
  schema: z.object({
    accountId: uuidV4,
    customerId: uuidV4,
    accountType,
    status: accountStatus.extract(['ACTIVE']),
    balance: money,
    openedAt: isoTimestamp,
  }),
});

export type AccountOpenedV1 = z.infer<typeof accountOpenedV1.schema>;
