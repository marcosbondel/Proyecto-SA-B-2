import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPage, setup } from '@nuxt/test-utils/e2e';
import type { Page } from 'playwright-core';

import { fakeToken } from './support/fake-token';
import { startLoginStub, type LoginStub } from './support/login-stub';
import { startNitro, WEB_ROOT, type NitroHandle } from './support/nitro-process';

/**
 * The detail screens of an operation the person did not just start (T-60): the
 * transfer and the payment. The assignment asks the frontend to show the
 * correlation **and** the trace of each operation, and these two screens showed
 * only the first — the correlation they print is the one the operation was born
 * under, which the session never recorded a trace for.
 *
 * The Gateway is played by `page.route`; what is under test is what the screen
 * prints and links, rendered by a real browser against a real Nitro server. Two
 * servers, because the Grafana link is configuration read at start-up.
 */
const STORAGE_KEY = 'bank-session-token';
const GRAFANA = 'http://localhost:3002';

const TRANSFER = '3f1c2d64-6b2f-4b1a-9d5e-0a7c8e5b41d2';
const PAYMENT = '5a1c2d64-6b2f-4b1a-9d5e-0a7c8e5b41d3';
const ORIGIN = '7d41e8b2-9a3f-4c15-8ee0-1b2f9a4c7d10';
const QUERY_CORRELATION = '1c0b2d3e-5f6a-4b7c-8d9e-0f1a2b3c4d5e';
const QUERY_TRACE = '4bf92f3577b34da6a3ce929d0e0e4736';

let login: LoginStub;
let plain: NitroHandle;
let linked: NitroHandle;

beforeAll(async () => {
  login = await startLoginStub();
  plain = await startNitro({ GATEWAY_URL: login.baseUrl, NUXT_PUBLIC_API_BASE_URL: login.baseUrl });
  linked = await startNitro({
    GATEWAY_URL: login.baseUrl,
    NUXT_PUBLIC_API_BASE_URL: login.baseUrl,
    NUXT_PUBLIC_GRAFANA_URL: GRAFANA,
  });

  await setup({ host: plain.baseUrl, rootDir: WEB_ROOT });
}, 90_000);

afterAll(async () => {
  await plain?.close();
  await linked?.close();
  await login?.close();
});

async function playGateway(page: Page, withTrace: boolean): Promise<void> {
  await page.addInitScript(
    ([key, value]) => {
      window.sessionStorage.setItem(key, value);
    },
    [STORAGE_KEY, fakeToken({ sub: 'customer-admin', username: 'admin-user', role: 'ADMINISTRADOR' })],
  );

  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const { pathname } = new URL(request.url());
    const headers: Record<string, string> = {
      'access-control-allow-origin': '*',
      'access-control-allow-headers': '*',
      'access-control-allow-methods': '*',
      'access-control-expose-headers': 'X-Correlation-Id, X-Trace-Id',
      'x-correlation-id': QUERY_CORRELATION,
      ...(withTrace ? { 'x-trace-id': QUERY_TRACE } : {}),
    };

    if (request.method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers });

      return;
    }

    let body: unknown = {};

    if (pathname === `/api/transfers/${TRANSFER}`) {
      body = {
        outcome: 'FOUND',
        transactionId: TRANSFER,
        status: 'COMPLETED',
        amount: { amountMinor: 125_000, currency: 'GTQ' },
        reason: null,
        createdAt: '2026-10-18T12:00:00.000Z',
        updatedAt: '2026-10-18T12:00:05.000Z',
        originCorrelationId: ORIGIN,
        correlationId: QUERY_CORRELATION,
      };
    } else if (pathname === `/api/payments/${PAYMENT}`) {
      body = {
        payment: {
          paymentId: PAYMENT,
          transactionId: TRANSFER,
          status: 'CONFIRMED',
          amount: { amountMinor: 125_000, currency: 'GTQ' },
          attempt: 1,
          errorType: null,
          failureReason: null,
          providerReference: 'PRV-1',
          scenario: 'SUCCESS',
          originCorrelationId: ORIGIN,
          createdAt: '2026-10-18T12:00:00.000Z',
          updatedAt: '2026-10-18T12:00:05.000Z',
          decidedAt: '2026-10-18T12:00:05.000Z',
        },
        attempts: [],
        correlationId: QUERY_CORRELATION,
      };
    }

    await route.fulfill({ status: 200, contentType: 'application/json', headers, body: JSON.stringify(body) });
  });
}

async function open(server: NitroHandle, path: string, withTrace = true): Promise<Page> {
  const page = await createPage();

  await playGateway(page, withTrace);
  await page.goto(new URL(path.replace(/^\//, ''), server.baseUrl).toString(), { waitUntil: 'hydration' });

  return page;
}

describe('the transfer detail', () => {
  it('shows the correlation it was born under and, beside it, the trace of the question asked', async () => {
    const page = await open(plain, `/transferencias/${TRANSFER}`);

    try {
      await page.getByTestId('trace-id').waitFor();

      expect(await page.getByTestId('correlation-id').textContent()).toContain(ORIGIN);
      expect(await page.getByTestId('trace-id').textContent()).toContain(QUERY_TRACE);
      // Never passed off as the operation's own trace.
      expect(await page.getByTestId('correlation-badge').textContent()).toContain('Traza de esta consulta');
      expect(await page.getByTestId('trace-link').count()).toBe(0);
    } finally {
      await page.close();
    }
  });

  it('links the trace to Grafana when the deployment knows where Grafana is', async () => {
    const page = await open(linked, `/transferencias/${TRANSFER}`);

    try {
      const link = page.getByTestId('trace-link');

      await link.waitFor();

      const href = (await link.getAttribute('href')) ?? '';

      expect(href.startsWith(GRAFANA)).toBe(true);
      expect(decodeURIComponent(href)).toContain(QUERY_TRACE);
    } finally {
      await page.close();
    }
  });

  it('prints no trace line, and invents none, when the Gateway sent no trace', async () => {
    const page = await open(plain, `/transferencias/${TRANSFER}`, false);

    try {
      await page.getByTestId('correlation-id').waitFor();

      expect(await page.getByTestId('correlation-id').textContent()).toContain(ORIGIN);
      expect(await page.getByTestId('trace-id').count()).toBe(0);
    } finally {
      await page.close();
    }
  });
});

describe('the payment detail', () => {
  it('shows the origin correlation with its trace, labelled as the query\'s', async () => {
    const page = await open(plain, `/pagos/${PAYMENT}`);

    try {
      await page.getByTestId('trace-id').waitFor();

      expect(await page.getByTestId('correlation-id').textContent()).toContain(ORIGIN);
      expect(await page.getByTestId('trace-id').textContent()).toContain(QUERY_TRACE);
      expect(await page.getByTestId('correlation-badge').textContent()).toContain('Traza de esta consulta');
    } finally {
      await page.close();
    }
  });
});
