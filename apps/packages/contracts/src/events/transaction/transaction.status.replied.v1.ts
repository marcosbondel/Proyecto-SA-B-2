import { z } from 'zod';

import {
  failureCode,
  isoTimestamp,
  money,
  paymentErrorType,
  paymentStatus,
  transactionStatus,
  uuidV4,
} from '../../schemas/primitives';
import { defineContract } from '../contract';

/**
 * What the payment step of this Saga did, as Transaction Service heard it.
 *
 * Added by T-18 and **optional**, for the same reason and by the same rule as
 * T-15's `paymentScenario`: a reply that omits it validates exactly as before,
 * so the version does not move and no consumer had to change.
 *
 * It is a copy of what `payment.succeeded.v1` or `payment.failed.v1` said, not
 * a second opinion. Transaction Service does not process payments and does not
 * read Payment Service's database; it records the event it received and repeats
 * it. `status: 'PENDING'` means the payment was ordered and nothing has come
 * back yet — which is a different statement from "there is no payment", and the
 * screen that shows it has to be able to tell them apart.
 */
const paymentOutcome = z.object({
  paymentId: uuidV4,
  status: paymentStatus,
  /** Payment Service's own attempt counter, not the broker's redeliveries. */
  attempt: z.int().positive().nullable(),
  reason: failureCode.extract(['PAYMENT_DECLINED', 'PAYMENT_RETRIES_EXHAUSTED']).nullable(),
  /**
   * The kind of the last failure, added by T-19 and **optional**, by the same
   * additive rule as `payment` itself: a reply that omits it validates exactly
   * as before, so the version does not move and no consumer had to change.
   *
   * It is not derivable from `reason`, which is why it is a field. The two look
   * related — `PAYMENT_DECLINED` is normally permanent, `PAYMENT_RETRIES_EXHAUSTED`
   * normally transient — but that mapping is Payment Service's policy, not a law,
   * and a consumer that inferred it would be reimplementing a decision it does
   * not own. It also says nothing at all while the payment is still `PENDING`,
   * where `reason` is `null` and the kind of the last failed attempt is the only
   * thing that tells a screen a retry is under way.
   */
  errorType: paymentErrorType.nullable().optional(),
  decidedAt: isoTimestamp.nullable(),
});

/**
 * The answer to `transaction.status.requested.v1`.
 *
 * `reason` is present exactly when the transfer did not complete, and it is one
 * of the closed failure codes — never free text and never an internal message.
 * A status reply is the most likely thing a customer sees after a timeout, so
 * it is the last place that should leak an implementation detail.
 */
export const transactionStatusRepliedV1 = defineContract({
  name: 'transaction.status.replied.v1',
  category: 'reply',
  producer: 'transaction-service',
  consumers: ['gateway'],
  schema: z.discriminatedUnion('outcome', [
    z.object({
      outcome: z.literal('FOUND'),
      transactionId: uuidV4,
      status: transactionStatus,
      amount: money,
      reason: failureCode.nullable(),
      createdAt: isoTimestamp,
      updatedAt: isoTimestamp,
      /**
       * The correlation of the flow that **started** this transfer, not of the
       * question being asked now.
       *
       * They are different identifiers and confusing them makes this reply
       * useless for the thing it exists for. The Gateway stamps every request
       * with a fresh correlation, so a caller polling the status every two
       * seconds produces a new one each time; the trail they actually need to
       * search the audit record with is the one the transfer was created under.
       * Transaction Service is the only component that still knows it, because
       * it is the only one that wrote it down.
       *
       * Named `originCorrelationId` rather than `correlationId` on purpose: the
       * Gateway adds the request's own `correlationId` to the body it returns,
       * and two different values under one name is how a diagnostic identifier
       * becomes a source of wrong bug reports.
       *
       * Optional for backwards compatibility, and always sent by T-18.
       */
      originCorrelationId: uuidV4.optional(),
      /** What the payment step did, when there is a payment step yet. */
      payment: paymentOutcome.optional(),
    }),
    z.object({
      outcome: z.literal('NOT_FOUND'),
    }),
  ]),
});

export type TransactionStatusRepliedV1 = z.infer<typeof transactionStatusRepliedV1.schema>;

/** The payment half of a status reply, on its own. */
export type TransactionPaymentOutcome = z.infer<typeof paymentOutcome>;
