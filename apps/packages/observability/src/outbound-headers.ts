/**
 * The slice of an undici request this module touches: `headers` is a
 * `name: value\r\n` string on undici 5 and a flat `[name, value, …]` array
 * from undici 6 on, which is what Node's global `fetch` bundles.
 */
export interface OutboundRequest {
  headers: string | (string | string[])[];
}

/** The W3C propagation headers the instrumentation writes itself. */
const TRACE_HEADERS = new Set(['traceparent', 'tracestate']);

/**
 * Removes a `traceparent` / `tracestate` the caller set by hand.
 *
 * `@opentelemetry/instrumentation-undici` injects its own pair after every
 * hook has run and never looks at what is already there, so a client that
 * propagates the trace manually (the partner-bank client of the payment
 * service did, before the SDK could) would put **two** `traceparent` headers
 * on the wire. A receiver may reject the request, join the values into one
 * invalid header, or pick either; none of those is a trace. Dropping the manual
 * pair leaves exactly one, and it names the CLIENT span of this very call.
 *
 * Mutates the request in place, which is the only thing a hook can do.
 */
export function dropManualTraceHeaders(request: OutboundRequest): void {
  if (Array.isArray(request.headers)) {
    const kept: (string | string[])[] = [];

    for (let index = 0; index < request.headers.length; index += 2) {
      const name = request.headers[index];

      if (typeof name === 'string' && TRACE_HEADERS.has(name.toLowerCase())) {
        continue;
      }

      kept.push(name as string, request.headers[index + 1] as string | string[]);
    }

    request.headers.length = 0;
    request.headers.push(...kept);
    return;
  }

  if (typeof request.headers === 'string') {
    request.headers = request.headers
      .split('\r\n')
      .filter((line) => !TRACE_HEADERS.has(line.split(':', 1)[0]?.trim().toLowerCase() ?? ''))
      .join('\r\n');
  }
}
