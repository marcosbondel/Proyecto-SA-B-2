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

  /**
   * Returns the accounts it deactivated, so a caller can log the count.
   *
   * **Known gap (no outbox here, unlike Transaction and Payment Service):**
   * the `UPDATE` and this publish loop are not one atomic step. A crash or a
   * broker outage between them leaves an account genuinely `INACTIVE` with no
   * `account.deactivated.v1` ever emitted — and because the next run's
   * predicate is `status = 'ACTIVE'`, that account is never selected again, so
   * the event is lost for good rather than merely delayed. Evaluated for T-16
   * and deliberately left this way rather than adding an outbox table to the
   * balances service four days before delivery: see TD-055 in
   * `docs/TECH_DEBT.md` for the trade-off. What **is** done here is contain the
   * blast radius of that gap: each account's publish is isolated so one
   * broker hiccup does not also silence every account queued behind it in the
   * same run, and a failure names exactly which accounts it hit so a person can
   * replay them by hand instead of guessing from a batch-level "run failed".
   */
  public async execute(runId: string): Promise<readonly string[]> {
    const now = this.#clock.now();

    const deactivated = await this.#repository.deactivateInactive({
      now,
      criteria: this.#criteria,
      runId,
    });

    const failures: string[] = [];

    for (const account of deactivated) {
      try {
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
      } catch (error) {
        // The account is already INACTIVE in this database regardless of what
        // happens next — isolated per account precisely so this account's
        // failure does not also stop the ones still queued behind it.
        failures.push(
          `${account.accountId}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    if (failures.length > 0) {
      throw new Error(
        `${String(failures.length)} of ${String(deactivated.length)} ` +
          `account.deactivated.v1 events failed to publish for run ${runId}: ` +
          failures.join('; '),
      );
    }

    return deactivated.map((account) => account.accountId);
  }
}
