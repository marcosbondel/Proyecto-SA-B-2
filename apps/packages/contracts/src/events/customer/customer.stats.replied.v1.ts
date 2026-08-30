import { z } from 'zod';

import { defineContract } from '../contract';

/**
 * The answer to `customer.stats.query.v1`, matched by `correlationId`.
 *
 * Counts and nothing else. No names, no ids, no sample rows — a dashboard that
 * carried the newest customer's name would put personal data on a screen whose
 * whole purpose is to be left open on a monitor.
 *
 * Zeroes for a caller who may not see them, rather than a refusal: the
 * dashboard composes several of these and one refusal should narrow the screen,
 * not break it.
 */
export const customerStatsRepliedV1 = defineContract({
  name: 'customer.stats.replied.v1',
  category: 'reply',
  producer: 'customer-service',
  consumers: ['gateway'],
  schema: z.object({
    registered: z.int().nonnegative(),
    /** Awaiting a teller's verdict — the teller's own queue length. */
    pendingValidation: z.int().nonnegative(),
    activatedToday: z.int().nonnegative(),
  }),
});

export type CustomerStatsRepliedV1 = z.infer<typeof customerStatsRepliedV1.schema>;
