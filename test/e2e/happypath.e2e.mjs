import { chromium } from 'playwright';
import { execSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { resolve, join } from 'node:path';

const BASE_URL = process.env.APP_BASE_URL || 'http://localhost:3010';
const SCREENSHOT_DIR = resolve('docs/screenshots');

mkdirSync(SCREENSHOT_DIR, { recursive: true });

async function clearSession(context, page) {
  try {
    await page.evaluate(() => {
      localStorage.clear();
      sessionStorage.clear();
    });
  } catch {}
  await context.clearCookies();
}

async function getActivationLinkFromLogs(timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const logs = execSync('docker compose -f infra/docker/docker-compose.dev.yml logs --tail 60 notification-audit-service', { encoding: 'utf-8' });
      const lines = logs.split('\n');
      for (const line of lines.reverse()) {
        if (line.includes('deliveryLink') || line.includes('/activar?token=')) {
          const match = line.match(/\/activar\?token=[a-zA-Z0-9_-]+/);
          if (match) {
            return match[0];
          }
          try {
            const jsonStr = line.substring(line.indexOf('{'));
            const parsed = JSON.parse(jsonStr);
            if (parsed.deliveryLink) return parsed.deliveryLink;
          } catch {}
        }
      }
    } catch (e) {
      console.error('Error fetching logs:', e.message);
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  return null;
}

async function run() {
  console.log('🚀 Iniciando recorrido E2E automatizado de QA - Happy Path...');
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1366, height: 768 },
    deviceScaleFactor: 2,
  });
  const page = await context.newPage();

  // =========================================================================
  // PASO 1: Pantalla de Login inicial
  // =========================================================================
  console.log('📸 Paso 1: Visitando pantalla de Login...');
  await clearSession(context, page);
  await page.goto(`${BASE_URL}/login`);
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: join(SCREENSHOT_DIR, '01-login-screen.png') });

  // =========================================================================
  // PASO 2: Registro Público de un Nuevo Cliente
  // =========================================================================
  console.log('📸 Paso 2.1: Registro Público (Paso 1 de 3 - Datos Personales)...');
  await page.goto(`${BASE_URL}/registro`);
  await page.waitForLoadState('networkidle');

  const randomSuffix = Math.floor(1000 + Math.random() * 9000);
  const testUser = {
    fullName: `Carlos Eduardo Morales Méndez`,
    dateOfBirth: '1995-06-20',
    address: '10ma Avenida 4-50 Zona 14, Ciudad de Guatemala',
    email: `carlos.morales.${randomSuffix}@example.com`,
    dpi: `29871${randomSuffix}0101`, // 13 dígitos exactos
    credential: 'SecurePassword#2026',
  };

  await page.fill('input[placeholder="María Fernanda López García"]', testUser.fullName);
  await page.fill('input[type="date"]', testUser.dateOfBirth);
  await page.fill('input[placeholder="12 calle 3-45 zona 1, Guatemala"]', testUser.address);
  await page.fill('input[type="email"]', testUser.email);
  await page.screenshot({ path: join(SCREENSHOT_DIR, '02-registro-paso1-datos.png') });

  await page.click('button[type="submit"]');
  await page.waitForTimeout(600);

  console.log('📸 Paso 2.2: Registro Público (Paso 2 de 3 - Documento DPI)...');
  await page.fill('input[placeholder="2547 89632 0101"]', testUser.dpi);

  const dummyPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
  await page.setInputFiles('input[type="file"]', {
    name: 'dpi_carlos_morales.png',
    mimeType: 'image/png',
    buffer: dummyPng,
  });
  await page.waitForTimeout(800);
  await page.screenshot({ path: join(SCREENSHOT_DIR, '03-registro-paso2-documento.png') });

  await page.click('button[type="submit"]');
  await page.waitForTimeout(600);

  console.log('📸 Paso 2.3: Registro Público (Paso 3 de 3 - Contraseña y Términos)...');
  await page.fill('input[placeholder="Mínimo 8 caracteres"]', testUser.credential);
  await page.fill('input[placeholder="Repite la contraseña"]', testUser.credential);
  await page.click('[role="checkbox"]');
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(SCREENSHOT_DIR, '04-registro-paso3-confirmacion.png') });

  console.log('📸 Enviando registro...');
  await page.click('[data-testid="registration-submit"]');
  await page.waitForSelector('[data-testid="registration-accepted"]', { timeout: 10000 });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: join(SCREENSHOT_DIR, '05-registro-exitoso-solicitud-aceptada.png') });

  // =========================================================================
  // PASO 3: Activación de la Cuenta por Correo
  // =========================================================================
  console.log('🔍 Obteniendo enlace de activación de los logs de Notification Service...');
  const activationPath = await getActivationLinkFromLogs();
  console.log('🔗 Enlace de activación detectado:', activationPath);

  if (activationPath) {
    console.log('📸 Paso 3: Activando cuenta...');
    await page.goto(`${BASE_URL}${activationPath}`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1500);
    await page.screenshot({ path: join(SCREENSHOT_DIR, '06-activacion-cuenta-exitosa.png') });
  }

  // =========================================================================
  // PASO 4: Inicio de Sesión del Nuevo Cliente
  // =========================================================================
  console.log('📸 Paso 4: Login con el nuevo cliente...');
  await clearSession(context, page);
  await page.goto(`${BASE_URL}/login`);
  await page.waitForLoadState('networkidle');
  await page.fill('input[type="email"]', testUser.email);
  await page.fill('input[type="password"]', testUser.credential);
  await page.screenshot({ path: join(SCREENSHOT_DIR, '07-login-cliente-nuevo.png') });

  await page.click('button:has-text("Entrar")');
  await page.waitForURL(`${BASE_URL}/`, { timeout: 10000 });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: join(SCREENSHOT_DIR, '08-dashboard-cliente-nuevo.png') });

  // =========================================================================
  // PASO 5: Apertura de una Nueva Cuenta Monetaria
  // =========================================================================
  console.log('📸 Paso 5: Apertura de cuenta bancaria...');
  await page.goto(`${BASE_URL}/cuentas/nueva`);
  await page.waitForLoadState('networkidle');
  await page.click('[data-account-type="MONETARIA"]');
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(SCREENSHOT_DIR, '09-apertura-cuenta-formulario.png') });

  await page.click('button:has-text("Continuar")');
  await page.waitForTimeout(600);
  await page.screenshot({ path: join(SCREENSHOT_DIR, '10-apertura-cuenta-confirmacion.png') });

  await page.click('button:has-text("Crear la cuenta")');
  await page.waitForSelector('[data-testid="new-account-id"]', { timeout: 10000 });
  await page.waitForTimeout(1000);

  // Obtener el ID de la nueva cuenta creada
  const newAccountText = await page.locator('[data-testid="new-account-id"]').textContent();
  const accountIdMatch = newAccountText.match(/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i);
  const newAccountId = accountIdMatch ? accountIdMatch[0] : null;
  console.log('💳 Nueva cuenta monetaria creada:', newAccountId);

  // Ir a la lista de cuentas
  await page.goto(`${BASE_URL}/cuentas`);
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1500);
  await page.screenshot({ path: join(SCREENSHOT_DIR, '11-lista-cuentas-cliente.png') });

  // =========================================================================
  // PASO 6: Flujo de Cajero Receptor - Validación de Identidad
  // =========================================================================
  console.log('📸 Paso 6: Cerrando sesión e ingresando como Cajero Receptor...');
  await clearSession(context, page);
  await page.goto(`${BASE_URL}/login`);
  await page.waitForLoadState('networkidle');
  await page.fill('input[type="email"]', 'cajero@bankusac.gt');
  await page.fill('input[type="password"]', 'BankUsac#2026');
  await page.screenshot({ path: join(SCREENSHOT_DIR, '12-login-cajero.png') });
  await page.click('button:has-text("Entrar")');
  await page.waitForURL(`${BASE_URL}/`, { timeout: 10000 });
  await page.waitForTimeout(1000);

  console.log('📸 Paso 6.2: Revisando cola de validaciones de identidad...');
  await page.goto(`${BASE_URL}/clientes/validaciones`);
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1000);
  await page.screenshot({ path: join(SCREENSHOT_DIR, '13-cola-validaciones-cajero.png') });

  // Detalle de validación si existe
  const reviewLink = page.locator('text=Revisar →').first();
  if (await reviewLink.isVisible()) {
    await reviewLink.click();
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1500);
    await page.screenshot({ path: join(SCREENSHOT_DIR, '14-detalle-validacion-identidad.png') });
  }

  // =========================================================================
  // PASO 7: Flujo de Cajero Receptor - Depósito en Ventanilla
  // =========================================================================
  console.log('📸 Paso 7: Realizando depósito en ventanilla...');
  await page.goto(`${BASE_URL}/cuentas/deposito`);
  await page.waitForLoadState('networkidle');

  const targetDepositAccount = newAccountId || '00000000-0000-4000-8000-000000000001';
  await page.fill('input[placeholder="Pega aquí el número de cuenta"]', targetDepositAccount);
  
  // Monto con spinbutton
  const depositSpinbutton = page.locator('[role="spinbutton"]');
  if (await depositSpinbutton.isVisible()) {
    await depositSpinbutton.fill('2500');
  }
  
  await page.fill('input[placeholder="Depósito en efectivo, Agencia Central"]', 'Depósito inicial en efectivo por ventanilla');
  await page.screenshot({ path: join(SCREENSHOT_DIR, '16-deposito-ventanilla-formulario.png') });

  await page.click('button:has-text("Continuar")');
  await page.waitForTimeout(600);
  await page.screenshot({ path: join(SCREENSHOT_DIR, '17-deposito-ventanilla-confirmacion.png') });

  await page.click('button:has-text("Registrar depósito")');
  await page.waitForTimeout(2000);
  await page.screenshot({ path: join(SCREENSHOT_DIR, '18-comprobante-deposito-exitoso.png') });

  // =========================================================================
  // PASO 8: Flujo de Transferencia Bancaria con Saga (Cliente Demo)
  // =========================================================================
  console.log('📸 Paso 8: Inicio de sesión con Cliente Demo para Transferencia con Saga...');
  await clearSession(context, page);
  await page.goto(`${BASE_URL}/login`);
  await page.waitForLoadState('networkidle');
  await page.fill('input[type="email"]', 'cliente@bankusac.gt');
  await page.fill('input[type="password"]', 'BankUsac#2026');
  await page.screenshot({ path: join(SCREENSHOT_DIR, '19-login-cliente-transferencia.png') });
  await page.click('button:has-text("Entrar")');
  await page.waitForURL(`${BASE_URL}/`, { timeout: 10000 });
  await page.waitForTimeout(1000);

  console.log('📸 Paso 8.2: Creando transferencia...');
  await page.goto(`${BASE_URL}/transferencias/nueva`);
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1000);

  // Seleccionar cuenta de origen con saldo (la que tiene Q5,000.00)
  await page.click('[data-testid="source-account"]');
  await page.waitForTimeout(600);
  const sourceOptions = await page.locator('[role="option"]').all();
  if (sourceOptions.length > 1) {
    for (let i = 1; i < sourceOptions.length; i++) {
      const text = await sourceOptions[i].textContent();
      if (text.includes('5,000') || text.includes('5000')) {
        await sourceOptions[i].click();
        break;
      }
    }
  }
  await page.waitForTimeout(600);

  // Transferir a la cuenta recién creada de Carlos
  if (newAccountId) {
    const radioOther = page.locator('text=A la cuenta de otra persona');
    if (await radioOther.isVisible()) {
      await radioOther.click();
      await page.waitForTimeout(400);
      const destInput = page.locator('[data-testid="target-account"]');
      if (await destInput.isVisible()) {
        await destInput.fill(newAccountId);
      }
    }
  }

  // Rellenar monto de transferencia con spinbutton
  const transferSpinbutton = page.locator('[role="spinbutton"]');
  if (await transferSpinbutton.isVisible()) {
    await transferSpinbutton.fill('750');
  }

  await page.screenshot({ path: join(SCREENSHOT_DIR, '20-transferencia-formulario.png') });

  await page.click('button:has-text("Continuar")');
  await page.waitForTimeout(600);
  await page.screenshot({ path: join(SCREENSHOT_DIR, '21-transferencia-confirmacion.png') });

  await page.click('[data-testid="confirm-transfer"]');
  await page.waitForURL(/\/transferencias\/[0-9a-f-]+/, { timeout: 15000 });
  await page.waitForTimeout(4500); // Esperar que la Saga complete los eventos
  await page.screenshot({ path: join(SCREENSHOT_DIR, '22-transferencia-saga-completada.png') });

  // Ver historial de transferencias
  await page.goto(`${BASE_URL}/transferencias/historial`);
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1500);
  await page.screenshot({ path: join(SCREENSHOT_DIR, '23-historial-transferencias.png') });

  // =========================================================================
  // PASO 9: Flujo de Administrador - Auditoría y Observabilidad
  // =========================================================================
  console.log('📸 Paso 9: Inicio de sesión como Administrador...');
  await clearSession(context, page);
  await page.goto(`${BASE_URL}/login`);
  await page.waitForLoadState('networkidle');
  await page.fill('input[type="email"]', 'admin@bankusac.gt');
  await page.fill('input[type="password"]', 'BankUsac#2026');
  await page.screenshot({ path: join(SCREENSHOT_DIR, '24-login-administrador.png') });
  await page.click('button:has-text("Entrar")');
  await page.waitForURL(`${BASE_URL}/`, { timeout: 10000 });
  await page.waitForTimeout(1000);
  await page.screenshot({ path: join(SCREENSHOT_DIR, '25-dashboard-administrador.png') });

  console.log('📸 Paso 9.2: Módulo de Auditoría...');
  await page.goto(`${BASE_URL}/auditoria`);
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1000);
  await page.screenshot({ path: join(SCREENSHOT_DIR, '26-auditoria-consulta-correlation.png') });

  console.log('📸 Paso 9.3: Monitoreo de Pagos...');
  await page.goto(`${BASE_URL}/pagos`);
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1000);
  await page.screenshot({ path: join(SCREENSHOT_DIR, '27-monitoreo-pagos-administrador.png') });

  console.log('📸 Paso 9.4: Bandeja de Notificaciones de Auditoría...');
  await page.goto(`${BASE_URL}/auditoria/notificaciones`);
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1000);
  await page.screenshot({ path: join(SCREENSHOT_DIR, '28-inbox-notificaciones-administrador.png') });

  await browser.close();
  console.log('🎉 ¡Recorrido E2E completado con éxito! Todas las capturas fueron actualizadas.');
}

run().catch((err) => {
  console.error('❌ Error en la ejecución de E2E:', err);
  process.exit(1);
});
