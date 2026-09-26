/**
 * payments — the payment monitoring routes and the fact that a "service
 * payment" is a transfer to a biller's collection account.
 *
 * **There is no `POST /api/payments`.** A payment is step 4 of the transfer
 * Saga (`apps/gateway/src/interfaces/payments.controller.ts` says so at
 * length), so every payment this suite needs is produced by a real
 * `POST /api/transfers` carrying a `paymentScenario`, never invented.
 *
 * `GET /api/payments` is staff-only (`@Roles('CAJERO_RECEPTOR', 'ADMINISTRADOR')`)
 * because Payment Service holds a `transactionId` and no customer reference —
 * TD-037. `GET /api/accounts/billers` is open to any authenticated role. The
 * staff monitor lives at `/pagos/monitor`, not `/pagos` — `/pagos` is the
 * customer-facing "Historial de pagos" front door (confirmed by reading
 * `apps/web/app/pages/pagos/{index,monitor,nuevo}.vue`, not assumed from the
 * ticket's working title).
 */
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { BASE, SEEDED, api, loginApi, waitForStatus } from '../support/gateway.mjs';
import { launch, loginViaUI, shot } from '../support/browser.mjs';
import { Report } from '../support/report.mjs';
import { provisionCustomer } from '../support/seed.mjs';

export async function run() {
  const report = new Report('payments');
  const { browser, ctx, page } = await launch();

  try {
    const cajero = await loginApi(SEEDED.cajero.email, SEEDED.cajero.password);
    const admin = await loginApi(SEEDED.admin.email, SEEDED.admin.password);
    if (!cajero.token || !admin.token) {
      throw new Error(
        `No se pudo autenticar cajero/admin sembrados (cajero=${cajero.status}, admin=${admin.status}). ¿Está el stack corriendo con SEED_DEMO_DATA=true?`,
      );
    }

    // ---- PAY-RBAC-01/02/03 — GET /api/payments is staff-only. --------------
    const source = await provisionCustomer({ label: 'pay-src' });
    if (!source.ok) {
      report.skip(
        'PAY-RBAC-01',
        'Pagos',
        'CLIENTE no puede listar pagos',
        `No se pudo aprovisionar un cliente para obtener un token CLIENTE real: ${source.step} — ${source.detail}`,
      );
      report.skip('PAY-RBAC-02', 'Pagos', 'CAJERO puede listar pagos', 'Sin cliente aprovisionado, se omite el bloque completo por consistencia.');
      report.skip('PAY-RBAC-03', 'Pagos', 'ADMIN puede listar pagos', 'Sin cliente aprovisionado, se omite el bloque completo por consistencia.');
    } else {
      const asCliente = await api('/api/payments', source.token);
      report.record(
        'PAY-RBAC-01',
        'Pagos',
        'Un CLIENTE no puede listar pagos (D-06 / TD-037)',
        '403',
        `${asCliente.status}`,
        asCliente.status === 403,
      );

      const asCajero = await api('/api/payments', cajero.token);
      report.record(
        'PAY-RBAC-02',
        'Pagos',
        'Un CAJERO_RECEPTOR puede listar pagos',
        '200',
        `${asCajero.status}`,
        asCajero.status === 200 && Array.isArray(asCajero.body.payments),
      );

      const asAdmin = await api('/api/payments', admin.token);
      report.record(
        'PAY-RBAC-03',
        'Pagos',
        'Un ADMINISTRADOR puede listar pagos',
        '200',
        `${asAdmin.status}`,
        asAdmin.status === 200 && Array.isArray(asAdmin.body.payments),
      );
    }

    // ---- Fund the source account, independently of whether `target`
    // provisions — the UI section below (PAY-UI-NEW-SUBMIT-01) needs
    // `source` funded regardless of whether the CREATE/DETAIL/FILTER block
    // gets to run, and gating the deposit on both customers meant a target
    // provisioning failure silently left `source` at Q0.00 for the rest of
    // the suite, turning an unrelated "insufficient funds" into what looked
    // like a broken submit button. Fresh accounts start at Q0.00. --------
    if (source.ok) {
      const depositKey = `qa-pay-deposit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const deposit = await api(`/api/accounts/${source.accountIds[0]}/deposit`, cajero.token, {
        method: 'POST',
        headers: { 'Idempotency-Key': depositKey },
        body: { amount: { amountMinor: 500000, currency: 'GTQ' }, description: 'QA payments fixture' },
      });
      if (deposit.status !== 200) {
        throw new Error(`No se pudo fondear la cuenta origen: ${deposit.status} ${JSON.stringify(deposit.body)}`);
      }
    }

    // ---- Fixtures shared by the CREATE/DETAIL/FILTER cases: a second
    // provisioned customer as the transfer's target. -------------------------
    const target = await provisionCustomer({ label: 'pay-tgt' });
    let approveTransactionId = null;
    let approvePaymentId = null;
    let rejectTransactionId = null;

    if (!source.ok || !target.ok) {
      const detail = !source.ok
        ? `origen: ${source.step} — ${source.detail}`
        : `destino: ${target.step} — ${target.detail}`;
      for (const [id, name] of [
        ['PAY-CREATE-APPROVE-01', 'Transferencia APPROVE crea un pago SUCCEEDED'],
        ['PAY-CREATE-REJECT-01', 'Transferencia REJECT crea un pago FAILED/PERMANENT'],
        ['PAY-DETAIL-01', 'GET /api/payments/:paymentId devuelve el pago creado'],
        ['PAY-FILTER-01', 'GET /api/payments?status= filtra realmente'],
      ]) {
        report.skip(id, 'Pagos', name, `No se pudo aprovisionar el fixture de dos clientes: ${detail}`);
      }
    } else {
      const sourceAccountId = source.accountIds[0];
      const targetAccountId = target.accountIds[0];

      // ---- PAY-CREATE-APPROVE-01 --------------------------------------------
      const approveReq = await api('/api/transfers', source.token, {
        method: 'POST',
        headers: { 'Idempotency-Key': `qa-pay-approve-${Date.now()}` },
        body: {
          sourceAccount: sourceAccountId,
          targetAccount: targetAccountId,
          amount: { amountMinor: 1500, currency: 'GTQ' },
          reference: 'QA payments APPROVE',
          paymentScenario: 'APPROVE',
        },
      });

      if (approveReq.status !== 202 || !approveReq.body.transactionId) {
        report.record(
          'PAY-CREATE-APPROVE-01',
          'Pagos',
          'Transferencia APPROVE crea un pago SUCCEEDED',
          '202 al solicitar, luego COMPLETED con un pago SUCCEEDED',
          `POST /api/transfers → ${approveReq.status}: ${JSON.stringify(approveReq.body)}`,
          false,
        );
      } else {
        approveTransactionId = approveReq.body.transactionId;
        const settled = await waitForStatus(
          `/api/transfers/${approveTransactionId}`,
          source.token,
          (r) => r.body.status === 'COMPLETED' || r.body.status === 'FAILED' || r.body.status === 'COMPENSATED',
          15000,
        );
        const listed = await api(`/api/payments?transactionId=${approveTransactionId}`, cajero.token);
        const row = Array.isArray(listed.body.payments)
          ? listed.body.payments.find((p) => p.transactionId === approveTransactionId)
          : undefined;
        if (row) approvePaymentId = row.paymentId;
        report.record(
          'PAY-CREATE-APPROVE-01',
          'Pagos',
          'Transferencia APPROVE crea un pago SUCCEEDED',
          'transfer.status=COMPLETED, payment.status=SUCCEEDED',
          `transfer.status=${settled.body.status}, payments.length=${listed.body.payments?.length ?? 'N/A'}, row.status=${row?.status ?? 'NOT_FOUND'}`,
          settled.body.status === 'COMPLETED' && row !== undefined && row.status === 'SUCCEEDED',
        );
      }

      // ---- PAY-CREATE-REJECT-01 ----------------------------------------------
      const rejectReq = await api('/api/transfers', source.token, {
        method: 'POST',
        headers: { 'Idempotency-Key': `qa-pay-reject-${Date.now()}` },
        body: {
          sourceAccount: sourceAccountId,
          targetAccount: targetAccountId,
          amount: { amountMinor: 1200, currency: 'GTQ' },
          reference: 'QA payments REJECT',
          paymentScenario: 'REJECT',
        },
      });

      if (rejectReq.status !== 202 || !rejectReq.body.transactionId) {
        report.record(
          'PAY-CREATE-REJECT-01',
          'Pagos',
          'Transferencia REJECT crea un pago FAILED/PERMANENT',
          '202 al solicitar, luego COMPENSATED con un pago FAILED/PERMANENT',
          `POST /api/transfers → ${rejectReq.status}: ${JSON.stringify(rejectReq.body)}`,
          false,
        );
      } else {
        rejectTransactionId = rejectReq.body.transactionId;
        const settled = await waitForStatus(
          `/api/transfers/${rejectTransactionId}`,
          source.token,
          (r) => r.body.status === 'COMPENSATED' || r.body.status === 'COMPLETED' || r.body.status === 'FAILED',
          15000,
        );
        const listed = await api(`/api/payments?transactionId=${rejectTransactionId}`, admin.token);
        const row = Array.isArray(listed.body.payments)
          ? listed.body.payments.find((p) => p.transactionId === rejectTransactionId)
          : undefined;
        report.record(
          'PAY-CREATE-REJECT-01',
          'Pagos',
          'Transferencia REJECT crea un pago FAILED/PERMANENT',
          'transfer.status=COMPENSATED, payment.status=FAILED, payment.errorType=PERMANENT',
          `transfer.status=${settled.body.status}, payment.reason=${settled.body.payment?.reason ?? 'N/A'}, row.status=${row?.status ?? 'NOT_FOUND'}, row.errorType=${row?.errorType ?? 'N/A'}`,
          settled.body.status === 'COMPENSATED' &&
            row !== undefined &&
            row.status === 'FAILED' &&
            row.errorType === 'PERMANENT',
        );
      }

      // ---- PAY-DETAIL-01 -------------------------------------------------
      if (approvePaymentId === null) {
        report.skip(
          'PAY-DETAIL-01',
          'Pagos',
          'GET /api/payments/:paymentId devuelve el pago creado',
          'PAY-CREATE-APPROVE-01 no produjo un paymentId real que consultar.',
        );
      } else {
        const detail = await api(`/api/payments/${approvePaymentId}`, cajero.token);
        report.record(
          'PAY-DETAIL-01',
          'Pagos',
          'GET /api/payments/:paymentId devuelve el pago creado',
          `200, outcome=FOUND, payment.transactionId=${approveTransactionId}`,
          `${detail.status}: outcome=${detail.body.outcome ?? 'N/A'}, payment.transactionId=${detail.body.payment?.transactionId ?? 'N/A'}`,
          detail.status === 200 &&
            detail.body.outcome === 'FOUND' &&
            detail.body.payment?.transactionId === approveTransactionId &&
            Array.isArray(detail.body.attempts),
        );
      }

      // ---- PAY-FILTER-01 --------------------------------------------------
      const filtered = await api('/api/payments?status=SUCCEEDED', cajero.token);
      const rows = Array.isArray(filtered.body.payments) ? filtered.body.payments : [];
      const allMatch = rows.length > 0 && rows.every((p) => p.status === 'SUCCEEDED');
      report.record(
        'PAY-FILTER-01',
        'Pagos',
        'GET /api/payments?status=SUCCEEDED filtra realmente, no decora',
        'status 200, al menos una fila, y CADA fila tiene status=SUCCEEDED',
        `${filtered.status}: ${rows.length} filas, statuses=${JSON.stringify([...new Set(rows.map((p) => p.status))])}`,
        filtered.status === 200 && allMatch,
      );
    }

    // ---- PAY-DETAIL-NOTFOUND-01 — a well-formed but nonexistent paymentId. -
    // The envelope's outer `type` is always `BUSINESS_REJECTION` here; the
    // borrowed code payments.controller.ts documents living at `failureCode`
    // — verified live against the running gateway, not assumed from the
    // controller comment alone.
    const fakePaymentId = '00000000-0000-4000-8000-000000000000';
    const notFound = await api(`/api/payments/${fakePaymentId}`, cajero.token);
    report.record(
      'PAY-DETAIL-NOTFOUND-01',
      'Pagos',
      'GET /api/payments/:paymentId con un UUID válido pero inexistente',
      '409, type=BUSINESS_REJECTION, failureCode=ILLEGAL_TRANSITION (código prestado, ver payments.controller.ts)',
      `${notFound.status}: type=${notFound.body.type ?? 'N/A'}, failureCode=${notFound.body.failureCode ?? 'N/A'}`,
      notFound.status === 409 &&
        notFound.body.type === 'BUSINESS_REJECTION' &&
        notFound.body.failureCode === 'ILLEGAL_TRANSITION',
    );

    // ---- BILLERS-01 — the catalogue G-01 reads. ----------------------------
    const billers = await api('/api/accounts/billers', source.ok ? source.token : cajero.token);
    const billerRows = Array.isArray(billers.body.billers) ? billers.body.billers : [];
    const hasRealShape =
      billerRows.length > 0 &&
      billerRows.every(
        (b) => typeof b.code === 'string' && typeof b.name === 'string' && typeof b.accountId === 'string',
      );
    report.record(
      'BILLERS-01',
      'Pagos',
      'GET /api/accounts/billers devuelve un catálogo real y no vacío',
      '200 y >=1 biller con {code, name, accountId}',
      `${billers.status}: ${billerRows.length} billers — ${JSON.stringify(billerRows.map((b) => b.code))}`,
      billers.status === 200 && hasRealShape,
      billerRows.length === 0
        ? 'Catálogo vacío observado en este ambiente compartido: los tests de integración de account-service ' +
          '(TRUNCATE accounts) pueden vaciar esta misma tabla si corren contra el mismo DATABASE_URL que dev:host; ' +
          'un reinicio de account-service re-siembra los tres billers en el arranque.'
        : '',
    );

    // ---- BILLERS-ROLE-01 — open to CLIENTE too, per the controller's absent @Roles. --
    if (!source.ok) {
      report.skip(
        'BILLERS-ROLE-01',
        'Pagos',
        'Un CLIENTE también puede leer el catálogo de billers (sin @Roles)',
        'Sin cliente aprovisionado.',
      );
    } else {
      const billersAsClient = await api('/api/accounts/billers', source.token);
      report.record(
        'BILLERS-ROLE-01',
        'Pagos',
        'Un CLIENTE también puede leer el catálogo de billers (sin @Roles)',
        '200',
        `${billersAsClient.status}`,
        billersAsClient.status === 200,
      );
    }

    // ---- PAY-UI-MONITOR-01 — the staff monitor at /pagos/monitor. ----------
    const monitorLogin = await loginViaUI(ctx, page, SEEDED.cajero.email, SEEDED.cajero.password);
    if (!monitorLogin.includes('/login')) {
      await page.goto(`${BASE}/pagos/monitor`);
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(1200);
      await shot(page, 'payments-01-monitor');

      const apiPayments = await api('/api/payments', cajero.token);
      const apiCount = Array.isArray(apiPayments.body.payments) ? apiPayments.body.payments.length : 0;
      const bodyText = await page.locator('body').innerText();
      // The screen renders each row's paymentId truncated (see monitor.vue's
      // search filter, which matches full ids) — look for the transactionId
      // we actually created instead, which the row also carries.
      // `PaymentMonitorTable.vue` renders `payment.transactionId` verbatim
      // (not truncated) in a `<code>` cell — checked by reading the component.
      const showsOurTransfer =
        approveTransactionId !== null && bodyText.includes(approveTransactionId);
      const showsAnyPaymentRow = apiCount > 0 && /Q\s?[\d,]+\.\d{2}/.test(bodyText);
      report.record(
        'PAY-UI-MONITOR-01',
        'Pagos',
        '/pagos/monitor (staff) muestra pagos reales, no un estado genérico',
        `El texto de la página referencia la transacción creada (${approveTransactionId ?? 'N/A'}) o al menos un monto real, con GET /api/payments devolviendo ${apiCount} filas`,
        `apiCount=${apiCount}, showsOurTransfer=${showsOurTransfer}, showsAnyPaymentRow=${showsAnyPaymentRow}`,
        apiCount > 0 && (showsOurTransfer || showsAnyPaymentRow),
      );
    } else {
      report.skip(
        'PAY-UI-MONITOR-01',
        'Pagos',
        '/pagos/monitor (staff) muestra pagos reales',
        `El login vía UI como cajero no salió de /login (landed=${monitorLogin}).`,
      );
    }

    // ---- PAY-UI-NEW-01 — the client-facing "Nuevo pago" form. --------------
    if (!source.ok) {
      report.skip(
        'PAY-UI-NEW-01',
        'Pagos',
        '/pagos/nuevo (cliente) renderiza el formulario y produce una transferencia real',
        'No se pudo aprovisionar un cliente para probar esta pantalla.',
      );
    } else {
      // A fresh page in its own browser context — not the cajero-logged-in
      // `page` from PAY-UI-MONITOR-01 above — so a leftover Pinia/session
      // state from the previous login can never be blamed for (or cause) a
      // failure here.
      const clientCtx = await browser.newContext({ viewport: { width: 1366, height: 768 }, deviceScaleFactor: 2 });
      const clientPage = await clientCtx.newPage();
      const clientLanded = await loginViaUI(clientCtx, clientPage, source.email, source.password);
      if (clientLanded.includes('/login')) {
        report.skip(
          'PAY-UI-NEW-01',
          'Pagos',
          '/pagos/nuevo (cliente) renderiza el formulario y produce una transferencia real',
          `El login vía UI como el cliente aprovisionado no salió de /login (landed=${clientLanded}).`,
        );
        report.skip(
          'PAY-UI-NEW-SUBMIT-01',
          'Pagos',
          '/pagos/nuevo envía una transferencia real al elegir un biller',
          'El login vía UI como el cliente aprovisionado falló; ver PAY-UI-NEW-01.',
        );
      } else {
        await clientPage.goto(`${BASE}/pagos/nuevo`);
        await clientPage.waitForLoadState('networkidle');
        await clientPage.waitForTimeout(1200);
        await shot(clientPage, 'payments-02-nuevo-formulario');

        const sourceLabelVisible = await clientPage
          .locator('label:has-text("Cuenta origen")')
          .first()
          .isVisible()
          .catch(() => false);
        const billerLabelVisible = await clientPage
          .locator('label:has-text("Servicio público o factura")')
          .first()
          .isVisible()
          .catch(() => false);
        const amountLabelVisible = await clientPage
          .locator('label:has-text("Monto")')
          .first()
          .isVisible()
          .catch(() => false);
        const referenceLabelVisible = await clientPage
          .locator('label:has-text("Número de contrato o referencia")')
          .first()
          .isVisible()
          .catch(() => false);
        const formPresent =
          sourceLabelVisible && billerLabelVisible && amountLabelVisible && referenceLabelVisible;

        report.record(
          'PAY-UI-NEW-01',
          'Pagos',
          '/pagos/nuevo (cliente) renderiza los controles reales del formulario',
          'Etiquetas visibles: Cuenta origen, Servicio público o factura, Monto, Número de contrato o referencia',
          `sourceAccount=${sourceLabelVisible} biller=${billerLabelVisible} amount=${amountLabelVisible} reference=${referenceLabelVisible}`,
          formPresent,
        );

        // Real submission: this screen is `POST /api/transfers` under the
        // hood (see the module doc-comment above and `pagos/nuevo.vue`'s own
        // `send()`) — drive the actual selects rather than assume it, and
        // verify the transfer this produced through the API afterward.
        const catalogueHelp = await clientPage
          .locator('text=No pudimos cargar el catálogo de servicios.')
          .first()
          .isVisible()
          .catch(() => false);

        if (catalogueHelp || billerRows.length === 0) {
          report.skip(
            'PAY-UI-NEW-SUBMIT-01',
            'Pagos',
            '/pagos/nuevo envía una transferencia real al elegir un biller',
            'El catálogo de billers estaba vacío en el momento de esta prueba (ver BILLERS-01); no hay ' +
              'ítem que seleccionar en el combobox de servicio.',
          );
        } else {
          // A locator timeout here is real information (the form refused to
          // submit, or a select never opened) and must be recorded as a
          // failed case, not an uncaught exception that kills every suite
          // that runs after this one in `run-all.mjs`'s single process.
          try {
            let requestSeen = null;
            clientPage.on('request', (req) => {
              if (req.method() === 'POST' && req.url().includes('/api/transfers')) {
                requestSeen = req.postData();
              }
            });

            await clientPage.locator('button:has-text("Elige o busca una cuenta...")').first().click();
            await clientPage.waitForTimeout(400);
            await clientPage.locator('[role="option"]').first().click({ timeout: 5000 });

            await clientPage.locator('button:has-text("Elige el servicio")').first().click();
            await clientPage.waitForTimeout(400);
            await clientPage.locator('[role="option"]').first().click({ timeout: 5000 });

            // `UInputNumber` (Reka UI's currency spinbutton) ignores `.fill()` —
            // verified live: `.fill('10.00')` leaves it empty and the submit
            // button stays disabled. `.pressSequentially` drives it the way a
            // real keystroke would and the value sticks.
            const amountInput = clientPage.locator('input[role="spinbutton"]').first();
            await amountInput.click();
            await amountInput.pressSequentially('10.00', { delay: 30 });
            await clientPage.locator('input[name="reference"]').fill('QA-UI-12345');

            const submitButton = clientPage.locator('button[type="submit"]').first();
            await submitButton.waitFor({ state: 'visible', timeout: 5000 });
            // `UInputNumber` commits its formatted value to the `v-model` on
            // blur (verified live: the hidden `input[name="amount"]` reads
            // empty right after `pressSequentially`, and only picks up the
            // typed value once focus leaves the field) — so the submit
            // button legitimately stays disabled for a beat after the
            // reference field is filled. Poll a bounded 5s rather than
            // either an instant check (false negative on that real gap) or
            // Playwright's unbounded 30s auto-retry on `.click()` (which is
            // what produced an unrecoverable hang before this suite wrapped
            // the interaction in try/catch).
            let stillDisabled = await submitButton.isDisabled();
            const pollDeadline = Date.now() + 5000;
            while (stillDisabled && Date.now() < pollDeadline) {
              await clientPage.waitForTimeout(250);
              stillDisabled = await submitButton.isDisabled();
            }
            if (stillDisabled) {
              await shot(clientPage, 'payments-03-nuevo-boton-deshabilitado');
              throw new Error(
                `El botón de envío seguía deshabilitado tras llenar cuenta, servicio, monto (${await amountInput.inputValue()}) y referencia, tras esperar 5s adicionales.`,
              );
            }
            await submitButton.click({ timeout: 5000 });
            await clientPage.waitForTimeout(2500);
            await shot(clientPage, 'payments-03-nuevo-enviado');

            const navigatedToTransfer = /\/transferencias\/[0-9a-f-]{36}/.test(clientPage.url());
            const uiTransactionId = navigatedToTransfer ? clientPage.url().split('/').pop() : null;
            let confirmedViaApi = false;
            if (uiTransactionId !== null) {
              const check = await api(`/api/transfers/${uiTransactionId}`, source.token);
              confirmedViaApi = check.status === 200 && typeof check.body.status === 'string';
            }

            report.record(
              'PAY-UI-NEW-SUBMIT-01',
              'Pagos',
              '/pagos/nuevo envía POST /api/transfers real y navega a la transferencia creada',
              'Redirige a /transferencias/:id, y ese id existe según GET /api/transfers/:id',
              `url=${clientPage.url()}, requestBodySeen=${requestSeen !== null}, confirmedViaApi=${confirmedViaApi}`,
              navigatedToTransfer && confirmedViaApi,
            );
          } catch (err) {
            await shot(clientPage, 'payments-03-nuevo-error').catch(() => {});
            report.record(
              'PAY-UI-NEW-SUBMIT-01',
              'Pagos',
              '/pagos/nuevo envía POST /api/transfers real y navega a la transferencia creada',
              'Redirige a /transferencias/:id, y ese id existe según GET /api/transfers/:id',
              `Excepción real durante la interacción UI: ${err.message.split('\n')[0]}`,
              false,
            );
          }
        }
      }
      await clientCtx.close();
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
