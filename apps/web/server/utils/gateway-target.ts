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
