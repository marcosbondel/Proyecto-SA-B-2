import { z } from 'zod';

import { defineContract } from '../contract';

/** How many accounts, and how much moved today. Staff only. */
export const accountStatsQueryV1 = defineContract({
  name: 'account.stats.query.v1',
  category: 'command',
  producer: 'gateway',
  consumers: ['account-service'],
  schema: z.object({}),
});

export type AccountStatsQueryV1 = z.infer<typeof accountStatsQueryV1.schema>;
