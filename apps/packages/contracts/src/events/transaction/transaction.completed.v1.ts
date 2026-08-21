import { z } from 'zod';

import { isoTimestamp, money, transactionStatus, uuidV4 } from '../../schemas/primitives';
import { defineContract } from '../contract';

/** The money arrived. Terminal state. */
export const transactionCompletedV1 = defineContract({
  name: 'transaction.completed.v1',
  category: 'event',
  producer: 'transaction-service',
  consumers: ['notification-audit-service'],
  schema: z.object({
    transactionId: uuidV4,
    sourceAccount: uuidV4,
    targetAccount: uuidV4,
    amount: money,
    status: transactionStatus.extract(['COMPLETED']),
    completedAt: isoTimestamp,
  }),
});

export type TransactionCompletedV1 = z.infer<typeof transactionCompletedV1.schema>;
