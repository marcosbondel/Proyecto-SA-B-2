import { z } from 'zod';

import { defineContract } from '../contract';

/** How many notifications one inbox screen may ask for at once. */
export const MAX_INBOX_ROWS = 100;

/**
 * Ask for **your own** notifications — the query that closes TD-041.
 *
 * Deliberately different from `notification.list.query.v1`, which is the staff
 * console and answers "what has the bank been sending". This one answers "what
 * has the bank told me", and the difference is not the filter: the console
 * carries the simulated recipient of every delivery in the system and is
 * restricted to `ADMINISTRADOR` for exactly that reason. Making one query serve
 * both would mean one reply shape carrying a field a customer must never see.
 *
 * **There is no `customerId` field.** The scope is the envelope's identity and
 * nothing else, so the query cannot be pointed at somebody else's inbox by
 * asking — which is the failure mode a filter would have introduced.
 */
export const notificationInboxQueryV1 = defineContract({
  name: 'notification.inbox.query.v1',
  category: 'command',
  producer: 'gateway',
  consumers: ['notification-audit-service'],
  schema: z.object({
    limit: z.int().positive().max(MAX_INBOX_ROWS).optional(),
  }),
});

export type NotificationInboxQueryV1 = z.infer<typeof notificationInboxQueryV1.schema>;
