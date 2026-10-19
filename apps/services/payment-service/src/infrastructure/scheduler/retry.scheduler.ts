import { AdaptiveTicker } from '@bank/messaging';

/**
 * Comes back for the attempts the ladder owes, and gets out of the way.
 *
 * This is what makes a retry **durable**. The obvious implementation of "try
 * again in five seconds" is a `setTimeout`, and it is wrong here for a reason
 * that only shows up in a cluster: a pod rescheduled mid-ladder forgets every
 * pending timer, and every transfer that was mid-payment stalls at
 * `PAYMENT_PENDING` with the money already debited and nothing on its way to
 * fix it. The due time lives in a column instead, and this sweeps it.
 *
 * Deliberately not a cron library and not `@nestjs/schedule`, matching
 * `account-service`'s own scheduler: an interval plus an environment variable
 * is the whole requirement, and a scheduling dependency would add a second way
 * to express time in the one service whose time-handling is the thing under
 * test.
 *
 * Four properties worth stating:
 *
 * - **It backs off while idle** (T-60). A pod with nothing due polled every
 *   500 ms forever, which on a 50 m CPU request was enough to hold the
 *   autoscaler at its maximum with no traffic. The interval is now the *floor*:
 *   a sweep that finds nothing doubles the wait up to `idleMaxMs`, a sweep that
 *   finds something (or a `wake()` from a delivery that may have created work)
 *   returns to the floor. The cost is lateness — anything the clock alone makes
 *   due is found up to `idleMaxMs` late, never early. See `AdaptiveTicker`.
 * - **It never overlaps itself.** A sweep that outlives its interval would
 *   otherwise have a second start on top of it. The row lock would still stop a
 *   double charge, but only after both had asked the provider.
 * - **A failed sweep does not stop the schedule.** The next one tries again;
 *   the due list is read fresh every time, so nothing is lost by a sweep that
 *   threw halfway.
 * - **A failed *payment* does not stop the sweep.** One payment that throws
 *   must not leave the other nine due payments unattempted, so each is caught
 *   on its own.
 */
export interface RetryJob {
  /**
   * Does whatever is due. Returns how much work it found — `0` means idle,
   * which is what lets the scheduler back off.
   */
  execute(): Promise<number>;
}

export interface SchedulerLog {
  info(message: string, fields?: Record<string, unknown>): void;
  error(message: string, fields?: Record<string, unknown>): void;
}

export class RetryScheduler {
  readonly #job: RetryJob;
  readonly #logger: SchedulerLog;
  readonly #ticker: AdaptiveTicker;
  #running = false;

  constructor(dependencies: {
    readonly job: RetryJob;
    /** The floor: the wait while there is work, and after a `wake()`. */
    readonly intervalMs: number;
    /** The ceiling of the idle backoff. Defaults to the floor, i.e. no backoff. */
    readonly idleMaxMs?: number;
    readonly logger: SchedulerLog;
  }) {
    this.#job = dependencies.job;
    this.#logger = dependencies.logger;
    this.#ticker = new AdaptiveTicker({
      minMs: dependencies.intervalMs,
      maxMs: dependencies.idleMaxMs ?? dependencies.intervalMs,
      tick: async () => await this.runOnce(),
    });
  }

  /** The unref'd timers do not keep the process alive: a service told to stop does not linger. */
  public start(): void {
    this.#ticker.start();
  }

  public stop(): void {
    this.#ticker.stop();
  }

  /** Something in this process may have made work: look for it soon. */
  public wake(): void {
    this.#ticker.wake();
  }

  /**
   * Exposed so a test — or an operator — can trigger a sweep without waiting.
   * Returns how much work it found.
   */
  public async runOnce(): Promise<number> {
    if (this.#running) {
      return 0;
    }

    this.#running = true;

    try {
      const attempted = await this.#job.execute();

      /**
       * Silent when there was nothing to do. Unlike the daily deactivation job,
       * this runs every second or so; logging "found nothing" at that rate
       * would bury the lines that matter under its own heartbeat.
       */
      if (attempted > 0) {
        this.#logger.info('retry sweep finished', {
          outcome: `${String(attempted)} worked`,
        });
      }

      return attempted;
    } catch (error) {
      this.#logger.error('retry sweep failed', {
        error: error instanceof Error ? error.message : String(error),
      });

      return 0;
    } finally {
      this.#running = false;
    }
  }
}
