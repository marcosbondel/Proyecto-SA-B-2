import { z } from 'zod';

import { money, uuidV4 } from '../../schemas/primitives';
import { defineContract } from '../contract';

/** Step 6 of the transfer Saga: put the money into the target account. */
export const accountCreditRequestedV1 = defineContract({
  name: 'account.credit.requested.v1',
  category: 'command',
  producer: 'transaction-service',
  consumers: ['account-service'],
  schema: z.object({
    transactionId: uuidV4,
    accountId: uuidV4,
    amount: money,
  }),
});

export type AccountCreditRequestedV1 = z.infer<typeof accountCreditRequestedV1.schema>;
