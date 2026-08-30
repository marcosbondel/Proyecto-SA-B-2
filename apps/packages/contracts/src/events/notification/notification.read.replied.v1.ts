import { z } from 'zod';

import { defineContract } from '../contract';

/**
 * The answer to `notification.mark-read.v1`, matched by `correlationId`.
 *
 * It carries the new unread count rather than a bare acknowledgement, because
 * the one thing the screen does next is redraw the badge — and a second query
 * to learn a number the write already knew would be a round trip for nothing.
 *
 * `changed` is how many rows actually moved. Zero is a normal answer: marking
 * an already-read notification read again changes nothing, and so does naming
 * an id that is not yours.
 */
export const notificationReadRepliedV1 = defineContract({
  name: 'notification.read.replied.v1',
  category: 'reply',
  producer: 'notification-audit-service',
  consumers: ['gateway'],
  schema: z.object({
    changed: z.int().nonnegative(),
    unread: z.int().nonnegative(),
  }),
});

export type NotificationReadRepliedV1 = z.infer<typeof notificationReadRepliedV1.schema>;
