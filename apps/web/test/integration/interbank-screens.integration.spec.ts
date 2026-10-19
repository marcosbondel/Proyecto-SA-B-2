import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPage, setup } from '@nuxt/test-utils/e2e';
import type { Page, Route } from 'playwright-core';

import { fakeToken } from './support/fake-token';
import { startLoginStub, type LoginStub } from './support/login-stub';
import { startNitro, WEB_ROOT, type NitroHandle } from './support/nitro-process';

/**
 * The interbank deposit screens (T-60, B10 / TD-090), rendered by a real
 * browser against a real Nitro server.
 *
 * The Gateway is played by `page.route`, because what is under test is the
 * screen — what it asks for, what it says for each of the six states and each
 * reason, when it stops asking, and where sending takes you — and not the
 * Gateway, whose own suites prove the other half of each of those contracts.
 * The session is injected, the way `audit-screen` does.
 *
 * Two servers, because the Grafana link is configuration read at start-up: one
 * knows where Grafana is and one does not, and the screen has to be right for
 * both.
 */
const STORAGE_KEY = 'bank-session-token';
const GRAFANA = 'http://localhost:3002';

const DEPOSIT = '7f2b1c42-0000-4000-8000-0000000000aa';
const OTHER_DEPOSIT = '7f2b1c42-0000-4000-8000-0000000000bb';
const TRANSFER = '3f1c2d64-6b2f-4b1a-9d5e-0a7c8e5b41d2';
const ACCOUNT = '9a8b7c6d-1111-4222-8333-444455556666';
const CORRELATION = '7d41e8b2-9a3f-4c15-8ee0-1b2f9a4c7d10';
const TRACE = '4bf92f3577b34da6a3ce929d0e0e4736';

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

  // `setup` points `createPage` at one host; the pages below pass absolute URLs
  // when they need the other server.
  await setup({ host: plain.baseUrl, rootDir: WEB_ROOT });
}, 90_000);

afterAll(async () => {
  await plain?.close();
  await linked?.close();
  await login?.close();
});

type Role = 'CLIENTE' | 'ADMINISTRADOR';

async function signInAs(page: Page, role: Role): Promise<void> {
  const token = fakeToken({ sub: `customer-${role.toLowerCase()}`, username: `${role.toLowerCase()}-user`, role });

  await page.addInitScript(
    ([key, value]) => {
      window.sessionStorage.setItem(key, value);
    },
    [STORAGE_KEY, token],
  );
}

/** A deposit as `GET /api/interbank/transfers` sends it. */
function view(overrides: Record<string, unknown> = {}) {
  return {
    interbankTransferId: DEPOSIT,
    paymentId: '11111111-2222-4333-8444-555566667777',
    transactionId: TRANSFER,
    state: 'SENT',
    reason: null,
    destinationBankCode: 'BANK99',
    destinationAccount: '********1234',
    originAccount: '02-0000123',
    amount: { amountMinor: 125_000, currency: 'GTQ' },
    correlationId: CORRELATION,
    traceId: TRACE,
    createdAt: '2026-10-18T12:00:00.000Z',
    expiresAt: '2026-10-18T12:03:00.000Z',
    sentAt: '2026-10-18T12:00:02.000Z',
    decidedAt: null,
    reversedAt: null,
    attempts: 1,
    releasedUnverified: false,
    reversal: null,
    ...overrides,
  };
}

const history = (...states: Array<[string, string | null]>) =>
  states.map(([state, reason], index) => ({
    state,
    reason,
    at: new Date(Date.UTC(2026, 9, 18, 12, 0, index * 10)).toISOString(),
  }));

interface Gateway {
  /** Every request the browser made, as `METHOD path?query`. */
  readonly requests: string[];
  readonly bodies: unknown[];
  /** What the next list answers with. */
  respondList: (sends: unknown[], status?: number) => void;
  /** What each successive detail request answers with; the last repeats. */
  respondDetail: (...answers: Array<{ status: number; body: unknown }>) => void;
}

/** Plays the Gateway for the interbank routes, the account list and the send. */
async function playGateway(page: Page): Promise<Gateway> {
  const requests: string[] = [];
  const bodies: unknown[] = [];
  let list: { status: number; body: unknown } = { status: 200, body: { sends: [], correlationId: CORRELATION } };
  let details: Array<{ status: number; body: unknown }> = [
    { status: 200, body: { send: view(), history: history(['PENDING', null], ['SENT', null]), correlationId: CORRELATION } },
  ];
  let detailCalls = 0;

  const answer = (route: Route, status: number, body: unknown) =>
    route.fulfill({
      status,
      contentType: 'application/json',
      headers: {
        'access-control-allow-origin': '*',
        'access-control-allow-headers': '*',
        'access-control-expose-headers': 'X-Correlation-Id, X-Trace-Id',
        'x-correlation-id': CORRELATION,
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

    requests.push(`${request.method()} ${target.pathname}${target.search}`);

    if (target.pathname === '/api/interbank/transfers' && request.method() === 'GET') {
      await answer(route, list.status, list.body);

      return;
    }

    if (target.pathname === '/api/interbank/transfers' && request.method() === 'POST') {
      bodies.push(request.postDataJSON());
      await answer(route, 202, {
        transactionId: TRANSFER,
        interbankTransferId: DEPOSIT,
        correlationId: CORRELATION,
      });

      return;
    }

    if (target.pathname.startsWith('/api/interbank/transfers/')) {
      const next = details[Math.min(detailCalls, details.length - 1)]!;

      detailCalls += 1;
      await answer(route, next.status, next.body);

      return;
    }

    if (target.pathname === '/api/accounts') {
      await answer(route, 200, {
        accounts: [
          {
            accountId: ACCOUNT,
            customerId: 'customer-cliente',
            accountType: 'MONETARIA',
            balance: { amountMinor: 500_000, currency: 'GTQ' },
            status: 'ACTIVE',
            lastActivityAt: null,
            openedAt: '2026-10-01T00:00:00.000Z',
          },
        ],
        correlationId: CORRELATION,
      });

      return;
    }

    await answer(route, 200, {});
  });

  return {
    requests,
    bodies,
    respondList: (sends, status = 200) => {
      list = { status, body: status === 200 ? { sends, correlationId: CORRELATION } : sends };
    },
    respondDetail: (...answers) => {
      details = answers;
      detailCalls = 0;
    },
  };
}

/**
 * Picks the only account in the source menu and waits for the menu to finish
 * closing. Typing straight after the click loses the text: the closing menu
 * re-renders the form and puts back the empty value.
 */
async function pickSourceAccount(page: Page): Promise<void> {
  await page.getByTestId('interbank-source-account').waitFor();
  await page.getByTestId('interbank-source-account').click();
  await page.getByRole('option').first().click();
  await page.getByRole('listbox').waitFor({ state: 'hidden' });
}

async function open(
  server: NitroHandle,
  path: string,
  role: Role = 'CLIENTE',
  prepare?: (gateway: Gateway) => void,
): Promise<{ page: Page; gateway: Gateway }> {
  const page = await createPage();

  await signInAs(page, role);

  const gateway = await playGateway(page);

  prepare?.(gateway);
  await page.goto(new URL(path.replace(/^\//, ''), server.baseUrl).toString(), { waitUntil: 'hydration' });

  return { page, gateway };
}

describe('the list of deposits sent to the other bank', () => {
  it('shows each deposit with its state in words, the bank and the masked account', async () => {
    const { page } = await open(plain, '/transferencias/interbancarias', 'CLIENTE', (gateway) =>
      gateway.respondList([
        view({ state: 'ACCEPTED', decidedAt: '2026-10-18T12:00:20.000Z' }),
        view({ interbankTransferId: OTHER_DEPOSIT, state: 'TIMEOUT', destinationAccount: '*****9876' }),
        view({ interbankTransferId: '7f2b1c42-0000-4000-8000-0000000000cc', state: 'REVERSED' }),
      ]),
    );

    try {
      await page.getByTestId('interbank-table').waitFor();

      const rows = page.getByTestId('interbank-row');

      expect(await rows.count()).toBe(3);

      const text = (await rows.allTextContents()).join(' | ');

      expect(text).toContain('Acreditado');
      expect(text).toContain('Sin respuesta');
      expect(text).toContain('Devuelto');
      expect(text).toContain('BANK99');
      expect(text).toContain('********1234');
      expect(text).toContain('*****9876');
      // The internal names never reach the person.
      expect(text).not.toMatch(/ACCEPTED|TIMEOUT|REVERSED/);

      expect(await page.getByRole('heading', { level: 1 }).textContent()).toContain('Mis depósitos a otro banco');
    } finally {
      await page.close();
    }
  });

  it('asks for the newest fifty, with no state filter until one is picked', async () => {
    const { page, gateway } = await open(plain, '/transferencias/interbancarias');

    try {
      await page.getByTestId('interbank-empty').waitFor();

      const first = gateway.requests.find((entry) => entry.startsWith('GET /api/interbank/transfers'));

      expect(first).toBe('GET /api/interbank/transfers?limit=50');
    } finally {
      await page.close();
    }
  });

  it('offers all six states plus "todos" in the filter, and filters by the one picked', async () => {
    const { page, gateway } = await open(plain, '/transferencias/interbancarias', 'CLIENTE', (g) =>
      g.respondList([view({ state: 'TIMEOUT' })]),
    );

    try {
      await page.getByTestId('interbank-table').waitFor();

      await page.getByRole('combobox', { name: 'Filtrar por estado del depósito' }).click();

      const options = await page.getByRole('option').allTextContents();

      expect(options.map((option) => option.trim())).toEqual([
        'Todos los estados',
        'Por enviar',
        'Esperando al otro banco',
        'Acreditado',
        'Rechazado',
        'Sin respuesta',
        'Devuelto',
      ]);

      await page.getByRole('option', { name: 'Sin respuesta' }).click();
      await page.getByTestId('interbank-clear-filter').waitFor();

      expect(gateway.requests.at(-1)).toBe('GET /api/interbank/transfers?limit=50&state=TIMEOUT');
    } finally {
      await page.close();
    }
  });

  it('says "no deposit has that state" apart from "you have sent none"', async () => {
    const { page, gateway } = await open(plain, '/transferencias/interbancarias');

    try {
      await page.getByTestId('interbank-empty').waitFor();
      expect(await page.getByTestId('interbank-empty').textContent()).toContain(
        'Todavía no enviaste depósitos a otro banco',
      );

      await page.getByRole('combobox', { name: 'Filtrar por estado del depósito' }).click();
      await page.getByRole('option', { name: 'Rechazado' }).click();
      await page.getByTestId('interbank-empty-filtered').waitFor();

      expect(await page.getByTestId('interbank-empty-filtered').textContent()).toContain(
        'Ningún depósito tiene ese estado',
      );
      expect(await page.getByTestId('interbank-empty').count()).toBe(0);

      gateway.respondList([view()]);
      await page.getByTestId('interbank-clear-filter').click();
      await page.getByTestId('interbank-table').waitFor();
    } finally {
      await page.close();
    }
  });

  it('says the service did not answer, and offers to try again', async () => {
    const { page, gateway } = await open(plain, '/transferencias/interbancarias', 'CLIENTE', (g) =>
      g.respondList(
        { type: 'REPLY_TIMEOUT', message: 'El servicio de pagos no respondió a tiempo.', correlationId: CORRELATION } as never,
        504,
      ),
    );

    try {
      const alert = page.locator('[data-state="REPLY_TIMEOUT"]');

      await alert.waitFor();
      expect(await alert.textContent()).toContain('no respondió a tiempo');

      gateway.respondList([view()]);
      await page.getByTestId('async-retry').click();
      await page.getByTestId('interbank-table').waitFor();
    } finally {
      await page.close();
    }
  });

  it('talks to the staff about every client, not about "mine"', async () => {
    const { page } = await open(plain, '/transferencias/interbancarias', 'ADMINISTRADOR');

    try {
      await page.getByTestId('interbank-empty').waitFor();

      expect(await page.getByRole('heading', { level: 1 }).textContent()).toContain('Depósitos a otros bancos');
      expect(await page.getByTestId('interbank-empty').textContent()).toContain('No hay depósitos a otros bancos');
    } finally {
      await page.close();
    }
  });
});

describe('one deposit', () => {
  it('shows the state first and large, with the bank, the masked account, the amount and the history', async () => {
    const { page } = await open(plain, `/transferencias/interbancarias/${DEPOSIT}`);

    try {
      await page.getByTestId('interbank-state-label').waitFor();

      expect(await page.getByTestId('interbank-state-label').textContent()).toBe('Esperando al otro banco');
      expect(await page.getByTestId('interbank-bank').textContent()).toBe('BANK99');
      expect(await page.getByTestId('interbank-account').textContent()).toBe('********1234');
      expect(await page.getByTestId('interbank-amount').textContent()).toContain('1,250.00');

      const steps = page.getByTestId('interbank-history').locator('li');

      expect(await steps.count()).toBe(2);
      expect(await steps.nth(0).textContent()).toContain('Depósito registrado');
      expect(await steps.nth(1).textContent()).toContain('Solicitud entregada al otro banco');

      expect(await page.getByTestId('correlation-id').textContent()).toContain(CORRELATION);
      expect(await page.getByTestId('trace-id').textContent()).toContain(TRACE);
    } finally {
      await page.close();
    }
  });

  it('keeps asking while the other bank has not answered, and shows the answer without a reload', async () => {
    const { page, gateway } = await open(plain, `/transferencias/interbancarias/${DEPOSIT}`, 'CLIENTE', (g) =>
      g.respondDetail(
        { status: 200, body: { send: view(), history: history(['PENDING', null], ['SENT', null]), correlationId: CORRELATION } },
        {
          status: 200,
          body: {
            send: view({ state: 'ACCEPTED', decidedAt: '2026-10-18T12:00:20.000Z' }),
            history: history(['PENDING', null], ['SENT', null], ['ACCEPTED', null]),
            correlationId: CORRELATION,
          },
        },
      ),
    );

    try {
      await page.getByTestId('interbank-live').waitFor();
      expect(await page.getByTestId('interbank-state-label').textContent()).toBe('Esperando al otro banco');

      await page.getByText('Acreditado', { exact: true }).first().waitFor({ timeout: 10_000 });
      expect(await page.getByTestId('interbank-state-label').textContent()).toBe('Acreditado');
      expect(await page.getByTestId('interbank-history').locator('li').count()).toBe(3);

      // Settled: it says so and stops asking.
      expect(await page.getByTestId('interbank-live').count()).toBe(0);

      const asked = gateway.requests.filter((entry) => entry.startsWith('GET /api/interbank/transfers/')).length;

      await page.waitForTimeout(2_500);
      expect(gateway.requests.filter((entry) => entry.startsWith('GET /api/interbank/transfers/')).length).toBe(asked);
    } finally {
      await page.close();
    }
  });

  it('explains a rejection in a sentence, never by its code', async () => {
    const { page } = await open(plain, `/transferencias/interbancarias/${DEPOSIT}`, 'CLIENTE', (g) =>
      g.respondDetail({
        status: 200,
        body: {
          send: view({ state: 'REJECTED', reason: 'ACCOUNT_NOT_FOUND', decidedAt: '2026-10-18T12:00:20.000Z' }),
          history: history(['PENDING', null], ['SENT', null], ['REJECTED', 'ACCOUNT_NOT_FOUND']),
          correlationId: CORRELATION,
        },
      }),
    );

    try {
      await page.getByTestId('interbank-reason').waitFor();

      const reason = (await page.getByTestId('interbank-reason').textContent()) ?? '';

      expect(reason).toContain('Por qué no se completó');
      expect(reason).toContain('La cuenta de destino no existe en el otro banco');
      expect(await page.getByTestId('interbank-state-label').textContent()).toBe('Rechazado');
      expect(await page.locator('body').textContent()).not.toContain('ACCOUNT_NOT_FOUND');
    } finally {
      await page.close();
    }
  });

  it('keeps asking after a rejection, until the money is back', async () => {
    const { page } = await open(plain, `/transferencias/interbancarias/${DEPOSIT}`, 'CLIENTE', (g) =>
      g.respondDetail(
        {
          status: 200,
          body: {
            send: view({ state: 'REJECTED', reason: 'ACCOUNT_INACTIVE' }),
            history: history(['PENDING', null], ['SENT', null], ['REJECTED', 'ACCOUNT_INACTIVE']),
            correlationId: CORRELATION,
          },
        },
        {
          status: 200,
          body: {
            send: view({ state: 'REVERSED', reason: 'ACCOUNT_INACTIVE', reversedAt: '2026-10-18T12:00:30.000Z' }),
            history: history(['PENDING', null], ['SENT', null], ['REJECTED', 'ACCOUNT_INACTIVE'], ['REVERSED', null]),
            correlationId: CORRELATION,
          },
        },
      ),
    );

    try {
      await page.getByTestId('interbank-reversed-at').waitFor({ timeout: 10_000 });
      expect(await page.getByTestId('interbank-state-label').textContent()).toBe('Devuelto');
    } finally {
      await page.close();
    }
  });

  it('says why it is still waiting on a TIMEOUT, in the amber family and not as a failure', async () => {
    const { page } = await open(plain, `/transferencias/interbancarias/${DEPOSIT}`, 'CLIENTE', (g) =>
      g.respondDetail({
        status: 200,
        body: {
          send: view({ state: 'TIMEOUT', reason: 'CONFIRMATION_TIMEOUT' }),
          history: history(['PENDING', null], ['SENT', null], ['TIMEOUT', 'CONFIRMATION_TIMEOUT']),
          correlationId: CORRELATION,
        },
      }),
    );

    try {
      await page.getByTestId('interbank-reason').waitFor();
      expect(await page.getByTestId('interbank-reason').textContent()).toContain('Por qué seguimos esperando');
      expect(await page.getByTestId('interbank-state').textContent()).toContain('no repitas el depósito todavía');
    } finally {
      await page.close();
    }
  });

  it('shows the reverse asked of the other bank, and the release without confirmation', async () => {
    const { page } = await open(plain, `/transferencias/interbancarias/${DEPOSIT}`, 'ADMINISTRADOR', (g) =>
      g.respondDetail({
        status: 200,
        body: {
          send: view({
            state: 'REVERSED',
            reason: 'RELEASED_NO_ANSWER',
            reversedAt: '2026-10-18T12:09:00.000Z',
            releasedUnverified: true,
            reversal: { reversalId: '5a5a5a5a-1111-4222-8333-444455556666', state: 'PROCESSING' },
          }),
          history: history(['PENDING', null], ['SENT', null], ['TIMEOUT', 'CONFIRMATION_TIMEOUT'], ['REJECTED', 'RELEASED_NO_ANSWER'], ['REVERSED', null]),
          correlationId: CORRELATION,
        },
      }),
    );

    try {
      await page.getByTestId('interbank-reversal').waitFor();

      expect(await page.getByTestId('interbank-reversal').textContent()).toContain('En proceso en el otro banco');
      expect(await page.getByTestId('interbank-unverified').textContent()).toContain(
        'El dinero volvió sin confirmación del otro banco',
      );
      // An administrator is offered the audit trail of the flow.
      expect(await page.getByTestId('interbank-audit-link').getAttribute('href')).toBe(
        `/auditoria?correlationId=${CORRELATION}`,
      );
    } finally {
      await page.close();
    }
  });

  it('does not offer the audit trail to a client', async () => {
    const { page } = await open(plain, `/transferencias/interbancarias/${DEPOSIT}`);

    try {
      await page.getByTestId('interbank-state-label').waitFor();
      expect(await page.getByTestId('interbank-audit-link').count()).toBe(0);
      expect(await page.getByTestId('interbank-saga-link').getAttribute('href')).toBe(`/transferencias/${TRANSFER}`);
    } finally {
      await page.close();
    }
  });

  it('reads "not written down yet" as registering, not as missing, right after sending', async () => {
    const { page } = await open(
      plain,
      `/transferencias/interbancarias/${DEPOSIT}?transferencia=${TRANSFER}`,
      'CLIENTE',
      (g) =>
        g.respondDetail(
          { status: 404, body: { type: 'NOT_FOUND', message: 'No hay un depósito interbancario con ese identificador.', correlationId: CORRELATION } },
          { status: 200, body: { send: view({ state: 'PENDING', sentAt: null }), history: history(['PENDING', null]), correlationId: CORRELATION } },
        ),
    );

    try {
      await page.getByText('lo está registrando').waitFor();
      expect(await page.getByTestId('interbank-missing').count()).toBe(0);

      await page.getByTestId('interbank-state-label').waitFor({ timeout: 10_000 });
      expect(await page.getByTestId('interbank-state-label').textContent()).toBe('Por enviar');
    } finally {
      await page.close();
    }
  });

  it('says it was not found once the grace has passed, and points at the transfer that explains it', async () => {
    const page = await createPage();

    await signInAs(page, 'CLIENTE');
    // Time is the page's to control: the grace is twenty seconds of the clock.
    await page.clock.install();

    const gateway = await playGateway(page);

    gateway.respondDetail({
      status: 404,
      body: { type: 'NOT_FOUND', message: 'No hay un depósito interbancario con ese identificador.', correlationId: CORRELATION },
    });

    try {
      await page.goto(
        new URL(`transferencias/interbancarias/${DEPOSIT}?transferencia=${TRANSFER}`, plain.baseUrl).toString(),
        { waitUntil: 'hydration' },
      );
      await page.getByText('lo está registrando').waitFor();

      await page.clock.runFor(30_000);
      await page.getByTestId('interbank-missing').waitFor();

      expect(await page.getByTestId('interbank-missing').textContent()).toContain('No encontramos este depósito');
      expect(await page.getByTestId('interbank-saga-link').getAttribute('href')).toBe(`/transferencias/${TRANSFER}`);
    } finally {
      await page.close();
    }
  });

  it('refuses an identifier that is not one, and asks nothing', async () => {
    const { page, gateway } = await open(plain, '/transferencias/interbancarias/1');

    try {
      await page.locator('[data-state="VALIDATION_ERROR"]').waitFor();
      expect(gateway.requests.filter((entry) => entry.includes('/api/interbank/transfers/'))).toEqual([]);
    } finally {
      await page.close();
    }
  });
});

describe('the trace id on a deposit', () => {
  it('is a link to Grafana Explore on Tempo when the deployment knows where Grafana is', async () => {
    const { page } = await open(linked, `/transferencias/interbancarias/${DEPOSIT}`);

    try {
      const link = page.getByTestId('trace-link');

      await link.waitFor();

      const href = (await link.getAttribute('href')) ?? '';
      const target = new URL(href);

      expect(target.origin).toBe(GRAFANA);
      expect(target.pathname).toBe('/explore');
      expect(JSON.parse(target.searchParams.get('panes')!).a.queries[0].query).toBe(TRACE);
      expect(await link.getAttribute('target')).toBe('_blank');
      expect(await link.getAttribute('rel')).toContain('noopener');
      expect(await page.getByTestId('trace-id').textContent()).toBe(TRACE);
    } finally {
      await page.close();
    }
  });

  it('stays copyable text, with no link, when Grafana is not configured', async () => {
    const { page } = await open(plain, `/transferencias/interbancarias/${DEPOSIT}`);

    try {
      await page.getByTestId('trace-id').waitFor();

      expect(await page.getByTestId('trace-id').textContent()).toBe(TRACE);
      expect(await page.getByTestId('trace-link').count()).toBe(0);
    } finally {
      await page.close();
    }
  });
});

describe('sending a deposit', () => {
  it('takes you to the new deposit, not to the Saga, and keeps the transfer one click away', async () => {
    const { page, gateway } = await open(plain, '/transferencias/interbancaria');

    try {
      await pickSourceAccount(page);

      await page.getByTestId('interbank-bank-code').fill('BANK99');
      await page.getByTestId('interbank-destination-account').fill('02-0001234');
      await page.getByTestId('interbank-amount').fill('1250');
      await page.getByTestId('interbank-review').click();

      await page.getByTestId('confirm-interbank').click();
      await page.waitForURL(`**/transferencias/interbancarias/${DEPOSIT}*`);

      expect(new URL(page.url()).searchParams.get('transferencia')).toBe(TRANSFER);
      expect(gateway.bodies).toEqual([
        {
          sourceAccount: ACCOUNT,
          destinationBankCode: 'BANK99',
          destinationAccount: '02-0001234',
          amount: { amountMinor: 125_000, currency: 'GTQ' },
        },
      ]);

      await page.getByTestId('interbank-state-label').waitFor();
      expect(await page.getByTestId('interbank-saga-link').getAttribute('href')).toBe(`/transferencias/${TRANSFER}`);
    } finally {
      await page.close();
    }
  });

  it('marks a bank code and an account the Gateway would refuse, and sends nothing', async () => {
    const { page, gateway } = await open(plain, '/transferencias/interbancaria');

    try {
      await pickSourceAccount(page);

      await page.getByTestId('interbank-bank-code').fill('BANCO_PAREJA');
      await page.getByTestId('interbank-destination-account').fill('cuenta con espacios');
      await page.getByTestId('interbank-amount').fill('10000.01');
      await page.getByTestId('interbank-review').click();

      const text = (await page.locator('form').textContent()) ?? '';

      expect(text).toContain('BANK seguido de dos dígitos');
      expect(text).toContain('letras, números y guiones');
      expect(text).toContain('Q 10,000.00');
      expect(gateway.requests.filter((entry) => entry.startsWith('POST'))).toEqual([]);
    } finally {
      await page.close();
    }
  });
});
