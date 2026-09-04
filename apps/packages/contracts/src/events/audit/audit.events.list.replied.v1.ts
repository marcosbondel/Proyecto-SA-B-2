import { z } from 'zod';

import { isoTimestamp, uuidV4 } from '../../schemas/primitives';
import { defineContract } from '../contract';

export const auditEventsListRepliedV1 = defineContract({
  name: 'audit.events.list.replied.v1',
  category: 'reply',
  producer: 'notification-audit-service',
  consumers: ['gateway'],
  schema: z.object({
    events: z.array(
      z.object({
        eventId: uuidV4,
        messageType: z.string(),
        producer: z.string(),
        occurredAt: isoTimestamp,
        correlationId: uuidV4,
        processingStatus: z.string(),
        consumer: z.string(),
        payload: z.record(z.string(), z.unknown()),
      }),
    ),
    total: z.number().int().nonnegative(),
    page: z.number().int().positive(),
    limit: z.number().int().positive(),
  }),
});

export type AuditEventsListRepliedV1 = z.infer<typeof auditEventsListRepliedV1.schema>;
