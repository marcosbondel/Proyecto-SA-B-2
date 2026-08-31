import { z } from 'zod';

import { defineContract } from '../contract';

/** How the Saga is doing today. Staff only. */
export const transactionStatsQueryV1 = defineContract({
  name: 'transaction.stats.query.v1',
  category: 'command',
  producer: 'gateway',
  consumers: ['transaction-service'],
  schema: z.object({}),
});

export type TransactionStatsQueryV1 = z.infer<typeof transactionStatsQueryV1.schema>;
