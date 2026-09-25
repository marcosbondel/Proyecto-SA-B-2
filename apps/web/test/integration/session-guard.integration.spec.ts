import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPage, setup, url } from '@nuxt/test-utils/e2e';
import type { Page } from 'playwright-core';

import { fakeToken } from './support/fake-token';
import { startLoginStub, type LoginStub } from './support/login-stub';
import { startNitro, WEB_ROOT, type NitroHandle } from './support/nitro-process';
import { modulesFor } from '../../app/lib/navigation';

/**
 * `app/middleware/auth.global.ts` end to end, the one thing
 * `pages-ssr.integration.spec.ts` proved a plain HTTP client cannot observe:
 * the guard is entirely client-side (`if (import.meta.server) return`, and
 * the session lives only in the browser's `sessionStorage`), so seeing it
 * act at all needs a real browser running the real client router — hence
 * `createPage()` / `playwright-core` rather than `fetch`.
 *
 * This file runs its own dedicated Nitro process (reusing the one prebuilt
 * `.output`, same as `gateway-proxy`) in front of a stub that answers
 * `POST /api/auth/login` well enough to make the one real sign-in round trip
 * below honest, rather than sharing the always-`{}` placeholder the other two
 * suites use.
 */
const STORAGE_KEY = 'bank-session-token';

let login: LoginStub;
let server: NitroHandle;

beforeAll(async () => {
  login = await startLoginStub();
  server = await startNitro({ GATEWAY_URL: login.baseUrl, NUXT_PUBLIC_API_BASE_URL: login.baseUrl });

  await setup({ host: server.baseUrl, rootDir: WEB_ROOT });
}, 60_000);

afterAll(async () => {
  await server?.close();
  await login?.close();
});

/** Injects a session before the page's own scripts run, for every navigation this page makes from here on. */
async function signInAs(
  page: Page,
  role: 'CLIENTE' | 'CAJERO_RECEPTOR' | 'ADMINISTRADOR',
): Promise<void> {
  const token = fakeToken({ sub: `customer-${role.toLowerCase()}`, username: `${role.toLowerCase()}-user`, role });

  await page.addInitScript(
    ([key, value]) => {
      window.sessionStorage.setItem(key, value);
    },
    [STORAGE_KEY, token],
  );
}

async function navRailLabels(page: Page): Promise<string[]> {
  const items = await page.locator('nav[aria-label="Módulos"] a').allTextContents();

  return items.map((text) => text.trim()).filter((text) => text.length > 0);
}

describe('an anonymous visitor', () => {
  it('is bounced from a guarded route to /login with ?next set', async () => {
    const page = await createPage('/cuentas', { waitUntil: 'hydration' });

    try {
      const current = new URL(page.url());

      expect(current.pathname).toBe('/login');
      expect(current.searchParams.get('next')).toBe('/cuentas');
    } finally {
      await page.close();
    }
  });

  it('can still reach a guest-only route', async () => {
    const page = await createPage('/login', { waitUntil: 'hydration' });

    try {
      expect(new URL(page.url()).pathname).toBe('/login');
      expect(await page.locator('form').count()).toBeGreaterThan(0);
    } finally {
      await page.close();
    }
  });
});

describe('a signed-in visitor', () => {
  it('is bounced off /login to the landing page', async () => {
    const page = await createPage();

    try {
      await signInAs(page, 'CLIENTE');
      await page.goto(url('/login'), { waitUntil: 'hydration' });

      expect(new URL(page.url()).pathname).toBe('/');
    } finally {
      await page.close();
    }
  });

  it('a CLIENTE visiting /auditoria is bounced to the landing page', async () => {
    const page = await createPage();

    try {
      await signInAs(page, 'CLIENTE');
      await page.goto(url('/auditoria'), { waitUntil: 'hydration' });

      expect(new URL(page.url()).pathname).toBe('/');
    } finally {
      await page.close();
    }
  });

  it('an ADMINISTRADOR visiting /auditoria is not bounced', async () => {
    const page = await createPage();

    try {
      await signInAs(page, 'ADMINISTRADOR');
      await page.goto(url('/auditoria'), { waitUntil: 'hydration' });

      expect(new URL(page.url()).pathname).toBe('/auditoria');
    } finally {
      await page.close();
    }
  });
});

describe('the navigation rail', () => {
  it.each(['CLIENTE', 'CAJERO_RECEPTOR', 'ADMINISTRADOR'] as const)(
    'for %s matches modulesFor(role) exactly',
    async (role) => {
      const page = await createPage();

      try {
        await signInAs(page, role);
        await page.goto(url('/'), { waitUntil: 'hydration' });

        const rendered = await navRailLabels(page);
        const expected = modulesFor(role).map((module) => module.label);

        expect(rendered).toEqual(expected);
      } finally {
        await page.close();
      }
    },
  );
});
