import { z } from 'zod';

import { uuidV4 } from '../../schemas/primitives';
import { defineContract } from '../contract';

/**
 * Ask for an account's balance.
 *
 * Asynchronous request/reply. Reading a balance does **not** touch
 * `lastActivityAt` (invariant A-4), so a customer who only ever checks their
 * balance still drifts toward automatic deactivation. That is the domain's
 * decision, not an oversight of this contract.
 */
export const accountBalanceQueryV1 = defineContract({
  name: 'account.balance.query.v1',
  category: 'command',
  producer: 'gateway',
  consumers: ['account-service'],
  schema: z.object({
    accountId: uuidV4,
  }),
});

export type AccountBalanceQueryV1 = z.infer<typeof accountBalanceQueryV1.schema>;
