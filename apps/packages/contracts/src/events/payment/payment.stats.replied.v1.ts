import { z } from 'zod';

import { defineContract } from '../contract';

/**
 * The answer to `payment.stats.query.v1`, matched by `correlationId`.
 *
 * `retrying` is the number that makes the retry ladder visible from outside
 * this service — payments that have failed at least once and are still due
 * another attempt. It is the operational number here: `failedToday` is history,
 * and `retrying` is a thing that is happening.
 */
export const paymentStatsRepliedV1 = defineContract({
  name: 'payment.stats.replied.v1',
  category: 'reply',
  producer: 'payment-service',
  consumers: ['gateway'],
  schema: z.object({
    today: z.int().nonnegative(),
    succeededToday: z.int().nonnegative(),
    failedToday: z.int().nonnegative(),
    /** Failed at least once and still due another attempt. Not scoped to today. */
    retrying: z.int().nonnegative(),
  }),
});

export type PaymentStatsRepliedV1 = z.infer<typeof paymentStatsRepliedV1.schema>;
