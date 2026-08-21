import { z } from 'zod';

import { accountStatus, uuidV4 } from '../../schemas/primitives';
import { defineContract } from '../contract';

/**
 * Deactivate or reactivate an account by hand.
 *
 * `ADMINISTRADOR` only. The authorization decision belongs to the Gateway,
 * which is the component holding the verified role; this contract only carries
 * the intent.
 */
export const accountSetStatusV1 = defineContract({
  name: 'account.set-status.v1',
  category: 'command',
  producer: 'gateway',
  consumers: ['account-service'],
  schema: z.object({
    accountId: uuidV4,
    status: accountStatus,
    reason: z.string().min(1).max(300),
  }),
});

export type AccountSetStatusV1 = z.infer<typeof accountSetStatusV1.schema>;
