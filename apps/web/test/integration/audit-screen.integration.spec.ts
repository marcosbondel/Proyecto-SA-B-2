import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPage, setup, url } from '@nuxt/test-utils/e2e';
import type { Page, Route } from 'playwright-core';

import { fakeToken } from './support/fake-token';
import { startLoginStub, type LoginStub } from './support/login-stub';
import { startNitro, WEB_ROOT, type NitroHandle } from './support/nitro-process';

/**
 * T-45's screen, rendered by a real browser against a real Nitro server: "la
 * pantalla de auditoría renderiza en los tests de Nitro".
 *
 * The Gateway is played by `page.route`, because what is under test is the
 * screen — the four filters, what it sends for each, what it says about an
 * identifier that is not one, and where the trace of an operation appears — and
 * not the Gateway, whose own suites prove the other half of each of those
 * contracts. The session is the same injected one `session-guard` uses.
 *
 * Every assertion is about something a person would see or a request the
 * browser would make; none is about a component's internals.
 */
const STORAGE_KEY = 'bank-session-token';

const TRACE = '4bf92f3577b34da6a3ce929d0e0e4736';
const OTHER_TRACE = '0af7651916cd43dd8448eb211c80319c';
const CORRELATION = '7d41e8b2-9a3f-4c15-8ee0-1b2f9a4c7d10';
const OTHER_CORRELATION = '1c0b2d3e-5f6a-4b7c-8d9e-0f1a2b3c4d5e';

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

async function signInAs(page: Page, role: 'CLIENTE' | 'ADMINISTRADOR'): Promise<void> {
  const token = fakeToken({ sub: `customer-${role.toLowerCase()}`, username: `${role.toLowerCase()}-user`, role });

  await page.addInitScript(
    ([key, value]) => {
      window.sessionStorage.setItem(key, value);
    },
    [STORAGE_KEY, token],
  );
}

const event = (overrides: Record<string, unknown> = {}) => ({
  eventId: crypto.randomUUID(),
  messageType: 'payment.failed.v1',
  producer: 'payment-service',
  occurredAt: '2026-10-05T18:00:00.000Z',
  correlationId: CORRELATION,
  processingStatus: 'PROCESSED',
  consumer: 'audit.payment',
  payload: {},
  severity: 'ERROR',
  ...overrides,
});

/** One event of a flow's trail, so the screen has a trail to draw and a badge to show. */
const TRAIL_EVENT = {
  messageId: '8f21c9a0-4d7b-4f0e-9c1e-0242ac120002',
  messageType: 'payment.failed.v1',
  producer: 'payment-service',
  causationId: null,
  occurredAt: '2026-10-05T18:00:00.000Z',
  processingStatus: 'PROCESSED',
  severity: 'ERROR',
};

interface Gateway {
  /** The `/api/audit/recent` requests the browser made, as their query strings. */
  readonly recentQueries: URLSearchParams[];
  /** What the next `/api/audit/recent` answers with. */
  respondRecent: (body: unknown, status?: number) => void;
}

/** Plays the Gateway for the three routes the audit screen calls. */
async function playGateway(page: Page): Promise<Gateway> {
  const recentQueries: URLSearchParams[] = [];
  let recent: { body: unknown; status: number } = {
    body: { events: [event({ traceId: TRACE }), event({ messageType: 'transaction.failed.v1' })], total: 2, page: 1, limit: 10 },
    status: 200,
  };

  const answer = (route: Route, status: number, body: unknown, traceId: string | null) =>
    route.fulfill({
      status,
      contentType: 'application/json',
      headers: {
        'access-control-allow-origin': '*',
        'access-control-allow-headers': '*',
        'access-control-expose-headers': 'X-Correlation-Id, X-Trace-Id',
        'x-correlation-id': CORRELATION,
        ...(traceId === null ? {} : { 'x-trace-id': traceId }),
      },
      body: JSON.stringify(body),
    });

  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const target = new URL(request.url());

    if (request.method() === 'OPTIONS') {
      await route.fulfill({
        status: 204,
        headers: {
          'access-control-allow-origin': '*',
          'access-control-allow-headers': '*',
          'access-control-allow-methods': '*',
        },
      });

      return;
    }

    if (target.pathname === '/api/audit/recent') {
      recentQueries.push(target.searchParams);
      await answer(route, recent.status, recent.body, TRACE);

      return;
    }

    if (target.pathname === '/api/audit') {
      await answer(
        route,
        200,
        {
          events: [
            {
              messageId: crypto.randomUUID(),
              messageType: 'payment.failed.v1',
              producer: 'payment-service',
              causationId: null,
              occurredAt: '2026-10-05T18:00:00.000Z',
              processingStatus: 'PROCESSED',
              severity: 'ERROR',
              traceId: TRACE,
            },
          ],
          notifications: [],
        },
        OTHER_TRACE,
      );

      return;
    }

    await answer(route, 200, { audit: { infoToday: 3, warningToday: 2, errorToday: 1 } }, null);
  });

  return {
    recentQueries,
    respondRecent: (body, status = 200) => {
      recent = { body, status };
    },
  };
}

async function openAudit(): Promise<{ page: Page; gateway: Gateway }> {
  const page = await createPage();

  await signInAs(page, 'ADMINISTRADOR');

  const gateway = await playGateway(page);

  await page.goto(url('/auditoria'), { waitUntil: 'hydration' });
  await page.getByTestId('audit-filters').waitFor();

  return { page, gateway };
}

describe('the audit screen, in a browser (T-45)', () => {
  it('offers the four filters §4.1 names, and lists the events with their traces', async () => {
    const { page } = await openAudit();

    try {
      for (const testId of ['filter-correlation', 'filter-trace', 'filter-service', 'filter-severity']) {
        expect(await page.getByTestId(testId).count(), `${testId} is not on the screen`).toBe(1);
      }

      const cells = page.getByTestId('event-trace');
      const traces = await cells.allTextContents();

      // Eight characters on the table, the whole id in the tooltip.
      expect(traces.map((text) => text.trim())).toEqual([`${TRACE.slice(0, 8)}…`, '—']);
      expect(await cells.first().locator('span').getAttribute('title')).toBe(TRACE);
    } finally {
      await page.close();
    }
  });

  it('asks for the events of a trace, and only with the filters that are on', async () => {
    const { page, gateway } = await openAudit();

    try {
      gateway.recentQueries.length = 0;

      await page.getByTestId('filter-trace').fill(` ${TRACE.toUpperCase()} `);
      await page.getByTestId('filter-submit').click();
      await page.getByTestId('filter-note').waitFor();

      const query = gateway.recentQueries.at(-1);

      expect(query?.get('traceId')).toBe(TRACE);
      expect(query?.has('correlationId')).toBe(false);
      expect(query?.has('service')).toBe(false);
      expect(query?.has('severity')).toBe(false);
    } finally {
      await page.close();
    }
  });

  it('combines the filters in one request', async () => {
    const { page, gateway } = await openAudit();

    try {
      gateway.recentQueries.length = 0;

      await page.getByTestId('filter-correlation').fill(OTHER_CORRELATION);
      await page.getByTestId('filter-trace').fill(OTHER_TRACE);
      await page.getByTestId('filter-submit').click();
      await page.getByTestId('filter-note').waitFor();

      const query = gateway.recentQueries.at(-1);

      expect(query?.get('correlationId')).toBe(OTHER_CORRELATION);
      expect(query?.get('traceId')).toBe(OTHER_TRACE);
    } finally {
      await page.close();
    }
  });

  it('says what is wrong with an identifier that is not one, and does not search with it', async () => {
    const { page, gateway } = await openAudit();

    try {
      gateway.recentQueries.length = 0;

      await page.getByTestId('filter-trace').fill('not-a-trace');
      await page.getByTestId('filter-correlation').fill('not-a-uuid');

      expect(await page.getByTestId('filter-trace-error').textContent()).toContain('32 caracteres');
      expect(await page.getByTestId('filter-correlation-error').textContent()).toContain('UUID');
      expect(await page.getByTestId('filter-submit').isDisabled()).toBe(true);

      await page.getByTestId('filter-trace').press('Enter');
      expect(gateway.recentQueries).toHaveLength(0);

      await page.getByTestId('filter-trace').fill(TRACE);
      await page.getByTestId('filter-correlation').fill('');

      expect(await page.getByTestId('filter-submit').isDisabled()).toBe(false);
      expect(await page.getByTestId('filter-trace-error').count()).toBe(0);
    } finally {
      await page.close();
    }
  });

  it('says "no coincide" for a search that found nothing, and clears back to the whole trail', async () => {
    const { page, gateway } = await openAudit();

    try {
      gateway.respondRecent({ events: [], total: 0, page: 1, limit: 10 });
      await page.getByTestId('filter-trace').fill(TRACE);
      await page.getByTestId('filter-submit').click();

      await page.getByText('Ningún evento coincide con los filtros.').waitFor();

      gateway.respondRecent({ events: [event()], total: 1, page: 1, limit: 10 });
      gateway.recentQueries.length = 0;
      await page.getByTestId('filter-clear').click();
      await page.getByTestId('event-trace').first().waitFor();

      expect(gateway.recentQueries.at(-1)?.has('traceId')).toBe(false);
      expect(await page.getByTestId('filter-trace').inputValue()).toBe('');
    } finally {
      await page.close();
    }
  });

  it('says the audit service did not answer instead of showing an empty trail', async () => {
    const { page, gateway } = await openAudit();

    try {
      gateway.respondRecent(
        { type: 'REPLY_TIMEOUT', message: 'El servicio de auditoría no respondió a tiempo.', correlationId: CORRELATION },
        504,
      );
      await page.getByTestId('filter-trace').fill(TRACE);
      await page.getByTestId('filter-submit').click();

      const alert = page.getByTestId('filter-failure');

      await alert.waitFor();
      expect(await alert.textContent()).toContain('no respondió a tiempo');
    } finally {
      await page.close();
    }
  });

  it('shows the trace of an operation beside its tracking code, from the header the Gateway sent', async () => {
    const { page } = await openAudit();

    try {
      await page.getByTestId('audit-correlation-input').fill(CORRELATION);
      await page.getByTestId('audit-submit').click();

      const badge = page.getByTestId('correlation-badge').first();

      await badge.waitFor();

      expect(await badge.getByTestId('correlation-id').textContent()).toContain(CORRELATION);
      // The trail was asked under OTHER_TRACE; the listing under TRACE. The badge
      // shows the one of *this* operation, never the last one anything produced.
      expect(await badge.getByTestId('trace-id').textContent()).toContain(OTHER_TRACE);
    } finally {
      await page.close();
    }
  });
});

describe('the trace is not invented', () => {
  it('shows no trace at all when the Gateway sent none', async () => {
    const page = await createPage();

    try {
      await signInAs(page, 'ADMINISTRADOR');
      await page.route('**/api/**', async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          headers: {
            'access-control-allow-origin': '*',
            'access-control-expose-headers': 'X-Correlation-Id, X-Trace-Id',
            'x-correlation-id': CORRELATION,
          },
          body: JSON.stringify({ events: [TRAIL_EVENT], notifications: [], total: 1, page: 1, limit: 10 }),
        });
      });
      await page.goto(url('/auditoria'), { waitUntil: 'hydration' });
      await page.getByTestId('audit-correlation-input').fill(CORRELATION);
      await page.getByTestId('audit-submit').click();

      await page.getByTestId('correlation-badge').first().waitFor();

      expect(await page.getByTestId('trace-id').count()).toBe(0);
    } finally {
      await page.close();
    }
  });

  it('does not take a header that is not a trace id for one', async () => {
    const page = await createPage();

    try {
      await signInAs(page, 'ADMINISTRADOR');
      await page.route('**/api/**', async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          headers: {
            'access-control-allow-origin': '*',
            'access-control-expose-headers': 'X-Correlation-Id, X-Trace-Id',
            'x-correlation-id': CORRELATION,
            'x-trace-id': '0'.repeat(32),
          },
          body: JSON.stringify({ events: [TRAIL_EVENT], notifications: [], total: 1, page: 1, limit: 10 }),
        });
      });
      await page.goto(url('/auditoria'), { waitUntil: 'hydration' });
      await page.getByTestId('audit-correlation-input').fill(CORRELATION);
      await page.getByTestId('audit-submit').click();

      await page.getByTestId('correlation-badge').first().waitFor();

      expect(await page.getByTestId('trace-id').count()).toBe(0);
    } finally {
      await page.close();
    }
  });
});
