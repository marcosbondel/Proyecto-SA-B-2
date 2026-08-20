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
    cause: z.enum(['AUTOMATIC_INACTIVITY', 'ADMINISTRATOR']),
    balanceAtDeactivation: money,
    lastActivityAt: isoTimestamp.nullable(),
    deactivatedAt: isoTimestamp,
  }),
});

export type AccountDeactivatedV1 = z.infer<typeof accountDeactivatedV1.schema>;
