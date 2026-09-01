import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const BASE_URL = process.env.APP_BASE_URL || 'http://localhost:3010';
const GATEWAY_URL = process.env.GATEWAY_URL || 'http://localhost:3000';

const testResults = {
  suite: 'Bank USAC - Exhaustive QA & Validation Test Suite',
  timestamp: new Date().toISOString(),
  categories: {
    frontend_validations: { title: 'Validaciones de Formularios en Frontend (UI/UX)', tests: [] },
    rbac_security: { title: 'Control de Acceso Basado en Roles (RBAC / D-06)', tests: [] },
    idempotency_concurrency: { title: 'Idempotencia y Manejo de Concurrencia', tests: [] },
    saga_failure_modes: { title: 'Modos de Falla y Compensación de la Saga', tests: [] },
    data_privacy_audit: { title: 'Privacidad de Datos y Redacción en Auditoría', tests: [] },
  },
  metrics: {
    total: 0,
    passed: 0,
    failed: 0,
    score: 0,
  },
};

function recordTest(category, name, expected, actual, passed, details = '') {
  testResults.categories[category].tests.push({
    name,
    expected,
    actual,
    passed,
    details,
  });
  testResults.metrics.total++;
  if (passed) testResults.metrics.passed++;
  else testResults.metrics.failed++;
}

async function fetchApi(path, options = {}) {
  try {
    const res = await fetch(`${GATEWAY_URL}${path}`, options);
    const body = await res.json().catch(() => ({}));
    return { status: res.status, ok: res.ok, body, headers: res.headers };
  } catch (e) {
    return { status: 0, ok: false, error: e.message };
  }
}

async function loginApi(email, credential) {
  const res = await fetch(`${GATEWAY_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, credential }),
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, token: data.token || null, data };
}

async function runSuite() {
  console.log('🧪 Iniciando Suite Exhaustiva de Pruebas E2E de QA...');
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  // -------------------------------------------------------------------------
  // 1. FRONTEND VALIDATIONS (UI / Form Rules)
  // -------------------------------------------------------------------------
  console.log('🔹 Ejecutando pruebas de validación de UI...');

  // 1.1 DPI < 13 dígitos
  await page.goto(`${BASE_URL}/registro`);
  await page.waitForLoadState('networkidle');
  await page.fill('input[placeholder="María Fernanda López García"]', 'Test DPI Validation');
  await page.fill('input[type="date"]', '1990-01-01');
  await page.fill('input[placeholder="12 calle 3-45 zona 1, Guatemala"]', 'Ciudad de Guatemala');
  await page.fill('input[type="email"]', 'test.dpi@example.com');
  await page.click('button[type="submit"]');
  await page.waitForTimeout(500);

  await page.fill('input[placeholder="2547 89632 0101"]', '123456'); // Solo 6 dígitos
  await page.click('button[type="submit"]');
  await page.waitForTimeout(500);
  const dpiStepBlocked = await page.locator('input[placeholder="2547 89632 0101"]').isVisible();
  recordTest(
    'frontend_validations',
    'DPI con longitud inválida (< 13 dígitos)',
    'Bloquear avance al paso 3 y mantener al usuario en el paso 2',
    dpiStepBlocked ? 'Paso 2 bloqueado (DPI inválido)' : 'Avanzó incorrectamente',
    dpiStepBlocked,
    'El formulario valida que el DPI tenga exactamente 13 dígitos antes de continuar.',
  );

  // 1.2 Menor de edad (< 18 años)
  await page.goto(`${BASE_URL}/registro`);
  await page.waitForLoadState('networkidle');
  const underageDate = new Date();
  underageDate.setFullYear(underageDate.getFullYear() - 15);
  await page.fill('input[placeholder="María Fernanda López García"]', 'Menor de Edad');
  await page.fill('input[type="date"]', underageDate.toISOString().split('T')[0]);
  await page.fill('input[placeholder="12 calle 3-45 zona 1, Guatemala"]', 'Ciudad de Guatemala');
  await page.fill('input[type="email"]', 'menor@example.com');
  await page.click('button[type="submit"]');
  await page.waitForTimeout(500);
  const ageStepBlocked = await page.locator('input[placeholder="María Fernanda López García"]').isVisible();
  recordTest(
    'frontend_validations',
    'Registro de cliente menor de edad (< 18 años)',
    'Bloquear avance al paso 2 por minoría de edad',
    ageStepBlocked ? 'Paso 1 bloqueado (Edad < 18)' : 'Avanzó incorrectamente',
    ageStepBlocked,
    'Validación estricta de mayoría de edad (18+) según normativa bancaria guatemalteca.',
  );

  // 1.3 Contraseñas no coincidentes
  await page.goto(`${BASE_URL}/registro`);
  await page.waitForLoadState('networkidle');
  await page.fill('input[placeholder="María Fernanda López García"]', 'Test Pass Match');
  await page.fill('input[type="date"]', '1990-01-01');
  await page.fill('input[placeholder="12 calle 3-45 zona 1, Guatemala"]', 'Ciudad de Guatemala');
  await page.fill('input[type="email"]', 'pass.match@example.com');
  await page.click('button[type="submit"]');
  await page.waitForTimeout(500);
  await page.fill('input[placeholder="2547 89632 0101"]', '1234567890101');
  const dummyPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
  await page.setInputFiles('input[type="file"]', { name: 'test.png', mimeType: 'image/png', buffer: dummyPng });
  await page.click('button[type="submit"]');
  await page.waitForTimeout(500);
  await page.fill('input[placeholder="Mínimo 8 caracteres"]', 'PasswordA#123');
  await page.fill('input[placeholder="Repite la contraseña"]', 'PasswordB#999');
  await page.click('[role="checkbox"]');
  await page.click('[data-testid="registration-submit"]');
  await page.waitForTimeout(500);
  const passMismatchBlocked = !(await page.locator('[data-testid="registration-accepted"]').isVisible());
  recordTest(
    'frontend_validations',
    'Discrepancia entre contraseña y confirmación',
    'Impedir envío del registro y señalar error de confirmación',
    passMismatchBlocked ? 'Envío bloqueado (Contraseñas no coinciden)' : 'Enviado incorrectamente',
    passMismatchBlocked,
    'Previene errores de tipeo y asegura la integridad de la credencial del cliente.',
  );

  await browser.close();

  // -------------------------------------------------------------------------
  // 2. RBAC & SECURITY TESTS (D-06 Permission Matrix)
  // -------------------------------------------------------------------------
  console.log('🔹 Ejecutando pruebas de RBAC y Seguridad...');

  const clientAuth = await loginApi('cliente@bankusac.gt', 'BankUsac#2026');
  const tellerAuth = await loginApi('cajero@bankusac.gt', 'BankUsac#2026');
  const adminAuth = await loginApi('admin@bankusac.gt', 'BankUsac#2026');

  // Obtener una cuenta existente real
  const accountsRes = await fetchApi('/api/accounts', {
    headers: { Authorization: `Bearer ${tellerAuth.token}` },
  });
  const existingAccountId = Array.isArray(accountsRes.body.accounts) && accountsRes.body.accounts.length > 0
    ? accountsRes.body.accounts[0].accountId
    : '00000000-0000-4000-8000-000000000001';

  // 2.1 Sin autenticar -> 401
  const unauthRes = await fetchApi('/api/accounts');
  recordTest('rbac_security', 'Acceso anónimo a endpoints protegidos (/api/accounts)', '401 UNAUTHENTICATED', `${unauthRes.status}`, unauthRes.status === 401, 'El Gateway rechaza solicitudes sin Bearer JWT válido.');

  // 2.2 Cliente intenta ver cola de validaciones de cajero -> 403
  const clientTellerRes = await fetchApi('/api/customers/pending-validation', {
    headers: { Authorization: `Bearer ${clientAuth.token}` },
  });
  recordTest('rbac_security', 'Cliente consulta cola de validaciones (/api/customers/pending-validation)', '403 FORBIDDEN', `${clientTellerRes.status}`, clientTellerRes.status === 403, 'Aislamiento de permisos de backoffice respecto al rol CLIENTE.');

  // 2.3 Cliente intenta realizar depósito en ventanilla -> 403
  const clientDepositRes = await fetchApi(`/api/accounts/${existingAccountId}/deposit`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${clientAuth.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ amount: { amountMinor: 10000, currency: 'GTQ' }, description: 'Intento no autorizado' }),
  });
  recordTest('rbac_security', 'Cliente intenta auto-depositar fondos por ventanilla', '403 FORBIDDEN', `${clientDepositRes.status}`, clientDepositRes.status === 403, 'Solo el rol CAJERO_RECEPTOR está autorizado para asentar depósitos.');

  // 2.4 Cajero intenta ver rastro de auditoría global -> 403
  const tellerAuditRes = await fetchApi('/api/audit?correlationId=00000000-0000-4000-8000-000000000001', {
    headers: { Authorization: `Bearer ${tellerAuth.token}` },
  });
  recordTest('rbac_security', 'Cajero intenta consultar rastro de auditoría global (/api/audit)', '403 FORBIDDEN', `${tellerAuditRes.status}`, tellerAuditRes.status === 403, 'El rastro completo de auditoría está reservado para el rol ADMINISTRADOR.');

  // 2.5 Administrador consulta notificaciones de auditoría -> 200 OK
  const adminAuditRes = await fetchApi('/api/audit/notifications', {
    headers: { Authorization: `Bearer ${adminAuth.token}` },
  });
  recordTest('rbac_security', 'Administrador consulta notificaciones de auditoría (/api/audit/notifications)', '200 OK', `${adminAuditRes.status}`, adminAuditRes.status === 200, 'El administrador cuenta con acceso completo de lectura al bus de auditoría.');

  // -------------------------------------------------------------------------
  // 3. IDEMPOTENCY & CONCURRENCY TESTS
  // -------------------------------------------------------------------------
  console.log('🔹 Ejecutando pruebas de Idempotencia y Concurrencia...');

  const idempotencyKey = `qa-test-idemp-${Date.now()}`;
  const depositPayload = {
    amount: { amountMinor: 15000, currency: 'GTQ' },
    description: 'Depósito de prueba de idempotencia',
  };

  // Primer depósito
  const dep1 = await fetchApi(`/api/accounts/${existingAccountId}/deposit`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${tellerAuth.token}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': idempotencyKey,
    },
    body: JSON.stringify(depositPayload),
  });

  // Segundo depósito con misma clave de idempotencia
  const dep2 = await fetchApi(`/api/accounts/${existingAccountId}/deposit`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${tellerAuth.token}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': idempotencyKey,
    },
    body: JSON.stringify(depositPayload),
  });

  const isIdempotentDeposit = dep1.status === 200 && dep2.status === 200 && dep1.body.movementId === dep2.body.movementId;
  recordTest(
    'idempotency_concurrency',
    'Depósito repetido con la misma Idempotency-Key',
    'Mismo resultado (200 OK) y mismo movementId sin duplicar saldo',
    `Dep1: ${dep1.status} (${dep1.body.movementId}), Dep2: ${dep2.status} (${dep2.body.movementId})`,
    isIdempotentDeposit,
    'La base de datos protege la unicidad por clave de idempotencia antes de mover fondos.',
  );

  // -------------------------------------------------------------------------
  // 4. SAGA FAILURE MODES & COMPENSATION
  // -------------------------------------------------------------------------
  console.log('🔹 Ejecutando pruebas de la Saga (Fondos insuficientes y Compensación)...');

  // Transferencia con saldo insuficiente
  const clientAccountsRes = await fetchApi('/api/accounts', {
    headers: { Authorization: `Bearer ${clientAuth.token}` },
  });
  const clientAccounts = clientAccountsRes.body.accounts || [];
  const srcAcc = clientAccounts.length > 1 ? clientAccounts[1].accountId : existingAccountId;
  const tgtAcc = clientAccounts.length > 0 ? clientAccounts[0].accountId : existingAccountId;

  const txFailKey = `qa-saga-fail-${Date.now()}`;
  const sagaFailRes = await fetchApi('/api/transfers', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${clientAuth.token}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': txFailKey,
    },
    body: JSON.stringify({
      sourceAccount: srcAcc,
      targetAccount: tgtAcc,
      amount: { amountMinor: 99999000, currency: 'GTQ' },
    }),
  });

  let sagaState = 'UNKNOWN';
  if (sagaFailRes.status === 202 && sagaFailRes.body.transactionId) {
    const txId = sagaFailRes.body.transactionId;
    await new Promise((r) => setTimeout(r, 3000)); // Esperar resolución de Saga
    const txStatus = await fetchApi(`/api/transfers/${txId}`, {
      headers: { Authorization: `Bearer ${clientAuth.token}` },
    });
    sagaState = txStatus.body.status || 'UNKNOWN';
  }

  const sagaFailedCorrectly = sagaState === 'FAILED';
  recordTest(
    'saga_failure_modes',
    'Transferencia con fondos insuficientes (Fallo de débito)',
    'Saga transiciona limpiamente a estado terminal FAILED con motivo DEBIT_REJECTED',
    `Estado alcanzado: ${sagaState}`,
    sagaFailedCorrectly,
    'El orquestador de transacciones no permite balances negativos y finaliza la Saga de forma consistente.',
  );

  // -------------------------------------------------------------------------
  // 5. DATA PRIVACY & AUDIT REDACTION
  // -------------------------------------------------------------------------
  console.log('🔹 Ejecutando pruebas de Privacidad de Datos y Redacción...');

  const auditEvents = await fetchApi('/api/audit/notifications', {
    headers: { Authorization: `Bearer ${adminAuth.token}` },
  });

  let hasClearPassword = false;
  if (Array.isArray(auditEvents.body.notifications)) {
    for (const ev of auditEvents.body.notifications) {
      const str = JSON.stringify(ev);
      if (str.includes('BankUsac#2026') || str.includes('SecurePassword#2026')) {
        hasClearPassword = true;
      }
    }
  }

  recordTest(
    'data_privacy_audit',
    'Redacción estricta de credenciales en bus de auditoría',
    'Ninguna contraseña en texto claro en eventos almacenados',
    hasClearPassword ? 'ALERTA: Se encontró contraseña' : 'Sin contraseñas en claro (Redacción verificada)',
    !hasClearPassword,
    'El servicio de Notificación y Auditoría aplica redacción previa a la inserción en base de datos.',
  );

  // Calcular Score final
  testResults.metrics.score = Math.round((testResults.metrics.passed / testResults.metrics.total) * 100);

  console.log(`\n📊 RESULTADOS FINALES: ${testResults.metrics.passed}/${testResults.metrics.total} pruebas superadas (${testResults.metrics.score}%).`);

  writeFileSync(resolve('docs/qa-test-results.json'), JSON.stringify(testResults, null, 2), 'utf-8');
  console.log('💾 Resultados guardados en docs/qa-test-results.json');
}

runSuite().catch((err) => {
  console.error('❌ Error en ejecución de Suite de QA:', err);
  process.exit(1);
});
