/**
 * rbac-matrix — the D-06 role×endpoint permission matrix, plus the
 * client-side route guards that sit in front of it.
 *
 * `auth-session.e2e.mjs` already covers login mechanics and session handling
 * (SEC-01..SEC-12) including the generic 401 on a missing/forged token
 * (SEC-10/SEC-11) and the client-side redirect off `/cuentas` with no session
 * (SEC-12). None of that is repeated here. This suite is strictly about *who*,
 * once authenticated, may reach *what* — the real HTTP status a role gets back
 * from a restricted endpoint (Part A), whether the frontend actually stops a
 * disallowed role from reaching a staff-only screen (Part B), and two specific,
 * previously-untested guard behaviours: the post-login `next` bounce and
 * whether signing out really closes a guarded page (Part C / TD-075).
 *
 * A UUID placeholder (`PLACEHOLDER_ID`) stands in for every path parameter
 * where the specific resource does not matter — what is under test is the role
 * check, and a correctly layered Gateway applies `@Roles` before it ever looks
 * the resource up. That is verified, not assumed: every "wrong role" case here
 * asserts the actual status is 403, and a stray 404 would be recorded as the
 * genuine defect it would be, not smoothed over.
 */
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { BASE, SEEDED, api, loginAllRoles } from '../support/gateway.mjs';
import { clearSession, launch, shot } from '../support/browser.mjs';
import { Report } from '../support/report.mjs';

const PLACEHOLDER_ID = '00000000-0000-4000-8000-000000000001';

export async function run() {
  const report = new Report('rbac-matrix');
  const roles = await loginAllRoles();

  // ===========================================================================
  // Part A — the D-06 role×endpoint matrix, real status codes over HTTP.
  // ===========================================================================

  // RBAC-GATE-01/02 — the 401 gate applies to a restricted GET and a
  // restricted command alike, with no token at all.
  const unauthGet = await api(`/api/audit?correlationId=${PLACEHOLDER_ID}`);
  report.record(
    'RBAC-GATE-01',
    'RBAC',
    'GET /api/audit sin token',
    '401 UNAUTHENTICATED',
    `${unauthGet.status}`,
    unauthGet.status === 401,
  );

  const unauthPost = await api(`/api/accounts/${PLACEHOLDER_ID}/deposit`, null, {
    method: 'POST',
    body: { amount: { amountMinor: 1000, currency: 'GTQ' } },
  });
  report.record(
    'RBAC-GATE-02',
    'RBAC',
    'POST /api/accounts/:id/deposit sin token',
    '401 UNAUTHENTICATED',
    `${unauthPost.status}`,
    unauthPost.status === 401,
  );

  // RBAC-AUDIT-* — GET /api/audit is ADMINISTRADOR-only.
  const auditCliente = await api(`/api/audit?correlationId=${PLACEHOLDER_ID}`, roles.cliente.token);
  report.record(
    'RBAC-AUDIT-CLIENTE',
    'RBAC',
    'GET /api/audit como CLIENTE',
    '403 FORBIDDEN (no 404: el chequeo de rol corre antes de buscar el recurso)',
    `${auditCliente.status}: ${auditCliente.body.type ?? ''}`,
    auditCliente.status === 403,
    auditCliente.status === 404
      ? 'HALLAZGO: se obtuvo 404 en vez de 403 — el chequeo de rol podría correr después de la búsqueda del recurso.'
      : '',
  );

  const auditCajero = await api(`/api/audit?correlationId=${PLACEHOLDER_ID}`, roles.cajero.token);
  report.record(
    'RBAC-AUDIT-CAJERO',
    'RBAC',
    'GET /api/audit como CAJERO_RECEPTOR',
    '403 FORBIDDEN',
    `${auditCajero.status}: ${auditCajero.body.type ?? ''}`,
    auditCajero.status === 403,
  );

  const auditAdmin = await api(`/api/audit?correlationId=${PLACEHOLDER_ID}`, roles.admin.token);
  report.record(
    'RBAC-AUDIT-ADMIN',
    'RBAC',
    'GET /api/audit como ADMINISTRADOR',
    '200',
    `${auditAdmin.status}`,
    auditAdmin.status === 200,
  );

  // RBAC-AUDIT-RECENT / RBAC-AUDIT-NOTIF — the two audit sub-routes carry the
  // identical @Roles('ADMINISTRADOR'), one case per side rather than one per
  // route, since a fourth near-duplicate check would prove nothing new.
  const recentCliente = await api('/api/audit/recent', roles.cliente.token);
  report.record(
    'RBAC-AUDIT-RECENT-CLIENTE',
    'RBAC',
    'GET /api/audit/recent como CLIENTE',
    '403 FORBIDDEN',
    `${recentCliente.status}: ${recentCliente.body.type ?? ''}`,
    recentCliente.status === 403,
  );

  const notifCliente = await api('/api/audit/notifications', roles.cliente.token);
  report.record(
    'RBAC-AUDIT-NOTIF-CLIENTE',
    'RBAC',
    'GET /api/audit/notifications como CLIENTE',
    '403 FORBIDDEN',
    `${notifCliente.status}: ${notifCliente.body.type ?? ''}`,
    notifCliente.status === 403,
  );

  const recentAdmin = await api('/api/audit/recent', roles.admin.token);
  const notifAdmin = await api('/api/audit/notifications', roles.admin.token);
  report.record(
    'RBAC-AUDIT-SUBROUTES-ADMIN',
    'RBAC',
    '/api/audit/recent y /api/audit/notifications como ADMINISTRADOR',
    'Ambas 200',
    `recent=${recentAdmin.status} notifications=${notifAdmin.status}`,
    recentAdmin.status === 200 && notifAdmin.status === 200,
  );

  // RBAC-PAYMENTS-* — GET /api/payments is CAJERO_RECEPTOR/ADMINISTRADOR only.
  const paymentsCliente = await api('/api/payments', roles.cliente.token);
  report.record(
    'RBAC-PAYMENTS-CLIENTE',
    'RBAC',
    'GET /api/payments como CLIENTE',
    '403 FORBIDDEN',
    `${paymentsCliente.status}: ${paymentsCliente.body.type ?? ''}`,
    paymentsCliente.status === 403,
  );

  const paymentsCajero = await api('/api/payments', roles.cajero.token);
  report.record(
    'RBAC-PAYMENTS-CAJERO',
    'RBAC',
    'GET /api/payments como CAJERO_RECEPTOR',
    '200',
    `${paymentsCajero.status}`,
    paymentsCajero.status === 200,
  );

  // RBAC-DEPOSIT-* — POST /api/accounts/:id/deposit is staff-only.
  const depositCliente = await api(`/api/accounts/${PLACEHOLDER_ID}/deposit`, roles.cliente.token, {
    method: 'POST',
    body: { amount: { amountMinor: 1000, currency: 'GTQ' } },
  });
  report.record(
    'RBAC-DEPOSIT-CLIENTE',
    'RBAC',
    'POST /api/accounts/:id/deposit como CLIENTE (cuenta inexistente)',
    '403 FORBIDDEN (no 404: el rol se rechaza antes de mirar la cuenta)',
    `${depositCliente.status}: ${depositCliente.body.type ?? ''}`,
    depositCliente.status === 403,
    depositCliente.status === 404
      ? 'HALLAZGO: se obtuvo 404 en vez de 403 para un id inexistente con el rol equivocado.'
      : '',
  );

  const depositCajero = await api(`/api/accounts/${PLACEHOLDER_ID}/deposit`, roles.cajero.token, {
    method: 'POST',
    body: { amount: { amountMinor: 1000, currency: 'GTQ' } },
  });
  report.record(
    'RBAC-DEPOSIT-CAJERO',
    'RBAC',
    'POST /api/accounts/:id/deposit como CAJERO_RECEPTOR',
    'Pasa el chequeo de rol (no 401/403); lo que ocurra después depende de que la cuenta no existe',
    `${depositCajero.status}: ${depositCajero.body.type ?? ''}`,
    depositCajero.status !== 401 && depositCajero.status !== 403,
  );

  // RBAC-STATUS-* — POST /api/accounts/:id/status.
  //
  // The task brief that spawned this suite listed this route as
  // "ADMINISTRADOR only". Reading `apps/gateway/src/interfaces/accounts.controller.ts`
  // directly shows `@Roles('ADMINISTRADOR', 'CAJERO_RECEPTOR', 'CLIENTE')` — D-06
  // restricts deactivation by *role* but grants it to all three, scoped for
  // CLIENTE to "their own accounts" (a scope check the Gateway cannot make, so
  // it is Account Service's problem, not this route's). This case tests the
  // REAL behaviour rather than the assumed one, and the discrepancy is recorded
  // here rather than silently "corrected" away.
  const statusCliente = await api(`/api/accounts/${PLACEHOLDER_ID}/status`, roles.cliente.token, {
    method: 'POST',
    body: { status: 'INACTIVE', reason: 'rbac-matrix e2e probe' },
  });
  const statusCajero = await api(`/api/accounts/${PLACEHOLDER_ID}/status`, roles.cajero.token, {
    method: 'POST',
    body: { status: 'INACTIVE', reason: 'rbac-matrix e2e probe' },
  });
  const statusAdmin = await api(`/api/accounts/${PLACEHOLDER_ID}/status`, roles.admin.token, {
    method: 'POST',
    body: { status: 'INACTIVE', reason: 'rbac-matrix e2e probe' },
  });
  report.record(
    'RBAC-STATUS-ALLROLES',
    'RBAC',
    'POST /api/accounts/:id/status para las tres sesiones autenticadas',
    'Las tres pasan el gate de rol (202) — D-06 no es "solo ADMINISTRADOR" en esta ruta',
    `cliente=${statusCliente.status} cajero=${statusCajero.status} admin=${statusAdmin.status}`,
    statusCliente.status === 202 && statusCajero.status === 202 && statusAdmin.status === 202,
    'La consigna de esta suite asumía "ADMINISTRADOR only" para esta ruta; el código fuente y esta ' +
      'prueba muestran @Roles(\'ADMINISTRADOR\', \'CAJERO_RECEPTOR\', \'CLIENTE\') — D-06 permite que un ' +
      'CLIENTE desactive/reactive sus propias cuentas. No es un defecto: es el hecho real, documentado en ' +
      'el propio comentario del controlador ("ADMINISTRADOR, CAJERO_RECEPTOR y CLIENTE (para sus propias cuentas)").',
  );

  // RBAC-IDENTITY-VERDICT-* — staff only.
  const verdictCliente = await api(`/api/customers/${PLACEHOLDER_ID}/identity-verdict`, roles.cliente.token, {
    method: 'POST',
    body: { verdict: 'VALIDATED' },
  });
  report.record(
    'RBAC-IDENTITY-VERDICT-CLIENTE',
    'RBAC',
    'POST /api/customers/:id/identity-verdict como CLIENTE',
    '403 FORBIDDEN',
    `${verdictCliente.status}: ${verdictCliente.body.type ?? ''}`,
    verdictCliente.status === 403,
  );

  const verdictCajero = await api(`/api/customers/${PLACEHOLDER_ID}/identity-verdict`, roles.cajero.token, {
    method: 'POST',
    body: { verdict: 'VALIDATED' },
  });
  report.record(
    'RBAC-IDENTITY-VERDICT-CAJERO',
    'RBAC',
    'POST /api/customers/:id/identity-verdict como CAJERO_RECEPTOR',
    '202 (pasa el gate de rol)',
    `${verdictCajero.status}`,
    verdictCajero.status === 202,
  );

  // RBAC-KYC-STATUS-* — staff only.
  const kycCliente = await api(`/api/customers/${PLACEHOLDER_ID}/kyc-status`, roles.cliente.token, {
    method: 'POST',
    body: { status: 'VERIFIED' },
  });
  report.record(
    'RBAC-KYC-STATUS-CLIENTE',
    'RBAC',
    'POST /api/customers/:id/kyc-status como CLIENTE',
    '403 FORBIDDEN',
    `${kycCliente.status}: ${kycCliente.body.type ?? ''}`,
    kycCliente.status === 403,
  );

  const kycCajero = await api(`/api/customers/${PLACEHOLDER_ID}/kyc-status`, roles.cajero.token, {
    method: 'POST',
    body: { status: 'VERIFIED' },
  });
  report.record(
    'RBAC-KYC-STATUS-CAJERO',
    'RBAC',
    'POST /api/customers/:id/kyc-status como CAJERO_RECEPTOR',
    '202 (pasa el gate de rol)',
    `${kycCajero.status}`,
    kycCajero.status === 202,
  );

  // RBAC-PENDING-VALIDATION-* — staff only.
  const pendingCliente = await api('/api/customers/pending-validation', roles.cliente.token);
  report.record(
    'RBAC-PENDING-VALIDATION-CLIENTE',
    'RBAC',
    'GET /api/customers/pending-validation como CLIENTE',
    '403 FORBIDDEN',
    `${pendingCliente.status}: ${pendingCliente.body.type ?? ''}`,
    pendingCliente.status === 403,
  );

  const pendingCajero = await api('/api/customers/pending-validation', roles.cajero.token);
  report.record(
    'RBAC-PENDING-VALIDATION-CAJERO',
    'RBAC',
    'GET /api/customers/pending-validation como CAJERO_RECEPTOR',
    '200',
    `${pendingCajero.status}`,
    pendingCajero.status === 200,
  );

  // RBAC-ACCOUNTS-OPEN-CLIENTE — self-service account opening, any authenticated CLIENTE.
  const openAccount = await api('/api/accounts', roles.cliente.token, {
    method: 'POST',
    body: { accountType: 'MONETARIA' },
  });
  report.record(
    'RBAC-ACCOUNTS-OPEN-CLIENTE',
    'RBAC',
    'POST /api/accounts como CLIENTE (autoservicio)',
    '202',
    `${openAccount.status}`,
    openAccount.status === 202,
  );

  // RBAC-ANY-ROLE-CLIENTE — the three routes open to every authenticated role.
  const [accountsGet, dashboardGet, notificationsGet] = await Promise.all([
    api('/api/accounts', roles.cliente.token),
    api('/api/dashboard', roles.cliente.token),
    api('/api/notifications', roles.cliente.token),
  ]);
  report.record(
    'RBAC-ANY-ROLE-CLIENTE',
    'RBAC',
    'GET /api/accounts, /api/dashboard y /api/notifications como CLIENTE',
    'Las tres 200',
    `accounts=${accountsGet.status} dashboard=${dashboardGet.status} notifications=${notificationsGet.status}`,
    accountsGet.status === 200 && dashboardGet.status === 200 && notificationsGet.status === 200,
  );

  // ===========================================================================
  // Part B — UI navigation guards. What actually happens, not what should.
  // ===========================================================================
  const { browser, ctx, page } = await launch();

  try {
    await loginAsUi(ctx, page, SEEDED.cliente.email, SEEDED.cliente.password);

    // NAV-CLIENT-STAFF-01 — /clientes/validaciones (staff-only sub-screen of a
    // module CLIENTE otherwise has full access to). Its own component carries a
    // page-level guard (`apps/web/app/pages/clientes/validaciones/index.vue`)
    // that redirects a non-staff role to `/clientes` — narrower than, and
    // separate from, the global module-level `canOpen` check.
    await page.goto(`${BASE}/clientes/validaciones`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1000);
    await shot(page, 'rbac-01-clientes-validaciones-cliente');
    const url1 = page.url();
    const blocked1 = !url1.includes('/clientes/validaciones');
    report.record(
      'NAV-CLIENT-STAFF-01',
      'Guardas de navegación',
      'CLIENTE navega a /clientes/validaciones (pantalla de personal)',
      'La URL cambia lejos de /clientes/validaciones (redirección real)',
      url1,
      blocked1,
      blocked1
        ? 'Redirige a /clientes vía un guard propio de esa página, no vía el chequeo global de módulo (D-06 en /clientes es EVERY_ROLE).'
        : 'No se observó redirección: la URL permaneció en /clientes/validaciones.',
    );

    // NAV-CLIENT-STAFF-02 — /cuentas/deposito. `canOpen` treats the whole
    // `/cuentas` module as EVERY_ROLE, so there is NO navigation-level block
    // here: the URL stays put and the page shell renders. What actually
    // protects this screen is content-level — the deposit form itself is
    // hidden behind `v-if="!allowed"` (`apps/web/app/pages/cuentas/deposito.vue`)
    // and a "cajero/admin only" message is shown instead. Recorded precisely
    // as that, not as "blocked".
    await page.goto(`${BASE}/cuentas/deposito`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1000);
    await shot(page, 'rbac-02-cuentas-deposito-cliente');
    const url2 = page.url();
    const stillOnPage2 = url2.includes('/cuentas/deposito');
    const blockedMessageVisible = await page
      .getByText('Esta pantalla es para ventanilla')
      .first()
      .isVisible()
      .catch(() => false);
    const depositFormVisible = await page
      .locator('input[type="number"], [data-testid="deposit-local-problem"]')
      .first()
      .isVisible()
      .catch(() => false);
    report.record(
      'NAV-CLIENT-STAFF-02',
      'Guardas de navegación',
      'CLIENTE navega a /cuentas/deposito (pantalla de ventanilla)',
      'La navegación NO se bloquea (URL igual); en su lugar el formulario de depósito está oculto ' +
        'y se muestra el mensaje "Esta pantalla es para ventanilla"',
      `url=${url2} mensajeVisible=${blockedMessageVisible} formularioVisible=${depositFormVisible}`,
      stillOnPage2 && blockedMessageVisible && !depositFormVisible,
      'Este es un guard de CONTENIDO, no de navegación: la URL nunca cambia. Es el patrón contrario ' +
        'al de NAV-CLIENT-STAFF-01/03 — vale la pena que quede documentado así y no como "bloqueado" sin más.',
    );

    // NAV-CLIENT-STAFF-03 — /auditoria. The global module-level guard applies
    // (Auditoría is the one module D-06 actually restricts by role in
    // `apps/web/app/lib/navigation.ts`), and a signed-in visitor who may not
    // open a route is sent to the landing page, not to /login and not to the
    // shared error.vue screen (`apps/web/app/middleware/auth.global.ts`).
    await page.goto(`${BASE}/auditoria`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1000);
    await shot(page, 'rbac-03-auditoria-cliente');
    const url3 = page.url();
    const blocked3 = !url3.includes('/auditoria');
    report.record(
      'NAV-CLIENT-STAFF-03',
      'Guardas de navegación',
      'CLIENTE navega a /auditoria (pantalla de administración)',
      'La URL cambia lejos de /auditoria (redirección real, vía el guard global de módulo)',
      url3,
      blocked3,
      blocked3
        ? 'Redirige a la landing (/) — no a /login ni a la pantalla de error.vue — porque el visitante ya tiene sesión.'
        : 'No se observó redirección: la URL permaneció en /auditoria.',
    );

    // =========================================================================
    // Part C — TD-075. Re-tested against the real full stack for the first time.
    // =========================================================================

    // GUARD-NEXT-01 — an unauthenticated deep link redirects to /login with
    // `next` carrying the original destination, and logging in from THAT page
    // (not a bare /login) lands back on the original destination.
    await clearSession(ctx, page);
    await page.goto(`${BASE}/cuentas`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(600);
    const preLoginUrl = page.url();
    const onLoginWithNext = preLoginUrl.includes('/login') && /next=%2Fcuentas|next=\/cuentas/.test(preLoginUrl);
    await shot(page, 'rbac-04-guard-next-login-con-next');

    await page.fill('input[type="email"]', SEEDED.cliente.email);
    await page.fill('input[type="password"]', SEEDED.cliente.password);
    await page.click('button:has-text("Entrar")');
    await page
      .waitForURL((u) => !u.toString().includes('/login'), { timeout: 15000 })
      .catch(() => {});
    await page.waitForTimeout(800);
    const postLoginUrl = page.url();
    await shot(page, 'rbac-05-guard-next-aterrizaje');

    report.record(
      'GUARD-NEXT-01',
      'Guardas de navegación',
      'Deep link sin sesión a /cuentas conserva el destino a través del login (?next=)',
      '1) /login?next=/cuentas (o codificado) antes de autenticar. 2) Login desde esa página aterriza en /cuentas, no en la landing genérica',
      `antesDeLogin=${preLoginUrl} despuesDeLogin=${postLoginUrl}`,
      onLoginWithNext && postLoginUrl.endsWith('/cuentas'),
    );

    // GUARD-LOGOUT-01 — THE important one. A real sign-out through the actual
    // UI control, then a fresh guarded navigation, must never show the
    // authenticated page again. Do not weaken this assertion if it fails.
    await loginAsUi(ctx, page, SEEDED.cliente.email, SEEDED.cliente.password);
    await page.goto(`${BASE}/cuentas`);
    await page.waitForLoadState('networkidle');
    const confirmedAtCuentas = page.url().includes('/cuentas');

    const signOutButton = page.locator('button:has-text("Cerrar sesión")').first();
    const signOutVisible = await signOutButton.isVisible().catch(() => false);
    if (!signOutVisible) {
      await shot(page, 'rbac-06-guard-logout-boton-no-encontrado');
    }
    if (signOutVisible) {
      await signOutButton.click();
    }
    await page.waitForTimeout(1200);
    const urlRightAfterSignOut = page.url();
    await shot(page, 'rbac-07-guard-logout-justo-despues');

    // A fresh, separate navigation — simulates arriving at a guarded page after
    // having signed out in the same browser, rather than trusting whatever
    // in-memory state the sign-out click left behind.
    await page.goto(`${BASE}/cuentas`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1000);
    const urlAfterFreshNav = page.url();
    await shot(page, 'rbac-08-guard-logout-nav-fresca');
    const bodyAfterFreshNav = await page.locator('body').innerText().catch(() => '');
    const stillShowsCuentasContent =
      urlAfterFreshNav.includes('/cuentas') && /Cuentas|Mis cuentas|Nueva cuenta/i.test(bodyAfterFreshNav);

    const loggedOutCorrectly = signOutVisible && urlAfterFreshNav.includes('/login');

    report.record(
      'GUARD-LOGOUT-01',
      'Guardas de navegación',
      'Cerrar sesión por la UI real, luego navegar de nuevo a /cuentas',
      'Tras cerrar sesión, una navegación fresca a /cuentas redirige a /login (nunca debe mostrarse una pantalla autenticada)',
      `botonCerrarSesiónVisible=${signOutVisible} urlJustoDespuésDeCerrar=${urlRightAfterSignOut} ` +
        `urlEnNavegaciónFresca=${urlAfterFreshNav} confirmadoEnCuentasAntes=${confirmedAtCuentas}`,
      loggedOutCorrectly,
      !signOutVisible
        ? 'No se encontró el botón real de "Cerrar sesión" en el DOM — no se pudo ejercitar el logout real. Ver captura rbac-06.'
        : loggedOutCorrectly
          ? 'Comportamiento correcto: el logout limpia la sesión de verdad y una navegación fresca a una pantalla protegida redirige a /login.'
          : `HALLAZGO DE SEGURIDAD: tras cerrar sesión por la UI, una navegación fresca (nuevo page.goto) a ${BASE}/cuentas ` +
            `NO redirigió a /login. URL observada: ${urlAfterFreshNav}. ¿Muestra contenido de cuentas? ${stillShowsCuentasContent}. ` +
            'Un usuario que cerró sesión nunca debe poder ver una pantalla autenticada. No se debilitó esta aserción para hacerla pasar.',
    );
  } finally {
    await browser.close();
  }

  return report.summary();
}

/**
 * Logs in through the real form, without assuming the form starts on a bare
 * `/login` — some callers here arrive via `/login?next=...` and must submit
 * from that same page. This is `loginViaUI` minus its own `goto('/login')`.
 */
async function loginAsUi(ctx, page, email, password) {
  await clearSession(ctx, page);
  await page.goto(`${BASE}/login`);
  await page.waitForLoadState('networkidle');
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', password);
  await page.click('button:has-text("Entrar")');
  try {
    await page.waitForURL((url) => !url.toString().includes('/login'), { timeout: 15000 });
  } catch {
    // The caller inspects the resulting page state.
  }
  await page.waitForTimeout(800);
  return page.url();
}

/**
 * `import.meta.url === \`file://${process.argv[1]}\`` — the check every other
 * suite in this directory uses — silently never fires in this checkout: this
 * repository's path contains a space (`.../segundo semestre/...`), which
 * `import.meta.url` percent-encodes (`%20`) and a plain template string built
 * from `process.argv[1]` does not. The comparison is always false, `run()` is
 * never called, and `node test/e2e/suites/<name>.e2e.mjs` exits 0 having done
 * nothing — no console output, no report written. Verified directly against
 * `auth-session.e2e.mjs`, which has the identical, pre-existing bug. `resolve`
 * + `fileURLToPath` compares two real filesystem paths instead of a URL against
 * a hand-built string, so it is correct regardless of what characters the
 * checkout's path contains.
 */
if (resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1] ?? '')) {
  const { writeReport, printSuiteLine } = await import('../support/report.mjs');
  const summary = await run();
  printSuiteLine(summary);
  writeReport('docs/qa/pyramid-e2e.json', [summary]);
  process.exit(summary.failed > 0 ? 1 : 0);
}
