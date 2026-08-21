import { z } from 'zod';

import { isoTimestamp, messageTypeName, producer, uuidV4 } from '../../schemas/primitives';
import { defineContract } from '../contract';

/**
 * The audit trail of a flow, in order.
 *
 * Returns **metadata, not payloads**. The trail exists to answer "what happened
 * and when", and echoing every payload back would recreate, in one reply, the
 * personal and financial data that the per-service databases exist to keep
 * apart.
 */
export const auditQueryRepliedV1 = defineContract({
  name: 'audit.query.replied.v1',
  category: 'reply',
  producer: 'notification-audit-service',
  consumers: ['gateway'],
  schema: z.object({
    correlationId: uuidV4,
    events: z.array(
      z.object({
        messageId: uuidV4,
        messageType: messageTypeName,
        producer,
        causationId: uuidV4.nullable(),
        occurredAt: isoTimestamp,
      }),
    ),
    notifications: z.array(
      z.object({
        channel: z.enum(['EMAIL']),
        subject: z.string().min(1).max(200),
        sentAt: isoTimestamp.nullable(),
      }),
    ),
  }),
});

export type AuditQueryRepliedV1 = z.infer<typeof auditQueryRepliedV1.schema>;
