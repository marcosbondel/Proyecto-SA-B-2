import { z } from 'zod';

import { money, uuidV4 } from '../../schemas/primitives';
import { defineContract } from '../contract';

/**
 * How the payment step should be made to end, for demonstration only.
 *
 * The assignment's Saga is only interesting when it can be shown failing and
 * compensating on demand, and a real external provider cannot be asked to
 * decline to order. This field exists so a demonstration can pick the ending.
 *
 * **The Gateway validates it and never obeys it.** Acting on the value is
 * Transaction Service's business; deciding anything from it in the Gateway
 * would be exactly the domain logic constitution V forbids there.
 *
 * Its absence is the normal path.
 */
export const paymentScenario = z.enum(['APPROVE', 'REJECT', 'TRANSIENT_FAILURE']);

export type PaymentScenario = z.infer<typeof paymentScenario>;

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
 *
 * `paymentScenario` was added by T-15 as an **optional** field, which is why
 * the version stayed at v1: a message that omits it validates exactly as
 * before, so no consumer had to change and no binding had to move.
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
      paymentScenario: paymentScenario.optional(),
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
