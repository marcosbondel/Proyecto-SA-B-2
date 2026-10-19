import { z } from 'zod';

import { eventSeverity, isoTimestamp, traceId, uuidV4 } from '../../schemas/primitives';
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
        /** T-45. Absent when no SDK recorded a trace for the event. */
        traceId: traceId.optional(),
        causationId: uuidV4.optional(),
        processingStatus: z.string(),
        consumer: z.string(),
        payload: z.record(z.string(), z.unknown()),
        /** §4.1's classification (T-30). Absent for a row recorded before it existed. */
        severity: eventSeverity.optional(),
      }),
    ),
    total: z.number().int().nonnegative(),
    page: z.number().int().positive(),
    limit: z.number().int().positive(),
  }),
});

export type AuditEventsListRepliedV1 = z.infer<typeof auditEventsListRepliedV1.schema>;
