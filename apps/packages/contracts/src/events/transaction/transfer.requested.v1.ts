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
 *
 * `TIMEOUT` was added by T-29 alongside Payment Service's simulated provider.
 * It is a third, distinct way to fail: `TRANSIENT_FAILURE` already named "a
 * timeout, a connection reset, a 503" as one value, which meant a timeout
 * could not be rehearsed on its own. `TIMEOUT` and `TRANSIENT_FAILURE` both
 * retry on the same ladder and both exhaust into `PAYMENT_RETRIES_EXHAUSTED`
 * — the only difference is which answer the simulated provider gives, which
 * is why `payment.attempt.failed.v1` is what makes the two distinguishable.
 */
export const paymentScenario = z.enum(['APPROVE', 'REJECT', 'TRANSIENT_FAILURE', 'TIMEOUT']);

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
      customerId: uuidV4.optional(),
      paymentScenario: paymentScenario.optional(),

      /**
       * What the payment is *for*, when the target is a biller's collection
       * account — a contract number, a meter number, a phone line.
       *
       * **Added for the prototype's `G-01`, optional and backward-compatible**,
       * the same additive shape T-15 used for `paymentScenario` and T-18 used
       * for the payment fields on the status reply: a message that omits it
       * validates exactly as before, so the version does not move and no
       * existing consumer breaks. Recorded alongside TD-036.
       *
       * It exists because a service payment **is a transfer** — to an account
       * the biller holds at this bank — and the one thing a transfer could not
       * carry was the number that tells the biller whose bill was paid. That is
       * the whole difference between the two, and it is one optional string
       * rather than a second kind of money movement with its own state machine.
       *
       * Free text on purpose: a contract number's shape is the biller's
       * business, not this bank's, and a format rule here would refuse a valid
       * one the day a biller changed theirs.
       */
      reference: z.string().trim().min(1).max(60).optional(),
    })
    /*
     * These two messages are in Spanish, and they are the only strings in this
     * package that have to be: the Gateway revalidates the payload against this
     * schema before publishing and passes the first message straight to the
     * browser, so `T-2` was reaching customers as "source and target accounts
     * must differ (T-2)". The criterion each one enforces stays here, in the
     * comment, where it traces without being read aloud to a person.
     */
    // T-1: the amount must be positive.
    .refine((value) => value.amount.amountMinor > 0, {
      message: 'El monto debe ser mayor que cero.',
      path: ['amount', 'amountMinor'],
    })
    // T-2: a transfer must move money between two different accounts.
    .refine((value) => value.sourceAccount !== value.targetAccount, {
      message: 'La cuenta de destino debe ser distinta de la de origen.',
      path: ['targetAccount'],
    }),
});

export type TransferRequestedV1 = z.infer<typeof transferRequestedV1.schema>;
