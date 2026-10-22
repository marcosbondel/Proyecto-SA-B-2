import type { H3Event } from 'h3';

/**
 * The Gateway origin both proxies (`/api/**` and `/interbank/**`) forward to.
 *
 * Where it comes from, in order:
 *
 * 1. `GATEWAY_URL` — an explicit override for the server side only. The browser
 *    never sees it, which is what makes it usable for an address that is
 *    reachable from inside the cluster but not from outside.
 * 2. `apiBaseUrl` — `NUXT_PUBLIC_API_BASE_URL`, which `nuxt.config.ts` already
 *    defaults to `http://localhost:3000` for a developer running the stack on
 *    their machine.
 *
 * There is deliberately **no third fallback**. The `/api` proxy used to end
 * with a hard-coded `http://34.27.60.211:3000` — the GKE load balancer's
 * address at the time it was written. A misconfigured deployment silently
 * forwarding its users' requests — credentials included — to whatever now
 * answers at an address nobody remembers pinning is worse than one that does
 * not start, so it answers 503 instead.
 */
export function resolveGatewayTarget(event: H3Event): string {
  const config = useRuntimeConfig(event);
  const configured =
    typeof config.public.apiBaseUrl === 'string' && config.public.apiBaseUrl.startsWith('http')
      ? config.public.apiBaseUrl
      : undefined;

  const target = process.env.GATEWAY_URL || configured;

  if (target === undefined) {
    throw createError({
      statusCode: 503,
      statusMessage: 'Gateway no configurado',
      message:
        'Ni GATEWAY_URL ni NUXT_PUBLIC_API_BASE_URL apuntan a un origen http(s). ' +
        'Revisa la configuración del despliegue.',
    });
  }

  return target;
}

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

  return match === null ? undefined : `00-${match[1]}-${match[2]}-01`;
}
