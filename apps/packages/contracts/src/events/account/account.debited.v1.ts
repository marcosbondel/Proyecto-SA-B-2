import { z } from 'zod';

import { isoTimestamp, money, uuidV4 } from '../../schemas/primitives';
import { defineContract } from '../contract';

/**
 * The money left the source account.
 *
 * From here on the Saga can no longer end in `FAILED` (invariant T-7): there is
 * an effect to undo, so every later failure leads to compensation instead.
 *
 * `balanceAfter` is carried so the audit record can reconstruct the movement
 * without querying Account Service, which it is not allowed to do anyway.
 */
export const accountDebitedV1 = defineContract({
  name: 'account.debited.v1',
  category: 'event',
  producer: 'account-service',
  consumers: ['transaction-service', 'notification-audit-service'],
  schema: z.object({
    transactionId: uuidV4,
    accountId: uuidV4,
    amount: money,
    balanceAfter: money,
    debitedAt: isoTimestamp,
  }),
});

export type AccountDebitedV1 = z.infer<typeof accountDebitedV1.schema>;
