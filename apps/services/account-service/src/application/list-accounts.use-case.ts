import { accountListRepliedV1 } from '@bank/contracts';
import type { AccountListQueryV1, Identity } from '@bank/contracts';

import { quetzales } from '../domain/money';
import { visibleFilter } from './visibility';
import type { AccountRepository, EventPublisher } from './ports';

/**
 * Lists the accounts this identity may see, and only those.
 *
 * The filters the caller sent are a request, not a permission. They are
 * intersected with D-06 before they reach SQL, so a `CLIENTE` asking for
 * somebody else's `customerId` gets an empty array — the same answer they would
 * get if that customer had no accounts, which is the point.
 */
export class ListAccountsUseCase {
  readonly #repository: AccountRepository;
  readonly #publisher: EventPublisher;

  constructor(dependencies: {
    readonly repository: AccountRepository;
    readonly publisher: EventPublisher;
  }) {
    this.#repository = dependencies.repository;
    this.#publisher = dependencies.publisher;
  }

  public async execute(payload: AccountListQueryV1, identity: Identity | null): Promise<void> {
    const filter = visibleFilter(identity, payload);

    const accounts = filter === null ? [] : await this.#repository.list(filter);

    await this.#publisher.reply({
      messageType: accountListRepliedV1.name,
      payload: {
        accounts: accounts.map((account) => ({
          accountId: account.accountId,
          accountNumber: account.accountNumber,
          customerId: account.customerId,
          accountType: account.accountType,
          balance: quetzales(account.balanceMinor),
          status: account.status,
          lastActivityAt: account.lastActivityAt?.toISOString() ?? null,
          openedAt: account.openedAt.toISOString(),
        })),
      },
    });
  }
}
