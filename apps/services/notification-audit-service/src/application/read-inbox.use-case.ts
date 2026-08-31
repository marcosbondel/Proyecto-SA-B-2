import { MAX_INBOX_ROWS, notificationInboxRepliedV1 } from '@bank/contracts';
import type { Identity, NotificationInboxQueryV1 } from '@bank/contracts';

import type { AuditRepository, ReplyPublisher } from './ports';

/** Enough to fill the screen without being a table dump. */
const DEFAULT_LIMIT = 30;

/**
 * `N-01` — a customer's own notifications.
 *
 * The whole of it is one property: **the scope is the envelope and nothing
 * else**. The query carries no `customerId` field to point somewhere else, and
 * an envelope with no identity gets an empty inbox rather than everybody's —
 * "nobody" is not "everybody", and this is the one table in the bank that hears
 * every event.
 *
 * It is a different query from the staff console over the same table, and the
 * difference is not the filter: the console carries the simulated recipient of
 * every delivery in the system and is restricted to `ADMINISTRADOR` for exactly
 * that reason. One query serving both would mean one reply shape carrying a
 * field a customer must never see.
 */
export class ReadInboxUseCase {
  readonly #repository: AuditRepository;
  readonly #publisher: ReplyPublisher;

  constructor(dependencies: {
    readonly repository: AuditRepository;
    readonly publisher: ReplyPublisher;
  }) {
    this.#repository = dependencies.repository;
    this.#publisher = dependencies.publisher;
  }

  public async execute(query: NotificationInboxQueryV1, identity: Identity | null): Promise<void> {
    if (identity === null) {
      await this.#reply({ notifications: [], unread: 0 });
      return;
    }

    const found = await this.#repository.inboxOf({
      customerId: identity.customerId,
      limit: Math.min(query.limit ?? DEFAULT_LIMIT, MAX_INBOX_ROWS),
    });

    await this.#reply(found);
  }

  async #reply(payload: {
    readonly notifications: readonly unknown[];
    readonly unread: number;
  }): Promise<void> {
    await this.#publisher.reply({
      messageType: notificationInboxRepliedV1.name,
      payload,
    });
  }
}
