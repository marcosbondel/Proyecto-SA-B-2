/**
 * Transparent proxy for Gateway API requests.
 *
 * In production environments (such as Cloud Run over HTTPS), browsers disallow
 * Mixed Content (calling an HTTP Gateway from an HTTPS frontend). This server route
 * proxies /api requests from the same HTTPS origin to the internal/external Gateway.
 */
export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig(event);
  const target =
    process.env.GATEWAY_URL ||
    (typeof config.public.apiBaseUrl === 'string' && config.public.apiBaseUrl.startsWith('http')
      ? config.public.apiBaseUrl
      : 'http://34.27.60.211:3000');

  return proxyRequest(event, `${target}${event.path}`);
});
