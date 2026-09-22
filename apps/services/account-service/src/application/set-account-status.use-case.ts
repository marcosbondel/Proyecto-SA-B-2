import { accountDeactivatedV1, accountReactivatedV1 } from '@bank/contracts';
import type { AccountSetStatusV1, Identity } from '@bank/contracts';

import { quetzales } from '../domain/money';
import type { AccountRepository, Clock, EventPublisher } from './ports';

/**
 * An administrator deactivating or reactivating an account by hand.
 *
 * D-06 gives this to `ADMINISTRADOR` alone, and the Gateway's guard already
 * refuses everyone else — but the check is repeated here, because the Gateway's
 * guard protects an HTTP route and this message could also arrive from
 * somewhere else on the broker. A permission enforced only at the edge is a
 * permission that holds until the second producer appears.
 *
 * A no-op change publishes nothing. Deactivating an account that is already
 * inactive is an intention with no effect, and narrating it would put a
 * deactivation in the audit trail that never happened.
 */
export class SetAccountStatusUseCase {
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
    payload: AccountSetStatusV1,
    identity: Identity | null,
    idempotencyKey: string,
  ): Promise<void> {
    if (!identity) {
      return;
    }

    const messageType = 'account.set-status.v1';

    if ((await this.#repository.findProcessed(idempotencyKey, messageType)) !== null) {
      return;
    }

    const before = await this.#repository.findById(payload.accountId);

    if (before === null) {
      await this.#repository.recordProcessed({
        idempotencyKey,
        messageType,
        resultSummary: { outcome: 'NOT_FOUND' },
      });

      return;
    }

    // Role authorization:
    // ADMINISTRADOR & CAJERO_RECEPTOR can change status on any account.
    // CLIENTE can only change status on their own accounts.
    if (identity.role === 'CLIENTE') {
      if (before.customerId !== identity.customerId) {
        return;
      }
    } else if (identity.role !== 'ADMINISTRADOR' && identity.role !== 'CAJERO_RECEPTOR') {
      return;
    }

    const account = await this.#repository.setStatus({
      accountId: payload.accountId,
      status: payload.status,
      idempotency: {
        idempotencyKey,
        messageType,
        resultSummary: { outcome: 'APPLIED', status: payload.status },
      },
    });

    if (account === null || before.status === payload.status) {
      return;
    }

    const now = this.#clock.now().toISOString();
    const cause =
      identity.role === 'CLIENTE'
        ? 'CUSTOMER'
        : identity.role === 'CAJERO_RECEPTOR'
          ? 'TELLER'
          : 'ADMINISTRATOR';

    await this.#publisher.publish(
      payload.status === 'INACTIVE'
        ? {
            messageType: accountDeactivatedV1.name,
            payload: {
              accountId: account.accountId,
              customerId: account.customerId,
              cause,
              balanceAtDeactivation: quetzales(account.balanceMinor),
              lastActivityAt: account.lastActivityAt?.toISOString() ?? null,
              deactivatedAt: now,
              reason: payload.reason,
            },
          }
        : {
            messageType: accountReactivatedV1.name,
            payload: {
              accountId: account.accountId,
              customerId: account.customerId,
              cause,
              reactivatedAt: now,
            },
          },
    );
  }
}
