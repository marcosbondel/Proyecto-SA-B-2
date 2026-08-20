/**
 * When a failed message is handed back, and when it stops being handed back.
 *
 * RabbitMQ has no delayed delivery of its own, and the image this project pins
 * (`rabbitmq:4.3.4-management`) does not carry the delayed-message plugin. The
 * delay therefore comes from a queue with a `x-message-ttl` that dead-letters
 * back to the queue the message failed in — never to the exchange it arrived
 * from, which would redeliver it to consumers that already handled it.
 *
 * This module decides *whether and where*; it does not talk to a broker.
 */

/** The attempt number rides in a header the consumer maintains. */
export const ATTEMPT_HEADER = 'x-attempt';

/** Milliseconds before each successive retry. Configurable, defaulted here. */
export const DEFAULT_RETRY_DELAYS_MS = [1_000, 5_000, 30_000] as const;

export interface RetryPolicyOptions {
  /** One entry per retry. Its length *is* the maximum number of retries. */
  readonly delaysMs?: readonly number[];
}

/** What to do with a message that failed. */
export type RetryDecision =
  | { readonly kind: 'retry'; readonly attempt: number; readonly delayMs: number }
  | { readonly kind: 'dead-letter'; readonly attempt: number };

export class RetryPolicy {
  readonly #delaysMs: readonly number[];

  constructor(options: RetryPolicyOptions = {}) {
    const delays = options.delaysMs ?? DEFAULT_RETRY_DELAYS_MS;

    if (delays.length === 0) {
      throw new Error('A retry policy with no delays cannot retry; use maxRetries 0 explicitly.');
    }

    if (delays.some((delay) => delay <= 0)) {
      throw new Error('Retry delays must be positive; a zero delay is a tight loop.');
    }

    this.#delaysMs = delays;
  }

  /** Retries allowed after the first attempt. Total deliveries is this plus one. */
  public get maxRetries(): number {
    return this.#delaysMs.length;
  }

  /**
   * Reads the attempt number out of a delivery's headers.
   *
   * Deliberately not RabbitMQ's own `x-death`: that header accumulates one
   * entry per queue a message passed through, and with three retry queues in
   * the path, reading the attempt out of it is guesswork.
   */
  public attemptOf(headers: Readonly<Record<string, unknown>> | undefined): number {
    const raw = headers?.[ATTEMPT_HEADER];

    return typeof raw === 'number' && Number.isInteger(raw) && raw > 0 ? raw : 1;
  }

  /** Whether to wait and try again, and for how long, or to give up. */
  public decide(currentAttempt: number): RetryDecision {
    if (currentAttempt > this.maxRetries) {
      return { kind: 'dead-letter', attempt: currentAttempt };
    }

    const delayMs = this.#delaysMs[currentAttempt - 1];
    if (delayMs === undefined) {
      return { kind: 'dead-letter', attempt: currentAttempt };
    }

    return { kind: 'retry', attempt: currentAttempt, delayMs };
  }

  /** The queue a retry waits in, derived from the queue it failed in. */
  public retryQueueFor(queue: string, delayMs: number): string {
    return `${queue}.retry.${String(delayMs / 1_000)}s`;
  }
}
