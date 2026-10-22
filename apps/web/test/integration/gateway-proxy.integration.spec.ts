import { createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startNitro, type NitroHandle } from './support/nitro-process';
import {
  UPSTREAM_TRACE_ID,
  fakeJpegBytes,
  startUpstreamStub,
  type UpstreamStub,
} from './support/upstream-stub';

/**
 * `apps/web/server/routes/api/[...slug].ts` end to end: a real Nitro process
 * in front, a real `node:http` upstream behind it — every case here crosses
 * two process boundaries, not one.
 *
 * This file manages its own Nitro processes rather than sharing the one
 * `global-setup.ts` starts for `pages-ssr`/`session-guard`, because it needs
 * several different environments (`GATEWAY_URL` set, unset, empty,
 * conflicting with `NUXT_PUBLIC_API_BASE_URL`) and that server's `GATEWAY_URL`
 * is fixed for its whole lifetime — a separate OS process cannot have its own
 * `process.env` mutated from here after it starts. What stays shared is the
 * one `nuxt build` `global-setup.ts` already ran: every process started below
 * reuses that same `.output`, so each of these is only a Node boot, not a
 * rebuild.
 */
let stub: UpstreamStub;
let main: NitroHandle;
let noConfig: NitroHandle;
let publicVarOnly: NitroHandle;
let gatewayWins: NitroHandle;
let unreachableGateway: NitroHandle;

// No trailing slash: the proxy handler builds the upstream URL as
// `${target}${event.path}` with no normalisation
// (`apps/web/server/routes/api/[...slug].ts`), and `event.path` always starts
// with `/`. `GATEWAY_URL` in every real deployment is written the same way
// (`http://gateway:3000`, see that file's own comments) — a trailing slash
// here would be a self-inflicted `//api/...` bug in the stub, not a finding
// about the proxy.
const UNROUTABLE = 'http://127.0.0.1:1';

beforeAll(async () => {
  stub = await startUpstreamStub();
  const stubOrigin = stub.baseUrl.replace(/\/$/, '');

  [main, noConfig, publicVarOnly, gatewayWins, unreachableGateway] = await Promise.all([
    startNitro({ GATEWAY_URL: stubOrigin, NUXT_PUBLIC_API_BASE_URL: stubOrigin }),
    startNitro({ GATEWAY_URL: undefined, NUXT_PUBLIC_API_BASE_URL: '' }),
    startNitro({ GATEWAY_URL: undefined, NUXT_PUBLIC_API_BASE_URL: stubOrigin }),
    startNitro({ GATEWAY_URL: stubOrigin, NUXT_PUBLIC_API_BASE_URL: UNROUTABLE }),
    // A port nothing listens on: connection refused, not a timeout.
    startNitro({ GATEWAY_URL: UNROUTABLE, NUXT_PUBLIC_API_BASE_URL: UNROUTABLE }),
  ]);
}, 60_000);

afterAll(async () => {
  await Promise.all([
    main?.close(),
    noConfig?.close(),
    publicVarOnly?.close(),
    gatewayWins?.close(),
    unreachableGateway?.close(),
  ]);
  await stub?.close();
});

describe('the path and query string', () => {
  it('keeps the /api prefix intact', async () => {
    const response = await fetch(new URL('/api/echo', main.baseUrl));
    const body = (await response.json()) as { url: string };

    expect(body.url.startsWith('/api/echo')).toBe(true);
  });

  it('forwards the query string verbatim', async () => {
    const response = await fetch(new URL('/api/echo?a=1&b=two%20words&c=', main.baseUrl));
    const body = (await response.json()) as { url: string };

    expect(body.url).toBe('/api/echo?a=1&b=two%20words&c=');
  });
});

describe('the status the Gateway chose, and not one the proxy invented', () => {
  /**
   * The seven codes the Gateway's own error table can produce, plus the two
   * success shapes. A proxy that collapses 401 and 403 into one, or turns a
   * business 422 into a 500, breaks every screen that decides what to say from
   * the status — and `app/lib/gateway-error.ts` decides exactly that.
   *
   * The stub's `…/status/<code>` route existed before this suite and nothing
   * used it; these are the cases it was built for.
   */
  it.each([200, 201, 202, 400, 401, 403, 404, 409, 422, 500, 503, 504])(
    'relays %i unchanged',
    async (code) => {
      const response = await fetch(new URL(`/api/status/${code}`, main.baseUrl));

      expect(response.status).toBe(code);
    },
  );

  it('does not turn an upstream 500 into a Nitro error page', async () => {
    const response = await fetch(new URL('/api/status/500', main.baseUrl));

    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain('<!DOCTYPE html>');
  });
});

describe('headers', () => {
  it('forwards Authorization', async () => {
    const response = await fetch(new URL('/api/echo', main.baseUrl), {
      headers: { authorization: 'Bearer test-token-123' },
    });
    const body = (await response.json()) as { headers: Record<string, string> };

    expect(body.headers.authorization).toBe('Bearer test-token-123');
  });

  it('forwards x-correlation-id to the upstream and returns it on the response', async () => {
    const response = await fetch(new URL('/api/echo', main.baseUrl), {
      headers: { 'x-correlation-id': 'corr-abc-999' },
    });
    const body = (await response.json()) as { headers: Record<string, string> };

    expect(body.headers['x-correlation-id']).toBe('corr-abc-999');
    expect(response.headers.get('x-correlation-id')).toBe('corr-abc-999');
  });

  /**
   * T-45: the trace id is what the frontend shows beside the correlation id, and
   * it reaches the browser through this proxy whenever the page is served over
   * HTTPS and talks to the Gateway same-origin. A proxy that kept only the
   * headers it knew by name would drop it and the screen would show nothing.
   */
  it('returns the x-trace-id the upstream chose', async () => {
    const response = await fetch(new URL('/api/traced', main.baseUrl));

    expect(response.headers.get('x-trace-id')).toBe(UPSTREAM_TRACE_ID);
    expect(response.headers.get('x-correlation-id')).toBe('corr-traced');
  });

  /**
   * Cloud Run's front end stamps a `traceparent` on every request, sampled or
   * not by its own rules. Forwarded, the Gateway inherited "do not sample" and
   * showed the screen a trace id Tempo never received.
   */
  it('does not forward the trace context of whoever called the proxy', async () => {
    const response = await fetch(new URL('/api/echo', main.baseUrl), {
      headers: {
        traceparent: '00-081f9218dd1bbd8b0002740d2163bd9b-1111222233334444-00',
        tracestate: 'gcp=abc',
      },
    });
    const body = (await response.json()) as { headers: Record<string, string | undefined> };

    expect(body.headers.traceparent).toBeUndefined();
    expect(body.headers.tracestate).toBeUndefined();
  });

  it('preserves Content-Type from the client to the upstream', async () => {
    const response = await fetch(new URL('/api/echo', main.baseUrl), {
      method: 'POST',
      headers: { 'content-type': 'application/vnd.bank.v2+json' },
      body: JSON.stringify({ ok: true }),
    });
    const body = (await response.json()) as { headers: Record<string, string> };

    expect(body.headers['content-type']).toBe('application/vnd.bank.v2+json');
  });

  it('preserves Content-Type from the upstream back to the client', async () => {
    const response = await fetch(new URL('/api/binary', main.baseUrl));

    expect(response.headers.get('content-type')).toBe('image/jpeg');
  });
});

/**
 * `server/routes/interbank/[...slug].ts`: the HTTPS entry a partner bank calls.
 * Same target as `/api`, but the partner's trace id must survive the hop.
 */
describe('the interbank proxy', () => {
  type Echo = { url: string; headers: Record<string, string | undefined> };

  it('keeps the /interbank/v1 path and the query string', async () => {
    const response = await fetch(new URL('/interbank/v1/echo?date=2026-10-22', main.baseUrl));
    const body = (await response.json()) as Echo;

    expect(body.url).toBe('/interbank/v1/echo?date=2026-10-22');
  });

  it('forwards the API key and the Idempotency-Key', async () => {
    const response = await fetch(new URL('/interbank/v1/echo', main.baseUrl), {
      method: 'POST',
      headers: { 'x-api-key': 'partner-key', 'idempotency-key': 'idem-1' },
      body: '{}',
    });
    const body = (await response.json()) as Echo;

    expect(body.headers['x-api-key']).toBe('partner-key');
    expect(body.headers['idempotency-key']).toBe('idem-1');
  });

  it.each([200, 202, 401, 404, 409, 422])('relays %i unchanged', async (code) => {
    const response = await fetch(new URL(`/interbank/v1/status/${String(code)}`, main.baseUrl));

    expect(response.status).toBe(code);
  });

  it("keeps the caller's trace id and forces it sampled", async () => {
    const response = await fetch(new URL('/interbank/v1/echo', main.baseUrl), {
      headers: {
        traceparent: '00-1234567890abcdef1234567890abcdef-1111222233334444-00',
        tracestate: 'gcp=abc',
      },
    });
    const body = (await response.json()) as Echo;

    expect(body.headers.traceparent).toBe('00-1234567890abcdef1234567890abcdef-1111222233334444-01');
    expect(body.headers.tracestate).toBeUndefined();
  });

  it('drops a malformed traceparent instead of forwarding it', async () => {
    const response = await fetch(new URL('/interbank/v1/echo', main.baseUrl), {
      headers: { traceparent: 'not-a-trace' },
    });
    const body = (await response.json()) as Echo;

    expect(body.headers.traceparent).toBeUndefined();
  });

  it('answers 503 when no Gateway is configured', async () => {
    const response = await fetch(new URL('/interbank/v1/health', noConfig.baseUrl));

    expect(response.status).toBe(503);
  });
});

describe('status passthrough', () => {
  it.each([200, 202, 401, 403, 404, 422, 500])('relays upstream status %d unchanged', async (code) => {
    const response = await fetch(new URL(`/api/status/${String(code)}`, main.baseUrl));

    expect(response.status).toBe(code);
  });
});

describe('request bodies are forwarded byte-identically', () => {
  it.each(['POST', 'PATCH', 'DELETE', 'PUT'] as const)('%s body survives the round trip', async (method) => {
    const payload = JSON.stringify({ method, nested: { list: [1, 2, 3], note: 'áéíóú €' } });
    const expectedSha = createHash('sha256').update(payload).digest('hex');

    const response = await fetch(new URL('/api/echo', main.baseUrl), { method, body: payload });
    const body = (await response.json()) as { bodySha256: string; bodyLength: number };

    expect(body.bodySha256).toBe(expectedSha);
    expect(body.bodyLength).toBe(Buffer.byteLength(payload));
  });

  /**
   * `HEAD` cannot carry a body through the Fetch API at all — `fetch()`
   * throws `TypeError: Request with a HEAD method cannot have a body`, a
   * platform rule this proxy has no say over. What is actually testable for
   * `HEAD` is that the method and headers still make the round trip; the
   * "bodies forwarded" half of the suggested inventory does not apply to it,
   * and pretending otherwise would be a case that cannot fail.
   */
  it('HEAD forwards the method with no body, rather than being rejected', async () => {
    const response = await fetch(new URL('/api/echo', main.baseUrl), {
      method: 'HEAD',
      headers: { 'x-correlation-id': 'head-check' },
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('x-correlation-id')).toBe('head-check');
  });
});

describe('multipart is forwarded, not re-encoded', () => {
  it('keeps the exact boundary and byte length of a multipart body', async () => {
    const boundary = '----bankUsacTestBoundary123456';
    const jpeg = fakeJpegBytes();
    const parts = [
      `--${boundary}\r\n`,
      'Content-Disposition: form-data; name="dpi"; filename="dpi.jpg"\r\n',
      'Content-Type: image/jpeg\r\n\r\n',
    ];
    const head = Buffer.from(parts.join(''), 'utf8');
    const tail = Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8');
    const payload = Buffer.concat([head, jpeg, tail]);

    const response = await fetch(new URL('/api/echo', main.baseUrl), {
      method: 'POST',
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
      body: payload,
    });
    const body = (await response.json()) as {
      bodyLength: number;
      bodySha256: string;
      headers: Record<string, string>;
    };

    expect(body.headers['content-type']).toBe(`multipart/form-data; boundary=${boundary}`);
    expect(body.bodyLength).toBe(payload.length);
    expect(body.bodySha256).toBe(createHash('sha256').update(payload).digest('hex'));
  });
});

describe('a binary response', () => {
  it('returns the upstream image/jpeg with a matching sha256', async () => {
    const expected = fakeJpegBytes();
    const response = await fetch(new URL('/api/binary', main.baseUrl));
    const received = Buffer.from(await response.arrayBuffer());

    expect(createHash('sha256').update(received).digest('hex')).toBe(
      createHash('sha256').update(expected).digest('hex'),
    );
    expect(received.equals(expected)).toBe(true);
  });
});

describe('a body over 1MB', () => {
  it('survives the round trip through the proxy', async () => {
    const big = Buffer.alloc(1_200_000);

    for (let i = 0; i < big.length; i += 1) {
      big[i] = i % 256;
    }
    const expectedSha = createHash('sha256').update(big).digest('hex');

    const response = await fetch(new URL('/api/big', main.baseUrl), { method: 'POST', body: big });
    const body = (await response.json()) as { bodySha256: string; bodyLength: number };

    expect(body.bodyLength).toBe(big.length);
    expect(body.bodySha256).toBe(expectedSha);
  });
});

describe('an upstream that refuses the connection', () => {
  it('answers with a server error rather than hanging', async () => {
    const started = Date.now();
    const response = await fetch(new URL('/api/echo', unreachableGateway.baseUrl));
    const elapsedMs = Date.now() - started;

    expect(response.status).toBeGreaterThanOrEqual(500);
    expect(response.status).toBeLessThan(600);
    // Generous, but the point is "did not hang until the test timeout" —
    // connection refusal is near-instant on loopback.
    expect(elapsedMs).toBeLessThan(10_000);
  });
});

describe('which target wins', () => {
  it('GATEWAY_URL overrides NUXT_PUBLIC_API_BASE_URL', async () => {
    // gatewayWins: GATEWAY_URL -> the real stub, NUXT_PUBLIC_API_BASE_URL ->
    // an unroutable address. A request that succeeds proves GATEWAY_URL was
    // the one actually used.
    const response = await fetch(new URL('/api/echo', gatewayWins.baseUrl));

    expect(response.status).toBe(200);
  });

  it('falls back to NUXT_PUBLIC_API_BASE_URL when GATEWAY_URL is unset', async () => {
    const response = await fetch(new URL('/api/echo', publicVarOnly.baseUrl));
    const body = (await response.json()) as { url: string };

    expect(response.status).toBe(200);
    expect(body.url.startsWith('/api/echo')).toBe(true);
  });

  it('answers 503 "Gateway no configurado" when neither is a usable http(s) origin', async () => {
    const response = await fetch(new URL('/api/echo', noConfig.baseUrl));

    expect(response.status).toBe(503);

    const body = (await response.json()) as { statusMessage?: string; message?: string };

    expect(`${body.statusMessage ?? ''} ${body.message ?? ''}`).toContain('Gateway no configurado');
  });
});

describe('/health', () => {
  it('answers JSON, not the two-byte text/html the Prometheus module would serve', async () => {
    const response = await fetch(new URL('/health', main.baseUrl));
    const body = (await response.json()) as { status: string; application: string };

    expect(response.headers.get('content-type')).toContain('application/json');
    expect(body).toEqual({ status: 'ok', application: 'web' });
  });
});

describe('/ready', () => {
  it('is 200 when the Gateway origin is configured', async () => {
    const response = await fetch(new URL('/ready', main.baseUrl));

    expect(response.status).toBe(200);

    const body = (await response.json()) as { status: string; gateway: string };

    expect(body.status).toBe('ready');
    expect(body.gateway).toBe(stub.baseUrl.replace(/\/$/, ''));
  });

  it('is 503 when neither origin is usable', async () => {
    const response = await fetch(new URL('/ready', noConfig.baseUrl));

    expect(response.status).toBe(503);

    const body = (await response.json()) as { status: string; gateway: string };

    expect(body.status).toBe('degraded');
    expect(body.gateway).toBe('misconfigured');
  });
});
