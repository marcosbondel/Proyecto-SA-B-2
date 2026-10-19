import { AdaptiveTicker, type MessageBroker } from '@bank/messaging';
import { withTraceparent } from '@bank/observability';

import type { OutboxMessage, PaymentRepository } from '../../application/ports';

/**
 * The relay half of the transactional outbox (TD-047).
 *
 * An attempt no longer commits and then publishes the event it produced in two
 * separate steps — it writes the event to the outbox in the attempt's own
 * transaction, and this comes back for it. That closes the crash window the old
 * code had: a payment can no longer settle in this database while the terminal
 * event the Saga needs to finish or refund the transfer is lost between the
 * commit and a publish that never happened.
 *
 * A sibling to the `RetryScheduler` this service already runs, and modelled on
 * it: an interval and one environment variable, no scheduling library. It never
 * overlaps itself, a failed sweep does not stop the schedule (a broker briefly
 * away throws the batch back to `PENDING` for the next tick), and its timer is
 * `unref`'d so shutdown does not wait on it.
 *
 * **It backs off while idle, and is woken by the writers** (T-60). At a fixed
 * 200 ms an idle replica ran three queries (`BEGIN`, `SELECT`, `COMMIT`) five
 * times a second for nothing. The interval is now the floor; an empty sweep
 * doubles the wait up to `idleMaxMs`, and `wake()` -- called when a delivery was
 * handled or a sweep found work, i.e. whenever *this process* may have written
 * an outbox row -- brings the next sweep back to the floor. That is why the
 * backoff costs the Saga no latency in the case that matters, a request landing
 * on a quiet pod: the handler that writes the event wakes the relay as it
 * returns. What is left is a row left by a replica that died, found up to
 * `idleMaxMs` late.
 */
export interface OutboxLog {
  info(message: string, fields?: Record<string, unknown>): void;
  error(message: string, fields?: Record<string, unknown>): void;
}

/** How many outbox rows one sweep publishes at most, so a backlog drains in bounded batches. */
const DEFAULT_BATCH_SIZE = 100;

export class OutboxRelay {
  readonly #repository: PaymentRepository;
  readonly #broker: MessageBroker;
  readonly #batchSize: number;
  readonly #logger: OutboxLog;
  readonly #ticker: AdaptiveTicker;
  #running = false;

  constructor(dependencies: {
    readonly repository: PaymentRepository;
    readonly broker: MessageBroker;
    /** The floor: the wait while there is work, and after a `wake()`. */
    readonly intervalMs: number;
    /** The ceiling of the idle backoff. Defaults to the floor, i.e. no backoff. */
    readonly idleMaxMs?: number;
    readonly logger: OutboxLog;
    readonly batchSize?: number;
  }) {
    this.#repository = dependencies.repository;
    this.#broker = dependencies.broker;
    this.#logger = dependencies.logger;
    this.#batchSize = dependencies.batchSize ?? DEFAULT_BATCH_SIZE;
    this.#ticker = new AdaptiveTicker({
      minMs: dependencies.intervalMs,
      maxMs: dependencies.idleMaxMs ?? dependencies.intervalMs,
      tick: async () => await this.runOnce(),
    });
  }

  public start(): void {
    this.#ticker.start();
  }

  public stop(): void {
    this.#ticker.stop();
  }

  /** This process may have just written an outbox row: sweep soon. */
  public wake(): void {
    this.#ticker.wake();
  }

  /**
   * Exposed so a test — or an operator — can drain the outbox without waiting.
   * Returns how many rows it published.
   */
  public async runOnce(): Promise<number> {
    if (this.#running) {
      return 0;
    }

    this.#running = true;

    try {
      const dispatched = await this.#repository.dispatchPendingOutbox(
        // Inside the trace the row was written in, or the event would open a
        // new trace and cut the Saga in two at this hop (T-48).
        (message: OutboxMessage) =>
          withTraceparent(message.traceparent ?? null, () =>
            this.#broker.publish(message.exchange, message.routingKey, message.envelope),
          ),
        this.#batchSize,
      );

      if (dispatched > 0) {
        this.#logger.info('outbox relay dispatched', {
          outcome: `${String(dispatched)} published`,
        });
      }

      return dispatched;
    } catch (error) {
      this.#logger.error('outbox relay sweep failed', {
        error: error instanceof Error ? error.message : String(error),
      });

      return 0;
    } finally {
      this.#running = false;
    }
  }
}
