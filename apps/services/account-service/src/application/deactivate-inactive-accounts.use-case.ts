import { accountDeactivatedV1 } from '@bank/contracts';

import { quetzales } from '../domain/money';
import type { DeactivationCriteria } from '../domain/deactivation-policy';
import { DEFAULT_CRITERIA } from '../domain/deactivation-policy';
import type { AccountRepository, Clock, EventPublisher } from './ports';

/**
 * The automatic process the assignment names explicitly (§4.1, p. 4).
 *
 * Three properties it has to have, and one it must not:
 *
 * - **Idempotent.** Running it twice in a day deactivates the same accounts
 *   once. It is the `status = 'ACTIVE'` in the selecting `UPDATE` that provides
 *   this, not a check in Node: a second run simply matches no rows.
 * - **Auditable.** Every run is recorded with its identifier and its count, and
 *   every account it touches gets an `account.deactivated.v1` naming the balance
 *   and the last activity at the moment of the decision. "The job ran and
 *   nothing happened" and "the job did not run" have to look different.
 * - **Testable.** The clock is injected. A policy that read `Date.now()` could
 *   only be tested by waiting six months.
 *
 * What it must not be is *transactional across the whole batch*. One account
 * that fails must not roll back the two hundred that succeeded, so the
 * repository commits per account and this reports what actually happened.
 */
export class DeactivateInactiveAccountsUseCase {
  readonly #repository: AccountRepository;
  readonly #publisher: EventPublisher;
  readonly #clock: Clock;
  readonly #criteria: DeactivationCriteria;

  constructor(dependencies: {
    readonly repository: AccountRepository;
    readonly publisher: EventPublisher;
    readonly clock: Clock;
    readonly criteria?: DeactivationCriteria;
  }) {
    this.#repository = dependencies.repository;
    this.#publisher = dependencies.publisher;
    this.#clock = dependencies.clock;
    this.#criteria = dependencies.criteria ?? DEFAULT_CRITERIA;
  }

  /** Returns the accounts it deactivated, so a caller can log the count. */
  public async execute(runId: string): Promise<readonly string[]> {
    const now = this.#clock.now();

    const deactivated = await this.#repository.deactivateInactive({
      now,
      criteria: this.#criteria,
      runId,
    });

    for (const account of deactivated) {
      await this.#publisher.publish({
        messageType: accountDeactivatedV1.name,
        payload: {
          accountId: account.accountId,
          cause: 'AUTOMATIC_INACTIVITY',
          balanceAtDeactivation: quetzales(account.balanceMinor),
          lastActivityAt: account.lastActivityAt?.toISOString() ?? null,
          deactivatedAt: now.toISOString(),
          // The automatic sweep has no human reason; its cause is the rule.
          reason: null,
        },
      });
    }

    return deactivated.map((account) => account.accountId);
  }
}
