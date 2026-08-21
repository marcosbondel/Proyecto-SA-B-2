import { z } from 'zod';

import { failureCode, uuidV4 } from '../../schemas/primitives';
import { defineContract } from '../contract';

/**
 * The credit could not be applied.
 *
 * Arrives **after** the debit succeeded, so it triggers compensation rather
 * than a plain failure. `ACCOUNT_INACTIVE` is deliberately absent: crediting an
 * inactive account is legal and reactivates it (A-3).
 */
export const accountCreditRejectedV1 = defineContract({
  name: 'account.credit.rejected.v1',
  category: 'event',
  producer: 'account-service',
  consumers: ['transaction-service', 'notification-audit-service'],
  schema: z.object({
    transactionId: uuidV4,
    accountId: uuidV4,
    reason: failureCode.extract(['ACCOUNT_NOT_FOUND', 'INVALID_AMOUNT_PRECISION']),
  }),
});

export type AccountCreditRejectedV1 = z.infer<typeof accountCreditRejectedV1.schema>;
