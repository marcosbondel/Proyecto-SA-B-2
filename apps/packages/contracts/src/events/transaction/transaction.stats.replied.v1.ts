import { z } from 'zod';

import { defineContract } from '../contract';

/**
 * The answer to `transaction.stats.query.v1`, matched by `correlationId`.
 *
 * `inFlight` is counted over **all** transfers rather than over today's, and
 * that is the one deliberate asymmetry here. A transfer stuck in
 * `PAYMENT_PENDING` since yesterday is more alarming than one stuck since this
 * morning, and a dashboard that reset the count at midnight would hide exactly
 * the case worth seeing.
 */
export const transactionStatsRepliedV1 = defineContract({
  name: 'transaction.stats.replied.v1',
  category: 'reply',
  producer: 'transaction-service',
  consumers: ['gateway'],
  schema: z.object({
    today: z.int().nonnegative(),
    completedToday: z.int().nonnegative(),
    failedToday: z.int().nonnegative(),
    compensatedToday: z.int().nonnegative(),
    /** Not scoped to today, on purpose — see above. */
    inFlight: z.int().nonnegative(),
  }),
});

export type TransactionStatsRepliedV1 = z.infer<typeof transactionStatsRepliedV1.schema>;
