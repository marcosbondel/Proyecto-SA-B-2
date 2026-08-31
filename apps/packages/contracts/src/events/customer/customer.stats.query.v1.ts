import { z } from 'zod';

import { defineContract } from '../contract';

/**
 * How many customers, and in what state — the counts `D-02` shows.
 *
 * One query with no arguments per service, rather than a dashboard that counts
 * rows it happened to fetch. The difference is not efficiency: a count over one
 * page of a listing, drawn as a bank-wide total, is a number nobody can
 * reproduce and everybody will quote. Each service counts its own rows, because
 * each service is the only one that has them.
 *
 * Staff only, enforced by the owning service. The counts say nothing about any
 * individual, but "how many customers does this bank have" is not a number a
 * customer is owed either.
 */
export const customerStatsQueryV1 = defineContract({
  name: 'customer.stats.query.v1',
  category: 'command',
  producer: 'gateway',
  consumers: ['customer-service'],
  schema: z.object({}),
});

export type CustomerStatsQueryV1 = z.infer<typeof customerStatsQueryV1.schema>;
