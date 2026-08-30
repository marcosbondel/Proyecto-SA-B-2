import { paymentStatsRepliedV1 } from '@bank/contracts';
import type { Identity } from '@bank/contracts';

import type { EventPublisher, PaymentRepository } from './ports';

/**
 * How the provider is doing today — `D-02`'s payment tile.
 *
 * Staff only, zeroes for anybody else, like every other count query.
 *
 * `retrying` is the number that makes the retry ladder visible from outside
 * this service: payments that have failed at least once and are still due
 * another attempt. `failedToday` is history; `retrying` is a thing that is
 * happening, and it is the only figure here somebody can act on.
 */
export class GetPaymentStatsUseCase {
  readonly #repository: PaymentRepository;
  readonly #publisher: EventPublisher;

  constructor(dependencies: {
    readonly repository: PaymentRepository;
    readonly publisher: EventPublisher;
  }) {
    this.#repository = dependencies.repository;
    this.#publisher = dependencies.publisher;
  }

  public async execute(identity: Identity | null): Promise<void> {
    const staff = identity !== null && identity.role !== 'CLIENTE';

    const stats = staff
      ? await this.#repository.stats()
      : { today: 0, succeededToday: 0, failedToday: 0, retrying: 0 };

    await this.#publisher.reply({
      messageType: paymentStatsRepliedV1.name,
      payload: stats,
    });
  }
}
