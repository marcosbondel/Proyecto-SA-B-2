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
 *
 * Carries `customerId` for the reason `transaction.compensated.v1` sets out at
 * length. This event is the one of the three that cannot lose the envelope's
 * identity — a rejected debit is always reached from the request that a
 * signed-in person made — and it declares its subject anyway, so the rule holds
 * for the whole terminal family instead of for two contracts out of three.
 */
export const transactionFailedV1 = defineContract({
  name: 'transaction.failed.v1',
  category: 'event',
  producer: 'transaction-service',
  consumers: ['notification-audit-service'],
  schema: z.object({
    transactionId: uuidV4,
    customerId: uuidV4.nullable(),
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
