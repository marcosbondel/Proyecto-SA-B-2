import { z } from 'zod';

import { eventSeverity } from '../../schemas/primitives';
import { defineContract } from '../contract';

export const auditEventsListQueryV1 = defineContract({
  name: 'audit.events.list.query.v1',
  category: 'command',
  producer: 'gateway',
  consumers: ['notification-audit-service'],
  schema: z.object({
    limit: z.coerce.number().int().positive().max(100).optional().default(10),
    page: z.coerce.number().int().positive().optional().default(1),
    /** §4.1's classification (T-30), added additively. Absent means unfiltered. */
    severity: eventSeverity.optional(),
  }),
});

export type AuditEventsListQueryV1 = z.infer<typeof auditEventsListQueryV1.schema>;
