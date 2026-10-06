import { z } from 'zod';

import { defineContract } from '../contract';
import { simulationParameters } from './payment.simulation.update.v1';

/**
 * The answer to `payment.simulation.query.v1` and to
 * `payment.simulation.update.v1`, matched by `correlationId`: the simulation as
 * it is *now*, so an update's reply is also its confirmation.
 *
 * `source` says where the values came from. `DEFAULTS` is what the ConfigMap
 * supplied; `RUNTIME` is an administrator's override, which survives restarts
 * and holds for every replica until a reset.
 */
export const paymentSimulationRepliedV1 = defineContract({
  name: 'payment.simulation.replied.v1',
  category: 'reply',
  producer: 'payment-service',
  consumers: ['gateway'],
  schema: simulationParameters.extend({
    source: z.enum(['DEFAULTS', 'RUNTIME']),
    /** When the override was made; `null` while the defaults are in force. */
    updatedAt: z.iso.datetime().nullable(),
  }),
});

export type PaymentSimulationRepliedV1 = z.infer<typeof paymentSimulationRepliedV1.schema>;
