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
 * Three properties worth stating:
 *
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
  /** Attempts every payment currently due. Returns how many it attempted. */
  execute(): Promise<number>;
}

export interface SchedulerLog {
  info(message: string, fields?: Record<string, unknown>): void;
  error(message: string, fields?: Record<string, unknown>): void;
}

export class RetryScheduler {
  readonly #job: RetryJob;
  readonly #intervalMs: number;
  readonly #logger: SchedulerLog;
  #timer: ReturnType<typeof setInterval> | null = null;
  #running = false;

  constructor(dependencies: {
    readonly job: RetryJob;
    readonly intervalMs: number;
    readonly logger: SchedulerLog;
  }) {
    this.#job = dependencies.job;
    this.#intervalMs = dependencies.intervalMs;
    this.#logger = dependencies.logger;
  }

  public start(): void {
    if (this.#timer !== null) {
      return;
    }

    this.#timer = setInterval(() => void this.runOnce(), this.#intervalMs);

    /**
     * Does not keep the process alive on its own. Without this a service told
     * to shut down would linger until the next tick.
     */
    this.#timer.unref();
  }

  public stop(): void {
    if (this.#timer !== null) {
      clearInterval(this.#timer);
      this.#timer = null;
    }
  }

  /** Exposed so a test — or an operator — can trigger a sweep without waiting. */
  public async runOnce(): Promise<void> {
    if (this.#running) {
      return;
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
          outcome: `${String(attempted)} attempted`,
        });
      }
    } catch (error) {
      this.#logger.error('retry sweep failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      this.#running = false;
    }
  }
}
