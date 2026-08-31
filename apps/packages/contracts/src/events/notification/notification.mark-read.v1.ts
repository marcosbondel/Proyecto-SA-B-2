import { z } from 'zod';

import { uuidV4 } from '../../schemas/primitives';
import { defineContract } from '../contract';

import { MAX_INBOX_ROWS } from './notification.inbox.query.v1';

/**
 * Mark your own notifications as read.
 *
 * The first write this service accepts from outside a flow, and the reason
 * `N-01` needed a new message rather than a query: nothing anywhere recorded
 * that somebody had read something (TD-041).
 *
 * `notificationIds` absent means **all of them**, which is the prototype's
 * "marcar todas como leídas" and by far the common case. Naming ids is for the
 * one a person actually opened.
 *
 * The scope is the envelope's identity. An id belonging to somebody else
 * matches no row and changes nothing — a no-op rather than a refusal, because a
 * refusal would confirm that the id exists.
 */
export const notificationMarkReadV1 = defineContract({
  name: 'notification.mark-read.v1',
  category: 'command',
  producer: 'gateway',
  consumers: ['notification-audit-service'],
  schema: z.object({
    notificationIds: z.array(uuidV4).min(1).max(MAX_INBOX_ROWS).optional(),
  }),
});

export type NotificationMarkReadV1 = z.infer<typeof notificationMarkReadV1.schema>;
