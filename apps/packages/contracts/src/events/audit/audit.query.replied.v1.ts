import { z } from 'zod';

import {
  auditProcessingStatus,
  eventSeverity,
  isoTimestamp,
  messageTypeName,
  notificationChannel,
  producer,
  uuidV4,
} from '../../schemas/primitives';
import { defineContract } from '../contract';

/**
 * The audit trail of a flow, in order.
 *
 * Returns **metadata and a redacted payload**, never the payload as it was
 * published. The trail exists to answer "what happened and when"; echoing every
 * payload back verbatim would recreate, in one reply, the personal and
 * financial data that the per-service databases exist to keep apart.
 *
 * T-05 defined this reply with metadata only, and T-20 added the two optional
 * fields below. Both are additive — a reply that omits them validates exactly
 * as before — and both exist for a named acceptance criterion. Recorded as
 * TD-039.
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
        /**
         * How this service fared with the message, so that criterion 3 —
         * "a payload inválido queda marcado `INVALID`/`ERROR`" — is something
         * a reader can see rather than something a log file knows.
         *
         * Optional because T-05 closed this reply without it.
         */
        processingStatus: auditProcessingStatus.optional(),
        /** §4.1's classification (T-30). Absent for a row recorded before it existed. */
        severity: eventSeverity.optional(),
        /**
         * The published payload with its sensitive fields removed.
         *
         * The prototype's screen N-03 shows a payload, T-20 asks for one, and
         * the privacy rule above forbids the real thing — so what travels is
         * the redaction, computed by the service that owns the record and
         * never by the consumer. `redactPayload` in the service's domain is the
         * single implementation; a reply that carried the raw payload and left
         * the hiding to a browser would be a leak with a stylesheet over it.
         *
         * Absent when there is nothing left to show after redaction.
         */
        payload: z.record(z.string(), z.unknown()).optional(),
      }),
    ),
    notifications: z.array(
      z.object({
        channel: notificationChannel,
        subject: z.string().min(1).max(200),
        sentAt: isoTimestamp.nullable(),
      }),
    ),
  }),
});

export type AuditQueryRepliedV1 = z.infer<typeof auditQueryRepliedV1.schema>;
