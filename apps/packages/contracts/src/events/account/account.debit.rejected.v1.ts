import { z } from 'zod';

import { failureCode, uuidV4 } from '../../schemas/primitives';
import { defineContract } from '../contract';

/**
 * The debit did not happen.
 *
 * The one failure in the whole Saga that needs **no compensation**: the money
 * never left, so there is nothing to put back. Transaction Service closes in
 * `FAILED`, which is a different operational situation from `COMPENSATED` and
 * the audit record must be able to tell them apart.
 */
export const accountDebitRejectedV1 = defineContract({
  name: 'account.debit.rejected.v1',
  category: 'event',
  producer: 'account-service',
  consumers: ['transaction-service', 'notification-audit-service'],
  schema: z.object({
    transactionId: uuidV4,
    accountId: uuidV4,
    reason: failureCode.extract([
      'INSUFFICIENT_FUNDS',
      'ACCOUNT_INACTIVE',
      'ACCOUNT_NOT_FOUND',
      'INVALID_AMOUNT_PRECISION',
    ]),
  }),
});

export type AccountDebitRejectedV1 = z.infer<typeof accountDebitRejectedV1.schema>;
