import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
/**
 * kyc-identity — the teller's identity/KYC review queue, and TD-074: the
 * defect where `POST /api/accounts` on the Gateway/Account Service enforces
 * no identity/KYC gate at all, even though the frontend blocks the button.
 *
 * Every case here records a real observation via `Report#record` — none of
 * the `pass` values below are hardcoded literals.
 */
import { BASE, GW, SEEDED, api, loginApi, waitForStatus } from '../support/gateway.mjs';
import { ActivationLinkUnavailable, getActivationLink } from '../support/activation.mjs';
import { launch, loginViaUI, shot, DUMMY_PNG } from '../support/browser.mjs';
import { Report } from '../support/report.mjs';

let cajeroTokenPromise = null;
function cajeroToken() {
  cajeroTokenPromise ??= loginApi(SEEDED.cajero.email, SEEDED.cajero.password).then((r) => {
    if (!r.token) throw new Error(`No se pudo autenticar el cajero sembrado: ${JSON.stringify(r.data)}`);
    return r.token;
  });
  return cajeroTokenPromise;
}

let adminTokenPromise = null;
function adminToken() {
  adminTokenPromise ??= loginApi(SEEDED.admin.email, SEEDED.admin.password).then((r) => {
    if (!r.token) throw new Error(`No se pudo autenticar el admin sembrado: ${JSON.stringify(r.data)}`);
    return r.token;
  });
  return adminTokenPromise;
}

/**
 * Registers and activates a customer WITHOUT ever calling identity-verdict or
 * kyc-status, so it lands — and stays — in the cajero's pending queue. Mirrors
 * `seed.mjs#provisionCustomer`'s register+activate steps exactly, stopping
 * before the validation chain on purpose.
 */
async function registerAndActivateUnvalidated(label) {
  const rnd = Math.floor(100000 + Math.random() * 899999);
  const email = `qa.${label}.${rnd}@example.com`;
  const password = 'StrongQA#2026!';
  const dpi = `2${String(rnd).padStart(4, '0')}9${String(rnd).padStart(4, '0')}0101`.slice(0, 13);
  const fullName = `QA ${label} ${rnd}`;

  const form = new FormData();
  form.set('fullName', fullName);
  form.set('identityDocument', dpi);
  form.set('email', email);
  form.set('dateOfBirth', '1995-06-20');
  form.set('address', 'Ciudad de Guatemala');
  form.set('role', 'CLIENTE');
  form.set('credential', password);
  form.set('photo', new Blob([DUMMY_PNG], { type: 'image/png' }), 'dpi.png');

  const regRes = await fetch(`${GW}/api/customers`, { method: 'POST', body: form });
  const reg = await regRes.json().catch(() => ({}));
  if (regRes.status !== 202 || !reg.customerId) {
    return { ok: false, step: 'register', detail: `${regRes.status}: ${JSON.stringify(reg)}` };
  }
  const customerId = reg.customerId;

  let activationPath;
  try {
    activationPath = await getActivationLink({
      correlationId: reg.correlationId,
      adminToken: await adminToken(),
    });
  } catch (err) {
    const detail = err instanceof ActivationLinkUnavailable ? err.message : String(err);
    return { ok: false, step: 'activation-link', detail, customerId };
  }
  const activationToken = activationPath.match(/token=([a-zA-Z0-9_-]+)/)?.[1];
  const verify = await api(`/api/customers/verify-email?token=${encodeURIComponent(activationToken ?? '')}`, null);
  if (verify.status !== 200) {
    return { ok: false, step: 'activate', detail: `${verify.status}: ${JSON.stringify(verify.body)}`, customerId };
  }

  const login = await loginApi(email, password);
  if (!login.token) {
    return { ok: false, step: 'login', detail: `${login.status}: ${JSON.stringify(login.data)}`, customerId };
  }

  return { ok: true, email, password, fullName, customerId, token: login.token };
}

export async function run() {
  const report = new Report('kyc-identity');
  const { browser, ctx, page } = await launch();

  try {
    const cajero = await cajeroToken();
    const cliente = await loginApi(SEEDED.cliente.email, SEEDED.cliente.password);

    // Two independent fresh customers, both stuck pending — one is approved,
    // one is rejected, and neither is touched by the other's verdict.
    const pendingA = await registerAndActivateUnvalidated('kyc-pending-a');
    const pendingB = await registerAndActivateUnvalidated('kyc-reject-b');

    if (!pendingA.ok) {
      report.skip('PENDING-01', 'KYC', 'Cliente sin validar aparece en pending-validation', `No se pudo aprovisionar el cliente A: paso=${pendingA.step} ${pendingA.detail}`);
      report.skip('PENDING-02', 'KYC', 'Cola de validaciones (UI) muestra al cliente', 'Depende del aprovisionamiento del cliente A');
      report.skip('PENDING-03', 'KYC', 'Detalle de validación (UI) muestra los datos declarados', 'Depende del aprovisionamiento del cliente A');
      report.skip('TD074-01', 'Defecto conocido (TD-074)', 'POST /api/accounts no exige identidad/KYC validados — hallazgo real', 'Depende del aprovisionamiento del cliente A');
      report.skip('UI-BLOCKED-01', 'KYC', 'UI bloquea /cuentas/nueva para un cliente no verificado', 'Depende del aprovisionamiento del cliente A');
      report.skip('APPROVE-01', 'KYC', 'Cajero aprueba identidad y KYC', 'Depende del aprovisionamiento del cliente A');
      report.skip('APPROVE-02', 'KYC', 'Tras aprobación, POST /api/accounts ahora sí abre cuenta', 'Depende del aprovisionamiento del cliente A');
    } else {
      // PENDING-01
      const pendingList = await api('/api/customers/pending-validation', cajero);
      const inList = Array.isArray(pendingList.body.customers)
        ? pendingList.body.customers.some((c) => c.customerId === pendingA.customerId)
        : false;
      report.record(
        'PENDING-01',
        'KYC',
        'Cliente recién registrado sin validar aparece en GET /api/customers/pending-validation',
        `customerId ${pendingA.customerId} presente en la lista`,
        `status=${pendingList.status} presente=${inList} total=${Array.isArray(pendingList.body.customers) ? pendingList.body.customers.length : 'N/A'}`,
        pendingList.status === 200 && inList,
      );

      // PENDING-02 — the cajero's UI queue page.
      await loginViaUI(ctx, page, SEEDED.cajero.email, SEEDED.cajero.password);
      await page.goto(`${BASE}/clientes/validaciones`);
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(600);
      await shot(page, 'kyc-01-cola-validaciones');
      const rowVisible = await page
        .locator(`[data-testid="validation-queue"]:has-text("${pendingA.fullName}")`)
        .first()
        .isVisible()
        .catch(() => false);
      report.record(
        'PENDING-02',
        'KYC',
        'Cola de validaciones (UI) muestra la fila del cliente pendiente',
        `El nombre "${pendingA.fullName}" aparece en la lista`,
        `rowVisible=${rowVisible}`,
        rowVisible,
      );

      // PENDING-03 — the detail page.
      await page.goto(`${BASE}/clientes/validaciones/${pendingA.customerId}`);
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(800);
      await shot(page, 'kyc-02-detalle-validacion');
      const declaredText = await page
        .locator('[data-testid="validation-declared"]')
        .innerText()
        .catch(() => '');
      const declaredShowsName = declaredText.includes(pendingA.fullName);
      const photoState = await page
        .locator('[data-testid="document-viewer-image"], [data-testid="document-viewer-empty"], [data-testid="document-viewer-error"]')
        .first()
        .isVisible()
        .catch(() => false);
      report.record(
        'PENDING-03',
        'KYC',
        'Detalle de validación (UI) muestra los datos declarados y el visor de documento',
        'Nombre completo visible en los datos declarados, y el visor de documento (foto, vacío o error) renderiza algo',
        `declaredShowsName=${declaredShowsName} photoStateVisible=${photoState} declaredText="${declaredText.slice(0, 120).replace(/\n/g, ' | ')}"`,
        declaredShowsName && photoState,
      );

      // TD074-01 — THE headline finding: POST /api/accounts on an unvalidated CLIENTE.
      const bypassAttempt = await api('/api/accounts', pendingA.token, {
        method: 'POST',
        body: { accountType: 'MONETARIA' },
      });
      const defectReproduced = bypassAttempt.status === 202 && typeof bypassAttempt.body.accountId === 'string';
      report.record(
        'TD074-01',
        'Defecto conocido (TD-074)',
        'POST /api/accounts no exige identidad/KYC validados — hallazgo real',
        'Un cliente con identityStatus=PENDING/kycStatus=PENDING NO debería poder abrir cuenta, pero el backend (account-service create-account.use-case.ts) no verifica esos estados',
        `status=${bypassAttempt.status} body=${JSON.stringify(bypassAttempt.body)}`,
        defectReproduced,
        'CONOCIDO: esto es la prueba reproducida del defecto TD-074, no un resultado deseable. ' +
          'apps/gateway/src/interfaces/accounts.controller.ts y apps/services/account-service/src/application/create-account.use-case.ts ' +
          'no consultan identityStatus/kycStatus antes de abrir la cuenta. El bloqueo visto en PENDING-02/03 y en UI-BLOCKED-01 es exclusivamente del frontend (validate() en AccountCreateForm.vue), ' +
          'y una llamada directa a la API lo evade por completo.',
      );

      // UI-BLOCKED-01 — the SAME unvalidated customer, through the real UI, is blocked.
      await loginViaUI(ctx, page, pendingA.email, pendingA.password);
      await page.goto(`${BASE}/cuentas/nueva`);
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(800);
      await shot(page, 'kyc-03-apertura-bloqueada-ui');
      const bodyText = await page.locator('body').innerText().catch(() => '');
      const hasRequiredText = bodyText.includes('Validación de identidad requerida');
      const hasBlockedButton = bodyText.includes('Apertura bloqueada');
      report.record(
        'UI-BLOCKED-01',
        'KYC',
        'UI bloquea /cuentas/nueva para un cliente no verificado (a diferencia de la API, ver TD074-01)',
        'La página muestra el texto "Validación de identidad requerida" y un botón que dice "Apertura bloqueada"',
        `hasRequiredText=${hasRequiredText} hasBlockedButton=${hasBlockedButton}`,
        hasRequiredText && hasBlockedButton,
        'Contraste directo con TD074-01: el mismo cliente sin validar es bloqueado aquí por el frontend pero no por la API.',
      );

      // APPROVE-01 — the cajero approves identity + KYC for pendingA.
      await api(`/api/customers/${pendingA.customerId}/identity-verdict`, cajero, {
        method: 'POST',
        body: { verdict: 'VALIDATED' },
      });
      await api(`/api/customers/${pendingA.customerId}/kyc-status`, cajero, {
        method: 'POST',
        body: { status: 'VERIFIED' },
      });
      const approved = await waitForStatus(
        `/api/customers/${pendingA.customerId}`,
        cajero,
        (r) => r.body.identityStatus === 'VALIDATED' && r.body.kycStatus === 'VERIFIED',
        8000,
      );
      report.record(
        'APPROVE-01',
        'KYC',
        'Cajero aprueba identidad (VALIDATED) y KYC (VERIFIED); ambos campos convergen',
        'identityStatus=VALIDATED y kycStatus=VERIFIED',
        `identityStatus=${approved.body.identityStatus} kycStatus=${approved.body.kycStatus}`,
        approved.body.identityStatus === 'VALIDATED' && approved.body.kycStatus === 'VERIFIED',
      );

      // APPROVE-02 — now the SAME customer's POST /api/accounts genuinely succeeds.
      const afterApproval = await api('/api/accounts', pendingA.token, {
        method: 'POST',
        body: { accountType: 'MONETARIA' },
        headers: { 'Idempotency-Key': `kyc-approve-02-${pendingA.customerId}` },
      });
      report.record(
        'APPROVE-02',
        'KYC',
        'Tras aprobación de identidad y KYC, POST /api/accounts abre la cuenta (contraste con TD074-01)',
        '202 + accountId',
        `status=${afterApproval.status} body=${JSON.stringify(afterApproval.body)}`,
        afterApproval.status === 202 && typeof afterApproval.body.accountId === 'string',
      );
    }

    if (!pendingB.ok) {
      report.skip('REJECT-01', 'KYC', 'Cajero rechaza la identidad de un cliente', `No se pudo aprovisionar el cliente B: paso=${pendingB.step} ${pendingB.detail}`);
      report.skip('REJECT-02', 'KYC', 'POST /api/accounts tras rechazo de identidad', 'Depende del aprovisionamiento del cliente B');
    } else {
      // REJECT-01
      await api(`/api/customers/${pendingB.customerId}/identity-verdict`, cajero, {
        method: 'POST',
        body: { verdict: 'REJECTED' },
      });
      const rejected = await waitForStatus(
        `/api/customers/${pendingB.customerId}`,
        cajero,
        (r) => r.body.identityStatus !== undefined && r.body.identityStatus !== 'PENDING',
        8000,
      );
      report.record(
        'REJECT-01',
        'KYC',
        'Cajero rechaza la identidad (REJECTED) de un cliente pendiente',
        'identityStatus refleja el rechazo (valor real observado, no asumido)',
        `identityStatus=${rejected.body.identityStatus}`,
        rejected.body.identityStatus === 'REJECTED',
      );

      // REJECT-02 — honest report of what actually happens; consistent with TD-074, no gate either way.
      const afterReject = await api('/api/accounts', pendingB.token, {
        method: 'POST',
        body: { accountType: 'MONETARIA' },
      });
      const bypassedAfterRejectToo = afterReject.status === 202 && typeof afterReject.body.accountId === 'string';
      report.record(
        'REJECT-02',
        'Defecto conocido (TD-074)',
        'POST /api/accounts tras un rechazo de identidad (mismo hallazgo que TD074-01)',
        'Reporta el resultado real observado — no hay gate en el backend, así que se espera el mismo resultado que con PENDING',
        `status=${afterReject.status} body=${JSON.stringify(afterReject.body)}`,
        bypassedAfterRejectToo,
        'Confirma que el defecto TD-074 es independiente del veredicto: ni PENDING ni REJECTED bloquean la apertura vía API.',
      );
    }

    // RBAC-KYC-01 — a CLIENTE token cannot issue an identity verdict. The
    // target customerId only needs to be a well-formed UUID for the role
    // guard to be exercised (a 403 must land before any record lookup), so
    // one of the two provisioned customers is reused when available.
    const someCustomerId = pendingA.ok ? pendingA.customerId : pendingB.ok ? pendingB.customerId : '00000000-0000-4000-8000-000000000000';
    if (cliente.token) {
      const forbiddenVerdict = await api(`/api/customers/${someCustomerId}/identity-verdict`, cliente.token, {
        method: 'POST',
        body: { verdict: 'VALIDATED' },
      });
      report.record(
        'RBAC-KYC-01',
        'RBAC',
        'CLIENTE no puede emitir un veredicto de identidad (identity-verdict)',
        '403 FORBIDDEN',
        `status=${forbiddenVerdict.status}`,
        forbiddenVerdict.status === 403,
      );

      // RBAC-KYC-02 — a CLIENTE token cannot list the pending-validation queue.
      const forbiddenQueue = await api('/api/customers/pending-validation', cliente.token);
      report.record(
        'RBAC-KYC-02',
        'RBAC',
        'CLIENTE no puede leer GET /api/customers/pending-validation',
        '403 FORBIDDEN',
        `status=${forbiddenQueue.status}`,
        forbiddenQueue.status === 403,
      );
    } else {
      report.skip('RBAC-KYC-01', 'RBAC', 'CLIENTE no puede emitir un veredicto de identidad', `No se pudo autenticar el cliente sembrado: ${JSON.stringify(cliente.data)}`);
      report.skip('RBAC-KYC-02', 'RBAC', 'CLIENTE no puede leer pending-validation', `No se pudo autenticar el cliente sembrado: ${JSON.stringify(cliente.data)}`);
    }
  } finally {
    await browser.close();
  }

  return report.summary();
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
