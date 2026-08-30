import { transactionStatsRepliedV1 } from '@bank/contracts';
import type { Identity } from '@bank/contracts';

import type { EventPublisher, TransactionRepository } from './ports';

/**
 * How the Saga is doing — `D-02`'s middle row.
 *
 * Staff only, zeroes for anybody else, for the reason every other count query
 * here answers that way: the dashboard composes five of them and one refusal
 * should narrow a screen rather than break it.
 *
 * `inFlight` is not scoped to today, and that asymmetry is the point. A
 * transfer stuck in `PAYMENT_PENDING` since yesterday is more alarming than one
 * stuck since this morning — the money has already left an account — and a
 * count that reset at midnight would hide exactly the case worth seeing.
 */
export class GetTransactionStatsUseCase {
  readonly #repository: TransactionRepository;
  readonly #publisher: EventPublisher;

  constructor(dependencies: {
    readonly repository: TransactionRepository;
    readonly publisher: EventPublisher;
  }) {
    this.#repository = dependencies.repository;
    this.#publisher = dependencies.publisher;
  }

  public async execute(identity: Identity | null): Promise<void> {
    const staff = identity !== null && identity.role !== 'CLIENTE';

    const stats = staff
      ? await this.#repository.stats()
      : { today: 0, completedToday: 0, failedToday: 0, compensatedToday: 0, inFlight: 0 };

    await this.#publisher.reply({
      messageType: transactionStatsRepliedV1.name,
      payload: stats,
    });
  }
}
