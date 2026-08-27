import { accountCreditRejectedV1, accountCreditedV1, accountReactivatedV1 } from '@bank/contracts';
import type { AccountCreditRequestedV1, FailureCode } from '@bank/contracts';

import { DomainRejection, credit } from '../domain/account';
import type { AccountRepository, Clock, EventPublisher } from './ports';

/**
 * Step 6 of the Saga: put the money into the destination account.
 *
 * Same shape as the debit and for the same reasons, with one addition: a credit
 * to an INACTIVE account **reactivates it** (invariant A-3), and that is
 * narrated separately. Two events for one movement is deliberate — Transaction
 * cares that the credit landed, Notification cares that an account woke up, and
 * folding the second into the first would make "your account was reactivated"
 * a field somebody has to remember to look at.
 */
export class CreditAccountUseCase {
  readonly #repository: AccountRepository;
  readonly #publisher: EventPublisher;
  readonly #clock: Clock;

  constructor(dependencies: {
    readonly repository: AccountRepository;
    readonly publisher: EventPublisher;
    readonly clock: Clock;
  }) {
    this.#repository = dependencies.repository;
    this.#publisher = dependencies.publisher;
    this.#clock = dependencies.clock;
  }

  public async execute(payload: AccountCreditRequestedV1, idempotencyKey: string): Promise<void> {
    const seen = await this.#repository.findProcessed(
      idempotencyKey,
      'account.credit.requested.v1',
    );

    if (seen !== null) {
      await this.#republish(payload, seen.resultSummary);

      return;
    }

    const now = this.#clock.now();

    try {
      const applied = await this.#repository.applyMovement({
        accountId: payload.accountId,
        type: 'CREDIT',
        transactionId: payload.transactionId,
        idempotencyKey,
        messageType: 'account.credit.requested.v1',
        decide: (account) => credit(account, payload.amount, now),
        now,
      });

      if (applied === null) {
        await this.#reject(payload, 'ACCOUNT_NOT_FOUND', idempotencyKey);

        return;
      }

      await this.#publisher.publish({
        messageType: accountCreditedV1.name,
        payload: {
          transactionId: payload.transactionId,
          accountId: payload.accountId,
          amount: applied.operation.amount,
          balanceAfter: applied.operation.balanceAfter,
          reactivated: applied.reactivated,
          creditedAt: applied.operation.occurredAt.toISOString(),
        },
      });

      if (applied.reactivated) {
        await this.#publisher.publish({
          messageType: accountReactivatedV1.name,
          payload: {
            accountId: payload.accountId,
            cause: 'CREDIT_RECEIVED',
            reactivatedAt: applied.operation.occurredAt.toISOString(),
          },
        });
      }
    } catch (error) {
      if (!(error instanceof DomainRejection)) {
        throw error;
      }

      await this.#reject(payload, error.code, idempotencyKey);
    }
  }

  async #reject(
    payload: AccountCreditRequestedV1,
    reason: FailureCode,
    idempotencyKey: string,
  ): Promise<void> {
    const permitted = accountCreditRejectedV1.schema.shape.reason.safeParse(reason);
    const narrowed = permitted.success ? reason : 'ACCOUNT_NOT_FOUND';

    await this.#repository.recordProcessed({
      idempotencyKey,
      messageType: 'account.credit.requested.v1',
      resultSummary: { outcome: 'REJECTED', reason: narrowed },
    });

    await this.#publisher.publish({
      messageType: accountCreditRejectedV1.name,
      payload: {
        transactionId: payload.transactionId,
        accountId: payload.accountId,
        reason: narrowed,
      },
    });
  }

  async #republish(
    payload: AccountCreditRequestedV1,
    summary: Record<string, unknown>,
  ): Promise<void> {
    if (summary.outcome === 'REJECTED') {
      await this.#publisher.publish({
        messageType: accountCreditRejectedV1.name,
        payload: {
          transactionId: payload.transactionId,
          accountId: payload.accountId,
          reason: summary.reason,
        },
      });

      return;
    }

    await this.#publisher.publish({
      messageType: accountCreditedV1.name,
      payload: {
        transactionId: payload.transactionId,
        accountId: payload.accountId,
        amount: summary.amount,
        balanceAfter: summary.balanceAfter,
        reactivated: summary.reactivated,
        creditedAt: summary.occurredAt,
      },
    });
  }
}
