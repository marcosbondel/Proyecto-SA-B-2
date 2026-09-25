import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
/**
 * auth-session — login, session handling, the D-04 generic-rejection rule.
 *
 * Every case here replaces a `happypath.e2e.mjs` case that used to record
 * `pass: true` unconditionally (SEC-01, SEC-02) with a real assertion, per
 * the restructuring's first requirement.
 */
import { BASE, SEEDED, api, loginApi } from '../support/gateway.mjs';
import { clearSession, launch, loginViaUI, shot } from '../support/browser.mjs';
import { Report } from '../support/report.mjs';

export async function run() {
  const report = new Report('auth-session');
  const { browser, ctx, page } = await launch();

  try {
    // SEC-01 — the login screen itself renders its two inputs and the submit button.
    await clearSession(ctx, page);
    await page.goto(`${BASE}/login`);
    await page.waitForLoadState('networkidle');
    await shot(page, 'auth-01-login-pantalla');
    const formReady =
      (await page.locator('input[type="email"]').isVisible().catch(() => false)) &&
      (await page.locator('input[type="password"]').isVisible().catch(() => false)) &&
      (await page.locator('button:has-text("Entrar")').isVisible().catch(() => false));
    report.record(
      'SEC-01',
      'Autenticación',
      'Pantalla de login renderiza los tres controles esperados',
      'email + password + botón Entrar visibles',
      formReady ? 'Los tres controles están visibles' : 'Falta al menos un control',
      formReady,
    );

    // SEC-02 — invalid credentials via the UI surface a visible error and do NOT navigate away from /login.
    await page.fill('input[type="email"]', 'noexiste@bankusac.gt');
    await page.fill('input[type="password"]', 'ClaveIncorrecta#2026');
    await page.click('button:has-text("Entrar")');
    await page.waitForTimeout(1500);
    await shot(page, 'auth-02-login-error-credenciales');
    const stillOnLogin = page.url().includes('/login');
    const errorVisible = await page
      .locator('[class*="error"], [class*="alert"], [role="alert"], text=/credencia/i')
      .first()
      .isVisible()
      .catch(() => false);
    report.record(
      'SEC-02',
      'Autenticación',
      'Login con credenciales inválidas (UI)',
      'Permanece en /login y muestra un error',
      `stillOnLogin=${stillOnLogin} errorVisible=${errorVisible}`,
      stillOnLogin && errorVisible,
      'D-04: el mensaje debe ser genérico para no permitir enumeración de cuentas.',
    );

    // SEC-03 — the same rejection via the API, for an unregistered email.
    const unknownEmail = await loginApi('nadie-registrado-xyz@bankusac.gt', 'CualquierClave#1');
    report.record(
      'SEC-03',
      'Autenticación',
      'Login API con correo no registrado',
      '401 UNAUTHENTICATED',
      `${unknownEmail.status}: ${unknownEmail.data.type ?? ''}`,
      unknownEmail.status === 401 && unknownEmail.token === null,
    );

    // SEC-04 — a registered email with the wrong password produces the IDENTICAL rejection shape (D-04).
    const wrongPassword = await loginApi(SEEDED.cliente.email, 'ClaveIncorrectaTotal#9');
    report.record(
      'SEC-04',
      'Autenticación',
      'Login API con correo válido y contraseña incorrecta',
      'Mismo 401 UNAUTHENTICATED que un correo desconocido (D-04)',
      `${wrongPassword.status}: ${wrongPassword.data.type ?? ''}`,
      wrongPassword.status === 401 &&
        wrongPassword.data.type === unknownEmail.data.type &&
        wrongPassword.data.message === unknownEmail.data.message,
      'Las dos respuestas deben ser indistinguibles: mismo type y mismo message.',
    );

    // SEC-05 — empty credential.
    const emptyCred = await loginApi(SEEDED.cliente.email, '');
    report.record(
      'SEC-05',
      'Autenticación',
      'Login API con contraseña vacía',
      '400 VALIDATION_ERROR o 401, nunca 200',
      `${emptyCred.status}`,
      emptyCred.status !== 200,
    );

    // SEC-06/07/08 — successful login for each seeded role, both by API and (for one) by UI, asserting the actual token and role claim.
    for (const [key, role] of [['cliente', 'CLIENTE'], ['cajero', 'CAJERO_RECEPTOR'], ['admin', 'ADMINISTRADOR']]) {
      const seed = SEEDED[key];
      const auth = await loginApi(seed.email, seed.password);
      const claims = decodeJwtPayload(auth.token);
      const id = { cliente: 'SEC-06', cajero: 'SEC-07', admin: 'SEC-08' }[key];
      report.record(
        id,
        'Autenticación',
        `Login API exitoso como ${role}`,
        `200 + token JWT con role=${role}`,
        `${auth.status}: role=${claims?.role ?? 'N/A'}`,
        auth.status === 200 && typeof auth.token === 'string' && claims?.role === role,
      );
    }

    // SEC-09 — successful login through the real UI form, asserting the redirect away from /login.
    const landedUrl = await loginViaUI(ctx, page, SEEDED.cliente.email, SEEDED.cliente.password);
    await shot(page, 'auth-03-login-exitoso-cliente');
    report.record(
      'SEC-09',
      'Autenticación',
      'Login exitoso vía UI redirige fuera de /login',
      'URL final no contiene /login',
      landedUrl,
      !landedUrl.includes('/login'),
    );

    // SEC-10 — an unauthenticated call to a protected route is 401, not a silent empty result.
    const anon = await api('/api/accounts');
    report.record(
      'SEC-10',
      'Sesión',
      'Petición sin token a una ruta protegida',
      '401 UNAUTHENTICATED',
      `${anon.status}`,
      anon.status === 401,
    );

    // SEC-11 — a malformed/forged bearer token is rejected the same way a missing one is.
    const forged = await api('/api/accounts', 'this.is.not-a-valid-jwt');
    report.record(
      'SEC-11',
      'Sesión',
      'Petición con un token JWT inválido/forjado',
      '401 UNAUTHENTICATED',
      `${forged.status}`,
      forged.status === 401,
    );

    // SEC-12 — clearing the session and revisiting a customer-only page redirects to /login (client-side guard), not a silent render of stale data.
    await clearSession(ctx, page);
    await page.goto(`${BASE}/cuentas`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1000);
    await shot(page, 'auth-04-sesion-limpia-redirige');
    const redirectedToLogin = page.url().includes('/login');
    report.record(
      'SEC-12',
      'Sesión',
      'Sin sesión, navegar a /cuentas redirige a /login',
      'URL contiene /login',
      page.url(),
      redirectedToLogin,
    );
  } finally {
    await browser.close();
  }

  return report.summary();
}

function decodeJwtPayload(token) {
  if (typeof token !== 'string') return null;
  const part = token.split('.')[1];
  if (!part) return null;
  try {
    return JSON.parse(Buffer.from(part, 'base64url').toString('utf-8'));
  } catch {
    return null;
  }
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
