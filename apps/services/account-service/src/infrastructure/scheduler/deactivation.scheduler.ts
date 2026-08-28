import { randomUUID } from 'node:crypto';

/**
 * Runs the deactivation job on an interval, and gets out of the way.
 *
 * Deliberately not a cron library and not `@nestjs/schedule`. What the ticket
 * asks for is "configurable, executable daily, with an injectable clock", and an
 * interval plus an environment variable is all of that — a scheduling
 * dependency would add a second way to express time in a service whose
 * time-handling is already the thing under test.
 *
 * Three properties worth stating:
 *
 * - **It never overlaps itself.** A run that outlives its interval would
 *   otherwise have a second one start on top of it, and two concurrent jobs
 *   selecting the same candidates is how one deactivation becomes two events.
 * - **A failed run does not stop the schedule.** The next one tries again;
 *   the job is idempotent, so retrying costs nothing.
 * - **It can be turned off entirely.** A developer running the stack locally
 *   does not need a background process rewriting rows while they read them.
 */
export interface DeactivationJob {
  execute(runId: string): Promise<readonly string[]>;
}

export interface SchedulerLog {
  info(message: string, fields?: Record<string, unknown>): void;
  error(message: string, fields?: Record<string, unknown>): void;
}

export class DeactivationScheduler {
  readonly #job: DeactivationJob;
  readonly #intervalMs: number;
  readonly #logger: SchedulerLog;
  #timer: ReturnType<typeof setInterval> | null = null;
  #running = false;

  constructor(dependencies: {
    readonly job: DeactivationJob;
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
     * Does not keep the process alive on its own. Without this, a service told
     * to shut down would linger until the next daily tick.
     */
    this.#timer.unref();

    /**
     * Run once at startup, not only on the first interval tick. With a 24h
     * interval, a pod that restarts more often than daily would otherwise reach
     * the tick and never execute the job — the automatic sweep the assignment
     * requires could then never run, and nothing would say so. The run is
     * idempotent and guarded by `#running`, so an extra one costs nothing.
     */
    void this.runOnce();
  }

  public stop(): void {
    if (this.#timer !== null) {
      clearInterval(this.#timer);
      this.#timer = null;
    }
  }

  /** Exposed so a test — or an operator — can trigger a run without waiting. */
  public async runOnce(): Promise<void> {
    if (this.#running) {
      this.#logger.info('deactivation run skipped: the previous one is still going');

      return;
    }

    this.#running = true;
    const runId = randomUUID();

    try {
      const deactivated = await this.#job.execute(runId);

      // Logged even when it is zero: "it ran and found nothing" and "it did not
      // run" have to look different from outside.
      this.#logger.info('deactivation run finished', {
        runId,
        outcome: `${String(deactivated.length)} deactivated`,
      });
    } catch (error) {
      this.#logger.error('deactivation run failed', {
        runId,
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      this.#running = false;
    }
  }
}
