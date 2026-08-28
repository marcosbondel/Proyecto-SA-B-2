import { z } from 'zod';

import { uuidV4 } from '../../schemas/primitives';
import { defineContract } from '../contract';

/**
 * "What became of this payment?" — the single-payment question.
 *
 * Added by T-19. It is asked by `paymentId`, which is the identifier a screen
 * already has: it arrives on the transfer's status reply, so following the link
 * from a transfer to its payment costs no lookup.
 *
 * This does not replace the payment half of `transaction.status.replied.v1`.
 * That one is Transaction Service repeating an event it received; this one is
 * Payment Service answering about its own row, and it is the only source of the
 * per-attempt evidence. Two questions, two owners, and the second is the one to
 * ask when the first disagrees with itself.
 */
export const paymentStatusQueryV1 = defineContract({
  name: 'payment.status.query.v1',
  category: 'command',
  producer: 'gateway',
  consumers: ['payment-service'],
  schema: z.object({
    paymentId: uuidV4,
  }),
});

export type PaymentStatusQueryV1 = z.infer<typeof paymentStatusQueryV1.schema>;
