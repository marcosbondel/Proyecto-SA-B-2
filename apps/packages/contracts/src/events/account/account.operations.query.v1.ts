import { z } from 'zod';

import { uuidV4 } from '../../schemas/primitives';
import { defineContract } from '../contract';

/**
 * The movements of one account. Added by T-17.
 *
 * Scoped to a single account rather than to a customer, because that is the
 * unit a statement is read in and because it keeps the reply bounded: a
 * customer-wide query would grow without limit as the system is used.
 */
export const accountOperationsQueryV1 = defineContract({
  name: 'account.operations.query.v1',
  category: 'command',
  producer: 'gateway',
  consumers: ['account-service'],
  schema: z.object({
    accountId: uuidV4,
  }),
});

export type AccountOperationsQueryV1 = z.infer<typeof accountOperationsQueryV1.schema>;
