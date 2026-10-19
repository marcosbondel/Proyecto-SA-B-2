import { z } from 'zod';

import { accountStatus, uuidV4 } from '../../schemas/primitives';
import { defineContract } from '../contract';

/**
 * Deactivate or reactivate an account by hand.
 *
 * `ADMINISTRADOR` only. The authorization decision belongs to the Gateway,
 * which is the component holding the verified role; this contract only carries
 * the intent.
 *
 * **`reason` is required when deactivating and optional when activating**
 * (T-60, QA 21). The reason is the audit trail's only record of *why* a manual
 * deactivation happened, so it stays mandatory there; a reactivation carries no
 * reason anywhere downstream (`account.reactivated.v1` has none), so demanding
 * one was friction with no purpose. Backward compatible: every message that
 * validated before still validates — a reactivation that does send a reason is
 * accepted as always.
 */
export const accountSetStatusV1 = defineContract({
  name: 'account.set-status.v1',
  category: 'command',
  producer: 'gateway',
  consumers: ['account-service'],
  schema: z
    .object({
      accountId: uuidV4,
      status: accountStatus,
      reason: z.string().min(1).max(300).optional(),
    })
    .refine((value) => value.status !== 'INACTIVE' || value.reason !== undefined, {
      path: ['reason'],
      message: 'Desactivar una cuenta exige un motivo.',
    }),
});

export type AccountSetStatusV1 = z.infer<typeof accountSetStatusV1.schema>;
