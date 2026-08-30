import { z } from 'zod';

import { isoTimestamp, money, uuidV4 } from '../../schemas/primitives';
import { defineContract } from '../contract';

/**
 * The money is in the account.
 *
 * Two consumers, and the second is what makes the teller's screen possible: the
 * Gateway correlates this to answer the person standing at the window, the way
 * it correlates an activation. Notification & Audit remains the declared
 * consumer and the trail is untouched.
 *
 * `balanceAfter` travels because the receipt shows it, and because recomputing
 * it anywhere else would be a second opinion about a number the ledger already
 * settled.
 */
export const accountDepositedV1 = defineContract({
  name: 'account.deposited.v1',
  category: 'event',
  producer: 'account-service',
  consumers: ['notification-audit-service'],
  schema: z.object({
    depositId: uuidV4,
    accountId: uuidV4,
    operationId: uuidV4,
    amount: money,
    balanceAfter: money,
    /** A deposit into an idle account wakes it up, like any other credit (A-3). */
    reactivated: z.boolean(),
    occurredAt: isoTimestamp,
  }),
});

export type AccountDepositedV1 = z.infer<typeof accountDepositedV1.schema>;
