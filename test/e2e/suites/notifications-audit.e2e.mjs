import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
/**
 * notifications-audit — the customer's own inbox (`N-01`) and the staff
 * audit console (`/api/audit`, `/api/audit/recent`, `/api/audit/notifications`),
 * both live over Notification & Audit Service.
 *
 * `GET /api/audit/recent` has no prior E2E coverage — this suite is where it
 * gets its first real assertions, including the per-item severity filter and
 * the D-06 role check.
 */
import { BASE, GW, SEEDED, api, loginApi } from '../support/gateway.mjs';
import { DUMMY_PNG, clearSession, launch, loginViaUI, shot } from '../support/browser.mjs';
import { Report } from '../support/report.mjs';
import { provisionCustomer } from '../support/seed.mjs';

/** The literal seeded password (docs/operations/CONTAINERS.md) — must never appear in a redacted payload. */
const SEEDED_PASSWORD = 'BankUsac#2026';

/** A bare `POST /api/customers`, kept minimal here because this case only needs the `correlationId` the response carries — `provisionCustomer` throws that away. */
async function registerRaw({ fullName, email, password, dpi }) {
  const form = new FormData();
  form.set('fullName', fullName);
  form.set('identityDocument', dpi);
  form.set('email', email);
  form.set('dateOfBirth', '1995-06-20');
  form.set('address', 'Ciudad de Guatemala');
  form.set('role', 'CLIENTE');
  form.set('credential', password);
  form.set('photo', new Blob([DUMMY_PNG], { type: 'image/png' }), 'dpi.png');

  const res = await fetch(`${GW}/api/customers`, { method: 'POST', body: form });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

/** Polls a fresh customer's own inbox until it is non-empty or the timeout elapses — registration/activation notifications are produced asynchronously. */
async function waitForNonEmptyInbox(token, timeoutMs = 10000, intervalMs = 500) {
  const start = Date.now();
  let last = await api('/api/notifications?limit=50', token);
  while (Date.now() - start < timeoutMs) {
    if (Array.isArray(last.body.notifications) && last.body.notifications.length > 0) return last;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
    last = await api('/api/notifications?limit=50', token);
  }
  return last;
}

export async function run() {
  const report = new Report('notifications-audit');

  // NOTIF-RBAC-01 — no token at all.
  const anonInbox = await api('/api/notifications');
  report.record(
    'NOTIF-RBAC-01',
    'Notificaciones',
    'GET /api/notifications sin token',
    '401 UNAUTHENTICATED',
    `${anonInbox.status}`,
    anonInbox.status === 401,
  );

  const admin = await loginApi(SEEDED.admin.email, SEEDED.admin.password);
  if (!admin.token) {
    throw new Error(`No se pudo autenticar el admin sembrado: ${JSON.stringify(admin.data)}`);
  }

  // Provision customer A — registration + activation generate real audit/notification events.
  const customerA = await provisionCustomer({ label: 'notif-a' });

  if (!customerA.ok) {
    report.skip('NOTIF-OWN-01', 'Notificaciones', 'Bandeja propia tras provisión', `No se pudo provisionar el cliente A: paso ${customerA.step} — ${customerA.detail}`);
    report.skip('NOTIF-READ-01', 'Notificaciones', 'Marcar como leída', 'Depende de NOTIF-OWN-01, que fue saltado.');
    report.skip('NOTIF-UI-01', 'Notificaciones', 'Bandeja en la UI', 'Depende de NOTIF-OWN-01, que fue saltado.');
  } else {
    // NOTIF-OWN-01
    const inboxA = await waitForNonEmptyInbox(customerA.token);
    const notificationsA = Array.isArray(inboxA.body.notifications) ? inboxA.body.notifications : [];
    const firstA = notificationsA[0];
    report.record(
      'NOTIF-OWN-01',
      'Notificaciones',
      'Bandeja propia de un cliente recién provisionado',
      'Al menos una notificación real, con un campo type reconocible',
      `count=${notificationsA.length} first.type=${firstA?.type ?? 'N/A'} first.subject=${firstA?.subject ?? 'N/A'}`,
      notificationsA.length > 0 && typeof firstA?.type === 'string' && firstA.type.length > 0,
    );

    // NOTIF-READ-01
    if (notificationsA.length === 0) {
      report.skip('NOTIF-READ-01', 'Notificaciones', 'Marcar como leída', 'No hay notificaciones en la bandeja de A para marcar.');
    } else {
      const targetId = firstA.notificationId;
      // Compared only over the IDs already present in "before" — `provisionCustomer`
      // opens an account right after this point, and that in-flight step can land a
      // brand-new unread notification between this call and the next GET, which would
      // make a raw `unreadBefore` vs `unreadAfter` comparison flaky through no fault of
      // the endpoint. Restricting the "still unread" count to the known-before IDs makes
      // the comparison immune to that race.
      const beforeIds = new Set(notificationsA.map((n) => n.notificationId));
      const unreadAmongBeforeIdsBefore = notificationsA.filter((n) => n.readAt === null).length;
      const markResult = await api('/api/notifications/read', customerA.token, {
        method: 'POST',
        body: { notificationIds: [targetId] },
      });
      const inboxAfter = await api('/api/notifications?limit=50', customerA.token);
      const afterList = inboxAfter.body.notifications ?? [];
      const updatedRow = afterList.find((n) => n.notificationId === targetId);
      const unreadAmongBeforeIdsAfter = afterList.filter(
        (n) => beforeIds.has(n.notificationId) && n.readAt === null,
      ).length;
      const wasUnreadBefore = firstA.readAt === null;
      const readNowReflected = updatedRow?.readAt !== null && updatedRow?.readAt !== undefined;
      const unreadDroppedCorrectly =
        !wasUnreadBefore || unreadAmongBeforeIdsAfter === unreadAmongBeforeIdsBefore - 1;
      report.record(
        'NOTIF-READ-01',
        'Notificaciones',
        'POST /api/notifications/read marca una notificación puntual',
        '200 con ReadResult numérico; la fila queda con readAt no nulo, y entre las notificaciones ya conocidas el conteo de no leídas baja en 1',
        `POST status=${markResult.status} changed=${markResult.body.changed} unread(resp)=${markResult.body.unread} ` +
          `unreadAmongBeforeIds: antes=${unreadAmongBeforeIdsBefore} después=${unreadAmongBeforeIdsAfter} ` +
          `readAtAntes=${firstA.readAt} readAtDespués=${updatedRow?.readAt}`,
        markResult.status === 200 &&
          typeof markResult.body.changed === 'number' &&
          typeof markResult.body.unread === 'number' &&
          readNowReflected &&
          unreadDroppedCorrectly,
      );
    }

    // NOTIF-UI-01
    {
      const { browser, ctx, page } = await launch();
      try {
        await loginViaUI(ctx, page, customerA.email, customerA.password);
        await page.goto(`${BASE}/notificaciones`);
        await page.waitForLoadState('networkidle');
        await page.waitForSelector('li[data-read], [data-testid="inbox-empty"]', { timeout: 10000 }).catch(() => {});
        await shot(page, 'notif-audit-01-bandeja-cliente');
        const renderedCount = await page.locator('li[data-read]').count();
        const apiCheck = await api('/api/notifications?limit=50', customerA.token);
        const apiCount = Array.isArray(apiCheck.body.notifications) ? apiCheck.body.notifications.length : 0;
        report.record(
          'NOTIF-UI-01',
          'Notificaciones',
          'La UI de /notificaciones muestra las notificaciones reales del cliente',
          'renderedCount === apiCount y ambos > 0',
          `renderedCount=${renderedCount} apiCount=${apiCount}`,
          renderedCount > 0 && renderedCount === apiCount,
        );
      } finally {
        await browser.close();
      }
    }
  }

  // NOTIF-ISOLATION-01 — customer B must never see A's notifications.
  const customerB = await provisionCustomer({ label: 'notif-b' });
  if (!customerB.ok) {
    report.skip('NOTIF-ISOLATION-01', 'Notificaciones', 'Aislamiento entre clientes', `No se pudo provisionar el cliente B: paso ${customerB.step} — ${customerB.detail}`);
  } else if (!customerA.ok) {
    report.skip('NOTIF-ISOLATION-01', 'Notificaciones', 'Aislamiento entre clientes', 'No se pudo provisionar el cliente A para comparar.');
  } else {
    const inboxB = await waitForNonEmptyInbox(customerB.token);
    const notificationsB = Array.isArray(inboxB.body.notifications) ? inboxB.body.notifications : [];
    const inboxAFinal = await api('/api/notifications?limit=50', customerA.token);
    const notificationsA = Array.isArray(inboxAFinal.body.notifications) ? inboxAFinal.body.notifications : [];
    const aCorrelationIds = new Set(notificationsA.map((n) => n.correlationId));
    const aReferenceIds = new Set(notificationsA.map((n) => n.referenceId).filter(Boolean));
    const aIdentifiers = new Set([customerA.customerId, ...(customerA.accountIds ?? [])]);
    const crossCorrelation = notificationsB.filter((n) => aCorrelationIds.has(n.correlationId));
    const crossReference = notificationsB.filter(
      (n) => aReferenceIds.has(n.referenceId) || aIdentifiers.has(n.referenceId),
    );
    report.record(
      'NOTIF-ISOLATION-01',
      'Notificaciones',
      'La bandeja de un cliente B no contiene notificaciones del cliente A',
      'countB > 0, sin correlationId ni referenceId compartidos con A',
      `countB=${notificationsB.length} crossCorrelationMatches=${crossCorrelation.length} crossReferenceMatches=${crossReference.length}`,
      notificationsB.length > 0 && crossCorrelation.length === 0 && crossReference.length === 0,
    );
  }

  // AUDIT-RECENT-01
  const recent = await api('/api/audit/recent?limit=20', admin.token);
  const recentEvents = Array.isArray(recent.body.events) ? recent.body.events : [];
  const firstEvent = recentEvents[0];
  report.record(
    'AUDIT-RECENT-01',
    'Auditoría',
    'GET /api/audit/recent como admin',
    '200 con eventos reales (messageType/severity presentes)',
    `status=${recent.status} count=${recentEvents.length} first.messageType=${firstEvent?.messageType ?? 'N/A'} first.processingStatus=${firstEvent?.processingStatus ?? 'N/A'}`,
    recent.status === 200 && recentEvents.length > 0 && typeof firstEvent?.messageType === 'string',
  );

  // AUDIT-RECENT-02 — filter by a severity actually present in the data.
  const severitiesPresent = [...new Set(recentEvents.map((e) => e.severity).filter(Boolean))];
  if (severitiesPresent.length === 0) {
    report.skip(
      'AUDIT-RECENT-02',
      'Auditoría',
      'Filtrar /api/audit/recent por severidad',
      'Ningún evento de la muestra trae severity asignada (eventos anteriores a T-30 la omiten).',
    );
  } else {
    const chosenSeverity = severitiesPresent[0];
    const filtered = await api(`/api/audit/recent?limit=50&severity=${chosenSeverity}`, admin.token);
    const filteredEvents = Array.isArray(filtered.body.events) ? filtered.body.events : [];
    const allMatch = filteredEvents.every((e) => e.severity === chosenSeverity);
    report.record(
      'AUDIT-RECENT-02',
      'Auditoría',
      `GET /api/audit/recent?severity=${chosenSeverity}`,
      'Cada evento devuelto trae exactamente esa severidad',
      `status=${filtered.status} count=${filteredEvents.length} allMatch=${allMatch} severidades=${[...new Set(filteredEvents.map((e) => e.severity))].join(',')}`,
      filtered.status === 200 && filteredEvents.length > 0 && allMatch,
    );
  }

  // AUDIT-RECENT-RBAC-01
  const cajero = await loginApi(SEEDED.cajero.email, SEEDED.cajero.password);
  if (!cajero.token) throw new Error(`No se pudo autenticar el cajero sembrado: ${JSON.stringify(cajero.data)}`);
  const cajeroRecent = await api('/api/audit/recent', cajero.token);
  report.record(
    'AUDIT-RECENT-RBAC-01',
    'Auditoría',
    'GET /api/audit/recent como CAJERO_RECEPTOR',
    '403 FORBIDDEN (D-06: solo ADMINISTRADOR)',
    `${cajeroRecent.status}`,
    cajeroRecent.status === 403,
  );

  // AUDIT-CORRELATION-01
  const rnd = Math.floor(100000 + Math.random() * 899999);
  const regEmail = `qa.audit-corr.${rnd}@example.com`;
  const regPassword = 'StrongQA#2026!';
  const regDpi = `2${String(rnd).padStart(4, '0')}9${String(rnd).padStart(4, '0')}0101`.slice(0, 13);
  const reg = await registerRaw({ fullName: `QA AuditCorr ${rnd}`, email: regEmail, password: regPassword, dpi: regDpi });
  if (reg.status !== 202 || !reg.body.correlationId) {
    report.skip(
      'AUDIT-CORRELATION-01',
      'Auditoría',
      'GET /api/audit?correlationId= incluye el registro real',
      `El registro directo no devolvió un correlationId usable: ${reg.status} ${JSON.stringify(reg.body)}`,
    );
  } else {
    const correlationId = reg.body.correlationId;
    // The trail is written asynchronously; poll until the registration event lands or the timeout elapses.
    const trail = await pollAuditTrail(correlationId, admin.token);
    const trailEvents = Array.isArray(trail.body.events) ? trail.body.events : [];
    const hasRegistrationEvent = trailEvents.some(
      (e) => typeof e.messageType === 'string' && e.messageType.startsWith('customer.register'),
    );
    report.record(
      'AUDIT-CORRELATION-01',
      'Auditoría',
      'GET /api/audit?correlationId= incluye el evento de registro real',
      'events incluye un customer.register*.v1 para ese correlationId exacto',
      `status=${trail.status} correlationId=${correlationId} eventCount=${trailEvents.length} messageTypes=${trailEvents.map((e) => e.messageType).join(',')}`,
      trail.status === 200 && hasRegistrationEvent,
    );

    // AUDIT-UI-01 — cross-checked against the same correlationId via the real UI.
    {
      const { browser, ctx, page } = await launch();
      try {
        await loginViaUI(ctx, page, SEEDED.admin.email, SEEDED.admin.password);
        await page.goto(`${BASE}/auditoria?correlationId=${correlationId}`);
        await page.waitForLoadState('networkidle');
        await page.waitForSelector('[data-testid="audit-correlation-input"]', { timeout: 10000 }).catch(() => {});
        await page.waitForTimeout(1500);
        await shot(page, 'notif-audit-02-auditoria-correlacion');
        const inputValue = await page.locator('[data-testid="audit-correlation-input"]').inputValue().catch(() => '');
        const bodyText = await page.locator('body').innerText().catch(() => '');
        const uiShowsCorrelation = bodyText.includes(correlationId) || inputValue === correlationId;
        report.record(
          'AUDIT-UI-01',
          'Auditoría',
          '/auditoria busca por correlationId y muestra el rastro real',
          `La página refleja correlationId=${correlationId} y al menos un evento (API tenía ${trailEvents.length})`,
          `inputValue=${inputValue} correlationIdInBody=${bodyText.includes(correlationId)} apiEventCount=${trailEvents.length}`,
          uiShowsCorrelation && trailEvents.length > 0,
        );
      } finally {
        await browser.close();
      }
    }
  }

  // AUDIT-NOTIF-RBAC-01
  const clienteLogin = await loginApi(SEEDED.cliente.email, SEEDED.cliente.password);
  if (!clienteLogin.token) throw new Error(`No se pudo autenticar el cliente sembrado: ${JSON.stringify(clienteLogin.data)}`);
  const clienteAuditNotifs = await api('/api/audit/notifications', clienteLogin.token);
  report.record(
    'AUDIT-NOTIF-RBAC-01',
    'Auditoría',
    'GET /api/audit/notifications como CLIENTE',
    '403 FORBIDDEN (D-06: solo ADMINISTRADOR)',
    `${clienteAuditNotifs.status}`,
    clienteAuditNotifs.status === 403,
  );

  // PRIV-REDACT-01 — no plaintext credential anywhere in what an admin can read.
  const auditNotifsAdmin = await api('/api/audit/notifications?limit=200', admin.token);
  const recentWide = await api('/api/audit/recent?limit=100', admin.token);
  const haystacks = [
    ['GET /api/audit/notifications', auditNotifsAdmin],
    ['GET /api/audit/recent', recentWide],
  ];
  const leaks = [];
  for (const [label, response] of haystacks) {
    const raw = JSON.stringify(response.body);
    if (raw.includes(SEEDED_PASSWORD)) leaks.push(`${label}: contiene la contraseña sembrada en texto plano`);
    if (raw.includes(regPassword)) leaks.push(`${label}: contiene la contraseña del registro directo en texto plano`);
    if (customerA.ok && raw.includes(customerA.password)) leaks.push(`${label}: contiene la contraseña de QA A en texto plano`);
  }
  report.record(
    'PRIV-REDACT-01',
    'Privacidad',
    'Ninguna respuesta de auditoría filtra una contraseña en texto plano',
    'Ninguna coincidencia literal de las contraseñas sembradas/generadas en el JSON de respuesta',
    leaks.length === 0 ? 'Sin coincidencias' : leaks.join(' | '),
    leaks.length === 0,
  );

  // NOTIF-READ-02 — omitted notificationIds marks every unread row for that customer.
  const customerC = await provisionCustomer({ label: 'notif-c' });
  if (!customerC.ok) {
    report.skip('NOTIF-READ-02', 'Notificaciones', 'Marcar todas como leídas (sin notificationIds)', `No se pudo provisionar el cliente C: paso ${customerC.step} — ${customerC.detail}`);
  } else {
    const inboxC = await waitForNonEmptyInbox(customerC.token);
    const beforeList = Array.isArray(inboxC.body.notifications) ? inboxC.body.notifications : [];
    const beforeCount = beforeList.length;
    const beforeIds = new Set(beforeList.map((n) => n.notificationId));
    const unreadBeforeC = inboxC.body.unread;
    const markAll = await api('/api/notifications/read', customerC.token, { method: 'POST', body: {} });
    const inboxCAfter = await api('/api/notifications?limit=50', customerC.token);
    const afterListC = inboxCAfter.body.notifications ?? [];
    // Restricted to the IDs already seen in "before": `provisionCustomer` opens an
    // account right after activation, and that step's own notification can land
    // between this "mark all" call and the follow-up GET — it is unread by
    // construction (it did not exist when "mark all" ran) and would make a raw,
    // whole-inbox `unread === 0` check flaky through no fault of the endpoint.
    const stillUnreadAmongBeforeIds = afterListC.filter(
      (n) => beforeIds.has(n.notificationId) && n.readAt === null,
    ).length;
    report.record(
      'NOTIF-READ-02',
      'Notificaciones',
      'POST /api/notifications/read sin notificationIds marca TODAS como leídas',
      'changed > 0 y, entre las notificaciones ya conocidas antes de la llamada, ninguna queda con readAt=null',
      `beforeCount=${beforeCount} unreadBefore=${unreadBeforeC} markAll.status=${markAll.status} markAll.changed=${markAll.body.changed} markAll.unread=${markAll.body.unread} stillUnreadAmongBeforeIds=${stillUnreadAmongBeforeIds}`,
      markAll.status === 200 &&
        beforeCount > 0 &&
        typeof markAll.body.changed === 'number' &&
        markAll.body.changed > 0 &&
        stillUnreadAmongBeforeIds === 0,
    );
  }

  return report.summary();
}

/** The audit trail for a fresh registration is written asynchronously by Notification & Audit Service; poll instead of guessing a sleep. */
async function pollAuditTrail(correlationId, adminToken, timeoutMs = 10000, intervalMs = 500) {
  const start = Date.now();
  let last = await api(`/api/audit?correlationId=${correlationId}`, adminToken);
  while (Date.now() - start < timeoutMs) {
    if (Array.isArray(last.body.events) && last.body.events.length > 0) return last;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
    last = await api(`/api/audit?correlationId=${correlationId}`, adminToken);
  }
  return last;
}

/*
 * Comparado como ruta y no como URL a propósito.
 *
 * `import.meta.url` codifica el espacio de «segundo semestre» como `%20`;
 * `file://${process.argv[1]}` no lo hace. En este repositorio las dos cadenas
 * nunca coinciden, así que este bloque no se ejecutaba: `node <suite>.e2e.mjs`
 * salía con código 0 y sin una sola línea de salida, que se lee exactamente
 * igual que una corrida limpia. `resolve` normaliza ambos lados y deja de
 * depender de cómo se escriba el path.
 */
if (resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1] ?? '')) {
  const { writeReport, printSuiteLine } = await import('../support/report.mjs');
  const summary = await run();
  printSuiteLine(summary);
  writeReport('docs/qa/pyramid-e2e.json', [summary]);
  process.exit(summary.failed > 0 ? 1 : 0);
}
