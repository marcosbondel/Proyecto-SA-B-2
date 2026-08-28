import { z } from 'zod';

import {
  failureCode,
  isoTimestamp,
  paymentErrorType,
  uuidV4,
} from '../../schemas/primitives';
import { defineContract } from '../contract';

/**
 * One attempt failed. Whether that ends the payment is the next field.
 *
 * Added by T-19, and it exists because of a gap the frontend found rather than
 * a gap the backend felt. Before this event the catalogue described a payment
 * as a thing that succeeds or fails **once**, at the end: `payment.succeeded.v1`
 * and `payment.failed.v1` both carry a final `attempt` count, and nothing was
 * said in between. So a retry ladder that is the whole point of the resilience
 * policy — three retries at 1s, 5s and 30s — was invisible to everyone except
 * Payment Service's own logs. A screen could report that a payment had taken
 * four attempts only after it had stopped taking them.
 *
 * This is the message that makes the middle of the ladder observable. It is
 * emitted once per failed attempt, **including the last one**, so the count a
 * consumer holds never skips a rung.
 *
 * Three deliberate choices:
 *
 * - **`willRetry` is a field, not something a consumer derives.** A reader
 *   could compare `attempt` against `MAX_RETRIES` and guess, but the decision
 *   belongs to the retry policy in Payment Service's domain, and a consumer
 *   that re-derives it is a second implementation of that policy waiting to
 *   disagree with the first. A `PERMANENT` error stops at attempt 1 no matter
 *   what the ladder allows, and the field says so directly.
 * - **It does not close the Saga.** `payment.failed.v1` is still the only event
 *   that means "the payment is over", and it still arrives afterwards when the
 *   retries are spent. A transaction that treated this event as terminal would
 *   compensate a payment that was about to succeed on its second attempt.
 * - **`failureReason` is nullable.** A transient failure — a timeout, a socket
 *   the provider closed — has no place in the closed failure-code enum, and
 *   inventing one would put transport noise into a vocabulary that services use
 *   to decide whether to compensate.
 */
export const paymentAttemptFailedV1 = defineContract({
  name: 'payment.attempt.failed.v1',
  category: 'event',
  producer: 'payment-service',
  consumers: ['transaction-service', 'notification-audit-service'],
  schema: z.object({
    paymentId: uuidV4,
    transactionId: uuidV4,
    /** Which rung. Starts at 1, and never skips one. */
    attempt: z.int().positive(),
    errorType: paymentErrorType,
    /**
     * Whether the policy will try again. `false` on a `PERMANENT` error and on
     * the last rung of the ladder; the terminal `payment.failed.v1` follows.
     */
    willRetry: z.boolean(),
    /**
     * When the next attempt is due, from the ladder in `routing/topology.ts`.
     * `null` exactly when `willRetry` is `false`.
     */
    nextAttemptAt: isoTimestamp.nullable(),
    /** The catalogue code, when the failure has one. Transport noise does not. */
    failureReason: failureCode
      .extract(['PAYMENT_DECLINED', 'PAYMENT_RETRIES_EXHAUSTED'])
      .nullable(),
    failedAt: isoTimestamp,
  }),
});

export type PaymentAttemptFailedV1 = z.infer<typeof paymentAttemptFailedV1.schema>;
