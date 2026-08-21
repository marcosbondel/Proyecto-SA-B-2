import { z } from 'zod';

import { failureCode, isoTimestamp, transactionStatus, uuidV4 } from '../../schemas/primitives';
import { defineContract } from '../contract';

/**
 * The transfer failed and **the money never left**.
 *
 * Reachable only from a rejected debit. Any transaction that left `DEBITING`
 * with the debit applied ends in `COMPLETED` or `COMPENSATED`, never here
 * (invariant T-7) — which is why the reason codes are restricted to the ones a
 * debit can be rejected with, plus the two request-level rejections that stop
 * the Saga before it starts.
 */
export const transactionFailedV1 = defineContract({
  name: 'transaction.failed.v1',
  category: 'event',
  producer: 'transaction-service',
  consumers: ['notification-audit-service'],
  schema: z.object({
    transactionId: uuidV4,
    status: transactionStatus.extract(['FAILED']),
    reason: failureCode.extract([
      'INSUFFICIENT_FUNDS',
      'ACCOUNT_INACTIVE',
      'ACCOUNT_NOT_FOUND',
      'INVALID_AMOUNT',
      'INVALID_AMOUNT_PRECISION',
      'SAME_ACCOUNT_TRANSFER',
      'IDEMPOTENCY_KEY_CONFLICT',
    ]),
    failedAt: isoTimestamp,
  }),
});

export type TransactionFailedV1 = z.infer<typeof transactionFailedV1.schema>;
