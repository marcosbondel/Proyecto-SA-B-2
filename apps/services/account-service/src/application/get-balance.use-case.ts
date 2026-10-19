import { accountBalanceRepliedV1 } from '@bank/contracts';
import type { AccountBalanceQueryV1, Identity } from '@bank/contracts';

import { quetzales } from '../domain/money';
import { mayRead } from './visibility';
import type { AccountRepository, EventPublisher } from './ports';

/**
 * Answers "what is the balance", to whoever asked and to nobody else.
 *
 * An account this identity may not see is answered `NOT_FOUND` rather than
 * "forbidden". The two are different facts and the difference is exactly what a
 * probe is looking for: a distinguishable refusal turns this query into a way
 * to discover which account numbers exist.
 */
export class GetBalanceUseCase {
  readonly #repository: AccountRepository;
  readonly #publisher: EventPublisher;

  constructor(dependencies: {
    readonly repository: AccountRepository;
    readonly publisher: EventPublisher;
  }) {
    this.#repository = dependencies.repository;
    this.#publisher = dependencies.publisher;
  }

  public async execute(payload: AccountBalanceQueryV1, identity: Identity | null): Promise<void> {
    const account = await this.#repository.findById(payload.accountId);

    if (account === null || !mayRead(identity, account)) {
      await this.#publisher.reply({
        messageType: accountBalanceRepliedV1.name,
        payload: { outcome: 'NOT_FOUND', reason: 'ACCOUNT_NOT_FOUND' },
      });

      return;
    }

    await this.#publisher.reply({
      messageType: accountBalanceRepliedV1.name,
      payload: {
        outcome: 'FOUND',
        accountId: account.accountId,
        accountNumber: account.accountNumber,
        balance: quetzales(account.balanceMinor),
        status: account.status,
        lastActivityAt: account.lastActivityAt?.toISOString() ?? null,
      },
    });
  }
}
