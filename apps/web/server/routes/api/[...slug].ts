import { resolveGatewayTarget } from '../../utils/gateway-target';

/**
 * Transparent proxy for Gateway API requests.
 *
 * In production environments (such as Cloud Run over HTTPS), browsers disallow
 * Mixed Content (calling an HTTP Gateway from an HTTPS frontend). This server route
 * proxies /api requests from the same HTTPS origin to the internal/external Gateway.
 *
 * Where the target comes from, and why there is no hard-coded fallback, is
 * `resolveGatewayTarget` in `server/utils/gateway-target.ts`.
 */
export default defineEventHandler(async (event) => {
  const target = resolveGatewayTarget(event);

  // The trace context the Gateway must NOT inherit. Cloud Run's front end adds
  // a `traceparent` to every request it routes here, with the sampled flag set
  // or not by Google's own sampling, and `proxyRequest` forwards it. The
  // Gateway's sampler honours a parent's decision, so an unsampled parent made
  // it answer an `X-Trace-Id` it never exported: the id the screen shows, and
  // Tempo answered "Not Found" for it (seen in production on 2026-10-21, about
  // one request in two). Without them the Gateway opens the root of the trace,
  // as it does for a client that calls it directly. Nitro records no spans of
  // its own, so nothing upstream of the Gateway is lost.
  delete event.node.req.headers.traceparent;
  delete event.node.req.headers.tracestate;

  return proxyRequest(event, `${target}${event.path}`);
});
