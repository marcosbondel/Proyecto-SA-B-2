/**
 * The one thing this application's readiness can honestly assert.
 *
 * A pure function, deliberately, for the reason everything that decides
 * something in this application is one: `apps/web` has no component test
 * framework (TD-010), so logic that lives in a handler is logic nobody can
 * assert. Here it is `node --test`-able.
 */

export type GatewayConfigVerdict =
  | { readonly ok: true; readonly gateway: string }
  | { readonly ok: false; readonly reason: string };

/**
 * Whether the browser will be able to reach the Gateway with what this process
 * was configured with.
 *
 * Note what is *not* checked: whether the Gateway is up. It is deliberate, and
 * it is the whole design of this probe. `NUXT_PUBLIC_API_BASE_URL` is public
 * runtime config — the **browser** resolves it, from the user's machine, and
 * this server never calls it. A readiness probe that pinged the Gateway would
 * therefore be measuring a path that is not the one that matters, and would
 * take the interface out of rotation during an API outage — exactly when a user
 * needs it up to be told, in words, that the bank is not answering. The shell
 * already renders that state; it cannot render it from a pod with no endpoints.
 *
 * So this checks configuration, which is the failure this process can actually
 * cause: an absolute `http`/`https` origin the browser can resolve. A relative
 * path or a missing value produces an interface that is up and useless, which
 * is worse than one that is honestly unready.
 */
export function describeGatewayConfig(apiBaseUrl: unknown): GatewayConfigVerdict {
  if (typeof apiBaseUrl !== 'string' || apiBaseUrl.trim() === '') {
    return { ok: false, reason: 'NUXT_PUBLIC_API_BASE_URL is empty' };
  }

  let parsed: URL;

  try {
    parsed = new URL(apiBaseUrl);
  } catch {
    return {
      ok: false,
      reason: `NUXT_PUBLIC_API_BASE_URL is not an absolute URL: ${apiBaseUrl}`,
    };
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return {
      ok: false,
      reason: `NUXT_PUBLIC_API_BASE_URL must be http or https, got ${parsed.protocol}`,
    };
  }

  return { ok: true, gateway: parsed.origin };
}
