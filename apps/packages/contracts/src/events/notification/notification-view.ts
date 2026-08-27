import { z } from 'zod';

import {
  isoTimestamp,
  notificationChannel,
  notificationStatus,
  uuidV4,
} from '../../schemas/primitives';

/**
 * A notification as somebody outside Notification & Audit Service sees it.
 *
 * Added by T-20 for the notifications console, and deliberately richer than
 * the three fields `audit.query.replied.v1` carries. The two answer different
 * questions and so they are allowed to differ: the audit trail says *what
 * happened in this flow* and stays as lean as that question needs, while this
 * one is the operational list of what the bank told people, which is useless
 * without the recipient and without the reason a delivery is still pending.
 *
 * **The recipient is a simulated address**, because no mail leaves this system
 * (§4.1 — notificaciones simuladas). It is here because a console that lists
 * deliveries without saying who they were for cannot be used to investigate
 * one, and because the route that exposes it is restricted to
 * `ADMINISTRADOR`. It must not travel on any reply a customer can read.
 */
export const notificationView = z.object({
  notificationId: uuidV4,
  /**
   * What the notification is about, named after the event that caused it —
   * `transfer.completed`, `transfer.failed`, `transfer.compensated`. Not a
   * message name: it has no version suffix and nothing routes on it.
   */
  type: z.string().min(1).max(50),
  channel: notificationChannel,
  /** Simulated. Never shown to anyone but staff. */
  recipient: z.string().min(1).max(200).nullable(),
  /** The transaction, account or customer the notification is about. */
  referenceId: uuidV4.nullable(),
  subject: z.string().min(1).max(200),
  status: notificationStatus,
  /** The flow this notification belongs to; how it joins the audit trail. */
  correlationId: uuidV4,
  createdAt: isoTimestamp,
  /** When the simulated adapter finished with it, however it finished. */
  processedAt: isoTimestamp.nullable(),
});

export type NotificationView = z.infer<typeof notificationView>;
