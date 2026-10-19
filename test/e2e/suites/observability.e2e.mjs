import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
/**
 * observability — what Fase 3 (T-41..T-45) put on the Gateway and on the
 * screen, exercised live: the audit trail's four filters (`correlationId`,
 * `traceId`, `service`, `severity`), the SLO-alert webhook, the account
 * anomaly that ends as a `WARNING` in the customer's inbox, and the payment
 * simulation an administrator changes without a redeploy.
 *
 * Cases are verified by what the system *did* — a notification that arrived, a
 * balance that came back — and not by a status somebody wrote down.
 *
 * What these cases cannot see yet: `traceId` is `NULL` in every audit row until
 * T-48 registers the OpenTelemetry SDK, so the trace filter is checked for
 * what it must do today (validate at the edge, answer an unknown trace with an
 * empty list rather than an error) and not for a hit.
 *
 * The webhook cases need the stack to run with `ALERT_WEBHOOK_TOKEN` set and
 * the same value in this process's environment; without it they are skipped,
 * with the reason, and never passed.
 */
import { BASE, GW, SEEDED, api, loginApi, waitForStatus } from '../support/gateway.mjs';
import { launch, loginViaUI, shot } from '../support/browser.mjs';
import { Report } from '../support/report.mjs';
import { provisionCustomer } from '../support/seed.mjs';

const ALERT_WEBHOOK_TOKEN = process.env.ALERT_WEBHOOK_TOKEN ?? '';

const ABSENT_TRACE = '0af7651916cd43dd8448eb211c80319c';
const TERMINAL = new Set(['COMPLETED', 'FAILED', 'COMPENSATED']);

const money = (amountMinor) => ({ amountMinor, currency: 'GTQ' });
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const key = (label) => `qa-obs-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}`;

async function balanceOf(accountId, token) {
  const r = await api(`/api/accounts/${accountId}/balance`, token);
  if (r.status !== 200 || r.body.outcome !== 'FOUND') {
    throw new Error(`No se pudo leer el saldo de ${accountId}: ${r.status} ${JSON.stringify(r.body)}`);
  }
  return r.body.balance.amountMinor;
}

/** A fresh registration is a new customer each time, so a retry is never a repeat of a half-failed one. */
async function provisionRetry(label, attempts = 6) {
  let last = { ok: false, step: 'none', detail: 'sin intentos' };
  for (let i = 1; i <= attempts; i += 1) {
    await sleep(Math.floor(Math.random() * 400));
    last = await provisionCustomer({ label });
    if (last.ok) return last;
    console.log(`  [observability] provisión de '${label}' reintento ${i}: ${last.step} — ${String(last.detail).slice(0, 120)}`);
  }
  return last;
}

async function fund(accountId, cajeroToken, amountMinor, label) {
  return api(`/api/accounts/${accountId}/deposit`, cajeroToken, {
    method: 'POST',
    body: { amount: money(amountMinor), description: `QA observability — ${label}` },
    headers: { 'Idempotency-Key': key(label) },
  });
}

/** A grafana-shaped webhook body; one critical alert by default. */
function grafanaBody(alertname, overrides = {}) {
  return {
    status: 'firing',
    alerts: [
      {
        status: 'firing',
        labels: { alertname, severity: 'critical', slo: 'gateway-availability' },
        annotations: { summary: `QA: ${alertname}`, runbook_url: 'https://example.invalid/runbook' },
        startsAt: new Date().toISOString(),
        fingerprint: `qa-${alertname}`,
        ...overrides,
      },
    ],
  };
}

function webhook(body, token) {
  return api('/api/alerts/slo', null, {
    method: 'POST',
    body,
    headers: token === undefined ? {} : { Authorization: `Bearer ${token}` },
  });
}

export async function run() {
  const report = new Report('observability');

  const admin = await loginApi(SEEDED.admin.email, SEEDED.admin.password);
  const cajero = await loginApi(SEEDED.cajero.email, SEEDED.cajero.password);
  const cliente = await loginApi(SEEDED.cliente.email, SEEDED.cliente.password);
  for (const [role, auth] of [['admin', admin], ['cajero', cajero], ['cliente', cliente]]) {
    if (!auth.token) throw new Error(`No se pudo autenticar el usuario sembrado '${role}': ${JSON.stringify(auth.data)}`);
  }

  // -------------------------------------------------------------------------
  // OBS-AUDIT — the four filters of §4.1 on GET /api/audit/recent.
  // -------------------------------------------------------------------------
  const baseline = await api('/api/audit/recent?limit=100', admin.token);
  const baselineEvents = Array.isArray(baseline.body.events) ? baseline.body.events : [];

  // OBS-AUDIT-SERVICE-01
  {
    const producers = [...new Set(baselineEvents.map((e) => e.producer).filter(Boolean))];
    if (producers.length === 0) {
      report.skip('OBS-AUDIT-SERVICE-01', 'Auditoría', 'Filtro por servicio', 'La auditoría no tiene eventos con productor.');
    } else {
      const chosen = producers[0];
      const res = await api(`/api/audit/recent?limit=100&service=${chosen}`, admin.token);
      const events = Array.isArray(res.body.events) ? res.body.events : [];
      report.record(
        'OBS-AUDIT-SERVICE-01',
        'Auditoría',
        `GET /api/audit/recent?service=${chosen} devuelve solo ese servicio`,
        '200, al menos un evento y todos con el productor pedido',
        `status=${res.status} count=${events.length} productores=${[...new Set(events.map((e) => e.producer))].join(',')}`,
        res.status === 200 && events.length > 0 && events.every((e) => e.producer === chosen),
      );
    }
  }

  // OBS-AUDIT-CORRELATION-01 / COMBINED-01 — the filters combine with AND.
  {
    const sample = baselineEvents.find((e) => typeof e.correlationId === 'string' && typeof e.severity === 'string');
    if (sample === undefined) {
      report.skip('OBS-AUDIT-CORRELATION-01', 'Auditoría', 'Filtro por correlationId', 'Ningún evento reciente trae correlationId y severidad.');
      report.skip('OBS-AUDIT-COMBINED-01', 'Auditoría', 'Filtros combinados', 'Ningún evento reciente trae correlationId y severidad.');
    } else {
      const byCorrelation = await api(`/api/audit/recent?limit=100&correlationId=${sample.correlationId}`, admin.token);
      const correlated = Array.isArray(byCorrelation.body.events) ? byCorrelation.body.events : [];
      report.record(
        'OBS-AUDIT-CORRELATION-01',
        'Auditoría',
        'GET /api/audit/recent?correlationId= devuelve solo esa correlación',
        '200, al menos un evento y todos con ese correlationId',
        `status=${byCorrelation.status} count=${correlated.length}`,
        byCorrelation.status === 200 && correlated.length > 0 && correlated.every((e) => e.correlationId === sample.correlationId),
      );

      const combined = await api(
        `/api/audit/recent?limit=100&correlationId=${sample.correlationId}&service=${sample.producer}&severity=${sample.severity}`,
        admin.token,
      );
      const combinedEvents = Array.isArray(combined.body.events) ? combined.body.events : [];
      const opposite = sample.severity === 'INFO' ? 'ERROR' : 'INFO';
      const contradicted = await api(
        `/api/audit/recent?limit=100&correlationId=${sample.correlationId}&severity=${opposite}`,
        admin.token,
      );
      const contradictedEvents = Array.isArray(contradicted.body.events) ? contradicted.body.events : [];
      const oppositeExpected = correlated.filter((e) => e.severity === opposite).length;
      report.record(
        'OBS-AUDIT-COMBINED-01',
        'Auditoría',
        'Los filtros se combinan con AND',
        'Los tres juntos devuelven el evento de muestra; con otra severidad solo los de esa severidad',
        `combinado=${combinedEvents.length} contieneMuestra=${combinedEvents.some((e) => e.eventId === sample.eventId)} ` +
          `severidadContraria(${opposite})=${contradictedEvents.length} esperados=${oppositeExpected}`,
        combined.status === 200 &&
          combinedEvents.some((e) => e.eventId === sample.eventId) &&
          contradicted.status === 200 &&
          contradictedEvents.length === oppositeExpected,
      );
    }
  }

  // OBS-AUDIT-TRACE-01 — an unknown trace is an empty list, not an error.
  {
    const res = await api(`/api/audit/recent?traceId=${ABSENT_TRACE}`, admin.token);
    report.record(
      'OBS-AUDIT-TRACE-01',
      'Auditoría',
      'GET /api/audit/recent?traceId= con una traza que no existe',
      '200 con lista vacía y total 0',
      `status=${res.status} count=${res.body.events?.length ?? 'N/A'} total=${res.body.total}`,
      res.status === 200 && Array.isArray(res.body.events) && res.body.events.length === 0 && res.body.total === 0,
    );
  }

  // OBS-AUDIT-VALIDATION-01 — a malformed filter is told so, never an empty trail.
  {
    const probes = [
      ['traceId=NO-ES-UNA-TRAZA', 'traceId'],
      [`traceId=${'0'.repeat(32)}`, 'traceId (todo ceros)'],
      ['correlationId=no-es-un-uuid', 'correlationId'],
      ['service=servicio-inexistente', 'service'],
      ['severity=CRITICAL', 'severity'],
    ];
    const outcomes = [];
    for (const [query, label] of probes) {
      const res = await api(`/api/audit/recent?${query}`, admin.token);
      outcomes.push(`${label}=${res.status}`);
    }
    report.record(
      'OBS-AUDIT-VALIDATION-01',
      'Auditoría',
      'Un filtro mal formado se rechaza en el borde',
      '400 en los cinco casos',
      outcomes.join(' '),
      outcomes.every((o) => o.endsWith('=400')),
    );
  }

  // -------------------------------------------------------------------------
  // OBS-WEBHOOK — POST /api/alerts/slo, the route Grafana calls with no session.
  // -------------------------------------------------------------------------
  {
    const anon = await webhook(grafanaBody('QAAnon'));
    const wrong = await webhook(grafanaBody('QAWrong'), 'un-secreto-que-no-es');
    const session = await webhook(grafanaBody('QASession'), admin.token);
    report.record(
      'OBS-WEBHOOK-AUTH-01',
      'Webhook de alertas',
      'El webhook rechaza sin secreto, con un secreto equivocado y con un JWT de sesión',
      '401 en los tres',
      `sin=${anon.status} equivocado=${wrong.status} jwtDeSesion=${session.status}`,
      anon.status === 401 && wrong.status === 401 && session.status === 401,
    );
  }

  if (ALERT_WEBHOOK_TOKEN.length < 32) {
    for (const id of ['OBS-WEBHOOK-VALIDATION-01', 'OBS-WEBHOOK-RECORDED-01']) {
      report.skip(
        id,
        'Webhook de alertas',
        id,
        'ALERT_WEBHOOK_TOKEN (>= 32 caracteres, el mismo del stack) no está en el entorno de esta corrida.',
      );
    }
  } else {
    // OBS-WEBHOOK-VALIDATION-01
    {
      const empty = await webhook({ status: 'firing', alerts: [] }, ALERT_WEBHOOK_TOKEN);
      const nameless = await webhook(
        { status: 'firing', alerts: [{ status: 'firing', labels: {}, startsAt: new Date().toISOString() }] },
        ALERT_WEBHOOK_TOKEN,
      );
      report.record(
        'OBS-WEBHOOK-VALIDATION-01',
        'Webhook de alertas',
        'Con el secreto correcto, un cuerpo inutilizable es un 400',
        '400 sin alertas y 400 sin alertname',
        `vacío=${empty.status} sinNombre=${nameless.status}`,
        empty.status === 400 && nameless.status === 400,
      );
    }

    // OBS-WEBHOOK-RECORDED-01 — registered in the audit trail and notified to operators.
    {
      const name = `QAProbe${Date.now()}`;
      const sent = await webhook(grafanaBody(name), ALERT_WEBHOOK_TOKEN);
      const correlationId = sent.body.correlationId;
      if (sent.status !== 202 || typeof correlationId !== 'string') {
        report.record(
          'OBS-WEBHOOK-RECORDED-01',
          'Webhook de alertas',
          'Una alerta válida queda registrada y notificada',
          '202 con correlationId',
          `${sent.status} ${JSON.stringify(sent.body)}`,
          false,
        );
      } else {
        const trail = await waitForStatus(
          `/api/audit?correlationId=${correlationId}`,
          admin.token,
          (r) => Array.isArray(r.body.events) && r.body.events.some((e) => e.messageType === 'alert.slo.received.v1'),
          10000,
        );
        const trailEvent = (trail.body.events ?? []).find((e) => e.messageType === 'alert.slo.received.v1');
        const notifications = await waitForStatus(
          '/api/audit/notifications?limit=100',
          admin.token,
          (r) => (r.body.notifications ?? []).some((n) => n.type === 'alert.slo' && n.correlationId === correlationId),
          10000,
        );
        const notified = (notifications.body.notifications ?? []).find(
          (n) => n.type === 'alert.slo' && n.correlationId === correlationId,
        );
        report.record(
          'OBS-WEBHOOK-RECORDED-01',
          'Webhook de alertas',
          'Una alerta válida queda registrada en la auditoría como ERROR y notificada a los operadores',
          '202; evento alert.slo.received.v1 con severity ERROR; notificación alert.slo con destinatario, estado SENT',
          `status=${sent.status} accepted=${sent.body.accepted} evento=${trailEvent?.severity ?? 'N/A'} ` +
            `notificación=${notified?.status ?? 'N/A'} destinatario=${notified?.recipient ?? 'N/A'}`,
          sent.body.accepted === 1 &&
            trailEvent?.severity === 'ERROR' &&
            notified?.status === 'SENT' &&
            typeof notified?.recipient === 'string' &&
            notified.recipient.length > 0,
        );
      }
    }
  }

  // -------------------------------------------------------------------------
  // OBS-SIM-RBAC — the simulation is the administrator's.
  // -------------------------------------------------------------------------
  {
    const body = { failureRatePercent: 0, timeoutRatePercent: 0, latencyMs: 0 };
    const anon = await api('/api/payments/simulation');
    const getCajero = await api('/api/payments/simulation', cajero.token);
    const getCliente = await api('/api/payments/simulation', cliente.token);
    const putCajero = await api('/api/payments/simulation', cajero.token, { method: 'PUT', body });
    const putCliente = await api('/api/payments/simulation', cliente.token, { method: 'PUT', body });
    report.record(
      'OBS-SIM-RBAC-01',
      'Simulación de pagos',
      '/api/payments/simulation solo responde al administrador',
      'GET sin sesión 401; GET y PUT como cajero y como cliente 403',
      `anon=${anon.status} getCajero=${getCajero.status} getCliente=${getCliente.status} putCajero=${putCajero.status} putCliente=${putCliente.status}`,
      anon.status === 401 &&
        [getCajero, getCliente, putCajero, putCliente].every((r) => r.status === 403),
    );

    const tooMuch = await api('/api/payments/simulation', admin.token, {
      method: 'PUT',
      body: { failureRatePercent: 80, timeoutRatePercent: 40, latencyMs: 0 },
    });
    const outOfRange = await api('/api/payments/simulation', admin.token, {
      method: 'PUT',
      body: { failureRatePercent: 150, timeoutRatePercent: 0, latencyMs: 0 },
    });
    report.record(
      'OBS-SIM-VALIDATION-01',
      'Simulación de pagos',
      'El administrador no puede fijar una simulación imposible',
      '400 si las tasas suman más de 100 y 400 si una sale del rango 0–100',
      `suma>100=${tooMuch.status} fueraDeRango=${outOfRange.status}`,
      tooMuch.status === 400 && outOfRange.status === 400,
    );
  }

  // -------------------------------------------------------------------------
  // OBS-ANOMALY-01 — more than N operations in M minutes ends as a WARNING in
  // the holder's inbox. N is 10 by default, so eleven credits are one too many.
  // -------------------------------------------------------------------------
  {
    const holder = await provisionRetry('obs-anomaly');
    if (!holder.ok) {
      report.skip('OBS-ANOMALY-01', 'Anomalías', 'Anomalía de alta frecuencia', `No se pudo aprovisionar al titular: ${holder.step} — ${String(holder.detail).slice(0, 160)}`);
      report.skip('OBS-ANOMALY-02', 'Anomalías', 'La anomalía llega a la auditoría', 'Depende de OBS-ANOMALY-01, que fue saltado.');
    } else {
      const account = holder.accountIds[0];
      let failures = 0;
      for (let i = 1; i <= 11; i += 1) {
        const res = await fund(account, cajero.token, 100, `anomaly-${i}`);
        if (res.status !== 200) failures += 1;
      }

      const inbox = await waitForStatus(
        '/api/notifications?limit=50',
        holder.token,
        (r) => (r.body.notifications ?? []).some((n) => n.type === 'account.anomaly'),
        15000,
      );
      const anomalies = (inbox.body.notifications ?? []).filter((n) => n.type === 'account.anomaly');
      report.record(
        'OBS-ANOMALY-01',
        'Anomalías',
        'Superar el umbral de operaciones deja exactamente una notificación WARNING en la bandeja del titular',
        '11 depósitos aceptados; una notificación account.anomaly con severity WARNING sobre esa cuenta',
        `depósitosFallidos=${failures} anomalías=${anomalies.length} severity=${anomalies[0]?.severity ?? 'N/A'} referencia=${anomalies[0]?.referenceId === account}`,
        failures === 0 &&
          anomalies.length === 1 &&
          anomalies[0].severity === 'WARNING' &&
          anomalies[0].referenceId === account,
      );

      // OBS-ANOMALY-02 — the same fact in the trail, found by service and level.
      const trail = await waitForStatus(
        '/api/audit/recent?limit=100&service=account-service&severity=WARNING',
        admin.token,
        (r) => (r.body.events ?? []).some((e) => e.messageType === 'account.anomaly.detected.v1' && e.payload?.accountId === account),
        10000,
      );
      const matches = (trail.body.events ?? []).filter(
        (e) => e.messageType === 'account.anomaly.detected.v1' && e.payload?.accountId === account,
      );
      report.record(
        'OBS-ANOMALY-02',
        'Anomalías',
        'La anomalía se encuentra en la auditoría por servicio y nivel, una sola vez',
        'Un account.anomaly.detected.v1 de esa cuenta, WARNING, con el umbral configurado',
        `coincidencias=${matches.length} severity=${matches[0]?.severity ?? 'N/A'} operationCount=${matches[0]?.payload?.operationCount ?? 'N/A'} threshold=${matches[0]?.payload?.threshold ?? 'N/A'}`,
        matches.length === 1 && matches[0].severity === 'WARNING' && matches[0].payload.operationCount > matches[0].payload.threshold,
      );
    }
  }

  // -------------------------------------------------------------------------
  // OBS-SIM-SAGA-01 — with a 100 % failure rate the Saga compensates, and the
  // money says so. The simulation is put back whatever happens.
  // -------------------------------------------------------------------------
  {
    const source = await provisionRetry('obs-sim-src');
    const target = await provisionRetry('obs-sim-dst');
    if (!source.ok || !target.ok) {
      const why = !source.ok ? source : target;
      report.skip('OBS-SIM-LIVE-01', 'Simulación de pagos', 'Cambio en caliente', `No se pudo aprovisionar: ${why.step} — ${String(why.detail).slice(0, 160)}`);
      report.skip('OBS-SIM-SAGA-01', 'Simulación de pagos', 'Compensación con 100 % de fallo', `No se pudo aprovisionar: ${why.step} — ${String(why.detail).slice(0, 160)}`);
    } else {
      const sourceAccount = source.accountIds[0];
      const targetAccount = target.accountIds[0];
      const funded = await fund(sourceAccount, cajero.token, 50000, 'sim-fund');

      try {
        const before = await api('/api/payments/simulation', admin.token);
        const set = await api('/api/payments/simulation', admin.token, {
          method: 'PUT',
          body: { failureRatePercent: 100, timeoutRatePercent: 0, latencyMs: 0 },
        });
        const after = await api('/api/payments/simulation', admin.token);
        report.record(
          'OBS-SIM-LIVE-01',
          'Simulación de pagos',
          'PUT cambia la simulación sin reiniciar nada, y GET la devuelve como RUNTIME',
          '200; failureRatePercent 100 y source RUNTIME',
          `antes=${before.body.failureRatePercent}/${before.body.source} put=${set.status} después=${after.body.failureRatePercent}/${after.body.source}`,
          set.status === 200 && after.status === 200 && after.body.failureRatePercent === 100 && after.body.source === 'RUNTIME',
        );

        if (funded.status !== 200) {
          report.skip('OBS-SIM-SAGA-01', 'Simulación de pagos', 'Compensación con 100 % de fallo', `El fondeo falló: ${funded.status}`);
        } else {
          const amount = 12500;
          const sourceBefore = await balanceOf(sourceAccount, source.token);
          const targetBefore = await balanceOf(targetAccount, cajero.token);
          const res = await api('/api/transfers', source.token, {
            method: 'POST',
            body: { sourceAccount, targetAccount, amount: money(amount) },
            headers: { 'Idempotency-Key': key('sim-saga') },
          });
          // The retry ladder (1 s, 2 s, 3 s) has to be climbed before the Saga gives up.
          const finished =
            res.status === 202
              ? await waitForStatus(`/api/transfers/${res.body.transactionId}`, source.token, (r) => r.status === 200 && TERMINAL.has(r.body.status), 45000, 700)
              : res;
          const sourceAfter = await balanceOf(sourceAccount, source.token);
          const targetAfter = await balanceOf(targetAccount, cajero.token);
          report.record(
            'OBS-SIM-SAGA-01',
            'Simulación de pagos',
            'Con 100 % de fallo la Saga compensa: el origen recupera el monto y el destino no recibe nada',
            'status COMPENSATED; saldo del origen igual al de antes; saldo del destino igual al de antes',
            `POST=${res.status} status=${finished.body.status} origen ${sourceBefore}→${sourceAfter} destino ${targetBefore}→${targetAfter}`,
            res.status === 202 &&
              finished.body.status === 'COMPENSATED' &&
              sourceAfter === sourceBefore &&
              targetAfter === targetBefore,
          );
        }
      } finally {
        const restored = await api('/api/payments/simulation', admin.token, { method: 'PUT', body: { reset: true } });
        report.record(
          'OBS-SIM-RESET-01',
          'Simulación de pagos',
          'PUT { reset: true } devuelve la simulación a los valores del ConfigMap',
          '200 y source DEFAULTS con tasa de fallo 0',
          `status=${restored.status} source=${restored.body.source} failureRatePercent=${restored.body.failureRatePercent}`,
          restored.status === 200 && restored.body.source === 'DEFAULTS' && restored.body.failureRatePercent === 0,
        );
      }
    }
  }

  // -------------------------------------------------------------------------
  // OBS-UI — the audit screen filters, on a real page.
  // -------------------------------------------------------------------------
  {
    const sample = baselineEvents.find((e) => typeof e.correlationId === 'string');
    const { browser, ctx, page } = await launch();
    try {
      await loginViaUI(ctx, page, SEEDED.admin.email, SEEDED.admin.password);
      await page.goto(`${BASE}/auditoria`);
      await page.waitForLoadState('networkidle');
      await page.waitForSelector('[data-testid="audit-filters"]', { timeout: 15000 }).catch(() => {});

      // OBS-UI-VALIDATION-01
      await page.locator('#filter-trace').fill('esto-no-es-una-traza');
      const traceError = await page
        .locator('[data-testid="filter-trace-error"]')
        .waitFor({ timeout: 5000 })
        .then(() => true)
        .catch(() => false);
      await page.locator('#filter-correlation').fill('tampoco-es-un-uuid');
      const correlationError = await page
        .locator('[data-testid="filter-correlation-error"]')
        .waitFor({ timeout: 5000 })
        .then(() => true)
        .catch(() => false);
      await shot(page, 'observability-01-filtros-invalidos');
      report.record(
        'OBS-UI-VALIDATION-01',
        'Auditoría (UI)',
        '/auditoria dice qué filtro está mal en lugar de mostrar una lista vacía',
        'Aparecen el aviso de la traza y el del código de seguimiento',
        `avisoTraza=${traceError} avisoCorrelación=${correlationError}`,
        traceError && correlationError,
      );

      // OBS-UI-FILTER-01
      if (sample === undefined) {
        report.skip('OBS-UI-FILTER-01', 'Auditoría (UI)', 'Filtrar por correlación en la pantalla', 'No hay eventos recientes de los que tomar una correlación.');
      } else {
        await page.locator('#filter-trace').fill('');
        await page.locator('#filter-correlation').fill(sample.correlationId);
        await page.locator('[data-testid="filter-submit"]').click();
        await page.waitForLoadState('networkidle');
        await page.waitForTimeout(1500);
        await shot(page, 'observability-02-filtro-correlacion');
        // One `event-trace` cell per row of the recent-events table.
        const rows = await page.locator('[data-testid="event-trace"]').count();
        const api = await (async () => {
          const r = await loginApi(SEEDED.admin.email, SEEDED.admin.password);
          const res = await fetch(`${GW}/api/audit/recent?limit=10&correlationId=${sample.correlationId}`, {
            headers: { Authorization: `Bearer ${r.token}` },
          });
          const body = await res.json().catch(() => ({}));
          return Array.isArray(body.events) ? body.events.length : 0;
        })();
        report.record(
          'OBS-UI-FILTER-01',
          'Auditoría (UI)',
          'Filtrar por correlación en /auditoria muestra los eventos reales de esa correlación',
          'La tabla tiene tantas filas como devuelve la API para ese filtro (y al menos una)',
          `filasEnPantalla=${rows} filasEnApi=${api}`,
          rows > 0 && rows === Math.min(api, 10),
        );
      }
    } finally {
      await browser.close();
    }
  }

  return report.summary();
}

/*
 * Comparado como ruta y no como URL a propósito: `import.meta.url` codifica los
 * espacios como `%20` y `file://${process.argv[1]}` no, así que en este
 * repositorio las dos cadenas nunca coinciden y el bloque no se ejecutaba.
 */
if (resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1] ?? '')) {
  const { writeReport, printSuiteLine } = await import('../support/report.mjs');
  const summary = await run();
  printSuiteLine(summary);
  writeReport('docs/qa/pyramid-e2e.json', [summary]);
  process.exit(summary.failed > 0 ? 1 : 0);
}
