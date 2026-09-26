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

/**
 * El permiso para barrer, cuando hay mas de una replica.
 *
 * `#running` de abajo impide que un barrido se solape consigo mismo *dentro de
 * un proceso*. Con `replicas: N` eso deja de bastar: son N procesos, cada uno
 * con su propio temporizador y su propio `#running`, y el barrido correria N
 * veces. Este puerto es la version entre procesos de la misma idea — quien no
 * consigue el arriendo se salta su turno en vez de encolarlo, porque el barrido
 * es periodico y el siguiente tick vuelve a intentarlo.
 *
 * Es opcional: sin el, el planificador se comporta como siempre, que es lo
 * correcto para una sola replica y para los tests.
 */
export interface SweepLease {
  /** `true` si este proceso puede barrer; `false` si otra replica ya lo hace. */
  acquire(): Promise<boolean>;
  release(): Promise<void>;
}

export interface SchedulerLog {
  info(message: string, fields?: Record<string, unknown>): void;
  error(message: string, fields?: Record<string, unknown>): void;
}

export class DeactivationScheduler {
  readonly #job: DeactivationJob;
  readonly #intervalMs: number;
  readonly #logger: SchedulerLog;
  readonly #lease: SweepLease | null;
  #timer: ReturnType<typeof setInterval> | null = null;
  #running = false;

  constructor(dependencies: {
    readonly job: DeactivationJob;
    readonly intervalMs: number;
    readonly logger: SchedulerLog;
    readonly lease?: SweepLease;
  }) {
    this.#job = dependencies.job;
    this.#intervalMs = dependencies.intervalMs;
    this.#logger = dependencies.logger;
    this.#lease = dependencies.lease ?? null;
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
      if (this.#lease !== null && !(await this.#lease.acquire())) {
        // Con `replicas: N` esto es lo normal en N-1 de ellas, no un problema.
        this.#logger.info('deactivation run skipped: another replica holds the sweep lease', {
          runId,
        });

        return;
      }

      try {
        const deactivated = await this.#job.execute(runId);

        // Logged even when it is zero: "it ran and found nothing" and "it did not
        // run" have to look different from outside.
        this.#logger.info('deactivation run finished', {
          runId,
          outcome: `${String(deactivated.length)} deactivated`,
        });
      } finally {
        // Se suelta pase lo que pase: un arriendo que no se devuelve deja al
        // resto de replicas sin barrido hasta que este proceso muera.
        await this.#releaseLease(runId);
      }
    } catch (error) {
      this.#logger.error('deactivation run failed', {
        runId,
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      this.#running = false;
    }
  }

  /**
   * Soltar el arriendo no puede tumbar el barrido que acaba de terminar: el
   * trabajo ya esta hecho y comprometido, y quedarse sin soltar es un problema
   * de la siguiente ronda, no de esta.
   */
  async #releaseLease(runId: string): Promise<void> {
    if (this.#lease === null) {
      return;
    }

    try {
      await this.#lease.release();
    } catch (error) {
      this.#logger.error('could not release the sweep lease', {
        runId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
