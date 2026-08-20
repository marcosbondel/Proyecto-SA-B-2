import { z } from 'zod';

import { isoTimestamp, money, uuidV4 } from '../../schemas/primitives';
import { defineContract } from '../contract';

/** The money is back in the source account. The Saga closes in `COMPENSATED`. */
export const accountDebitCompensatedV1 = defineContract({
  name: 'account.debit.compensated.v1',
  category: 'event',
  producer: 'account-service',
  consumers: ['transaction-service', 'notification-audit-service'],
  schema: z.object({
    transactionId: uuidV4,
    accountId: uuidV4,
    amount: money,
    balanceAfter: money,
    compensatedAt: isoTimestamp,
  }),
});

export type AccountDebitCompensatedV1 = z.infer<typeof accountDebitCompensatedV1.schema>;
