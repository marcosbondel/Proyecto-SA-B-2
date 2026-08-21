import { z } from 'zod';

import { money, uuidV4 } from '../../schemas/primitives';
import { defineContract } from '../contract';

/**
 * Step 2 of the transfer Saga: take the money out of the source account.
 *
 * The first step that moves money, and therefore the first that must be
 * idempotent. The consumer recognises a redelivery through the envelope's
 * `idempotencyKey`; `transactionId` is what ties the movement to the Saga it
 * belongs to, so a compensation can find it later.
 */
export const accountDebitRequestedV1 = defineContract({
  name: 'account.debit.requested.v1',
  category: 'command',
  producer: 'transaction-service',
  consumers: ['account-service'],
  schema: z.object({
    transactionId: uuidV4,
    accountId: uuidV4,
    amount: money,
  }),
});

export type AccountDebitRequestedV1 = z.infer<typeof accountDebitRequestedV1.schema>;
