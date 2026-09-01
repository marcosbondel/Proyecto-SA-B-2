import { z } from 'zod';

import { failureCode, isoTimestamp, transactionStatus, uuidV4 } from '../../schemas/primitives';
import { defineContract } from '../contract';

/**
 * The transfer failed **after** the money had left, and it was put back.
 *
 * Not interchangeable with `transaction.failed.v1`. Both mean the customer's
 * money is where it started, but only this one means it moved twice, and the
 * audit record has to be able to say which happened.
 *
 * **Why `customerId` is in the payload of a terminal transfer event.** The
 * envelope's identity is the right source for anything a signed-in person
 * caused, and it survives the whole choreography — except across Payment
 * Service's retry sweeper, which republishes on a timer with no session to
 * inherit from. A transfer that exhausts the retry ladder therefore arrives
 * here with a null identity, and the one notification that matters most —
 * *your money came back* — had no recipient and was recorded `FAILED`.
 *
 * So the subject travels in the payload, exactly as it already does for the
 * `customer.*` family and for the same reason (TD-044): an event about a
 * person must be able to say which person, even when nobody is signed in. It
 * is an identifier and not an address — Notification & Audit still *derives*
 * the destination from it and never reads a contact field — so the rule
 * `redaction.ts` exists to keep is untouched.
 *
 * Nullable because the column it comes from is: transfers created before
 * migration 006 have no customer, and a fabricated one would be worse than an
 * honest absence.
 */
export const transactionCompensatedV1 = defineContract({
  name: 'transaction.compensated.v1',
  category: 'event',
  producer: 'transaction-service',
  consumers: ['notification-audit-service'],
  schema: z.object({
    transactionId: uuidV4,
    customerId: uuidV4.nullable(),
    status: transactionStatus.extract(['COMPENSATED']),
    reason: failureCode.extract([
      'PAYMENT_DECLINED',
      'PAYMENT_RETRIES_EXHAUSTED',
      'ACCOUNT_NOT_FOUND',
      'INVALID_AMOUNT_PRECISION',
    ]),
    compensatedAt: isoTimestamp,
  }),
});

export type TransactionCompensatedV1 = z.infer<typeof transactionCompensatedV1.schema>;
