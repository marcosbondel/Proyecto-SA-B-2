/**
 * Transparent proxy for Gateway API requests.
 *
 * In production environments (such as Cloud Run over HTTPS), browsers disallow
 * Mixed Content (calling an HTTP Gateway from an HTTPS frontend). This server route
 * proxies /api requests from the same HTTPS origin to the internal/external Gateway.
 *
 * Where the target comes from, in order:
 *
 * 1. `GATEWAY_URL` — an explicit override for the server side only. The browser
 *    never sees it, which is what makes it usable for an address that is
 *    reachable from inside the cluster but not from outside.
 * 2. `apiBaseUrl` — `NUXT_PUBLIC_API_BASE_URL`, which `nuxt.config.ts` already
 *    defaults to `http://localhost:3000` for a developer running the stack on
 *    their machine.
 *
 * There is deliberately **no third fallback**. This file used to end with a
 * hard-coded `http://34.27.60.211:3000` — the GKE load balancer's address at
 * the time it was written. It was unreachable in practice, because step 2
 * always yields something starting with `http`, but it was the wrong kind of
 * unreachable: the one case that did reach it was an empty
 * `NUXT_PUBLIC_API_BASE_URL`, and a misconfigured deployment silently forwarding
 * its users' requests — credentials included — to whatever now answers at an
 * address nobody remembers pinning is worse than one that does not start.
 */
export default defineEventHandler(async (event) => {
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

  return proxyRequest(event, `${target}${event.path}`);
});
