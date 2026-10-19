import { describe, expect, it } from 'vitest';
import { $fetch, fetch, setup } from '@nuxt/test-utils/e2e';

import { WEB_ROOT } from './support/nitro-process';
import { topLevelNuxtConfigKeys } from './support/nuxt-payload';

/**
 * The first thing in this repository that actually **renders** the 34 `.vue`
 * screens (TD-054: "the whole prototype was implemented without opening a
 * browser"). Every case below drives a real Nitro process — built once by
 * `test/integration/support/global-setup.ts` — over plain HTTP.
 *
 * **What this suite cannot show**, and why the routes below all assert `200`
 * rather than the redirect `app/middleware/auth.global.ts` would seem to
 * promise for a guarded route: the middleware opens with
 * `if (import.meta.server) return`, and the session it decides on lives only
 * in the browser's `sessionStorage` (`app/composables/useSession.ts`). Server
 * rendering never has a session to evaluate and never redirects — every route
 * below, guarded or not, renders its shell at `200` for an anonymous request.
 * That is not a bug this suite found; it is documented in the middleware
 * itself ("This is convenience, not security"). But it does mean a guard can
 * only be observed with a browser that actually runs the client-side router,
 * which is what `session-guard.integration.spec.ts` does instead, over a real
 * `playwright-core` page against this same kind of server.
 */
await setup({
  host: process.env.WEB_IT_BASE_URL,
  rootDir: WEB_ROOT,
});

/**
 * Every screen `app/pages/**` defines, with a placeholder id where the route
 * is dynamic. `docs/FRONTEND.md#the-screen-inventory` is the authoritative
 * count (34 screens; some share a route, e.g. `/` resolves to one of three
 * dashboards picked by `dashboardFor`); this is the route list, which is what
 * an HTTP client actually addresses.
 */
const ROUTES: readonly string[] = [
  '/',
  '/login',
  '/registro',
  '/activar',
  '/recuperar',
  '/restablecer',
  '/perfil',
  '/notificaciones',
  '/clientes',
  '/clientes/nuevo',
  '/clientes/1',
  '/clientes/validaciones',
  '/clientes/validaciones/1',
  '/cuentas',
  '/cuentas/nueva',
  '/cuentas/deposito',
  '/cuentas/administracion',
  '/cuentas/1',
  '/transferencias',
  '/transferencias/nueva',
  '/transferencias/monitor',
  '/transferencias/interbancaria',
  '/transferencias/interbancarias',
  '/transferencias/interbancarias/1',
  '/transferencias/1',
  '/pagos',
  '/pagos/nuevo',
  '/pagos/monitor',
  '/pagos/1',
  '/auditoria',
  '/auditoria/notificaciones',
];

describe('every page route renders through a real Nitro process', () => {
  it.each(ROUTES)('GET %s answers 200 with an HTML shell', async (route) => {
    const response = await fetch(route);

    expect(response.status, `${route} did not answer 200`).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/html');

    const body = await response.text();

    expect(body).toContain('id="__nuxt"');
  });
});

describe('the served stylesheet', () => {
  it('is more than one byte — the defect nuxt.config.ts documents by name', async () => {
    const html = await $fetch('/');
    const hrefMatch = /href="([^"]+\.css)"/.exec(html);

    expect(hrefMatch, 'no <link rel="stylesheet"> found in the rendered HTML').not.toBeNull();

    const cssResponse = await fetch(hrefMatch![1]);

    expect(cssResponse.status).toBe(200);

    const css = await cssResponse.text();

    // The original defect was a *one-byte* stylesheet — @nuxt/ui without an
    // entry that imports it and Tailwind compiles to nothing. Comfortably
    // above one byte is the bar this integration layer can actually assert
    // against a real build; `test/stylesheet.test.mjs` already asserts the
    // >50KB Tailwind-compiled bar against the source and the last build.
    expect(css.length).toBeGreaterThan(1);
  });

  it('carries the --ui-primary custom property', async () => {
    const html = await $fetch('/');
    const hrefMatch = /href="([^"]+\.css)"/.exec(html);
    const css = await $fetch<string>(hrefMatch![1]);

    expect(css).toContain('--ui-primary');
  });
});

describe('the favicon', () => {
  it('is served', async () => {
    const response = await fetch('/favicon.svg');

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('svg');
  });
});

describe('an address that does not exist', () => {
  /**
   * **Real defect this suite found, not a design choice**: a direct SSR hit
   * on an unmatched path never reaches `app/error.vue`. Vue Router fails to
   * match server-side (`[VUE_ROUTER_R0004] No match found`, logged by the
   * Nitro process), and instead of that being caught and turned into
   * `app/error.vue`'s anti-enumeration screen, it surfaces as Nitro's own
   * generic JSON error — `{"error":true,"statusCode":404,"statusMessage":
   * "Page not found: ...","data":{"path":"..."}}` — with security headers
   * (`content-security-policy: script-src 'none'`) that read as an
   * infrastructure error page, not a screen the design system drew. The
   * status code is right; the body and content-type are not what
   * `app/error.vue`'s own doc comment promises ("the prototype draws one
   * screen for both" 404 and 403).
   *
   * `session-guard.integration.spec.ts` checks whether a *client-side*
   * navigation to the same path fares better, since `error.vue` is reached
   * through Nuxt's app-level error hooks, which a server-side router-match
   * failure apparently bypasses.
   */
  it('answers 404, but as Nitro\'s generic JSON error rather than error.vue', async () => {
    const response = await fetch('/this-route-does-not-exist');
    const body = (await response.json()) as { error?: boolean; statusCode?: number };

    expect(response.status).toBe(404);
    expect(response.headers.get('content-type')).toContain('application/json');
    expect(body.error).toBe(true);
    expect(body.statusCode).toBe(404);
  });

  it('does not carry the anti-enumeration wording error.vue defines for this case', async () => {
    const response = await fetch('/this-route-does-not-exist');
    const body = await response.text();

    // Documents the gap rather than asserting the friendlier text that a
    // reader of `app/error.vue` would expect: it genuinely is not there.
    expect(body).not.toContain('Esta pantalla no existe o no tienes permisos');
  });
});

describe('the __NUXT__ payload', () => {
  it('exposes apiBaseUrl under public', async () => {
    const html = await $fetch('/');

    expect(html).toContain('apiBaseUrl');
    expect(html).toContain(process.env.WEB_IT_PLACEHOLDER_GATEWAY_URL ?? '');
  });

  it('carries no top-level key outside the known, public shape', async () => {
    const html = await $fetch('/');
    const keys = topLevelNuxtConfigKeys(html);

    // `runtimeConfig` in nuxt.config.ts defines only `public` — there is no
    // private key to leak — but this pins the *shape* of what is exposed
    // rather than trusting that no one ever adds one next to it. `app` is
    // Nuxt's own build metadata (baseURL, buildId, cdnURL), not application
    // config.
    expect(keys.sort()).toEqual(['app', 'public'].sort());
  });
});
