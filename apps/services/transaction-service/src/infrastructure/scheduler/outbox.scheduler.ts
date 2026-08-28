import type { MessageBroker } from '@bank/messaging';

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
  readonly #intervalMs: number;
  readonly #batchSize: number;
  readonly #logger: OutboxLog;
  #timer: ReturnType<typeof setInterval> | null = null;
  #running = false;

  constructor(dependencies: {
    readonly repository: TransactionRepository;
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
        (message: OutboxMessage) =>
          this.#broker.publish(message.exchange, message.routingKey, message.envelope),
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
    } catch (error) {
      this.#logger.error('outbox relay sweep failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      this.#running = false;
    }
  }
}
