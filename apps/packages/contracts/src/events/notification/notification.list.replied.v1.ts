import { z } from 'zod';

import { defineContract } from '../contract';
import { notificationView } from './notification-view';

/**
 * The answer to `notification.list.query.v1`, matched by `correlationId`.
 *
 * Newest first, and the ordering is part of the contract rather than left to
 * the caller: this list is read while something is going wrong, and "what did
 * we just send" is the question being asked. A screen that had to sort a
 * truncated page would show the wrong rows.
 *
 * No `NOT_FOUND` outcome, for the reason `account.list.replied.v1` gives: an
 * empty list is the whole answer, and it must mean the same thing whether
 * nothing matched or nothing exists.
 */
export const notificationListRepliedV1 = defineContract({
  name: 'notification.list.replied.v1',
  category: 'reply',
  producer: 'notification-audit-service',
  consumers: ['gateway'],
  schema: z.object({
    /** Most recently created first. */
    notifications: z.array(notificationView),
    /**
     * How many rows exist beyond the ones returned, so a console can say "200
     * of 4,318" instead of implying it is showing everything. `0` when the
     * page is the whole answer.
     */
    omitted: z.int().nonnegative(),
  }),
});

export type NotificationListRepliedV1 = z.infer<typeof notificationListRepliedV1.schema>;
