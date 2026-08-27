import { describeGatewayConfig } from '../utils/gateway-config';

/**
 * Readiness. `200` when this replica can serve a usable interface, `503` when
 * it cannot.
 *
 * "Usable" here means one thing the process controls: the Gateway origin the
 * browser will be handed is a real absolute origin. It does **not** mean the
 * Gateway is up — see `describeGatewayConfig` for why coupling the two would be
 * the wrong probe on the wrong path.
 *
 * The status code is the part an orchestrator reads, so a misconfigured replica
 * has to fail with one rather than answer `200` with a sad body.
 */
export default defineEventHandler((event) => {
  const verdict = describeGatewayConfig(useRuntimeConfig(event).public.apiBaseUrl);

  if (!verdict.ok) {
    setResponseStatus(event, 503);

    return {
      status: 'degraded' as const,
      application: 'web',
      gateway: 'misconfigured' as const,
      reason: verdict.reason,
    };
  }

  return {
    status: 'ready' as const,
    application: 'web',
    gateway: verdict.gateway,
  };
});
