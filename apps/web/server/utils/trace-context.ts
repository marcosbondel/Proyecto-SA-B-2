/**
 * Pure, so `node --test` can assert it without a Nitro server (the reason
 * `gateway-config.ts` is one too).
 */

const TRACEPARENT = /^00-([0-9a-f]{32})-([0-9a-f]{16})-[0-9a-f]{2}$/;

/**
 * The caller's `traceparent` with the sampled flag forced on, or `undefined`
 * when there is none or it is malformed.
 *
 * The trace id is kept because it is the point: a partner bank that calls us
 * with its own trace must find our half of the transfer under the same id
 * (§4.1, traceability across banks). Cloud Run keeps a caller's trace id
 * (verified in production on 2026-10-22). The flag is forced because Cloud Run
 * also invents a `traceparent` for callers that send none, sampled or not by
 * Google's own rules, and the Gateway honours its parent's decision — an
 * unsampled parent would give an `X-Trace-Id` that Tempo never receives (the
 * defect `/api` fixed by dropping the header). The Gateway samples everything
 * it roots itself, so forcing the flag is its own policy, not a new one.
 */
export function sampledTraceparent(value: string | string[] | undefined): string | undefined {
  const match = typeof value === 'string' ? TRACEPARENT.exec(value.trim().toLowerCase()) : null;
  const traceId = match?.[1];
  const parentId = match?.[2];

  // All zeros is the W3C spelling of "no id": forwarding it would make the
  // Gateway discard the header anyway, so it is dropped here, visibly.
  if (traceId === undefined || parentId === undefined || /^0+$/.test(traceId) || /^0+$/.test(parentId)) {
    return undefined;
  }

  return `00-${traceId}-${parentId}-01`;
}
