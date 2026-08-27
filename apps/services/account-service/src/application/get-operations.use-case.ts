import { accountOperationsRepliedV1 } from '@bank/contracts';
import type { AccountOperationsQueryV1, Identity } from '@bank/contracts';

import { mayRead } from './visibility';
import type { AccountRepository, EventPublisher } from './ports';

/**
 * The movements of one account, for whoever may read that account.
 *
 * The permission is checked against the **account**, not against each movement:
 * a statement is read as a whole, and a partially-filtered one would show a
 * running balance that does not add up.
 */
export class GetOperationsUseCase {
  readonly #repository: AccountRepository;
  readonly #publisher: EventPublisher;

  constructor(dependencies: {
    readonly repository: AccountRepository;
    readonly publisher: EventPublisher;
  }) {
    this.#repository = dependencies.repository;
    this.#publisher = dependencies.publisher;
  }

  public async execute(
    payload: AccountOperationsQueryV1,
    identity: Identity | null,
  ): Promise<void> {
    const account = await this.#repository.findById(payload.accountId);

    if (account === null || !mayRead(identity, account)) {
      await this.#publisher.reply({
        messageType: accountOperationsRepliedV1.name,
        payload: { outcome: 'NOT_FOUND', reason: 'ACCOUNT_NOT_FOUND' },
      });

      return;
    }

    const operations = await this.#repository.operationsOf(account.accountId);

    await this.#publisher.reply({
      messageType: accountOperationsRepliedV1.name,
      payload: {
        outcome: 'FOUND',
        accountId: account.accountId,
        operations: operations.map((operation) => ({
          operationId: operation.operationId,
          type: operation.type,
          amount: operation.amount,
          balanceAfter: operation.balanceAfter,
          transactionId: operation.transactionId,
          status: operation.status,
          occurredAt: operation.occurredAt.toISOString(),
        })),
      },
    });
  }
}
