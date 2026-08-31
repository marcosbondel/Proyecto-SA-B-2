import { z } from 'zod';

import { isoTimestamp, uuidV4 } from '../../schemas/primitives';
import { defineContract } from '../contract';

/**
 * One notification as its own recipient sees it.
 *
 * **No `recipient` field**, and that is the whole reason this is a separate
 * shape from `notificationView`. That one carries the simulated address of
 * every delivery in the system and exists for a console restricted to
 * `ADMINISTRADOR`; this one is read by the person the notification is about,
 * who does not need to be told their own address and must not be handed a field
 * that would carry somebody else's if a scope were ever wrong.
 *
 * No `status` either. "PENDING" and "FAILED" are facts about the bank's mail
 * plumbing; the customer is reading the notification right now, so its delivery
 * status is not a thing they can act on. It stays on the staff console, where
 * somebody can.
 */
const inboxRow = z.object({
  notificationId: uuidV4,
  /** Named after the event that caused it. No version suffix; nothing routes on it. */
  type: z.string().min(1).max(50),
  subject: z.string().min(1).max(200),
  /** The transaction, account or customer this is about — where the screen links. */
  referenceId: uuidV4.nullable(),
  correlationId: uuidV4,
  createdAt: isoTimestamp,
  /** When the person read it, or `null` while it is still unread. */
  readAt: isoTimestamp.nullable(),
});

/**
 * The answer to `notification.inbox.query.v1`, matched by `correlationId`.
 *
 * `unread` is counted over the **whole** inbox rather than over the page, so a
 * badge does not shrink when somebody scrolls.
 */
export const notificationInboxRepliedV1 = defineContract({
  name: 'notification.inbox.replied.v1',
  category: 'reply',
  producer: 'notification-audit-service',
  consumers: ['gateway'],
  schema: z.object({
    notifications: z.array(inboxRow),
    unread: z.int().nonnegative(),
  }),
});

export type NotificationInboxRepliedV1 = z.infer<typeof notificationInboxRepliedV1.schema>;
