import { z } from 'zod';

import { notificationStatus, uuidV4 } from '../../schemas/primitives';
import { defineContract } from '../contract';

/**
 * "What has the bank told people?" — asked by the Gateway, answered by the
 * service that sent it.
 *
 * Added by T-20 for the notifications console, which the Claude Design
 * prototype draws as `N-01`. The prototype's version is a customer's own inbox
 * with a read/unread state; this system has neither — no service holds a
 * per-customer notification list, and nothing anywhere records that somebody
 * read something. So the screen that got built is the staff-facing one this
 * query supports, and the difference is recorded as TD-041 rather than
 * papered over with an invented read flag.
 *
 * Every filter is a *request*, not a permission. The restriction that makes
 * this route safe is the Gateway's `@Roles('ADMINISTRADOR')`, for the same
 * reason as `payment.list.query.v1` (TD-037): a notification row holds a
 * simulated recipient and a `correlationId`, and resolving either to the
 * customer who owns it means reading another service's tables (§8.2, 2.3).
 */
export const notificationListQueryV1 = defineContract({
  name: 'notification.list.query.v1',
  category: 'command',
  producer: 'gateway',
  consumers: ['notification-audit-service'],
  schema: z.object({
    /** Narrow to one flow. The only scope this service can compute itself. */
    correlationId: uuidV4.optional(),
    status: notificationStatus.optional(),
    /** An exact `type`, e.g. `transfer.completed`. Not a pattern. */
    type: z.string().min(1).max(50).optional(),
    /**
     * How many rows at most, newest first.
     *
     * Bounded in the contract rather than left to the service, because
     * `notifications` is append-only and grows for as long as the bank runs.
     * An unbounded listing is a query that works in a demonstration and stops
     * working the week somebody depends on it.
     */
    limit: z.int().positive().max(200).optional(),
  }),
});

export type NotificationListQueryV1 = z.infer<typeof notificationListQueryV1.schema>;
