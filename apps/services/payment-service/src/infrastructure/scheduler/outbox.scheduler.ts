import type { MessageBroker } from '@bank/messaging';
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
  readonly #intervalMs: number;
  readonly #batchSize: number;
  readonly #logger: OutboxLog;
  #timer: ReturnType<typeof setInterval> | null = null;
  #running = false;

  constructor(dependencies: {
    readonly repository: PaymentRepository;
    readonly broker: MessageBroker;
    readonly intervalMs: number;
    readonly logger: OutboxLog;
    readonly batchSize?: number;
  }) {
    this.#repository = dependencies.repository;
    this.#broker = dependencies.broker;
    this.#intervalMs = dependencies.intervalMs;
    this.#logger = dependencies.logger;
    this.#batchSize = dependencies.batchSize ?? DEFAULT_BATCH_SIZE;
  }

  public start(): void {
    if (this.#timer !== null) {
      return;
    }

    this.#timer = setInterval(() => void this.runOnce(), this.#intervalMs);
    this.#timer.unref();
  }

  public stop(): void {
    if (this.#timer !== null) {
      clearInterval(this.#timer);
      this.#timer = null;
    }
  }

  /** Exposed so a test — or an operator — can drain the outbox without waiting. */
  public async runOnce(): Promise<void> {
    if (this.#running) {
      return;
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
    } catch (error) {
      this.#logger.error('outbox relay sweep failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      this.#running = false;
    }
  }
}
