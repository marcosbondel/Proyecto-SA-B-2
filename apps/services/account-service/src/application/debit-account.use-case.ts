import { accountCommissionChargedV1, accountDebitRejectedV1, accountDebitedV1 } from '@bank/contracts';
import type { AccountDebitRequestedV1, FailureCode } from '@bank/contracts';

import { DomainRejection, debit } from '../domain/account';
import type { AccountActivity, AccountRepository, Clock, EventPublisher } from './ports';

/**
 * Step 2 of the Saga: take the money out of the source account.
 *
 * The whole of the ticket's balance contract meets here, and the order is what
 * makes it true:
 *
 * 1. **Idempotency first, before the balance is touched.** A redelivery is
 *    answered with the result already recorded. Deciding this after the debit
 *    would move the money twice and then notice.
 * 2. The repository locks the row and runs `debit` against what it actually
 *    found. Not against a copy read a moment earlier — that is the race.
 * 3. Rejection is an **answer**, never an exception that escapes. A thrown
 *    error would be retried by the ladder and dead-lettered, and the Saga would
 *    hang waiting for a verdict that never comes.
 */
export class DebitAccountUseCase {
  readonly #repository: AccountRepository;
  readonly #publisher: EventPublisher;
  readonly #clock: Clock;
  readonly #activity: AccountActivity;

  constructor(dependencies: {
    readonly repository: AccountRepository;
    readonly publisher: EventPublisher;
    readonly clock: Clock;
    readonly activity: AccountActivity;
  }) {
    this.#repository = dependencies.repository;
    this.#publisher = dependencies.publisher;
    this.#clock = dependencies.clock;
    this.#activity = dependencies.activity;
  }

  public async execute(payload: AccountDebitRequestedV1, idempotencyKey: string): Promise<void> {
    const seen = await this.#repository.findProcessed(idempotencyKey, 'account.debit.requested.v1');

    if (seen !== null) {
      await this.#republish(payload, seen.resultSummary);

      return;
    }

    const now = this.#clock.now();

    try {
      const applied = await this.#repository.applyMovement({
        accountId: payload.accountId,
        type: 'DEBIT',
        transactionId: payload.transactionId,
        idempotencyKey,
        messageType: 'account.debit.requested.v1',
        decide: (account) => debit(account, payload.amount, now),
        now,
      });

      if (applied === null) {
        await this.#reject(payload, 'ACCOUNT_NOT_FOUND', idempotencyKey);

        return;
      }

      await this.#publisher.publish({
        messageType: accountDebitedV1.name,
        payload: {
          transactionId: payload.transactionId,
          accountId: payload.accountId,
          amount: applied.operation.amount,
          balanceAfter: applied.operation.balanceAfter,
          debitedAt: applied.operation.occurredAt.toISOString(),
        },
      });

      // Published only when the account's type charges one (T-27) — never a
      // zero-amount event, since `commission` is `null` and not a zero.
      if (applied.commission !== null) {
        await this.#publisher.publish({
          messageType: accountCommissionChargedV1.name,
          payload: {
            accountId: payload.accountId,
            transactionId: payload.transactionId,
            amount: applied.commission.amount,
            balanceAfter: applied.commission.balanceAfter,
            chargedAt: applied.commission.occurredAt.toISOString(),
          },
        });
      }

      // After the movement has committed and been announced — never inside the
      // row lock — and it cannot throw (T-42).
      await this.#activity.afterMovement({
        account: applied.account,
        type: 'DEBIT',
        transactionId: payload.transactionId,
      });
    } catch (error) {
      if (!(error instanceof DomainRejection)) {
        throw error;
      }

      await this.#reject(payload, error.code, idempotencyKey);
    }
  }

  async #reject(
    payload: AccountDebitRequestedV1,
    reason: FailureCode,
    idempotencyKey: string,
  ): Promise<void> {
    const permitted = accountDebitRejectedV1.schema.shape.reason.safeParse(reason);

    await this.#repository.recordProcessed({
      idempotencyKey,
      messageType: 'account.debit.requested.v1',
      resultSummary: {
        outcome: 'REJECTED',
        reason: permitted.success ? reason : 'ACCOUNT_NOT_FOUND',
      },
    });

    await this.#publisher.publish({
      messageType: accountDebitRejectedV1.name,
      payload: {
        transactionId: payload.transactionId,
        accountId: payload.accountId,
        /**
         * The catalogue lists four reasons a debit may be refused. A code
         * outside that set would fail the publisher's own contract check and
         * leave the Saga with no verdict at all, so it is narrowed to the
         * nearest listed one rather than dropped.
         */
        reason: permitted.success ? reason : 'ACCOUNT_NOT_FOUND',
      },
    });
  }

  /**
   * The second delivery of the same intention gets the same answer.
   *
   * Not silence: the Saga may be waiting because the first reply was lost, and
   * a duplicate that answers nothing is indistinguishable from one that was
   * never processed. Re-publishing is safe — the transaction service
   * deduplicates on `transactionId` — while doing nothing is not.
   */
  async #republish(
    payload: AccountDebitRequestedV1,
    summary: Record<string, unknown>,
  ): Promise<void> {
    if (summary.outcome === 'REJECTED') {
      await this.#publisher.publish({
        messageType: accountDebitRejectedV1.name,
        payload: {
          transactionId: payload.transactionId,
          accountId: payload.accountId,
          reason: summary.reason,
        },
      });

      return;
    }

    await this.#publisher.publish({
      messageType: accountDebitedV1.name,
      payload: {
        transactionId: payload.transactionId,
        accountId: payload.accountId,
        amount: summary.amount,
        balanceAfter: summary.balanceAfter,
        debitedAt: summary.occurredAt,
      },
    });

    const commission = summary.commission as
      | { readonly amount: unknown; readonly balanceAfter: unknown }
      | null
      | undefined;

    if (commission != null) {
      await this.#publisher.publish({
        messageType: accountCommissionChargedV1.name,
        payload: {
          accountId: payload.accountId,
          transactionId: payload.transactionId,
          amount: commission.amount,
          balanceAfter: commission.balanceAfter,
          chargedAt: summary.occurredAt,
        },
      });
    }
  }
}
