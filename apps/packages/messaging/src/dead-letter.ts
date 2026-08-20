/**
 * What a message carries when it stops being retried.
 *
 * A dead-lettered message is read by a human under time pressure, so the
 * headers answer the three questions that person has: what went wrong, how many
 * times it was tried, and which flow it belonged to. The envelope is preserved
 * untouched, so a message can be republished from here without being rebuilt.
 */

export const FAILURE_REASON_HEADER = 'x-failure-reason';
export const FAILED_AT_HEADER = 'x-failed-at';
export const ORIGINAL_ROUTING_KEY_HEADER = 'x-original-routing-key';
export const ATTEMPT_HEADER = 'x-attempt';

/** Why a message is being parked, and whether retrying could ever have helped. */
export type FailureKind =
  /** The message could not be understood. Retrying it never repairs it. */
  | 'invalid'
  /** The handler failed on a message it understood. Retrying may help. */
  | 'handler-error';

export interface DeadLetterContext {
  readonly attempt: number;
  readonly kind: FailureKind;
  readonly reason: string;
  readonly routingKey: string;
  readonly failedAt?: string;
}

/**
 * Builds the headers for a dead-lettered delivery.
 *
 * The reason is truncated rather than passed through whole: an unbounded error
 * message can carry a stack trace, a connection string or a payload fragment
 * into a queue that outlives the incident.
 */
export function deadLetterHeaders(context: DeadLetterContext): Record<string, string | number> {
  return {
    [ATTEMPT_HEADER]: context.attempt,
    [FAILURE_REASON_HEADER]: `${context.kind}: ${context.reason}`.slice(0, 512),
    [FAILED_AT_HEADER]: context.failedAt ?? new Date().toISOString(),
    [ORIGINAL_ROUTING_KEY_HEADER]: context.routingKey,
  };
}

/** The terminal queue for a work queue. */
export function deadLetterQueueFor(queue: string): string {
  return `${queue}.dlq`;
}
