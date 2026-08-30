import { z } from 'zod';

import { defineContract } from '../contract';

/** How the payment provider is doing today. Staff only. */
export const paymentStatsQueryV1 = defineContract({
  name: 'payment.stats.query.v1',
  category: 'command',
  producer: 'gateway',
  consumers: ['payment-service'],
  schema: z.object({}),
});

export type PaymentStatsQueryV1 = z.infer<typeof paymentStatsQueryV1.schema>;
