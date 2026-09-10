import { accountOpenRejectedV1, accountOpenedV1 } from '@bank/contracts';
import type { AccountCreateV1, Identity } from '@bank/contracts';

import { openAccount, openingDepositRefusal, openingRefusal } from '../domain/account';
import { quetzales } from '../domain/money';
import type { AccountRepository, Clock, EventPublisher } from './ports';

/**
 * Opens an account, or says why it did not.
 *
 * Two things this deliberately does not do. It does not check that the customer
 * exists — `customerId` is an opaque reference and verifying it would be a
 * synchronous read into Customer Service's data, which criterion 7 forbids. And
 * it does not mint the identifier: the Gateway did that before publishing, so a
 * redelivery carries the same one and the unique key on the primary key is what
 * makes the retry a no-op rather than a second account.
 *
 * `AHORRO`'s minimum opening deposit (T-27) is checked here, alongside who may
 * open for whom — both are refusals the account never gets created for.
 */
export class CreateAccountUseCase {
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

  public async execute(
    payload: AccountCreateV1,
    identity: Identity | null,
    idempotencyKey: string,
  ): Promise<void> {
    const now = this.#clock.now();

    const initialDepositMinor = payload.initialDeposit?.amountMinor ?? 0;

    const refusal =
      (identity === null ? null : openingRefusal(identity, payload.customerId)) ??
      openingDepositRefusal(payload.accountType, initialDepositMinor);

    if (refusal !== null) {
      await this.#publisher.publish({
        messageType: accountOpenRejectedV1.name,
        payload: {
          accountId: payload.accountId,
          customerId: payload.customerId,
          reason: refusal,
          rejectedAt: now.toISOString(),
        },
      });

      // Recorded so a redelivery does not re-publish the same refusal.
      await this.#repository.recordProcessed({
        idempotencyKey,
        messageType: 'account.create.v1',
        resultSummary: { outcome: 'REJECTED', reason: refusal },
      });

      return;
    }

    const { account, created } = await this.#repository.openAccount({
      account: openAccount({
        accountId: payload.accountId,
        customerId: payload.customerId,
        accountType: payload.accountType,
        now,
        initialDepositMinor,
      }),
      idempotency: {
        idempotencyKey,
        messageType: 'account.create.v1',
        resultSummary: { outcome: 'OPENED', accountId: payload.accountId },
      },
    });

    /**
     * A redelivery re-announces nothing. The event already went out the first
     * time, and Notification & Audit would otherwise record two openings for
     * one account — which is precisely the duplication the SRE notes forbid.
     */
    if (!created) {
      return;
    }

    await this.#publisher.publish({
      messageType: accountOpenedV1.name,
      payload: {
        accountId: account.accountId,
        customerId: account.customerId,
        accountType: account.accountType,
        status: 'ACTIVE',
        balance: quetzales(account.balanceMinor),
        openedAt: account.openedAt.toISOString(),
      },
    });
  }
}
