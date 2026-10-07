import { isSpanContextValid, trace } from '@opentelemetry/api';

/**
 * The W3C trace id of the request being served, or `null` (T-45).
 *
 * What the frontend shows beside the `correlationId` and what an operator pastes
 * into the trace search: the technical trace, where the correlation id is the
 * business flow. Read from the active span through `@opentelemetry/api` alone,
 * so with no SDK registered this answers `null` and the response carries no
 * header at all — and the day T-48 registers the SDK, whose HTTP instrumentation
 * opens the server span before the middleware runs, it starts answering without
 * a line here changing.
 */
export function activeTraceId(): string | null {
  const context = trace.getActiveSpan()?.spanContext();

  return context !== undefined && isSpanContextValid(context) ? context.traceId : null;
}
