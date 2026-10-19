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
 *
 * **Whose debit it is travels in the envelope's `identity`, not in this
 * payload** (T-60). Transaction Service builds the command as a follow-up of the
 * request, so it carries the identity of whoever ordered the transfer, and
 * Account refuses a `CLIENTE` whose `customerId` is not the account's owner —
 * under the same row lock that moves the balance. A debit with `identity: null`
 * is refused: nobody ordered it.
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
