import { AdaptiveTicker, type MessageBroker } from '@bank/messaging';
import { withTraceparent } from '@bank/observability';

import type { OutboxMessage, TransactionRepository } from '../../application/ports';

/**
 * The relay half of the transactional outbox (TD-031).
 *
 * The Saga no longer publishes a command after committing the transition that
 * demands it — it writes the message to the outbox in that same transaction,
 * and this comes back for it. That is what closes the crash window the old code
 * had: a transfer can no longer reach `PAYMENT_PENDING`, with the money already
 * debited, while the payment command it implied was lost between the commit and
 * a publish that never happened.
 *
 * Modelled on `payment-service`'s `RetryScheduler`, and for the same reasons: an
 * interval and one environment variable is the whole requirement, so there is no
 * scheduling library, and the properties that matter are the same three —
 *
 * - **It never overlaps itself.** A sweep that outran its interval would
 *   otherwise start a second on top of it; `FOR UPDATE SKIP LOCKED` in the
 *   repository would still stop a double publish, but only after both had asked
 *   the broker.
 * - **A failed sweep does not stop the schedule.** The broker being briefly away
 *   throws the whole batch back to `PENDING`; the next tick reads it fresh and
 *   tries again, which is exactly what durability here means.
 * - **It gets out of the way on shutdown.** The timer is `unref`'d, so a service
 *   told to stop does not linger until the next tick.
 *
 * And, since T-60, a fourth: **it backs off while idle and is woken by the
 * writers.** At a fixed 200 ms an idle replica ran `BEGIN`/`SELECT`/`COMMIT`
 * five times a second for nothing. The interval is now the floor; an empty
 * sweep doubles the wait up to `idleMaxMs`, and `wake()` -- called when a
 * delivery was handled, i.e. whenever *this process* may have written an outbox
 * row -- returns the next sweep to the floor. The Saga loses nothing for a
 * request landing on a quiet pod, because the handler that writes the command
 * wakes the relay as it returns; only a row left by a replica that died is
 * found up to `idleMaxMs` late.
 */
export interface OutboxLog {
  info(message: string, fields?: Record<string, unknown>): void;
  error(message: string, fields?: Record<string, unknown>): void;
}

/** How many outbox rows one sweep publishes at most, so a backlog drains in bounded batches. */
const DEFAULT_BATCH_SIZE = 100;

export class OutboxRelay {
  readonly #repository: TransactionRepository;
  readonly #broker: MessageBroker;
  readonly #batchSize: number;
  readonly #logger: OutboxLog;
  readonly #ticker: AdaptiveTicker;
  #running = false;

  constructor(dependencies: {
    readonly repository: TransactionRepository;
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
        // Inside the trace the row was written in, or the command would open a
        // new trace and cut the Saga in two at this hop (T-48).
        (message: OutboxMessage) =>
          withTraceparent(message.traceparent ?? null, () =>
            this.#broker.publish(message.exchange, message.routingKey, message.envelope),
          ),
        this.#batchSize,
      );

      /**
       * Silent when there was nothing to send. This runs several times a second;
       * logging "found nothing" at that rate would bury the lines that matter
       * under its own heartbeat.
       */
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
