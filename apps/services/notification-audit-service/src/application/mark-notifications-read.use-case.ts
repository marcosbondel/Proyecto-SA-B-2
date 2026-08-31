import { notificationReadRepliedV1 } from '@bank/contracts';
import type { Identity, NotificationMarkReadV1 } from '@bank/contracts';

import type { AuditRepository, Clock, ReplyPublisher } from './ports';

/**
 * "Marcar como leída" — the first write this service accepts from outside a
 * flow, and the reason `N-01` needed a command rather than only a query:
 * nothing anywhere recorded that somebody had read something (TD-041).
 *
 * Absent `notificationIds` means all of them, which is the prototype's "marcar
 * todas como leídas" and by far the common case.
 *
 * **Not idempotency-guarded, and it does not need to be.** Marking a
 * notification read is idempotent by construction: the update matches only rows
 * where `read_at IS NULL`, so a redelivery changes nothing and answers the same
 * unread count. A guard would be a second mechanism for a guarantee the WHERE
 * clause already gives.
 *
 * The reply carries the new unread count rather than a bare acknowledgement,
 * because the one thing the screen does next is redraw the badge — and a second
 * query for a number this write already knew would be a round trip for nothing.
 */
export class MarkNotificationsReadUseCase {
  readonly #repository: AuditRepository;
  readonly #publisher: ReplyPublisher;
  readonly #clock: Clock;

  constructor(dependencies: {
    readonly repository: AuditRepository;
    readonly publisher: ReplyPublisher;
    readonly clock: Clock;
  }) {
    this.#repository = dependencies.repository;
    this.#publisher = dependencies.publisher;
    this.#clock = dependencies.clock;
  }

  public async execute(command: NotificationMarkReadV1, identity: Identity | null): Promise<void> {
    if (identity === null) {
      await this.#reply(0, 0);
      return;
    }

    const changed = await this.#repository.markRead({
      customerId: identity.customerId,
      notificationIds: command.notificationIds ?? null,
      now: this.#clock.now(),
    });

    const unread = await this.#repository.unreadCountOf(identity.customerId);

    await this.#reply(changed, unread);
  }

  async #reply(changed: number, unread: number): Promise<void> {
    await this.#publisher.reply({
      messageType: notificationReadRepliedV1.name,
      payload: { changed, unread },
    });
  }
}
