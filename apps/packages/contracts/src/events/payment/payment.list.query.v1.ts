import { z } from 'zod';

import { paymentErrorType, paymentStatus, uuidV4 } from '../../schemas/primitives';
import { defineContract } from '../contract';

/**
 * "Which payments are there?" — asked by the Gateway, answered by their owner.
 *
 * Added by T-19 for the monitoring screen the Claude Design prototype calls
 * G-04. Every filter is optional and every one of them is a *request*, not a
 * permission, exactly as in `account.list.query.v1`: the Gateway holds no
 * payments table and cannot know which payments the asker is entitled to see.
 *
 * Unlike accounts, though, Payment Service **cannot narrow this by customer**,
 * and pretending otherwise would be worse than admitting it. A payment row
 * holds a `transactionId` and nothing else that identifies a person; resolving
 * it to an owner means reading Transaction Service's or Account Service's
 * tables, which §8.2 criterion 2.3 forbids outright. That is why the Gateway
 * restricts the route to staff instead of asking this service for a scope it
 * has no way to compute — the same shape of gap as TD-035, refused in the same
 * direction.
 */
export const paymentListQueryV1 = defineContract({
  name: 'payment.list.query.v1',
  category: 'command',
  producer: 'gateway',
  consumers: ['payment-service'],
  schema: z.object({
    /** Narrow to the payments of one Saga. The only scope this service owns. */
    transactionId: uuidV4.optional(),
    status: paymentStatus.optional(),
    /** Narrow to the payments whose last failure was of this kind. */
    errorType: paymentErrorType.optional(),
  }),
});

export type PaymentListQueryV1 = z.infer<typeof paymentListQueryV1.schema>;
