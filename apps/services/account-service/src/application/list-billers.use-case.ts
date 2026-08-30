import { accountBillersRepliedV1 } from '@bank/contracts';

import type { AccountRepository, EventPublisher } from './ports';

/**
 * The biller catalogue — `G-01`'s dropdown.
 *
 * Unscoped, and that is the decision rather than an oversight: the list of
 * services a bank collects for is the same for everybody and is on its
 * marketing material. What is *not* here is any balance — what a biller has
 * collected is none of a paying customer's business, and this reply is read by
 * the screen that lets anyone pay one.
 *
 * Not idempotency-guarded: a query changes nothing, and a redelivery must
 * produce a fresh reply rather than a silence that leaves the Gateway waiting.
 */
export class ListBillersUseCase {
  readonly #repository: AccountRepository;
  readonly #publisher: EventPublisher;

  constructor(dependencies: {
    readonly repository: AccountRepository;
    readonly publisher: EventPublisher;
  }) {
    this.#repository = dependencies.repository;
    this.#publisher = dependencies.publisher;
  }

  public async execute(): Promise<void> {
    const billers = await this.#repository.listBillers();

    await this.#publisher.reply({
      messageType: accountBillersRepliedV1.name,
      payload: { billers },
    });
  }
}
