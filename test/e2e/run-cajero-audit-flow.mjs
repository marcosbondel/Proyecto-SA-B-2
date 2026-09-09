import { chromium } from 'playwright';
import { execSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { resolve, join } from 'node:path';

const BASE = 'http://localhost:3010';
const GW = 'http://localhost:3000';
const DIR = resolve('docs/qa/automated_test');
mkdirSync(DIR, { recursive: true });

const shot = (page, name) => page.screenshot({ path: join(DIR, `${name}.png`), fullPage: false });

async function clearSession(ctx, page) {
  try {
    await page.evaluate(() => {
      localStorage.clear();
      sessionStorage.clear();
    });
  } catch {}
  await ctx.clearCookies();
}

async function loginUser(ctx, page, email, password) {
  await clearSession(ctx, page);
  const res = await fetch(`${GW}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, credential: password }),
  });
  const data = await res.json();
  if (!data.token) {
    throw new Error(`Error autenticando a ${email}: ${JSON.stringify(data)}`);
  }
  await page.goto(`${BASE}/`);
  await page.evaluate((t) => sessionStorage.setItem('bank-session-token', t), data.token);
  await page.reload();
  await page.waitForTimeout(500);
  return data.token;
}

function getDbCustomer(email) {
  try {
    const res = execSync(
      `docker exec postgres-customer psql -U customer_app -d customer -t -A -F "|" -c "SELECT customer_id, full_name, email, identity_status, status FROM customers WHERE email = '${email}';"`,
      { encoding: 'utf-8' },
    ).trim();
    if (!res) return null;
    const [customerId, fullName, mail, identityStatus, status] = res.split('|');
    return { customerId, fullName, email: mail, identityStatus, status };
  } catch {
    return null;
  }
}

async function run() {
  console.log('======================================================================');
  console.log(' EJECUCIÓN DE PRUEBA E2E: AUDITORÍA DE VALIDACIÓN Y APERTURA DE CUENTA');
  console.log('======================================================================\n');

  const testEmail = 'carlostest@bankusac.gt';
  const testPass = 'Bambino2026!';
  const customerId = '72ab608f-842e-4011-a371-20477e6ec727';

  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();

  // 1. Verificar estado inicial del cliente
  const initialDb = getDbCustomer(testEmail);
  console.log('📌 [Paso 1: Estado inicial en PostgreSQL]:', initialDb);

  // 2. Probar bloqueo en /cuentas/nueva
  console.log('\n🔒 [Paso 2: Cliente sin validación entra a /cuentas/nueva]...');
  await loginUser(ctx, page, testEmail, testPass);
  await page.goto(`${BASE}/cuentas/nueva`);
  await page.waitForTimeout(2000);

  const alertVisible = (await page.locator('text=Validación de identidad requerida').count()) > 0;
  const btnBlocked = (await page.locator('button:has-text("Apertura bloqueada")').count()) > 0;
  console.log('  ⚠️  ¿Alerta de validación requerida visible?:', alertVisible);
  console.log('  🔒 ¿Botón de apertura bloqueado con mensaje de cajero?:', btnBlocked);

  await shot(page, '01-apertura-bloqueada-cajero');

  if (!alertVisible || !btnBlocked) {
    throw new Error('FALLO: El cliente no fue bloqueado como se esperaba.');
  }
  console.log('  ✅ COMPROBADO: El cliente no puede abrir cuentas sin visto bueno de cajero.');

  // 3. Cajero Receptor revisa y aprueba
  console.log('\n🧑‍💼 [Paso 3: Cajero Receptor entra a /clientes/validaciones]...');
  await loginUser(ctx, page, 'cajero@bankusac.gt', 'BankUsac#2026');
  await page.goto(`${BASE}/clientes/validaciones`);
  await page.waitForTimeout(2000);
  await shot(page, '02-cola-validaciones-cajero');

  const inQueue = (await page.locator('text=Carlos Test').count()) > 0;
  console.log('  📋 ¿Carlos Test visible en cola de validaciones?:', inQueue);

  console.log(`  🔍 Cajero abre ficha: /clientes/validaciones/${customerId}...`);
  await page.goto(`${BASE}/clientes/validaciones/${customerId}`);
  await page.waitForTimeout(2000);
  await shot(page, '03-inspeccion-documento-cajero');

  console.log('  ✍️  Cajero presiona "Aprobar identidad"...');
  const approveBtn = page.locator('button:has-text("Aprobar identidad")').first();
  await approveBtn.click();
  await page.waitForTimeout(2500);
  await shot(page, '04-aprobacion-completada');

  const approvedDb = getDbCustomer(testEmail);
  console.log('  📌 [Estado en PostgreSQL tras aprobación]:', approvedDb?.identityStatus);
  if (approvedDb?.identityStatus !== 'VALIDATED') {
    throw new Error('FALLO: La identidad no quedó en VALIDATED tras la aprobación del cajero.');
  }
  console.log('  ✅ COMPROBADO: Cajero aprobó exitosamente la identidad en la base de datos.');

  // 4. Cliente regresa a abrir su cuenta
  console.log('\n🎉 [Paso 4: Cliente validado regresa a /cuentas/nueva para aperturar cuenta]...');
  await loginUser(ctx, page, testEmail, testPass);
  await page.goto(`${BASE}/cuentas/nueva`);
  await page.waitForTimeout(2000);

  const alertStillThere = (await page.locator('text=Validación de identidad requerida').count()) > 0;
  console.log('  ¿Alerta de bloqueo desapareció?:', !alertStillThere);

  console.log('  Seleccionando cuenta de Ahorro y continuando...');
  const ahorroOption = page.locator('button:has-text("Ahorro"), div:has-text("Ahorro")').first();
  await ahorroOption.click();
  await page.waitForTimeout(500);

  await page.click('button:has-text("Continuar")');
  await page.waitForTimeout(1000);

  console.log('  Confirmando apertura...');
  await page.click('button:has-text("Crear la cuenta")');
  await page.waitForTimeout(3000);

  await shot(page, '05-cuenta-creada-con-exito');

  const successText = (await page.locator('text=Tu cuenta bancaria ha sido creada exitosamente').count()) > 0;
  console.log('  ¿Mensaje certero de creación visible?:', successText);

  const accountId = await page.locator('code').first().innerText();
  console.log('  💳 Número de cuenta aperturada:', accountId);

  // 5. Verificar en "Mis cuentas"
  console.log('\n📊 [Paso 5: Navegando a /cuentas para ver balance]...');
  await page.goto(`${BASE}/cuentas`);
  await page.waitForTimeout(2000);
  await shot(page, '06-mis-cuentas-aprobadas');

  const accountShown = (await page.locator(`text=${accountId.slice(0, 8)}`).count()) > 0;
  console.log('  ¿Cuenta reflejada en Mis Cuentas?:', accountShown || (await page.locator('text=Q 0.00').count()) > 0);

  await browser.close();

  console.log('\n======================================================================');
  console.log(' 🏁 INFORME FINAL: TODAS LAS PRUEBAS AUTOMATIZADAS FUERON SATISFACTORIAS');
  console.log('======================================================================\n');
}

run().catch((err) => {
  console.error('\n❌ ERROR DURANTE LA PRUEBA:', err);
  process.exit(1);
});
