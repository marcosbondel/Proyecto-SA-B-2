import { z } from 'zod';

import { isoTimestamp, money, transactionStatus, uuidV4 } from '../../schemas/primitives';
import { defineContract } from '../contract';

/** The Saga opened. Everything after this has something to reconcile against. */
export const transactionInitiatedV1 = defineContract({
  name: 'transaction.initiated.v1',
  category: 'event',
  producer: 'transaction-service',
  consumers: ['notification-audit-service'],
  schema: z.object({
    transactionId: uuidV4,
    sourceAccount: uuidV4,
    targetAccount: uuidV4,
    amount: money,
    status: transactionStatus.extract(['PENDING']),
    createdAt: isoTimestamp,
  }),
});

export type TransactionInitiatedV1 = z.infer<typeof transactionInitiatedV1.schema>;
