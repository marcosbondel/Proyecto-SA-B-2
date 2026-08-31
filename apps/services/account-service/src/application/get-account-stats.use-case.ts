import { accountStatsRepliedV1 } from '@bank/contracts';
import type { Identity } from '@bank/contracts';

import type { AccountRepository, EventPublisher } from './ports';

/**
 * The counts `D-01` and `D-02` show — how many accounts, and what a shift moved.
 *
 * Staff only, and zeroes rather than a refusal for anybody else: the dashboard
 * composes five of these, and one service saying no should narrow the screen
 * rather than break it.
 *
 * Billers' collection accounts are excluded from every count, for the reason
 * they are excluded from every listing: they are accounts and they are not
 * somebody's account, and counting them would make "cuentas activas" a number
 * that grows when the bank signs a new utility company.
 */
export class GetAccountStatsUseCase {
  readonly #repository: AccountRepository;
  readonly #publisher: EventPublisher;

  constructor(dependencies: {
    readonly repository: AccountRepository;
    readonly publisher: EventPublisher;
  }) {
    this.#repository = dependencies.repository;
    this.#publisher = dependencies.publisher;
  }

  public async execute(identity: Identity | null): Promise<void> {
    const staff = identity !== null && identity.role !== 'CLIENTE';

    const stats = staff
      ? await this.#repository.stats()
      : {
          active: 0,
          inactive: 0,
          openedToday: 0,
          depositsToday: 0,
          depositedToday: { amountMinor: 0, currency: 'GTQ' },
        };

    await this.#publisher.reply({
      messageType: accountStatsRepliedV1.name,
      payload: stats,
    });
  }
}
