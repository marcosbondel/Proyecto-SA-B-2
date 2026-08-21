import { z } from 'zod';

import { money, uuidV4 } from '../../schemas/primitives';
import { defineContract } from '../contract';

/**
 * Step 1 of the transfer Saga: move money between two accounts.
 *
 * The caller's idempotency key rides in the envelope, not here. That is what
 * makes invariants T-3 and T-4 checkable: the same key with the same content
 * returns the original transaction, and the same key with **different** content
 * is a conflict — answering it with the original result would be a lie.
 *
 * `amount > 0` (T-1) and source ≠ target (T-2) are enforced here because both
 * are properties of the request itself, not of any account's state.
 */
export const transferRequestedV1 = defineContract({
  name: 'transfer.requested.v1',
  category: 'command',
  producer: 'gateway',
  consumers: ['transaction-service'],
  schema: z
    .object({
      transactionId: uuidV4,
      sourceAccount: uuidV4,
      targetAccount: uuidV4,
      amount: money,
    })
    .refine((value) => value.amount.amountMinor > 0, {
      message: 'amount must be greater than zero (T-1)',
      path: ['amount', 'amountMinor'],
    })
    .refine((value) => value.sourceAccount !== value.targetAccount, {
      message: 'source and target accounts must differ (T-2)',
      path: ['targetAccount'],
    }),
});

export type TransferRequestedV1 = z.infer<typeof transferRequestedV1.schema>;
