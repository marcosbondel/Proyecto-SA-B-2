import { z } from 'zod';

import { failureCode, isoTimestamp, uuidV4 } from '../../schemas/primitives';
import { defineContract } from '../contract';

/**
 * The deposit did not happen, and why.
 *
 * Three reasons and no more: the account does not exist, the amount is not one
 * this system can hold, or the actor is not staff. There is deliberately no
 * `ACCOUNT_INACTIVE` — a deposit into a dormant account is the one thing that
 * should still work, and it reactivates it (invariant A-3). Refusing it would
 * mean telling somebody that the money they are holding cannot go into their
 * own account until they first put money into it.
 */
export const accountDepositRejectedV1 = defineContract({
  name: 'account.deposit.rejected.v1',
  category: 'event',
  producer: 'account-service',
  consumers: ['notification-audit-service'],
  schema: z.object({
    depositId: uuidV4,
    reason: failureCode.extract([
      'ACCOUNT_NOT_FOUND',
      'INVALID_AMOUNT_PRECISION',
      'FORBIDDEN_ACCOUNT_ACCESS',
    ]),
    occurredAt: isoTimestamp,
  }),
});

export type AccountDepositRejectedV1 = z.infer<typeof accountDepositRejectedV1.schema>;
