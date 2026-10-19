import { isSpanContextValid, trace } from '@opentelemetry/api';

/**
 * The W3C trace id of whatever is being handled right now, or `null`.
 *
 * Read from the active span rather than from the message: the envelope carries
 * no trace field and should not grow one, because `@bank/messaging` is where the
 * `traceparent` is injected into and extracted from the AMQP properties (T-48),
 * and a second copy in the payload would be two sources that can disagree.
 *
 * Instrumented against `@opentelemetry/api` only, so with no SDK registered this
 * is a no-op that answers `null`, and the day T-48 registers one the audit trail
 * starts carrying trace ids without a line here changing.
 */
export function activeTraceId(): string | null {
  const context = trace.getActiveSpan()?.spanContext();

  return context !== undefined && isSpanContextValid(context) ? context.traceId : null;
}
