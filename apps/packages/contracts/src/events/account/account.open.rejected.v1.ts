import { z } from 'zod';

import { failureCode, isoTimestamp, uuidV4 } from '../../schemas/primitives';
import { defineContract } from '../contract';

/**
 * An account was not opened, and why. Added by T-17.
 *
 * Without it, a refused opening produced silence: `account.create.v1` had only
 * a success event, so the interface waited out its poll and reported a timeout
 * for something that had already been decided. That is the same gap TD-022
 * closed for registration.
 *
 * Three reasons, all of which this service can actually judge from the
 * envelope and the payload alone. It does **not** validate that the customer
 * exists — `customerId` is an opaque reference and any check on it would be a
 * synchronous read into another service's data (§8.2, 2.3).
 *
 * `MINIMUM_BALANCE_VIOLATION` (T-27) means an `AHORRO` opening's
 * `initialDeposit` did not reach its type's minimum — a condition of opening
 * the account, checked once, here.
 */
export const accountOpenRejectedV1 = defineContract({
  name: 'account.open.rejected.v1',
  category: 'event',
  producer: 'account-service',
  consumers: ['notification-audit-service'],
  schema: z.object({
    accountId: uuidV4,
    customerId: uuidV4,
    reason: failureCode.extract([
      'ROLE_NOT_ELIGIBLE',
      'FORBIDDEN_ACCOUNT_ACCESS',
      'MINIMUM_BALANCE_VIOLATION',
    ]),
    rejectedAt: isoTimestamp,
  }),
});

export type AccountOpenRejectedV1 = z.infer<typeof accountOpenRejectedV1.schema>;
