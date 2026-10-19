import { accountDebitCompensatedV1 } from '@bank/contracts';
import type { AccountDebitCompensationRequestedV1 } from '@bank/contracts';

import { compensate } from '../domain/account';
import type { AccountActivity, AccountRepository, Clock, EventPublisher } from './ports';

/**
 * The Saga's undo: money that left and must come back.
 *
 * **There is no rejection event for a compensation, and that is not an
 * oversight.** The catalogue has none because there is no acceptable outcome
 * other than success: the money has already left the source account, and a
 * refusal here would strand it outside every account in the system. So a
 * compensation is never refused for business reasons — the domain accepts it
 * against an inactive account, and a missing account is the only thing that can
 * stop it, which is a defect and belongs in the dead-letter queue where somebody
 * will look at it.
 *
 * "Exactly once" is criterion 5 and it is the idempotency record that provides
 * it: a redelivery re-announces the same compensation without moving anything.
 *
 * **Reverses the commission too, when the debit charged one.** `decide` is
 * handed `commissionToReverse` by the repository — found from the debit's own
 * `account_operations` row, not carried on this event — so `compensate` folds
 * it into what comes back. Before this, a compensated `AHORRO` transfer
 * returned the transfer amount and kept the fee: the bank cancelled the
 * transfer and still charged for moving money that never moved.
 */
export class CompensateDebitUseCase {
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

  public async execute(
    payload: AccountDebitCompensationRequestedV1,
    idempotencyKey: string,
  ): Promise<void> {
    const messageType = 'account.debit.compensation.requested.v1';
    const seen = await this.#repository.findProcessed(idempotencyKey, messageType);

    if (seen !== null) {
      await this.#publisher.publish({
        messageType: accountDebitCompensatedV1.name,
        payload: {
          transactionId: payload.transactionId,
          accountId: payload.accountId,
          amount: seen.resultSummary.amount,
          balanceAfter: seen.resultSummary.balanceAfter,
          compensatedAt: seen.resultSummary.occurredAt,
        },
      });

      return;
    }

    const now = this.#clock.now();

    const applied = await this.#repository.applyMovement({
      accountId: payload.accountId,
      type: 'COMPENSATION',
      transactionId: payload.transactionId,
      idempotencyKey,
      messageType,
      decide: (account, commissionToReverse) =>
        compensate(account, payload.amount, commissionToReverse, now),
      // Marks the original debit COMPENSATED, so the statement does not read as
      // a debit and an unrelated deposit.
      compensates: { transactionId: payload.transactionId },
      now,
    });

    if (applied === null) {
      throw new Error(
        `Cannot compensate transaction ${payload.transactionId}: account ${payload.accountId} does not exist. ` +
          'The debited money has nowhere to return to; this needs a person.',
      );
    }

    await this.#publisher.publish({
      messageType: accountDebitCompensatedV1.name,
      payload: {
        transactionId: payload.transactionId,
        accountId: payload.accountId,
        amount: applied.operation.amount,
        balanceAfter: applied.operation.balanceAfter,
        compensatedAt: applied.operation.occurredAt.toISOString(),
      },
    });

    await this.#activity.afterMovement({
      account: applied.account,
      type: 'COMPENSATION',
      transactionId: payload.transactionId,
    });
  }
}
