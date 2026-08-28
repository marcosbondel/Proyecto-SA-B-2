import { z } from 'zod';

import { defineContract } from '../contract';

/**
 * Ask for the customers whose identity is still awaiting a teller's verdict.
 *
 * Staff work: the reply lists everyone with `identityStatus = PENDING` so a
 * `CAJERO_RECEPTOR` has a queue to work through. Who may ask is the owning
 * service's decision, made from the envelope identity; a `CLIENTE` gets an empty
 * list, which means the same thing whether nothing is pending or nothing is
 * visible.
 */
export const customerPendingValidationQueryV1 = defineContract({
  name: 'customer.pending-validation.query.v1',
  category: 'command',
  producer: 'gateway',
  consumers: ['customer-service'],
  schema: z.object({}),
});

export type CustomerPendingValidationQueryV1 = z.infer<
  typeof customerPendingValidationQueryV1.schema
>;
