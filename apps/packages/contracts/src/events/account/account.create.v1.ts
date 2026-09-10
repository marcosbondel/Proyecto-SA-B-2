import { z } from 'zod';

import { accountType, money, uuidV4 } from '../../schemas/primitives';
import { defineContract } from '../contract';

/**
 * Open an account.
 *
 * `accountType` is required and closed to the two the assignment names (§4.1
 * NOTE, page 7). Through Phase 1 it was a classification and nothing else —
 * decision D-02 of T-02 — but recording it then is what made it possible to
 * attach behaviour later without a version bump on every account message.
 *
 * `initialDeposit` is optional and defaults to Q0.00 when absent — every
 * `MONETARIA` opening, and the only shape this message had before T-27.
 * `AHORRO` requires one that reaches its type's minimum
 * (`account-type-rules.ts`); a deposit that does not is refused with
 * `account.open.rejected.v1`, `MINIMUM_BALANCE_VIOLATION`, and no account is
 * created. The deposit is not a floor the account must stay above afterward —
 * only a condition of opening it.
 *
 * Only `role = CLIENTE` may hold accounts (C-6); that is checked by the service
 * that knows the customer, not by this shape.
 */
export const accountCreateV1 = defineContract({
  name: 'account.create.v1',
  category: 'command',
  producer: 'gateway',
  consumers: ['account-service'],
  schema: z.object({
    accountId: uuidV4,
    customerId: uuidV4,
    accountType,
    initialDeposit: money.optional(),
  }),
});

export type AccountCreateV1 = z.infer<typeof accountCreateV1.schema>;
