import { execFileSync } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { fileURLToPath } from 'node:url';

import { findFreePort } from './ports';
import { startNitro, WEB_ROOT, type NitroHandle } from './nitro-process';

/**
 * The one place `nuxt build` runs for the whole `test:integration` run.
 *
 * Vitest calls the default export of a `globalSetup` file exactly once, in a
 * process of its own, before any test file starts — which is what makes it
 * the right place for the expensive step. `@nuxt/ui` 4 plus Tailwind 4
 * compiling through Vite is the slow part; every individual spec file then
 * points `@nuxt/test-utils`'s `setup({ host, build: false, server: false })`
 * at an already-running server instead of building or booting its own, so the
 * compile happens once rather than once per file.
 *
 * The base URL for the shared, persistent server this function starts is
 * handed to every worker through `process.env.WEB_IT_BASE_URL` — `process.env`
 * mutations made here are inherited by the workers Vitest spawns afterwards,
 * which is the documented way to pass state out of a `globalSetup` (the
 * function itself runs in a separate process, so nothing else survives the
 * trip).
 */
export default async function globalSetup(): Promise<() => Promise<void>> {
  execFileSync(process.execPath, [nuxtBin(), 'build'], {
    cwd: WEB_ROOT,
    stdio: 'inherit',
    env: { ...process.env, NODE_ENV: 'production' },
  });

  const stub = await startPlaceholderUpstream();

  const server = await startNitro({
    GATEWAY_URL: stub.baseUrl,
    NUXT_PUBLIC_API_BASE_URL: stub.baseUrl,
  });

  process.env.WEB_IT_BASE_URL = server.baseUrl;
  process.env.WEB_IT_PLACEHOLDER_GATEWAY_URL = stub.baseUrl;

  return async () => {
    await server.close();
    await new Promise<void>((resolveClose) => {
      stub.server.close(() => {
        resolveClose();
      });
    });
  };
}

/**
 * `fileURLToPath`, not `URL.pathname` — this repository's own path has a
 * space in it (`SA lab`), which `.pathname` would leave URL-encoded as `%20`
 * and hand to `spawn` as a literal three-character substring instead of a
 * space, pointing nowhere. `test/nuxt-restart-breaks-on-spaced-repo-path` is
 * the same landmine hitting `dev:host`.
 */
function nuxtBin(): string {
  return fileURLToPath(new URL('../../../node_modules/nuxt/bin/nuxt.mjs', import.meta.url));
}

/**
 * A universal, always-200 upstream for the **shared, persistent** server.
 *
 * `pages-ssr` and `session-guard` never assert anything about what the
 * Gateway returns — pages fetch nothing during SSR (there is no
 * `useFetch`/`useAsyncData` in `app/pages/**`, only `onMounted`, which runs in
 * the browser) — so this exists only so a client-side `onMounted` fetch after
 * hydration has somewhere to land instead of hitting `ECONNREFUSED` and
 * spamming the browser console. `gateway-proxy.integration.spec.ts` never uses
 * this: it boots its own Nitro processes against upstreams it controls
 * per-case.
 */
async function startPlaceholderUpstream(): Promise<{ server: Server; baseUrl: string }> {
  const server = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end('{}');
  });

  const port = await findFreePort();

  await new Promise<void>((resolveListen) => {
    server.listen(port, '127.0.0.1', resolveListen);
  });

  return { server, baseUrl: `http://127.0.0.1:${String(port)}/` };
}

export type { NitroHandle };
