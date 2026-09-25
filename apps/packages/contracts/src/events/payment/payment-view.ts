import { z } from 'zod';

import {
  failureCode,
  isoTimestamp,
  money,
  paymentErrorType,
  paymentStatus,
  uuidV4,
} from '../../schemas/primitives';
import { paymentScenario } from '../transaction/transfer.requested.v1';

/**
 * A payment as somebody outside Payment Service is allowed to see it.
 *
 * Shared by the listing and the single-payment reply so the two cannot drift:
 * a monitoring table and a detail screen that disagree about what `attempt`
 * counts are two screens that will eventually be used to contradict each other
 * in an incident.
 *
 * What is **not** here is as deliberate as what is. There is no provider
 * payload, no credential, no internal error string: `failureReason` is the
 * closed catalogue code and `errorType` is the two-value kind. A reply is the
 * most likely thing to reach a browser, and it is the last place an internal
 * message should leak.
 *
 * Added by T-19.
 */
export const paymentView = z.object({
  paymentId: uuidV4,
  /** The Saga this payment belongs to. A reference, never a foreign key. */
  transactionId: uuidV4,
  status: paymentStatus,
  amount: money,
  /**
   * How many attempts have been made so far — not how many are left, and not
   * the broker's redeliveries. `null` before the first attempt is recorded.
   */
  attempt: z.int().positive().nullable(),
  /** The kind of the **last** failure, or `null` while nothing has failed. */
  errorType: paymentErrorType.nullable(),
  failureReason: failureCode
    .extract(['PAYMENT_DECLINED', 'PAYMENT_RETRIES_EXHAUSTED'])
    .nullable(),
  /**
   * The simulated provider's reference. Opaque on purpose: it is a string to
   * quote back to a provider, not a value any consumer may parse.
   */
  providerReference: z.string().max(100).nullable(),
  /**
   * The demonstration scenario this payment was asked to act out, when it was
   * given one. Echoed so a screen can say *why* a payment was rejected on
   * purpose instead of leaving a rehearsal looking like a real refusal.
   */
  scenario: paymentScenario.nullable(),
  /** The correlation the payment was **born** in, not the query's. */
  originCorrelationId: uuidV4.nullable(),
  createdAt: isoTimestamp,
  updatedAt: isoTimestamp,
  /** When the payment stopped moving. `null` while it is still being tried. */
  decidedAt: isoTimestamp.nullable(),
});

export type PaymentView = z.infer<typeof paymentView>;

/**
 * One rung of the retry ladder, as evidence rather than as narrative.
 *
 * The ticket asks for a `payment_attempts` table precisely so that "it was
 * retried three times" is something anyone can check afterwards instead of
 * something the service asserts. Carrying it on the reply is what makes that
 * checkable from outside the service's own database.
 */
export const paymentAttemptView = z.object({
  attemptNumber: z.int().positive(),
  result: z.enum(['SUCCEEDED', 'FAILED']),
  errorType: paymentErrorType.nullable(),
  failureReason: failureCode
    .extract(['PAYMENT_DECLINED', 'PAYMENT_RETRIES_EXHAUSTED'])
    .nullable(),
  /**
   * What the simulated provider answered on this rung — added by T-29.
   * `null` only for an attempt recorded before this field existed; every
   * attempt from here on asks the provider and gets one of the three.
   */
  providerResult: z.enum(['SUCCESS', 'FAILURE', 'TIMEOUT']).nullable(),
  occurredAt: isoTimestamp,
});

export type PaymentAttemptView = z.infer<typeof paymentAttemptView>;
