import { z } from 'zod';

import { isoTimestamp } from '../../schemas/primitives';
import { defineContract } from '../contract';

/**
 * The answer to `audit.stats.query.v1`, matched by `correlationId`.
 *
 * `invalidToday` is the number worth having on a screen and the one a trail
 * that only counted successes would hide: a message this service could not
 * parse is recorded `INVALID` rather than parked, precisely so somebody can see
 * that it happened.
 *
 * `lastEventType` is a **message name**, never a payload. It says the system is
 * alive and what it was last doing, and it carries nothing about anyone — which
 * is the rule for this database in general and for a screen left open on a
 * monitor in particular.
 */
export const auditStatsRepliedV1 = defineContract({
  name: 'audit.stats.replied.v1',
  category: 'reply',
  producer: 'notification-audit-service',
  consumers: ['gateway'],
  schema: z.object({
    eventsToday: z.int().nonnegative(),
    invalidToday: z.int().nonnegative(),
    notificationsToday: z.int().nonnegative(),
    lastEventType: z.string().max(120).nullable(),
    lastEventAt: isoTimestamp.nullable(),
    /** §4.1's classification (T-30), counted over today's rows. Additive and optional. */
    infoToday: z.int().nonnegative().optional(),
    warningToday: z.int().nonnegative().optional(),
    errorToday: z.int().nonnegative().optional(),
  }),
});

export type AuditStatsRepliedV1 = z.infer<typeof auditStatsRepliedV1.schema>;
