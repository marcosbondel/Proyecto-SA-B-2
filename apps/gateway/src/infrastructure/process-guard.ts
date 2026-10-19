/**
 * The last line of defence against one stray promise taking the public entry
 * point down.
 *
 * Since Node 15 an unhandled rejection ends the process with code 1. For a
 * service whose only input is messages, restarting is defensible (TD-092). For
 * the Gateway it is not: every replica shares the same fate, the public IP
 * refuses connections until a pod is Ready again, and the request that caused
 * it was already answered or abandoned. On 2026-10-19 a single `REPLY_TIMEOUT`
 * nobody had observed did exactly that to every pod within ten seconds of
 * RabbitMQ going away.
 *
 * So a rejection is **logged and survived**. The log line carries the
 * correlation identifier when the rejected value has one (a `GatewayError`
 * does not, but anything the broker adapters throw may), which is what lets an
 * operator join it to the request that started it.
 *
 * An *uncaught exception* is deliberately not handled here: that is a thrown
 * error with no promise to blame, the process state is genuinely unknown, and
 * dying is the right answer.
 */

/** The slice of `process` this guard uses, so a test can pass a fake. */
export interface RejectionSource {
  on(event: 'unhandledRejection', listener: (reason: unknown) => void): unknown;
}

/** The slice of the logger this guard uses. */
export interface GuardLogger {
  error(message: string, fields?: Record<string, unknown>): void;
}

function describeReason(reason: unknown): Record<string, unknown> {
  if (reason instanceof Error) {
    const withFields = reason as Error & { type?: unknown; correlationId?: unknown };
    return {
      error: reason.message,
      errorName: reason.name,
      ...(typeof withFields.type === 'string' ? { errorType: withFields.type } : {}),
      ...(typeof withFields.correlationId === 'string'
        ? { correlationId: withFields.correlationId }
        : {}),
    };
  }

  return { error: String(reason) };
}

export function installUnhandledRejectionGuard(
  logger: GuardLogger,
  source: RejectionSource = process,
): void {
  source.on('unhandledRejection', (reason: unknown) => {
    logger.error('unhandled promise rejection survived', describeReason(reason));
  });
}
