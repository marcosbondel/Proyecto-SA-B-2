import { z } from 'zod';

import { defineContract } from '../contract';

/** How much the trail recorded today. Administrator only. */
export const auditStatsQueryV1 = defineContract({
  name: 'audit.stats.query.v1',
  category: 'command',
  producer: 'gateway',
  consumers: ['notification-audit-service'],
  schema: z.object({}),
});

export type AuditStatsQueryV1 = z.infer<typeof auditStatsQueryV1.schema>;
