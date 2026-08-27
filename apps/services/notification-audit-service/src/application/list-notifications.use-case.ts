import { notificationListRepliedV1 } from '@bank/contracts';

import type { AuditRepository, NotificationFilter, ReplyPublisher } from './ports';

/** What the query asks for when it asks for nothing in particular. */
const DEFAULT_LIMIT = 50;

/**
 * "What has the bank told people?" — the operational listing.
 *
 * Separate from the audit trail rather than a filter on it, because the two
 * answer different questions and the difference shows up in what they carry.
 * The trail explains one flow and stays as lean as that needs; this one is read
 * during an incident, so it carries the simulated recipient and the real
 * `PENDING`/`SENT`/`FAILED` status — the fields that let somebody say *which*
 * deliveries did not go out.
 *
 * Bounded, always. `notifications` is append-only and grows for as long as the
 * bank runs; an unbounded listing is a query that works in a demonstration and
 * stops working the week somebody depends on it. What was left out is counted
 * and reported rather than silently dropped.
 */
export class ListNotificationsUseCase {
  readonly #repository: AuditRepository;
  readonly #publisher: ReplyPublisher;

  constructor(dependencies: { repository: AuditRepository; publisher: ReplyPublisher }) {
    this.#repository = dependencies.repository;
    this.#publisher = dependencies.publisher;
  }

  public async execute(filter: NotificationFilter): Promise<void> {
    const page = await this.#repository.listNotifications({
      ...filter,
      limit: filter.limit ?? DEFAULT_LIMIT,
    });

    const payload: unknown = {
      notifications: page.notifications.map((notification) => ({
        notificationId: notification.notificationId,
        type: notification.type,
        channel: notification.channel,
        recipient: notification.recipient,
        referenceId: notification.referenceId,
        subject: notification.subject,
        status: notification.status,
        correlationId: notification.correlationId,
        createdAt: notification.createdAt.toISOString(),
        processedAt: notification.processedAt?.toISOString() ?? null,
      })),
      omitted: page.omitted,
    };

    await this.#publisher.reply({
      messageType: notificationListRepliedV1.name,
      payload,
    });
  }
}
