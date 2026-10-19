import {
  accountDepositRejectedV1,
  accountDepositedV1,
  accountReactivatedV1,
} from '@bank/contracts';
import type { AccountDepositV1, FailureCode, Identity } from '@bank/contracts';

import { DomainRejection, credit } from '../domain/account';
import type { AccountActivity, AccountRepository, Clock, EventPublisher } from './ports';

const MESSAGE_TYPE = 'account.deposit.v1';

/**
 * `A-05` — cash taken at a window, put into an account.
 *
 * It is a `CREDIT` movement and reuses the Saga's own credit rule, so a deposit
 * and the arriving half of a transfer are the same thing to the ledger. That is
 * the point: a second way to add money would be a second place for the
 * precision rule, the balance arithmetic and the reactivation invariant to
 * live, and the copies would drift.
 *
 * What differs is everything around it. There is **no `transactionId`** —
 * nothing is being orchestrated, so the movement carries `null` and its
 * deduplication rests on the `(idempotency_key, type)` constraint alone. And
 * there is no `ACCOUNT_INACTIVE` refusal: a deposit into a dormant account is
 * the one thing that should still work, and it wakes the account up (A-3).
 *
 * Staff only. The check is here rather than only at the Gateway because this
 * command mints money into an account from outside the system, and the one
 * place that must be sure who asked is the service that moves the balance.
 */
export class DepositUseCase {
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
    payload: AccountDepositV1,
    identity: Identity | null,
    idempotencyKey: string,
  ): Promise<void> {
    const seen = await this.#repository.findProcessed(idempotencyKey, MESSAGE_TYPE);

    if (seen !== null) {
      await this.#republish(payload, seen.resultSummary);
      return;
    }

    if (identity === null || identity.role === 'CLIENTE') {
      await this.#reject(payload, 'FORBIDDEN_ACCOUNT_ACCESS', idempotencyKey);
      return;
    }

    const now = this.#clock.now();

    try {
      const applied = await this.#repository.applyMovement({
        accountId: payload.accountId,
        type: 'CREDIT',
        // No Saga, no transaction to belong to. The `(idempotency_key, type)`
        // constraint is what makes a redelivery harmless here.
        transactionId: null,
        idempotencyKey,
        messageType: MESSAGE_TYPE,
        decide: (account) => credit(account, payload.amount, now),
        now,
      });

      if (applied === null) {
        await this.#reject(payload, 'ACCOUNT_NOT_FOUND', idempotencyKey);
        return;
      }

      await this.#publisher.publish({
        messageType: accountDepositedV1.name,
        payload: {
          depositId: payload.depositId,
          accountId: payload.accountId,
          operationId: applied.operation.operationId,
          amount: applied.operation.amount,
          balanceAfter: applied.operation.balanceAfter,
          reactivated: applied.reactivated,
          occurredAt: applied.operation.occurredAt.toISOString(),
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

      // A deposit enters the account as a credit, so it counts like one (T-42).
      await this.#activity.afterMovement({
        account: applied.account,
        type: 'CREDIT',
        transactionId: null,
      });
    } catch (error) {
      if (!(error instanceof DomainRejection)) {
        throw error;
      }

      await this.#reject(payload, error.code, idempotencyKey);
    }
  }

  async #reject(
    payload: AccountDepositV1,
    reason: FailureCode,
    idempotencyKey: string,
  ): Promise<void> {
    const permitted = accountDepositRejectedV1.schema.shape.reason.safeParse(reason);
    const narrowed = permitted.success ? reason : 'ACCOUNT_NOT_FOUND';

    await this.#repository.recordProcessed({
      idempotencyKey,
      messageType: MESSAGE_TYPE,
      resultSummary: { outcome: 'REJECTED', reason: narrowed },
    });

    await this.#publisher.publish({
      messageType: accountDepositRejectedV1.name,
      payload: {
        depositId: payload.depositId,
        reason: narrowed,
        occurredAt: this.#clock.now().toISOString(),
      },
    });
  }

  /**
   * Repeats the first answer for a redelivered command.
   *
   * A teller is holding an HTTP connection open on the other side of this, so
   * silence would cost them a five-second timeout for a deposit that already
   * landed — and, worse, invite them to take the money again.
   */
  async #republish(payload: AccountDepositV1, summary: Record<string, unknown>): Promise<void> {
    if (summary.outcome === 'REJECTED') {
      await this.#publisher.publish({
        messageType: accountDepositRejectedV1.name,
        payload: {
          depositId: payload.depositId,
          reason: summary.reason,
          occurredAt: this.#clock.now().toISOString(),
        },
      });

      return;
    }

    await this.#publisher.publish({
      messageType: accountDepositedV1.name,
      payload: {
        depositId: payload.depositId,
        accountId: payload.accountId,
        operationId: summary.operationId,
        amount: summary.amount,
        balanceAfter: summary.balanceAfter,
        reactivated: summary.reactivated,
        occurredAt: summary.occurredAt,
      },
    });
  }
}
