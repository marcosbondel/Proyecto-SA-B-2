import { accountAnomalyDetectedV1 } from '@bank/contracts';

import type { ActivityRule } from '../domain/activity-policy';
import type {
  AccountActivity,
  AccountRepository,
  ActivityTelemetry,
  Clock,
  EventPublisher,
  ObservedMovement,
} from './ports';

/**
 * Watches how accounts are used and announces the one pattern the assignment
 * names: more than N operations on one account in M minutes (Fase 3, §4.1 —
 * Account Service, T-42).
 *
 * Called by the use cases **after** a movement has committed and its events
 * have been published, never inside `applyMovement`. That placement is the
 * ticket's hardest criterion: the balance row is locked for the length of a
 * transaction, and a detector that counted operations while holding it would
 * make every debit on a busy account wait for the count.
 *
 * Three properties, and the reasoning for each:
 *
 * - **It never throws.** By the time it runs the money has moved and the Saga
 *   has its reply. A failure here, if it escaped, would send a successful debit
 *   down the retry ladder and re-run it — so every failure is caught and
 *   reported as telemetry instead.
 * - **The decision is the database's.** `claimAnomaly` counts the window from
 *   `account_operations` and records the anomaly in one step, so two replicas
 *   cannot both announce the same one.
 * - **It reports and does not block.** The account stays usable. The reasoning
 *   is ADR-017.
 */
export class ActivityMonitor implements AccountActivity {
  readonly #repository: AccountRepository;
  readonly #publisher: EventPublisher;
  readonly #clock: Clock;
  readonly #telemetry: ActivityTelemetry;
  readonly #rule: ActivityRule;

  constructor(dependencies: {
    readonly repository: AccountRepository;
    readonly publisher: EventPublisher;
    readonly clock: Clock;
    readonly telemetry: ActivityTelemetry;
    readonly rule: ActivityRule;
  }) {
    this.#repository = dependencies.repository;
    this.#publisher = dependencies.publisher;
    this.#clock = dependencies.clock;
    this.#telemetry = dependencies.telemetry;
    this.#rule = dependencies.rule;
  }

  public async afterMovement(movement: ObservedMovement): Promise<void> {
    const { account } = movement;

    try {
      this.#telemetry.operation({
        accountId: account.accountId,
        accountType: account.accountType,
        operation: OPERATION_LABEL[movement.type],
        transactionId: movement.transactionId,
      });
    } catch (error) {
      this.#fail(account.accountId, 'detection', error);
    }

    // A compensation is the system undoing a debit, not something the customer
    // did; it is counted as an operation above but never towards the limit.
    if (movement.type === 'COMPENSATION') {
      return;
    }

    let claim;

    try {
      claim = await this.#repository.claimAnomaly({
        account,
        rule: this.#rule,
        now: this.#clock.now(),
      });
    } catch (error) {
      this.#fail(account.accountId, 'detection', error);
      return;
    }

    if (claim === null) {
      return;
    }

    const { anomaly } = claim;

    try {
      await this.#publisher.publish({
        messageType: accountAnomalyDetectedV1.name,
        payload: {
          accountId: anomaly.accountId,
          customerId: anomaly.customerId,
          accountType: anomaly.accountType,
          rule: 'HIGH_FREQUENCY',
          operationCount: anomaly.operationCount,
          threshold: anomaly.threshold,
          windowMinutes: anomaly.windowMinutes,
          windowStart: anomaly.windowStart.toISOString(),
          detectedAt: anomaly.detectedAt.toISOString(),
        },
      });

      await this.#repository.markAnomalyPublished(anomaly.anomalyId, this.#clock.now());
    } catch (error) {
      // Recorded but not announced: the claim goes stale and the next movement
      // on this account inside the window publishes it again.
      this.#fail(account.accountId, 'publication', error);
    }

    try {
      this.#telemetry.anomaly({ ...anomaly, republished: !claim.firstTime });
    } catch (error) {
      this.#fail(account.accountId, 'detection', error);
    }
  }

  #fail(accountId: string, stage: 'detection' | 'publication', error: unknown): void {
    try {
      this.#telemetry.failed({
        accountId,
        stage,
        reason: error instanceof Error ? error.message : String(error),
      });
    } catch {
      // The monitor's own reporting failed too. Nothing is left to tell anyone.
    }
  }
}

const OPERATION_LABEL = {
  DEBIT: 'debit',
  CREDIT: 'credit',
  COMPENSATION: 'compensation',
} as const;
