import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
/**
 * registration-activation — the public self-service registration wizard
 * (`/registro`, three steps), account activation (`/activar?token=...`) and
 * password recovery (`/recuperar` → `/restablecer?token=...`).
 *
 * Every case here replaces a `happypath.e2e.mjs` case that used to record
 * `pass: true` no matter what actually happened (REG-01, REG-03, REG-05,
 * REG-07, REG-09, ACT-01, ACT-02, ACT-03, ...) with a real, computed boolean —
 * the restructuring's whole point. `apps/web/app/lib/customer.ts`
 * (`validateRegistration`) is what the client-side checks below are really
 * exercising; the form's `<form @submit.prevent="...">` means an invalid
 * `type="email"` input is blocked by the *browser's own* constraint
 * validation before Vue ever sees the submit, which is why REG-03 asserts on
 * `validity.valid` rather than on a Vue-rendered error message.
 */
import { GW, SEEDED, api, loginApi } from '../support/gateway.mjs';
import { DUMMY_PNG, clearSession, launch, shot } from '../support/browser.mjs';
import { ActivationLinkUnavailable, getActivationLink, getPasswordResetLink } from '../support/activation.mjs';
import { Report } from '../support/report.mjs';

const BASE = process.env.APP_BASE_URL || 'http://localhost:3010';

const VALID_ADDRESS = '10ma Avenida 4-50 Zona 14, Guatemala';
const VALID_DOB = '1995-06-20';
const VALID_PASSWORD = 'StrongQA#2026!';

function randomDigits(rnd) {
  // Same construction `test/e2e/support/seed.mjs`'s `provisionCustomer` uses —
  // 13 digits, the only shape `validateRegistration`'s `/^\d{13}$/` and the
  // Gateway's own DTO both accept.
  return `2${String(rnd).padStart(4, '0')}9${String(rnd).padStart(4, '0')}0101`.slice(0, 13);
}

function freshIdentity(label) {
  const rnd = Math.floor(100000 + Math.random() * 899999);
  return {
    rnd,
    fullName: `QA ${label} ${rnd}`,
    email: `qa.${label}.${rnd}@example.com`,
    dpi: randomDigits(rnd),
  };
}

/** Registers directly against the Gateway (multipart), bypassing the UI — used where a case needs the raw `{customerId, correlationId}` response body, not a rendered screen. */
async function registerViaApi({ fullName, email, password, dpi, dateOfBirth = VALID_DOB, address = VALID_ADDRESS }) {
  const form = new FormData();
  form.set('fullName', fullName);
  form.set('identityDocument', dpi);
  form.set('email', email);
  form.set('dateOfBirth', dateOfBirth);
  form.set('address', address);
  form.set('role', 'CLIENTE');
  form.set('credential', password);
  form.set('photo', new Blob([DUMMY_PNG], { type: 'image/png' }), 'dpi.png');

  const res = await fetch(`${GW}/api/customers`, { method: 'POST', body: form });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

async function fillStep1(page, { fullName, dob, address, email }) {
  await page.fill('input[placeholder="María Fernanda López García"]', fullName);
  await page.fill('input[type="date"]', dob);
  await page.fill('input[placeholder="12 calle 3-45 zona 1, Guatemala"]', address);
  await page.fill('input[type="email"]', email);
}

const step1Input = (page) => page.locator('input[placeholder="María Fernanda López García"]');
const dpiInput = (page) => page.locator('input[placeholder="2547 89632 0101"]');
const acceptedLocator = (page) => page.locator('[data-testid="registration-accepted"]');

export async function run() {
  const report = new Report('registration-activation');
  const { browser, ctx, page } = await launch();

  try {
    // ── REG-01: Step 1 submitted completely empty ──────────────────────────
    await clearSession(ctx, page);
    await page.goto(`${BASE}/registro`);
    await page.waitForLoadState('networkidle');
    const urlBeforeReg01 = page.url();
    await page.click('button[type="submit"]');
    await page.waitForTimeout(600);
    const reg01StillOnStep1 = await step1Input(page).isVisible().catch(() => false);
    await shot(page, 'reg-01-paso1-vacio');
    report.record(
      'REG-01',
      'Registro',
      'Paso 1 enviado con campos vacíos',
      'Permanece en el Paso 1 (input de nombre completo sigue visible, URL sin cambiar)',
      `stillOnStep1=${reg01StillOnStep1} url=${page.url()}`,
      reg01StillOnStep1 && page.url() === urlBeforeReg01,
    );

    // ── REG-02: Step 1, under-18 birth date ─────────────────────────────────
    await page.goto(`${BASE}/registro`);
    await page.waitForLoadState('networkidle');
    const underage = freshIdentity('underage');
    const underageDob = new Date();
    underageDob.setFullYear(underageDob.getFullYear() - 15);
    await fillStep1(page, {
      fullName: underage.fullName,
      dob: underageDob.toISOString().split('T')[0],
      address: VALID_ADDRESS,
      email: underage.email,
    });
    await page.click('button[type="submit"]');
    await page.waitForTimeout(600);
    const reg02StillOnStep1 = await step1Input(page).isVisible().catch(() => false);
    await shot(page, 'reg-02-paso1-menor-edad');
    report.record(
      'REG-02',
      'Registro',
      'Paso 1 con fecha de nacimiento de un menor de 18 años (15 años)',
      'Bloquea el avance al Paso 2',
      `stillOnStep1=${reg02StillOnStep1}`,
      reg02StillOnStep1,
    );

    // ── REG-03: Step 1, malformed email ─────────────────────────────────────
    await page.goto(`${BASE}/registro`);
    await page.waitForLoadState('networkidle');
    const badEmail = freshIdentity('bademail');
    await fillStep1(page, {
      fullName: badEmail.fullName,
      dob: VALID_DOB,
      address: VALID_ADDRESS,
      email: 'esto-no-es-email',
    });
    const emailValidityBefore = await page
      .locator('input[type="email"]')
      .evaluate((el) => el.validity.valid)
      .catch(() => null);
    await page.click('button[type="submit"]');
    await page.waitForTimeout(600);
    const reg03StillOnStep1 = await step1Input(page).isVisible().catch(() => false);
    await shot(page, 'reg-03-paso1-email-invalido');
    report.record(
      'REG-03',
      'Registro',
      'Paso 1 con formato de correo inválido',
      'validity.valid del input email es false, y/o permanece en el Paso 1',
      `emailValidityValid=${emailValidityBefore} stillOnStep1=${reg03StillOnStep1}`,
      emailValidityBefore === false || reg03StillOnStep1,
    );

    // ── Advance to a real Step 2, for REG-04/05/06 ──────────────────────────
    await page.goto(`${BASE}/registro`);
    await page.waitForLoadState('networkidle');
    const step2Chain = freshIdentity('step2chain');
    await fillStep1(page, {
      fullName: step2Chain.fullName,
      dob: VALID_DOB,
      address: VALID_ADDRESS,
      email: step2Chain.email,
    });
    await page.click('button[type="submit"]');
    await page.waitForTimeout(800);
    const reachedStep2 = await dpiInput(page).isVisible().catch(() => false);
    if (!reachedStep2) {
      const reason = 'No se pudo avanzar al Paso 2 con datos válidos en el Paso 1 — no es posible ejecutar REG-04/05/06/07/08/09/10.';
      for (const id of ['REG-04', 'REG-05', 'REG-06', 'REG-07', 'REG-08', 'REG-09', 'REG-10']) {
        report.skip(id, 'Registro', id, reason);
      }
    } else {
      // ── REG-04: Step 2, DPI with 6 digits ─────────────────────────────────
      await dpiInput(page).fill('123456');
      await page.click('button[type="submit"]');
      await page.waitForTimeout(600);
      const reg04StillOnStep2 = await dpiInput(page).isVisible().catch(() => false);
      await shot(page, 'reg-04-paso2-dpi-corto');
      report.record(
        'REG-04',
        'Registro',
        'Paso 2 con DPI de solo 6 dígitos',
        'Bloquea el avance (permanece en el Paso 2)',
        `stillOnStep2=${reg04StillOnStep2}`,
        reg04StillOnStep2,
      );

      // ── REG-05: Step 2, DPI with letters ──────────────────────────────────
      await dpiInput(page).fill('');
      await dpiInput(page).fill('ABCDEFGHIJKLM');
      const reg05ActualValue = await dpiInput(page).inputValue().catch(() => null);
      await page.click('button[type="submit"]');
      await page.waitForTimeout(600);
      const reg05StillOnStep2 = await dpiInput(page).isVisible().catch(() => false);
      await shot(page, 'reg-05-paso2-dpi-letras');
      const reg05ValueWasStripped = reg05ActualValue !== 'ABCDEFGHIJKLM';
      report.record(
        'REG-05',
        'Registro',
        'Paso 2 con DPI que contiene letras',
        'El input filtra los caracteres no numéricos, o el envío queda bloqueado en el Paso 2',
        `inputValueAfterFill="${reg05ActualValue}" valueWasStripped=${reg05ValueWasStripped} stillOnStep2=${reg05StillOnStep2}`,
        reg05ValueWasStripped || reg05StillOnStep2,
      );

      // ── REG-06: Step 2, valid DPI but no photo ────────────────────────────
      await dpiInput(page).fill('');
      await dpiInput(page).fill(step2Chain.dpi);
      await page.click('button[type="submit"]');
      await page.waitForTimeout(600);
      const reg06StillOnStep2 = await dpiInput(page).isVisible().catch(() => false);
      await shot(page, 'reg-06-paso2-sin-foto');
      report.record(
        'REG-06',
        'Registro',
        'Paso 2 con DPI válido pero sin foto de documento',
        'Bloquea el avance (foto requerida, permanece en el Paso 2)',
        `stillOnStep2=${reg06StillOnStep2}`,
        reg06StillOnStep2,
      );

      // Complete Step 2 for real, to reach Step 3.
      await dpiInput(page).fill('');
      await dpiInput(page).fill(step2Chain.dpi);
      await page.setInputFiles('input[type="file"]', {
        name: 'dpi.png',
        mimeType: 'image/png',
        buffer: DUMMY_PNG,
      });
      await page.waitForTimeout(600);
      await page.click('button[type="submit"]');
      await page.waitForTimeout(800);
      const reachedStep3 = await page
        .locator('input[placeholder="Mínimo 8 caracteres"]')
        .isVisible()
        .catch(() => false);

      if (!reachedStep3) {
        const reason = 'No se pudo avanzar al Paso 3 con DPI y foto válidos en el Paso 2 — no es posible ejecutar REG-07/08/09/10.';
        for (const id of ['REG-07', 'REG-08', 'REG-09', 'REG-10']) {
          report.skip(id, 'Registro', id, reason);
        }
      } else {
        // ── REG-07: Step 3, password under 8 chars ──────────────────────────
        await page.fill('input[placeholder="Mínimo 8 caracteres"]', 'abc123');
        await page.fill('input[placeholder="Repite la contraseña"]', 'abc123');
        const termsBox = page.locator('[role="checkbox"]');
        if ((await termsBox.getAttribute('aria-checked')) !== 'true') await termsBox.click();
        await page.click('[data-testid="registration-submit"]');
        await page.waitForTimeout(800);
        const reg07Accepted = await acceptedLocator(page).isVisible().catch(() => false);
        await shot(page, 'reg-07-paso3-password-corta');
        report.record(
          'REG-07',
          'Registro',
          'Paso 3 con contraseña de menos de 8 caracteres',
          '[data-testid="registration-accepted"] NO visible',
          `accepted=${reg07Accepted}`,
          !reg07Accepted,
        );

        // ── REG-08: Step 3, mismatched confirmation ──────────────────────────
        await page.fill('input[placeholder="Mínimo 8 caracteres"]', 'PasswordA#123');
        await page.fill('input[placeholder="Repite la contraseña"]', 'PasswordB#999');
        await page.click('[data-testid="registration-submit"]');
        await page.waitForTimeout(800);
        const reg08Accepted = await acceptedLocator(page).isVisible().catch(() => false);
        await shot(page, 'reg-08-paso3-password-mismatch');
        report.record(
          'REG-08',
          'Registro',
          'Paso 3 con confirmación de contraseña distinta a la contraseña',
          '[data-testid="registration-accepted"] NO visible',
          `accepted=${reg08Accepted}`,
          !reg08Accepted,
        );

        // ── REG-09: Step 3, terms checkbox left unchecked ────────────────────
        await page.fill('input[placeholder="Mínimo 8 caracteres"]', VALID_PASSWORD);
        await page.fill('input[placeholder="Repite la contraseña"]', VALID_PASSWORD);
        if ((await termsBox.getAttribute('aria-checked')) === 'true') await termsBox.click();
        const submitBtn = page.locator('[data-testid="registration-submit"]');
        const disabledAttr = await submitBtn.getAttribute('disabled').catch(() => null);
        const ariaDisabledAttr = await submitBtn.getAttribute('aria-disabled').catch(() => null);
        await submitBtn.click({ force: true }).catch(() => {});
        await page.waitForTimeout(600);
        const reg09Accepted = await acceptedLocator(page).isVisible().catch(() => false);
        await shot(page, 'reg-09-paso3-sin-terminos');
        const buttonReportsDisabled = disabledAttr !== null || ariaDisabledAttr === 'true';
        report.record(
          'REG-09',
          'Registro',
          'Paso 3 con checkbox de términos sin marcar',
          'El botón reporta disabled/aria-disabled, o el envío no queda aceptado',
          `disabled="${disabledAttr}" ariaDisabled="${ariaDisabledAttr}" accepted=${reg09Accepted}`,
          buttonReportsDisabled || !reg09Accepted,
        );

        // ── REG-10: full valid 3-step registration ───────────────────────────
        if ((await termsBox.getAttribute('aria-checked')) !== 'true') await termsBox.click();
        await page.fill('input[placeholder="Mínimo 8 caracteres"]', VALID_PASSWORD);
        await page.fill('input[placeholder="Repite la contraseña"]', VALID_PASSWORD);
        await submitBtn.click();
        let reg10Accepted = false;
        try {
          await page.waitForSelector('[data-testid="registration-accepted"]', { timeout: 12000 });
          reg10Accepted = await acceptedLocator(page).isVisible();
        } catch {
          reg10Accepted = false;
        }
        await shot(page, 'reg-10-registro-completo');
        report.record(
          'REG-10',
          'Registro',
          'Registro completo válido en 3 pasos',
          '[data-testid="registration-accepted"] visible',
          `accepted=${reg10Accepted}`,
          reg10Accepted,
        );
      }
    }

    // ── DUPLICATE-REG: same email + same DPI, registered twice ─────────────
    const dup = freshIdentity('dup');
    const firstDup = await registerViaApi({ fullName: dup.fullName, email: dup.email, password: VALID_PASSWORD, dpi: dup.dpi });
    if (firstDup.status !== 202 || !firstDup.body.customerId) {
      report.skip('DUPLICATE-REG', 'Registro', 'Doble registro con mismo correo y DPI', `El registro inicial no fue aceptado: ${firstDup.status} ${JSON.stringify(firstDup.body)}`);
    } else {
      const secondDup = await registerViaApi({ fullName: `${dup.fullName} Otra Vez`, email: dup.email, password: VALID_PASSWORD, dpi: dup.dpi });
      const dupRejectedCorrectly =
        secondDup.status === 409 &&
        ['EMAIL_ALREADY_REGISTERED', 'DOCUMENT_ALREADY_REGISTERED'].includes(secondDup.body.failureCode);
      report.record(
        'DUPLICATE-REG',
        'Registro',
        'Registrar un segundo cliente con el mismo correo y el mismo DPI',
        '409 con failureCode EMAIL_ALREADY_REGISTERED o DOCUMENT_ALREADY_REGISTERED',
        `${secondDup.status}: failureCode=${secondDup.body.failureCode} type=${secondDup.body.type}`,
        dupRejectedCorrectly,
      );

      // ── DUPLICATE-REG-DPI: new email, same DPI as an existing customer ────
      const dupDpiOnly = freshIdentity('dupdpi');
      const thirdDup = await registerViaApi({
        fullName: dupDpiOnly.fullName,
        email: dupDpiOnly.email,
        password: VALID_PASSWORD,
        dpi: dup.dpi, // reuses the FIRST customer's DPI, with a brand-new email
      });
      const docCollisionDetected = thirdDup.status === 409 && thirdDup.body.failureCode === 'DOCUMENT_ALREADY_REGISTERED';
      report.record(
        'DUPLICATE-REG-DPI',
        'Registro',
        'Registrar con un DPI ya usado pero un correo nuevo',
        '409 con failureCode específicamente DOCUMENT_ALREADY_REGISTERED (aísla la colisión de documento de la de correo)',
        `${thirdDup.status}: failureCode=${thirdDup.body.failureCode}`,
        docCollisionDetected,
      );
    }

    // ── ACT-01..04: activation, via a fresh API-registered customer ────────
    const adminAuth = await loginApi(SEEDED.admin.email, SEEDED.admin.password);
    const adminToken = adminAuth.token;

    if (adminToken === null) {
      const reason = `No se pudo autenticar como administrador sembrado (status ${adminAuth.status}); requerido para el fallback de GET /api/audit.`;
      for (const id of ['ACT-01', 'ACT-02', 'ACT-03', 'ACT-04', 'PWRESET-01', 'PWRESET-02', 'PWRESET-03']) {
        report.skip(id, 'Activación', id, reason);
      }
    } else {
      const actUser = freshIdentity('activation');
      const regRes = await registerViaApi({ fullName: actUser.fullName, email: actUser.email, password: VALID_PASSWORD, dpi: actUser.dpi });

      if (regRes.status !== 202 || !regRes.body.customerId) {
        const reason = `El registro previo a la activación no fue aceptado: ${regRes.status} ${JSON.stringify(regRes.body)}`;
        for (const id of ['ACT-01', 'ACT-02', 'ACT-03', 'ACT-04']) {
          report.skip(id, 'Activación', id, reason);
        }
      } else {
        let activationPath = null;
        try {
          activationPath = await getActivationLink({ correlationId: regRes.body.correlationId, adminToken });
        } catch (err) {
          const reason = err instanceof ActivationLinkUnavailable ? err.message : String(err);
          for (const id of ['ACT-01', 'ACT-02', 'ACT-03', 'ACT-04']) {
            report.skip(id, 'Activación', id, reason);
          }
        }

        if (activationPath !== null) {
          // ACT-04 — the recovered link has the expected shape before anything consumes it.
          const shapeOk = /^\/activar\?token=[a-zA-Z0-9_-]{16,}$/.test(activationPath);
          report.record(
            'ACT-04',
            'Activación',
            'El enlace de activación recuperado tiene la forma esperada (/activar?token=<token largo>)',
            'Coincide con /^\\/activar\\?token=[a-zA-Z0-9_-]{16,}$/',
            `activationPath="${activationPath}"`,
            shapeOk,
          );

          const activationToken = activationPath.match(/token=([a-zA-Z0-9_-]+)/)?.[1] ?? '';

          // ACT-01 — consume it via the real UI, then prove it worked by logging in.
          await clearSession(ctx, page);
          await page.goto(`${BASE}${activationPath}`);
          await page.waitForLoadState('networkidle');
          await page.waitForTimeout(1500);
          await shot(page, 'act-01-activacion-exitosa');
          const postActivationLogin = await loginApi(actUser.email, VALID_PASSWORD);
          report.record(
            'ACT-01',
            'Activación',
            'Activar la cuenta con el enlace real y luego iniciar sesión con las nuevas credenciales',
            'loginApi devuelve un token no nulo tras visitar el enlace de activación',
            `loginStatus=${postActivationLogin.status} token=${postActivationLogin.token !== null ? 'presente' : 'null'}`,
            postActivationLogin.token !== null,
          );

          // ACT-02 — the same token, used a second time via the API directly.
          const secondVerify = await api(`/api/customers/verify-email?token=${encodeURIComponent(activationToken)}`, null);
          report.record(
            'ACT-02',
            'Activación',
            'Reutilizar el mismo token de activación una segunda vez',
            'GET /api/customers/verify-email devuelve un status distinto de 200 (token de un solo uso)',
            `${secondVerify.status}: ${JSON.stringify(secondVerify.body)}`,
            secondVerify.status !== 200,
          );

          // ACT-03 — a manually fabricated token, via the UI, checked for the rejected-state text.
          await page.goto(`${BASE}/activar?token=estoNoEsUnTokenValido12345`);
          await page.waitForLoadState('networkidle');
          await page.waitForTimeout(1500);
          await shot(page, 'act-03-token-fabricado');
          const rejectedTextVisible = await page
            .locator('text=/expirad|inválid|invalid|ya fue|no v[aá]lid|error/i')
            .first()
            .isVisible()
            .catch(() => false);
          const fabricatedVerify = await api('/api/customers/verify-email?token=estoNoEsUnTokenValido12345', null);
          report.record(
            'ACT-03',
            'Activación',
            'Token de activación fabricado a mano',
            'La pantalla muestra un texto de rechazo, y/o GET /api/customers/verify-email responde distinto de 200',
            `rejectedTextVisible=${rejectedTextVisible} apiStatus=${fabricatedVerify.status}`,
            rejectedTextVisible || fabricatedVerify.status !== 200,
          );
        }
      }

      // ── PWRESET-01/02/03 ────────────────────────────────────────────────
      if (!activationSucceeded(report)) {
        report.skip(
          'PWRESET-01',
          'Recuperación de contraseña',
          'Solicitar restablecimiento para un correo real y confirmarlo',
          'Depende de ACT-01 (una cuenta realmente activada) para tener credenciales válidas que probar; ACT-01 no pasó en esta corrida.',
        );
      } else {
        const oldPassword = VALID_PASSWORD;
        const newPassword = 'RestablecidaQA#2026!';
        const requestReset = await api('/api/auth/password-reset', null, { method: 'POST', body: { email: actUser.email } });
        const requestResetOk = requestReset.status === 202;

        if (!requestResetOk) {
          report.record(
            'PWRESET-01',
            'Recuperación de contraseña',
            'Solicitar restablecimiento para un correo real y confirmarlo',
            '202 al solicitar el restablecimiento',
            `${requestReset.status}: ${JSON.stringify(requestReset.body)}`,
            false,
          );
        } else {
          let resetPath = null;
          try {
            resetPath = await getPasswordResetLink({ correlationId: requestReset.body.correlationId, adminToken });
          } catch (err) {
            const reason = err instanceof ActivationLinkUnavailable ? err.message : String(err);
            report.skip('PWRESET-01', 'Recuperación de contraseña', 'Solicitar restablecimiento para un correo real y confirmarlo', reason);
          }

          if (resetPath !== null) {
            const resetToken = resetPath.match(/token=([a-zA-Z0-9_-]+)/)?.[1] ?? '';
            const confirm = await api('/api/auth/password-reset/confirm', null, {
              method: 'POST',
              body: { resetToken, credential: newPassword },
            });
            const loginWithNew = await loginApi(actUser.email, newPassword);
            const loginWithOld = await loginApi(actUser.email, oldPassword);
            const pwreset01Pass =
              requestResetOk &&
              confirm.status === 200 &&
              loginWithNew.token !== null &&
              loginWithOld.status === 401;
            report.record(
              'PWRESET-01',
              'Recuperación de contraseña',
              'Solicitar restablecimiento, confirmarlo con el token real, iniciar sesión con la nueva contraseña y confirmar que la vieja ya NO funciona',
              '202 + 200 al confirmar + login nuevo con token válido + login viejo con 401',
              `requestStatus=${requestReset.status} confirmStatus=${confirm.status} newLoginToken=${loginWithNew.token !== null} oldLoginStatus=${loginWithOld.status}`,
              pwreset01Pass,
            );
          }
        }
      }

      // PWRESET-02 — anti-enumeration: an unknown email still gets 202.
      const unknownEmail = `no-existe-${Math.floor(Math.random() * 1e9)}@bankusac.gt`;
      const resetForUnknown = await api('/api/auth/password-reset', null, { method: 'POST', body: { email: unknownEmail } });
      report.record(
        'PWRESET-02',
        'Recuperación de contraseña',
        'Solicitar restablecimiento para un correo que NO existe',
        '202 (anti-enumeración, D-04) — cualquier otro status filtraría qué correos están registrados',
        `${resetForUnknown.status}`,
        resetForUnknown.status === 202,
      );

      // PWRESET-03 — a fabricated reset token is rejected by confirm.
      const fabricatedConfirm = await api('/api/auth/password-reset/confirm', null, {
        method: 'POST',
        body: { resetToken: 'tokenFalsoQueNoExisteNiExistira123', credential: 'OtraClave#2026!' },
      });
      report.record(
        'PWRESET-03',
        'Recuperación de contraseña',
        'Confirmar restablecimiento con un resetToken fabricado a mano',
        'Distinto de 200',
        `${fabricatedConfirm.status}: ${JSON.stringify(fabricatedConfirm.body)}`,
        fabricatedConfirm.status !== 200,
      );
    }

    // ── ERRORPAGE-01: unknown client route (TD-075) ─────────────────────────
    await clearSession(ctx, page);
    await page.goto(`${BASE}/esto-no-existe-abcdef`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(800);
    await shot(page, 'errorpage-01-ruta-desconocida');
    const heading = await page.locator('h1').first().textContent().catch(() => null);
    const headingOk = typeof heading === 'string' && heading.includes('Esta pantalla no existe o no tienes permisos');
    const bodyText = await page.locator('body').textContent().catch(() => '');
    const loginPromptVisible = typeof bodyText === 'string' && bodyText.includes('Inicia sesión');
    const loginButtonVisible = await page.locator('button:has-text("Ir a iniciar sesión")').isVisible().catch(() => false);
    report.record(
      'ERRORPAGE-01',
      'Manejo de errores',
      'Navegar a una ruta desconocida sin sesión abierta',
      'h1 contiene el texto exacto de error.vue, el cuerpo menciona "Inicia sesión", y hay un botón "Ir a iniciar sesión"',
      `heading="${heading}" headingOk=${headingOk} loginPromptVisible=${loginPromptVisible} loginButtonVisible=${loginButtonVisible}`,
      headingOk && loginPromptVisible && loginButtonVisible,
    );
  } finally {
    await browser.close();
  }

  return report.summary();
}

/** Whether ACT-01 was recorded and passed, i.e. there is now a real activated account to run PWRESET-01 against. */
function activationSucceeded(report) {
  const act01 = report.results.find((r) => r.id === 'ACT-01');
  return act01 !== undefined && act01.pass === true;
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
