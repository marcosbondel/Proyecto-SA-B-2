import { z } from 'zod';

import { isoTimestamp, money, uuidV4 } from '../../schemas/primitives';
import { defineContract } from '../contract';

/**
 * An account went inactive.
 *
 * Two causes, and they are not the same: the automatic sweep for accounts under
 * Q50.00 idle for six months (§4.1, page 5), or an administrator. The automatic
 * process is idempotent — an already inactive account does not transition again
 * nor emit a second event (invariant A-5).
 */
export const accountDeactivatedV1 = defineContract({
  name: 'account.deactivated.v1',
  category: 'event',
  producer: 'account-service',
  consumers: ['notification-audit-service'],
  schema: z.object({
    accountId: uuidV4,
    customerId: uuidV4.optional(),
    cause: z.enum(['AUTOMATIC_INACTIVITY', 'ADMINISTRATOR', 'CUSTOMER', 'TELLER']),
    balanceAtDeactivation: money,
    lastActivityAt: isoTimestamp.nullable(),
    deactivatedAt: isoTimestamp,
    /**
     * Why an administrator deactivated the account. Required on the command and
     * carried here so the audit trail keeps it; `null` for the automatic sweep,
     * which has no human reason (its cause is the inactivity rule itself).
     */
    reason: z.string().max(300).nullable(),
  }),
});

export type AccountDeactivatedV1 = z.infer<typeof accountDeactivatedV1.schema>;
