import { z } from 'zod';

import { money } from '../../schemas/primitives';
import { defineContract } from '../contract';

/**
 * The answer to `account.stats.query.v1`, matched by `correlationId`.
 *
 * `openedToday` and `depositedToday` are what `D-01` shows a teller: the two
 * numbers that measure a shift. Billers' collection accounts are excluded from
 * every count here for the reason they are excluded from every listing — they
 * are accounts and they are not somebody's account.
 *
 * The deposited total is `money` rather than a bare integer, because an amount
 * without a currency is exactly the kind of number that gets added to another
 * one that meant something else.
 */
export const accountStatsRepliedV1 = defineContract({
  name: 'account.stats.replied.v1',
  category: 'reply',
  producer: 'account-service',
  consumers: ['gateway'],
  schema: z.object({
    active: z.int().nonnegative(),
    inactive: z.int().nonnegative(),
    openedToday: z.int().nonnegative(),
    depositsToday: z.int().nonnegative(),
    depositedToday: money,
  }),
});

export type AccountStatsRepliedV1 = z.infer<typeof accountStatsRepliedV1.schema>;
