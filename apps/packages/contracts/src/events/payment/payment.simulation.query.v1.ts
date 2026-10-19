import { z } from 'zod';

import { defineContract } from '../contract';

/**
 * "How is the simulated provider set up right now?" — T-44.
 *
 * Empty on purpose: there is one simulation per bank, so there is nothing to
 * select. Staff only, enforced at the Gateway.
 */
export const paymentSimulationQueryV1 = defineContract({
  name: 'payment.simulation.query.v1',
  category: 'command',
  producer: 'gateway',
  consumers: ['payment-service'],
  schema: z.object({}),
});

export type PaymentSimulationQueryV1 = z.infer<typeof paymentSimulationQueryV1.schema>;
