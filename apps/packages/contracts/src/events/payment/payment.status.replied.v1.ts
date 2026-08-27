import { z } from 'zod';

import { defineContract } from '../contract';
import { paymentAttemptView, paymentView } from './payment-view';

/**
 * The answer to `payment.status.query.v1`, matched by `correlationId`.
 *
 * `NOT_FOUND` carries no failure code. Every code in the catalogue is a reason
 * something was *refused*, and a payment that does not exist was not refused —
 * it is a question about nothing. The Gateway supplies the nearest catalogue
 * code when it has to render an HTTP status, and does so in one place rather
 * than letting each service invent a vocabulary for absence.
 *
 * `attempts` is the retry ladder as evidence. It is present on a `FOUND` reply
 * even when it holds a single successful rung, because "approved on the first
 * try" and "approved on the third" are different operational stories and a
 * screen that could only show the second would make the first look like missing
 * data.
 */
export const paymentStatusRepliedV1 = defineContract({
  name: 'payment.status.replied.v1',
  category: 'reply',
  producer: 'payment-service',
  consumers: ['gateway'],
  schema: z.discriminatedUnion('outcome', [
    z.object({
      outcome: z.literal('FOUND'),
      payment: paymentView,
      /** Oldest rung first, so the list reads in the order it happened. */
      attempts: z.array(paymentAttemptView),
    }),
    z.object({
      outcome: z.literal('NOT_FOUND'),
    }),
  ]),
});

export type PaymentStatusRepliedV1 = z.infer<typeof paymentStatusRepliedV1.schema>;
