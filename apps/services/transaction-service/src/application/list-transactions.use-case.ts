import { MAX_TRANSACTION_ROWS, transactionListRepliedV1 } from '@bank/contracts';
import type { Identity, TransactionListQueryV1 } from '@bank/contracts';

import type { Transaction } from '../domain/transaction';
import type { EventPublisher, TransactionRepository } from './ports';

/** What a screen gets when it does not say. Enough to fill a page, not a table dump. */
const DEFAULT_LIMIT = 25;

/**
 * "Which transfers are mine" — the query that closes TD-033.
 *
 * The whole of it is one decision, and the decision is **where the scope comes
 * from**. `ownerId` is taken from the envelope's verified identity and passed to
 * the repository as a scope, never as a filter the caller may set: a `CLIENTE`
 * sees the transfers they asked for, staff see everything, and a client naming
 * somebody else's `customerId` in the query ends up with two contradictory
 * conditions and an empty list rather than a widened one.
 *
 * An empty list rather than a refusal, deliberately. A `403` for a `customerId`
 * that exists and a `200` with nothing for one that does not would together
 * answer "does this customer bank here", which is the enumeration every listing
 * in this system avoids the same way.
 *
 * Not idempotency-guarded: a query changes nothing, and a redelivery must
 * produce a fresh reply rather than a silence that leaves the Gateway waiting
 * out its five seconds.
 */
export class ListTransactionsUseCase {
  readonly #repository: TransactionRepository;
  readonly #publisher: EventPublisher;

  constructor(dependencies: {
    readonly repository: TransactionRepository;
    readonly publisher: EventPublisher;
  }) {
    this.#repository = dependencies.repository;
    this.#publisher = dependencies.publisher;
  }

  public async execute(query: TransactionListQueryV1, identity: Identity | null): Promise<void> {
    /**
     * Nobody in the envelope is not "everybody": it is an unauthenticated
     * message on the command exchange, and the safe reading of that is an
     * empty answer rather than the whole table.
     */
    if (identity === null) {
      await this.#reply([], 0);
      return;
    }

    const found = await this.#repository.list({
      ownerId: identity.role === 'CLIENTE' ? identity.customerId : null,
      ...(query.customerId === undefined ? {} : { customerId: query.customerId }),
      ...(query.accountId === undefined ? {} : { accountId: query.accountId }),
      ...(query.status === undefined ? {} : { status: query.status }),
      limit: Math.min(query.limit ?? DEFAULT_LIMIT, MAX_TRANSACTION_ROWS),
    });

    await this.#reply(found.transactions, found.total);
  }

  async #reply(transactions: readonly Transaction[], total: number): Promise<void> {
    await this.#publisher.reply({
      messageType: transactionListRepliedV1.name,
      payload: {
        transactions: transactions.map((transaction) => ({
          transactionId: transaction.transactionId,
          sourceAccount: transaction.sourceAccount,
          targetAccount: transaction.targetAccount,
          amount: transaction.amount,
          status: transaction.status,
          reason: transaction.failureReason,
          createdAt: transaction.createdAt.toISOString(),
          completedAt: transaction.completedAt?.toISOString() ?? null,
        })),
        total,
      },
    });
  }
}
