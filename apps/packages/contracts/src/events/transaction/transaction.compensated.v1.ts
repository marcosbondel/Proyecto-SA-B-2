import { z } from 'zod';

import { failureCode, isoTimestamp, transactionStatus, uuidV4 } from '../../schemas/primitives';
import { defineContract } from '../contract';

/**
 * The transfer failed **after** the money had left, and it was put back.
 *
 * Not interchangeable with `transaction.failed.v1`. Both mean the customer's
 * money is where it started, but only this one means it moved twice, and the
 * audit record has to be able to say which happened.
 */
export const transactionCompensatedV1 = defineContract({
  name: 'transaction.compensated.v1',
  category: 'event',
  producer: 'transaction-service',
  consumers: ['notification-audit-service'],
  schema: z.object({
    transactionId: uuidV4,
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
