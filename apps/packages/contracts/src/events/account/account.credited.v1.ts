import { z } from 'zod';

import { isoTimestamp, money, uuidV4 } from '../../schemas/primitives';
import { defineContract } from '../contract';

/**
 * The money arrived in the target account.
 *
 * `reactivated` is not decoration: crediting an `INACTIVE` account is a legal
 * transition that brings it back (invariant A-3), and the audit record needs to
 * show that the state changed as a side effect of a transfer rather than by an
 * administrator's hand.
 */
export const accountCreditedV1 = defineContract({
  name: 'account.credited.v1',
  category: 'event',
  producer: 'account-service',
  consumers: ['transaction-service', 'notification-audit-service'],
  schema: z.object({
    transactionId: uuidV4,
    accountId: uuidV4,
    amount: money,
    balanceAfter: money,
    reactivated: z.boolean(),
    creditedAt: isoTimestamp,
  }),
});

export type AccountCreditedV1 = z.infer<typeof accountCreditedV1.schema>;
