/**
 * A poll loop that gets cheaper while there is nothing to do (T-60).
 *
 * The sweepers and outbox relays of this system were a bare `setInterval` at
 * 200-500 ms. That is the right latency for a busy pod and a pointless cost for
 * an idle one: each tick is a handful of queries against the service's own
 * database, a pod with no traffic still made ~25 transactions a second, and on
 * the 50 m CPU request the chart gives it that was enough to keep the
 * HorizontalPodAutoscaler pinned at its maximum with no load at all.
 *
 * This replaces the fixed interval with a chain of timeouts whose delay follows
 * what the previous tick found:
 *
 * - **Work found** → the next tick comes after `minMs`, the old interval. A
 *   backlog drains at exactly the speed it did before.
 * - **Nothing found** → the delay doubles (`factor`) up to `maxMs`, so an idle
 *   pod settles at one tick every `maxMs` instead of one every `minMs`.
 * - **`wake()`** → somebody *in this process* just made work (a handler wrote an
 *   outbox row, a delivery opened a payment): the next tick is brought forward
 *   to at most `minMs` away and the delay is reset. This is what keeps the idle
 *   backoff from adding latency to the one case where latency is visible, a
 *   request arriving at a quiet pod. Work made by *another* replica needs no
 *   wake: that replica wakes its own loop.
 *
 * What it costs: work that appears **without** passing through this process —
 * a due time arriving on the clock, a replica that died holding rows — is found
 * up to `maxMs` late instead of `minMs`. Callers pick `maxMs` as the lateness
 * they can afford, and document it where the timing is a business rule.
 *
 * Properties kept from the intervals it replaces: it **never overlaps itself**
 * (the next timeout is only set after the tick returns, which a `setInterval`
 * does not guarantee), a tick that throws does not stop the schedule (and counts
 * as idle, so a database that is down is polled gently rather than hammered),
 * and its timer is `unref`'d so a service told to stop does not wait for it.
 */
export interface AdaptiveTickerOptions {
  /** One tick. Returns how much work it found; `0` means idle. */
  readonly tick: () => Promise<number>;
  /** The delay while there is work, and the floor after a `wake()`. */
  readonly minMs: number;
  /** The ceiling of the idle backoff. Never below `minMs`. */
  readonly maxMs: number;
  /** How fast the idle delay grows. Defaults to doubling. */
  readonly factor?: number;
  /** Called when a tick throws. The schedule continues either way. */
  readonly onError?: (error: unknown) => void;
}

export class AdaptiveTicker {
  readonly #tick: () => Promise<number>;
  readonly #minMs: number;
  readonly #maxMs: number;
  readonly #factor: number;
  readonly #onError: (error: unknown) => void;

  #timer: ReturnType<typeof setTimeout> | null = null;
  /** When the pending timer fires, to decide whether a `wake()` must bring it forward. */
  #dueAt = 0;
  #delayMs: number;
  #running = false;
  #started = false;
  #woken = false;

  constructor(options: AdaptiveTickerOptions) {
    this.#tick = options.tick;
    this.#minMs = options.minMs;
    this.#maxMs = Math.max(options.minMs, options.maxMs);
    this.#factor = options.factor ?? 2;
    this.#onError = options.onError ?? ((): void => undefined);
    this.#delayMs = this.#minMs;
  }

  /** The delay the next tick will wait, for tests and diagnostics. */
  public get delayMs(): number {
    return this.#delayMs;
  }

  public start(): void {
    if (this.#started) {
      return;
    }

    this.#started = true;
    this.#delayMs = this.#minMs;
    this.#schedule(this.#minMs);
  }

  public stop(): void {
    this.#started = false;

    if (this.#timer !== null) {
      clearTimeout(this.#timer);
      this.#timer = null;
    }
  }

  /**
   * Work was just made in this process: look for it within `minMs`, and start
   * the idle backoff over. Coalesces — a tick already due sooner is left alone,
   * and a tick in flight is told to follow itself up at `minMs`.
   */
  public wake(): void {
    if (!this.#started) {
      return;
    }

    this.#delayMs = this.#minMs;

    if (this.#running) {
      this.#woken = true;

      return;
    }

    if (this.#dueAt - Date.now() > this.#minMs) {
      this.#schedule(this.#minMs);
    }
  }

  #schedule(ms: number): void {
    if (this.#timer !== null) {
      clearTimeout(this.#timer);
    }

    this.#dueAt = Date.now() + ms;
    this.#timer = setTimeout(() => void this.#run(), ms);
    this.#timer.unref();
  }

  async #run(): Promise<void> {
    this.#timer = null;
    this.#running = true;
    this.#woken = false;

    let found = 0;

    try {
      found = await this.#tick();
    } catch (error) {
      this.#onError(error);
    } finally {
      this.#running = false;
    }

    if (!this.#started) {
      return;
    }

    this.#delayMs =
      found > 0 || this.#woken
        ? this.#minMs
        : Math.min(this.#maxMs, Math.ceil(this.#delayMs * this.#factor));
    this.#schedule(this.#delayMs);
  }
}
