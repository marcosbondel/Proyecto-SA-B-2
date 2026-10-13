import {
  accountInterbankCreditRejectedV1,
  accountInterbankCreditedV1,
  accountInterbankEligibilityRepliedV1,
} from '@bank/contracts';
import type {
  AccountInterbankCreditRequestedV1,
  AccountInterbankEligibilityQueryV1,
} from '@bank/contracts';

import { creditInterbank, DomainRejection } from '../domain/account';
import type { AccountRepository, Clock, EventPublisher } from './ports';

/** Account Service owns both the eligibility answer and the locked money movement. */
export class InterbankAccountUseCase {
  readonly #repository: AccountRepository;
  readonly #publisher: EventPublisher;
  readonly #clock: Clock;

  constructor(deps: { repository: AccountRepository; publisher: EventPublisher; clock: Clock }) {
    this.#repository = deps.repository;
    this.#publisher = deps.publisher;
    this.#clock = deps.clock;
  }

  async eligibility(query: AccountInterbankEligibilityQueryV1): Promise<void> {
    const account = await this.#repository.findById(query.accountId);
    const reason =
      account === null
        ? 'ACCOUNT_NOT_FOUND'
        : account.status === 'ACTIVE'
          ? null
          : 'ACCOUNT_INACTIVE';
    await this.#publisher.reply({
      messageType: accountInterbankEligibilityRepliedV1.name,
      payload: { ...query, eligible: reason === null, reason },
    });
  }

  async credit(command: AccountInterbankCreditRequestedV1): Promise<void> {
    const messageType = 'account.interbank.credit.requested.v1';
    const seen = await this.#repository.findProcessed(command.depositId, messageType);
    if (seen !== null) {
      await this.#publishOutcome(command, seen.resultSummary);
      return;
    }

    const now = this.#clock.now();
    try {
      const applied = await this.#repository.applyMovement({
        accountId: command.accountId,
        type: 'CREDIT',
        transactionId: null,
        idempotencyKey: command.depositId,
        messageType,
        decide: (account) => creditInterbank(account, command.amount, now),
        now,
      });
      if (applied === null) {
        await this.#reject(command, 'ACCOUNT_NOT_FOUND');
        return;
      }

      await this.#publishOutcome(command, {
        outcome: 'CREDITED',
        creditedAt: applied.operation.occurredAt.toISOString(),
      });
    } catch (error) {
      if (!(error instanceof DomainRejection)) throw error;
      await this.#reject(
        command,
        error.code === 'ACCOUNT_INACTIVE' ? 'ACCOUNT_INACTIVE' : 'INVALID_REQUEST',
      );
    }
  }

  async #reject(
    command: AccountInterbankCreditRequestedV1,
    reason: 'ACCOUNT_NOT_FOUND' | 'ACCOUNT_INACTIVE' | 'INVALID_REQUEST',
  ): Promise<void> {
    await this.#repository.recordProcessed({
      idempotencyKey: command.depositId,
      messageType: 'account.interbank.credit.requested.v1',
      resultSummary: { outcome: 'REJECTED', reason },
    });
    await this.#publishOutcome(command, { outcome: 'REJECTED', reason });
  }

  async #publishOutcome(
    command: AccountInterbankCreditRequestedV1,
    summary: Record<string, unknown>,
  ): Promise<void> {
    if (summary.outcome === 'CREDITED' || summary.outcome === 'APPLIED') {
      await this.#publisher.publish({
        messageType: accountInterbankCreditedV1.name,
        payload: {
          depositId: command.depositId,
          accountId: command.accountId,
          creditedAt: summary.creditedAt ?? summary.occurredAt,
        },
      });
      return;
    }
    await this.#publisher.publish({
      messageType: accountInterbankCreditRejectedV1.name,
      payload: {
        depositId: command.depositId,
        accountId: command.accountId,
        reason: summary.reason,
      },
    });
  }
}
