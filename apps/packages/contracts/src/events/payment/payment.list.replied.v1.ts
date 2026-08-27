import { z } from 'zod';

import { defineContract } from '../contract';
import { paymentView } from './payment-view';

/**
 * The answer to `payment.list.query.v1`, matched by `correlationId`.
 *
 * No `NOT_FOUND` outcome, for the reason `account.list.replied.v1` gives: an
 * empty list is the whole answer, and it must mean the same thing whether
 * nothing matched or nothing exists.
 *
 * Newest first. The ordering is part of the contract rather than left to the
 * caller because this list is read during incidents, and "the three that failed
 * in the last hour" is the question being asked — a screen that had to sort a
 * truncated page would show the wrong three.
 */
export const paymentListRepliedV1 = defineContract({
  name: 'payment.list.replied.v1',
  category: 'reply',
  producer: 'payment-service',
  consumers: ['gateway'],
  schema: z.object({
    /** Most recently updated first. */
    payments: z.array(paymentView),
  }),
});

export type PaymentListRepliedV1 = z.infer<typeof paymentListRepliedV1.schema>;
