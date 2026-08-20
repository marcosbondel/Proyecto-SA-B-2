import { z } from 'zod';

import { uuidV4 } from '../../schemas/primitives';
import { defineContract } from '../contract';

/**
 * Ask for the audit trail of one flow.
 *
 * Keyed by `correlationId` because that is the only identifier shared by every
 * message of a flow — the thing that makes the trail a trail rather than a pile
 * of unrelated records.
 */
export const auditQueryRequestedV1 = defineContract({
  name: 'audit.query.requested.v1',
  category: 'command',
  producer: 'gateway',
  consumers: ['notification-audit-service'],
  schema: z.object({
    correlationId: uuidV4,
  }),
});

export type AuditQueryRequestedV1 = z.infer<typeof auditQueryRequestedV1.schema>;
