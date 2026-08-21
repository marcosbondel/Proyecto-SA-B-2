import { z } from 'zod';

import { failureCode, isoTimestamp, paymentStatus, uuidV4 } from '../../schemas/primitives';
import { defineContract } from '../contract';

/**
 * The payment did not go through, and the retries are spent.
 *
 * Arrives after the debit, so it triggers compensation and the Saga closes in
 * `COMPENSATED`. `failureReason` is required here — `docs/domain/entities.md`
 * makes it nullable on the entity but mandatory when `status = FAILED`, and a
 * compensation with no recorded cause is an audit record that explains nothing.
 */
export const paymentFailedV1 = defineContract({
  name: 'payment.failed.v1',
  category: 'event',
  producer: 'payment-service',
  consumers: ['transaction-service', 'notification-audit-service'],
  schema: z.object({
    paymentId: uuidV4,
    transactionId: uuidV4,
    status: paymentStatus.extract(['FAILED']),
    attempt: z.int().positive(),
    failureReason: failureCode.extract(['PAYMENT_DECLINED', 'PAYMENT_RETRIES_EXHAUSTED']),
    failedAt: isoTimestamp,
  }),
});

export type PaymentFailedV1 = z.infer<typeof paymentFailedV1.schema>;
