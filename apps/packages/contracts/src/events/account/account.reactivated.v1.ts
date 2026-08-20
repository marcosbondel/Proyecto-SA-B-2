import { z } from 'zod';

import { isoTimestamp, uuidV4 } from '../../schemas/primitives';
import { defineContract } from '../contract';

/** An account came back. Either a credit arrived (A-3) or an administrator said so. */
export const accountReactivatedV1 = defineContract({
  name: 'account.reactivated.v1',
  category: 'event',
  producer: 'account-service',
  consumers: ['notification-audit-service'],
  schema: z.object({
    accountId: uuidV4,
    cause: z.enum(['CREDIT_RECEIVED', 'ADMINISTRATOR']),
    reactivatedAt: isoTimestamp,
  }),
});

export type AccountReactivatedV1 = z.infer<typeof accountReactivatedV1.schema>;
