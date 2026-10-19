import { setRequestAttribute } from '@bank/observability';
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

/**
 * The span attribute that ties a span to the business flow. The same key the
 * messaging layer puts on its PRODUCER and CONSUMER spans
 * (`@bank/messaging`'s telemetry), so one query finds the HTTP span and the
 * message spans of a flow by the one value.
 */
export const CORRELATION_ATTRIBUTE = 'bank.correlation_id';

/**
 * Stamps the correlation id on the request's spans.
 *
 * Until T-60 only the PRODUCER child that publishes the command carried it, so
 * a search for a `correlationId` in Tempo found the middle of the trace and not
 * its root. The first fix tagged `trace.getActiveSpan()`, which inside a Nest
 * middleware is the framework's INTERNAL span, not the HTTP SERVER span the
 * instrumentation opened; `setRequestAttribute` reaches the server span through
 * the RPC metadata `HttpInstrumentation` leaves in the context, and tags the
 * active one too. A no-op with no SDK.
 */
export function tagActiveSpanWithCorrelation(correlationId: string): void {
  setRequestAttribute(CORRELATION_ATTRIBUTE, correlationId);
}
