import type { MessageEnvelope } from '@bank/contracts';

/**
 * Waiting for an answer without blocking anything.
 *
 * The pattern is deliberately small: a caller registers what it is waiting for,
 * a reply arrives on its own queue, and the two are matched by
 * `correlationId`. There is no shared state between instances and no polling.
 *
 * **The reply queue is exclusive to one instance.** A durable queue shared by
 * every replica would have the broker deliver replies round-robin, so the
 * answer to instance A's question could land on instance B, which has nobody
 * waiting for it. The system is deployed to Kubernetes (constitution VII),
 * where more than one replica is the normal case, so this is not hypothetical.
 */

/** Five seconds, the ceiling T-05 fixed for a reply the caller waits on. */
export const DEFAULT_REPLY_TIMEOUT_MS = 5_000;

/**
 * Raised when no reply arrived in time.
 *
 * It means the caller stopped waiting. It does **not** mean the operation was
 * cancelled: there is no cancellation message in the catalogue, and the Saga
 * carries on. The caller finds out how it ended by asking again later.
 */
export class ReplyTimeoutError extends Error {
  public readonly correlationId: string;

  constructor(correlationId: string, timeoutMs: number) {
    super(
      `No reply for correlation ${correlationId} within ${String(timeoutMs)}ms. ` +
        'The operation was not cancelled; query its status to find out how it ended.',
    );
    this.name = 'ReplyTimeoutError';
    this.correlationId = correlationId;
  }
}

interface PendingReply {
  readonly resolve: (envelope: MessageEnvelope<unknown>) => void;
  readonly reject: (error: Error) => void;
  readonly timer: ReturnType<typeof setTimeout>;
}

export interface ReplyRegistryOptions {
  readonly timeoutMs?: number;
  /** Injectable so tests do not wait five real seconds. */
  readonly setTimeoutFn?: typeof setTimeout;
  readonly clearTimeoutFn?: typeof clearTimeout;
}

/**
 * Tracks the questions this instance is waiting on.
 *
 * Every wait ends: either a reply resolves it or the timer rejects it. A
 * registry that could leak an entry would leak a promise with it, and a gateway
 * that accumulates unresolved promises fails slowly and confusingly.
 */
export class ReplyRegistry {
  readonly #pending = new Map<string, PendingReply>();
  readonly #timeoutMs: number;
  readonly #setTimeout: typeof setTimeout;
  readonly #clearTimeout: typeof clearTimeout;

  constructor(options: ReplyRegistryOptions = {}) {
    this.#timeoutMs = options.timeoutMs ?? DEFAULT_REPLY_TIMEOUT_MS;
    this.#setTimeout = options.setTimeoutFn ?? setTimeout;
    this.#clearTimeout = options.clearTimeoutFn ?? clearTimeout;
  }

  /** How many answers this instance is currently waiting for. */
  public get pendingCount(): number {
    return this.#pending.size;
  }

  /** Waits for the reply to `correlationId`, or gives up after the timeout. */
  public async waitFor(correlationId: string): Promise<MessageEnvelope<unknown>> {
    if (this.#pending.has(correlationId)) {
      throw new Error(`Already waiting on correlation ${correlationId}.`);
    }

    return new Promise<MessageEnvelope<unknown>>((resolve, reject) => {
      const timer = this.#setTimeout(() => {
        this.#pending.delete(correlationId);
        reject(new ReplyTimeoutError(correlationId, this.#timeoutMs));
      }, this.#timeoutMs);

      this.#pending.set(correlationId, { resolve, reject, timer });
    });
  }

  /**
   * Hands a reply to whoever was waiting for it.
   *
   * Returns `false` when nobody was — a reply that arrived after its caller
   * gave up, or one meant for a different instance. It is discarded rather than
   * treated as an error: both are expected outcomes, not faults.
   */
  public settle(envelope: MessageEnvelope<unknown>): boolean {
    const pending = this.#pending.get(envelope.correlationId);
    if (pending === undefined) {
      return false;
    }

    this.#clearTimeout(pending.timer);
    this.#pending.delete(envelope.correlationId);
    pending.resolve(envelope);

    return true;
  }

  /** Fails every outstanding wait. For shutdown, so nothing hangs. */
  public abortAll(reason: string): void {
    for (const [correlationId, pending] of this.#pending) {
      this.#clearTimeout(pending.timer);
      pending.reject(new Error(`Reply wait for ${correlationId} aborted: ${reason}`));
    }

    this.#pending.clear();
  }
}

/** The name of an instance's private reply queue. Server-named in production. */
export function replyQueueName(application: string, instanceId: string): string {
  return `${application}.replies.${instanceId}`;
}
