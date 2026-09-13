import { z } from 'zod';

import { uuidV4 } from '../../schemas/primitives';
import { defineContract } from '../contract';

/**
 * Step 2 of the Fase 2 Saga (T-31): before the debit is ordered, Transaction
 * Service asks whether this customer may initiate a transaction at all.
 *
 * A command rather than a query on the reply exchange, because this is the
 * choreography's own shape: Transaction Service orders it the same way it
 * orders `account.debit.requested.v1`, and `customer.kyc.checked.v1` answers
 * it on `transaction.saga`, not on a Gateway-bound reply queue. Nobody is
 * holding an HTTP connection open for this — the Gateway already returned
 * `202` before this command exists.
 */
export const customerKycCheckRequestedV1 = defineContract({
  name: 'customer.kyc.check.requested.v1',
  category: 'command',
  producer: 'transaction-service',
  consumers: ['customer-service'],
  schema: z.object({
    transactionId: uuidV4,
    customerId: uuidV4,
  }),
});

export type CustomerKycCheckRequestedV1 = z.infer<typeof customerKycCheckRequestedV1.schema>;
