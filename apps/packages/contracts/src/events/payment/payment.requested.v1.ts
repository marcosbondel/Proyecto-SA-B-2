import { z } from 'zod';

import { money, uuidV4 } from '../../schemas/primitives';
import { defineContract } from '../contract';

/**
 * Step 4 of the transfer Saga: process the payment.
 *
 * Transaction Service orders this; Payment Service does **not** react to
 * `account.debited.v1` directly. That is what `docs/domain/use-cases.md` §6
 * fixed, and it is what keeps the Saga's state in one place without turning
 * Transaction Service into a central coordinator.
 */
export const paymentRequestedV1 = defineContract({
  name: 'payment.requested.v1',
  category: 'command',
  producer: 'transaction-service',
  consumers: ['payment-service'],
  schema: z.object({
    paymentId: uuidV4,
    transactionId: uuidV4,
    amount: money,
  }),
});

export type PaymentRequestedV1 = z.infer<typeof paymentRequestedV1.schema>;
