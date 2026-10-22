import { resolveGatewayTarget } from '../../utils/gateway-target';
import { sampledTraceparent } from '../../utils/trace-context';

/**
 * HTTPS entry for the interbank contract v1 (`/interbank/v1/*`).
 *
 * The Gateway serves the contract over plain HTTP on its static IP, and §13 of
 * the agreement declared HTTPS an open divergence. Cloud Run already terminates
 * TLS for this application with a Google-managed certificate, so the same
 * origin forwards `/interbank/**` to the Gateway exactly as it does `/api/**`:
 * `https://<cloud-run-host>/interbank/v1`. The Gateway's HTTP address keeps
 * working beside it. The API key, the `Idempotency-Key` and the status (`202`
 * for a new deposit, `200` for a repeat) go through untouched.
 *
 * One difference with `/api`: the caller's trace context is **kept**, not
 * dropped, because a partner bank's trace id is what ties its half of a
 * transfer to ours. See `sampledTraceparent` for why the flag is forced.
 */
export default defineEventHandler(async (event) => {
  const target = resolveGatewayTarget(event);
  const traceparent = sampledTraceparent(event.node.req.headers.traceparent);

  delete event.node.req.headers.tracestate;

  if (traceparent === undefined) {
    delete event.node.req.headers.traceparent;
  } else {
    event.node.req.headers.traceparent = traceparent;
  }

  return proxyRequest(event, `${target}${event.path}`);
});
