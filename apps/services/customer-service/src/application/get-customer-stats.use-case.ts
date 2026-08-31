import { customerStatsRepliedV1 } from '@bank/contracts';
import type { Identity } from '@bank/contracts';

import { mayValidateIdentity } from '../domain/customer';
import type { CustomerRepository, EventPublisher } from './ports';

/**
 * The counts `D-02` shows — how many customers, and in what state.
 *
 * Staff only. The numbers say nothing about any individual, but "how many
 * customers does this bank have" is not a figure a customer is owed either, and
 * a dashboard is precisely the screen somebody leaves open on a monitor.
 *
 * A refusal is **zeroes rather than an error**. The dashboard composes five of
 * these, and one service saying no should narrow the screen instead of breaking
 * it — a `D-02` that fails entirely because Payment Service is restarting is
 * worse than one with a blank tile.
 */
export class GetCustomerStatsUseCase {
  readonly #repository: CustomerRepository;
  readonly #publisher: EventPublisher;

  constructor(dependencies: {
    readonly repository: CustomerRepository;
    readonly publisher: EventPublisher;
  }) {
    this.#repository = dependencies.repository;
    this.#publisher = dependencies.publisher;
  }

  public async execute(identity: Identity | null): Promise<void> {
    const stats = mayValidateIdentity(identity)
      ? await this.#repository.stats()
      : { registered: 0, pendingValidation: 0, activatedToday: 0 };

    await this.#publisher.reply({
      messageType: customerStatsRepliedV1.name,
      payload: stats,
    });
  }
}
