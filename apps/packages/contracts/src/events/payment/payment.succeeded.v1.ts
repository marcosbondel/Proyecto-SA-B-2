import { z } from 'zod';

import { isoTimestamp, paymentStatus, uuidV4 } from '../../schemas/primitives';
import { defineContract } from '../contract';

/**
 * The payment went through.
 *
 * `attempt` starts at 1 and counts Payment Service's own internal retries, not
 * the broker's. A success on attempt 3 is a different operational story from a
 * success on attempt 1, and the audit record should be able to tell.
 */
export const paymentSucceededV1 = defineContract({
  name: 'payment.succeeded.v1',
  category: 'event',
  producer: 'payment-service',
  consumers: ['transaction-service', 'notification-audit-service'],
  schema: z.object({
    paymentId: uuidV4,
    transactionId: uuidV4,
    status: paymentStatus.extract(['SUCCEEDED']),
    attempt: z.int().positive(),
    succeededAt: isoTimestamp,
  }),
});

export type PaymentSucceededV1 = z.infer<typeof paymentSucceededV1.schema>;
