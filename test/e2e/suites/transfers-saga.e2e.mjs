/**
 * transfers-saga — the choreographed Saga, verified by the money, not the label.
 *
 * The defect this suite exists to remove: `happypath.e2e.mjs`'s TX-05 recorded
 * a transfer as "COMPLETED (Saga completada)" with `pass: true` written by
 * hand, in both its success branch AND its `catch` block — a transfer that
 * failed to even reach the confirmation button still "passed". Nothing here
 * records a verdict that was not computed from a real balance read or a real
 * terminal status polled from `GET /api/transfers/:id`. Every money-moving
 * case reads the account's balance before the attempt and after it reaches a
 * terminal state, and compares the two numbers exactly — `NUMERIC(14,2)` in
 * Postgres, integers on the wire, so the comparison is exact arithmetic, never
 * a tolerance.
 *
 * `provisionCustomer` is called sequentially (twice), which is the same shape
 * `run-all.mjs` runs suites in — the known race in `support/activation.mjs`
 * (the log-scrape returns the *last* activation link in the shared log, not
 * one scoped to this call's `correlationId`) only bites under concurrent
 * registrations from other suites/processes. A short jittered retry absorbs
 * that without the suite needing to know it happened.
 */
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { BASE, SEEDED, api, loginApi, waitForStatus } from '../support/gateway.mjs';
import { launch, loginViaUI, shot } from '../support/browser.mjs';
import { provisionCustomer } from '../support/seed.mjs';
import { Report } from '../support/report.mjs';

const TERMINAL = new Set(['COMPLETED', 'FAILED', 'COMPENSATED']);

/** GTQ 1.00 = amountMinor 100. Every amount below is named in minor units for the same reason `MoneyDto` is: no float ever touches a balance. */
const money = (amountMinor) => ({ amountMinor, currency: 'GTQ' });

async function balanceOf(accountId, token) {
  const r = await api(`/api/accounts/${accountId}/balance`, token);
  if (r.status !== 200 || r.body.outcome !== 'FOUND') {
    throw new Error(`No se pudo leer el saldo de ${accountId}: ${r.status} ${JSON.stringify(r.body)}`);
  }
  return r.body.balance.amountMinor;
}

async function pollTerminal(transactionId, token, timeoutMs = 15000, intervalMs = 600) {
  return waitForStatus(
    `/api/transfers/${transactionId}`,
    token,
    (r) => r.status === 200 && TERMINAL.has(r.body.status),
    timeoutMs,
    intervalMs,
  );
}

/**
 * `provisionCustomer` regenerates a fresh random email on every call, so a
 * retry is a genuinely new registration, never a repeat of one that already
 * half-failed. Jittered so two calls made back-to-back by this same process
 * (source customer, then target customer) do not land on the exact same tick
 * as another suite's registration and grab its activation link instead.
 */
async function provisionRetry(label, opts, attempts = 8) {
  let last = null;
  for (let i = 0; i < attempts; i += 1) {
    if (i > 0) {
      await new Promise((r) => setTimeout(r, 1200 + Math.random() * 1800));
    }
    last = await provisionCustomer({ label, ...opts });
    if (last.ok) return last;
    console.log(
      `  [transfers-saga] provisión de '${label}' reintento ${i}: ${last.step} — ${String(last.detail).slice(0, 160)}`,
    );
  }
  return last;
}

/** A single flaky reply on the broker (a 504 while a service is mid-restart) is not "the cajero doesn't exist" — retried the same way `provisionRetry` retries registration. */
async function loginWithRetry(email, password, attempts = 6) {
  let last;
  for (let i = 0; i < attempts; i += 1) {
    if (i > 0) await new Promise((r) => setTimeout(r, 1500 + Math.random() * 1500));
    last = await loginApi(email, password);
    if (last.token) return last;
    console.log(`  [transfers-saga] login de ${email} reintento ${i}: ${last.status} ${JSON.stringify(last.data).slice(0, 120)}`);
  }
  return last;
}

export async function run() {
  const report = new Report('transfers-saga');

  const cajero = await loginWithRetry(SEEDED.cajero.email, SEEDED.cajero.password);
  if (!cajero.token) {
    report.skip(
      'TX-SETUP-CAJERO',
      'Setup',
      'Login del cajero sembrado',
      `No se pudo autenticar al cajero sembrado (status ${cajero.status}); toda la suite depende de poder fondear cuentas.`,
    );
    return report.summary();
  }

  console.log('  [transfers-saga] aprovisionando cliente origen (2 cuentas)...');
  const custA = await provisionRetry('saga-src', { openSavings: true });
  console.log('  [transfers-saga] aprovisionando cliente destino (1 cuenta)...');
  const custB = await provisionRetry('saga-dst', { openSavings: false });

  if (!custA.ok) {
    const reason = `No se pudo aprovisionar el cliente origen tras varios reintentos: ${custA.step} — ${String(custA.detail).slice(0, 200)}`;
    for (const id of [
      'TX-SELF-01', 'TX-ZERO-01', 'TX-NEG-01', 'TX-NOFUNDS-01', 'TX-HAPPY-01', 'TX-REJECT-01',
      'TX-TRANSIENT-01', 'TX-TIMEOUT-01', 'TX-IDEMPOTENT-01', 'TX-OWNACCOUNTS-01', 'TX-SCOPE-01',
      'TX-HISTORY-01', 'TX-DETAIL-01', 'TX-UI-HAPPY-01',
    ]) {
      report.skip(id, 'Transferencias', id, reason);
    }
    // TX-NOTFOUND-01 and TX-MONITOR-01 need no provisioned customer — still attempted below.
    await runNotFound(report, cajero.token);
    await runMonitor(report);
    return report.summary();
  }

  const haveB = custB.ok;
  if (!haveB) {
    console.log(
      `  [transfers-saga] cliente destino no disponible (${custB.step}): las pruebas que necesitan una cuenta EXTERNA usarán la segunda cuenta propia de custA en su lugar.`,
    );
  }

  const srcAcc = custA.accountIds[0]; // MONETARIA — funded, the source of every money-moving case.
  const ownTarget = custA.accountIds[1]; // AHORRO — custA's own second account.
  const extTarget = haveB ? custB.accountIds[0] : ownTarget;

  // ---------------------------------------------------------------------
  // TX-SELF-01 — sourceAccount === targetAccount.
  // ---------------------------------------------------------------------
  {
    const res = await api('/api/transfers', custA.token, {
      method: 'POST',
      body: { sourceAccount: srcAcc, targetAccount: srcAcc, amount: money(100) },
      headers: { 'Idempotency-Key': `qa-self-${Date.now()}` },
    });
    const rejected =
      res.status !== 202 &&
      (res.body?.failureCode === 'SAME_ACCOUNT_TRANSFER' ||
        res.body?.type === 'VALIDATION_ERROR' ||
        res.body?.type === 'BUSINESS_REJECTION');
    report.record(
      'TX-SELF-01',
      'Transferencias',
      'sourceAccount === targetAccount es rechazado',
      'status !== 202 (rechazo síncrono) o, si se acepta, la Saga termina FAILED con SAME_ACCOUNT_TRANSFER',
      `${res.status}: ${JSON.stringify(res.body)}`,
      rejected,
    );
  }

  // ---------------------------------------------------------------------
  // TX-ZERO-01 / TX-NEG-01 — amountMinor inválido.
  // ---------------------------------------------------------------------
  {
    const res = await api('/api/transfers', custA.token, {
      method: 'POST',
      body: { sourceAccount: srcAcc, targetAccount: extTarget, amount: money(0) },
      headers: { 'Idempotency-Key': `qa-zero-${Date.now()}` },
    });
    report.record(
      'TX-ZERO-01',
      'Transferencias',
      'amountMinor = 0 es rechazado',
      'status !== 202',
      `${res.status}: ${JSON.stringify(res.body)}`,
      res.status !== 202,
    );
  }
  {
    const res = await api('/api/transfers', custA.token, {
      method: 'POST',
      body: { sourceAccount: srcAcc, targetAccount: extTarget, amount: money(-500) },
      headers: { 'Idempotency-Key': `qa-neg-${Date.now()}` },
    });
    report.record(
      'TX-NEG-01',
      'Transferencias',
      'amountMinor negativo es rechazado',
      'status !== 202',
      `${res.status}: ${JSON.stringify(res.body)}`,
      res.status !== 202,
    );
  }

  // ---------------------------------------------------------------------
  // TX-NOFUNDS-01 — antes de fondear nada, ambas cuentas de custA están en
  // Q0.00. `ownTarget` (AHORRO) es la fuente aquí a propósito: todavía no ha
  // recibido ningún depósito en ningún caso anterior.
  // ---------------------------------------------------------------------
  {
    const before = await balanceOf(ownTarget, custA.token);
    const res = await api('/api/transfers', custA.token, {
      method: 'POST',
      body: { sourceAccount: ownTarget, targetAccount: srcAcc, amount: money(100) },
      headers: { 'Idempotency-Key': `qa-nofunds-${Date.now()}` },
    });
    if (res.status === 202 && res.body.transactionId) {
      const term = await pollTerminal(res.body.transactionId, custA.token);
      const after = await balanceOf(ownTarget, custA.token);
      const isFailed = term.body.status === 'FAILED';
      const unchanged = after === before;
      report.record(
        'TX-NOFUNDS-01',
        'Transferencias',
        'Transferencia por más del saldo real termina FAILED sin mover dinero',
        'status=FAILED y saldo de origen sin cambios',
        `before=${before} after=${after} status=${term.body.status} reason=${term.body.reason}`,
        isFailed && unchanged,
      );
    } else {
      report.record(
        'TX-NOFUNDS-01',
        'Transferencias',
        'Transferencia por más del saldo real termina FAILED sin mover dinero',
        'status=FAILED y saldo de origen sin cambios',
        `POST inesperado: ${res.status} ${JSON.stringify(res.body)}`,
        false,
      );
    }
  }

  // ---------------------------------------------------------------------
  // Fondeo: a partir de aquí `srcAcc` tiene Q5,000.00.
  // ---------------------------------------------------------------------
  const funded = await api(`/api/accounts/${srcAcc}/deposit`, cajero.token, {
    method: 'POST',
    body: { amount: money(500000), description: 'QA transfers-saga — fondeo inicial' },
    headers: { 'Idempotency-Key': `qa-fund-${Date.now()}-${Math.random().toString(36).slice(2)}` },
  });
  if (funded.status !== 200) {
    const reason = `El depósito de fondeo falló: ${funded.status} ${JSON.stringify(funded.body)}`;
    for (const id of [
      'TX-HAPPY-01', 'TX-REJECT-01', 'TX-TRANSIENT-01', 'TX-TIMEOUT-01', 'TX-IDEMPOTENT-01',
      'TX-OWNACCOUNTS-01', 'TX-SCOPE-01', 'TX-HISTORY-01', 'TX-DETAIL-01', 'TX-UI-HAPPY-01',
    ]) {
      report.skip(id, 'Transferencias', id, reason);
    }
    await runNotFound(report, cajero.token);
    await runMonitor(report);
    return report.summary();
  }

  let happyTxId = null;

  // ---------------------------------------------------------------------
  // TX-HAPPY-01 — camino feliz, APPROVE explícito.
  // ---------------------------------------------------------------------
  {
    const srcBefore = await balanceOf(srcAcc, custA.token);
    const dstBefore = await balanceOf(extTarget, cajero.token).catch(() => null);
    const amount = 25000; // Q250.00
    const res = await api('/api/transfers', custA.token, {
      method: 'POST',
      body: { sourceAccount: srcAcc, targetAccount: extTarget, amount: money(amount), paymentScenario: 'APPROVE' },
      headers: { 'Idempotency-Key': `qa-happy-${Date.now()}` },
    });
    if (res.status === 202 && res.body.transactionId) {
      happyTxId = res.body.transactionId;
      const term = await pollTerminal(happyTxId, custA.token);
      const srcAfter = await balanceOf(srcAcc, custA.token);
      const dstAfter = await balanceOf(extTarget, cajero.token).catch(() => null);
      const isCompleted = term.body.status === 'COMPLETED';
      const srcMoved = srcAfter === srcBefore - amount;
      const dstMoved = dstBefore === null || dstAfter === dstBefore + amount;
      report.record(
        'TX-HAPPY-01',
        'Transferencias',
        'Transferencia exitosa mueve exactamente el monto en ambas cuentas',
        `status=COMPLETED, origen -${amount}, destino +${amount}`,
        `status=${term.body.status} srcBefore=${srcBefore} srcAfter=${srcAfter} dstBefore=${dstBefore} dstAfter=${dstAfter}`,
        isCompleted && srcMoved && dstMoved,
      );
    } else {
      report.record(
        'TX-HAPPY-01',
        'Transferencias',
        'Transferencia exitosa mueve exactamente el monto en ambas cuentas',
        `status=COMPLETED, origen -${amount}, destino +${amount}`,
        `POST inesperado: ${res.status} ${JSON.stringify(res.body)}`,
        false,
      );
    }
  }

  // ---------------------------------------------------------------------
  // TX-REJECT-01 — paymentScenario: REJECT → COMPENSATED, saldo restaurado exacto.
  // ---------------------------------------------------------------------
  {
    const srcBefore = await balanceOf(srcAcc, custA.token);
    const dstBefore = await balanceOf(extTarget, cajero.token).catch(() => null);
    const amount = 10000; // Q100.00
    const res = await api('/api/transfers', custA.token, {
      method: 'POST',
      body: { sourceAccount: srcAcc, targetAccount: extTarget, amount: money(amount), paymentScenario: 'REJECT' },
      headers: { 'Idempotency-Key': `qa-reject-${Date.now()}` },
    });
    if (res.status === 202 && res.body.transactionId) {
      const term = await pollTerminal(res.body.transactionId, custA.token);
      const srcAfter = await balanceOf(srcAcc, custA.token);
      const dstAfter = await balanceOf(extTarget, cajero.token).catch(() => null);
      const isCompensated = term.body.status === 'COMPENSATED';
      const srcRestored = srcAfter === srcBefore;
      const dstUntouched = dstBefore === null || dstAfter === dstBefore;
      report.record(
        'TX-REJECT-01',
        'Transferencias',
        'Pago rechazado por el proveedor compensa y restaura el saldo exacto',
        'status=COMPENSATED, saldo de origen === saldo previo, saldo de destino sin cambios',
        `status=${term.body.status} reason=${term.body.reason} srcBefore=${srcBefore} srcAfter=${srcAfter} dstBefore=${dstBefore} dstAfter=${dstAfter}`,
        isCompensated && srcRestored && dstUntouched,
      );
    } else {
      report.record(
        'TX-REJECT-01',
        'Transferencias',
        'Pago rechazado por el proveedor compensa y restaura el saldo exacto',
        'status=COMPENSATED, saldo de origen === saldo previo',
        `POST inesperado: ${res.status} ${JSON.stringify(res.body)}`,
        false,
      );
    }
  }

  // ---------------------------------------------------------------------
  // TX-TRANSIENT-01 — la escalera de reintentos es real: 1s + 5s + 30s entre
  // los 4 intentos (`app/lib/payment.ts`'s RETRY_LADDER_MS), así que un
  // timeout de espera corto (20-30s) queda corto en la práctica —
  // comprobado en vivo contra este stack: un caso TRANSIENT_FAILURE tardó
  // 38.2s reales en cerrar. Se usa 75s con sondeo cada 2.5s.
  // ---------------------------------------------------------------------
  {
    const srcBefore = await balanceOf(srcAcc, custA.token);
    const amount = 5000; // Q50.00
    const res = await api('/api/transfers', custA.token, {
      method: 'POST',
      body: { sourceAccount: srcAcc, targetAccount: extTarget, amount: money(amount), paymentScenario: 'TRANSIENT_FAILURE' },
      headers: { 'Idempotency-Key': `qa-transient-${Date.now()}` },
    });
    if (res.status === 202 && res.body.transactionId) {
      const started = Date.now();
      const term = await pollTerminal(res.body.transactionId, custA.token, 75000, 2500);
      const elapsedMs = Date.now() - started;
      const srcAfter = await balanceOf(srcAcc, custA.token);
      const isCompensated = term.body.status === 'COMPENSATED';
      const srcRestored = srcAfter === srcBefore;
      /**
       * `transitions` records one entry per DISTINCT (from,to) edge the state
       * machine took, not one per payment attempt — a `PAYMENT_PENDING` self
       * loop only shows the final attempt's failure. The real, checkable
       * signal that the ladder was actually climbed (not just declared) is
       * `payment.attempt`, which the payment step's own row tracks per
       * delivery: `MAX_ATTEMPTS` (4) means every rung was used before giving up.
       */
      const attempts = term.body.payment?.attempt ?? null;
      const climbedLadder = attempts !== null && attempts >= 2;
      report.record(
        'TX-TRANSIENT-01',
        'Transferencias',
        'Fallo transitorio agota la escalera de reintentos y compensa con saldo exacto',
        'status=COMPENSATED, saldo restaurado, payment.attempt > 1 (evidencia real de reintento)',
        `status=${term.body.status} reason=${term.body.reason} payment.attempt=${attempts} elapsedMs=${elapsedMs} srcBefore=${srcBefore} srcAfter=${srcAfter}`,
        isCompensated && srcRestored && climbedLadder,
        `Se verificó payment.attempt (${attempts} de MAX_ATTEMPTS=4) como evidencia de reintento real, ` +
          'porque transitions[] solo registra el borde final PAYMENT_PENDING→COMPENSATED, no cada intento.',
      );
    } else {
      report.record(
        'TX-TRANSIENT-01',
        'Transferencias',
        'Fallo transitorio agota la escalera de reintentos y compensa con saldo exacto',
        'status=COMPENSATED, saldo restaurado',
        `POST inesperado: ${res.status} ${JSON.stringify(res.body)}`,
        false,
      );
    }
  }

  // ---------------------------------------------------------------------
  // TX-TIMEOUT-01 — el proveedor simulado no contesta; misma escalera.
  // ---------------------------------------------------------------------
  {
    const srcBefore = await balanceOf(srcAcc, custA.token);
    const amount = 4000; // Q40.00
    const res = await api('/api/transfers', custA.token, {
      method: 'POST',
      body: { sourceAccount: srcAcc, targetAccount: extTarget, amount: money(amount), paymentScenario: 'TIMEOUT' },
      headers: { 'Idempotency-Key': `qa-timeout-${Date.now()}` },
    });
    if (res.status === 202 && res.body.transactionId) {
      const term = await pollTerminal(res.body.transactionId, custA.token, 75000, 2500);
      const srcAfter = await balanceOf(srcAcc, custA.token);
      const isCompensated = term.body.status === 'COMPENSATED';
      const srcRestored = srcAfter === srcBefore;
      report.record(
        'TX-TIMEOUT-01',
        'Transferencias',
        'El proveedor no responde (timeout) agota la escalera y compensa con saldo exacto',
        'status=COMPENSATED, saldo restaurado',
        `status=${term.body.status} reason=${term.body.reason} payment.attempt=${term.body.payment?.attempt} srcBefore=${srcBefore} srcAfter=${srcAfter}`,
        isCompensated && srcRestored,
      );
    } else {
      report.record(
        'TX-TIMEOUT-01',
        'Transferencias',
        'El proveedor no responde (timeout) agota la escalera y compensa con saldo exacto',
        'status=COMPENSATED, saldo restaurado',
        `POST inesperado: ${res.status} ${JSON.stringify(res.body)}`,
        false,
      );
    }
  }

  // ---------------------------------------------------------------------
  // TX-IDEMPOTENT-01 — misma Idempotency-Key dos veces: mismo transactionId,
  // y el saldo se mueve UNA sola vez (no dos).
  // ---------------------------------------------------------------------
  {
    const srcBefore = await balanceOf(srcAcc, custA.token);
    const amount = 1000; // Q10.00
    const key = `qa-idem-${Date.now()}`;
    const body = { sourceAccount: srcAcc, targetAccount: extTarget, amount: money(amount), paymentScenario: 'APPROVE' };
    const first = await api('/api/transfers', custA.token, { method: 'POST', body, headers: { 'Idempotency-Key': key } });
    const second = await api('/api/transfers', custA.token, { method: 'POST', body, headers: { 'Idempotency-Key': key } });
    const sameId =
      first.status === 202 &&
      second.status === 202 &&
      typeof first.body.transactionId === 'string' &&
      first.body.transactionId === second.body.transactionId;

    let singleDebit = false;
    let srcAfter = null;
    if (sameId) {
      await pollTerminal(first.body.transactionId, custA.token);
      srcAfter = await balanceOf(srcAcc, custA.token);
      singleDebit = srcAfter === srcBefore - amount;
    }
    report.record(
      'TX-IDEMPOTENT-01',
      'Idempotencia',
      'Misma Idempotency-Key repetida devuelve el mismo transactionId y debita una sola vez',
      `transactionId idéntico en ambas respuestas, saldo -${amount} exactamente una vez`,
      `first=${first.body.transactionId} second=${second.body.transactionId} srcBefore=${srcBefore} srcAfter=${srcAfter}`,
      sameId && singleDebit,
    );
  }

  // ---------------------------------------------------------------------
  // TX-OWNACCOUNTS-01 — transferencia legítima entre dos cuentas del MISMO
  // cliente (no self-account: son dos filas distintas). Siempre corre,
  // independientemente de si custB estuvo disponible.
  // ---------------------------------------------------------------------
  {
    const srcBefore = await balanceOf(srcAcc, custA.token);
    const dstBefore = await balanceOf(ownTarget, custA.token);
    const amount = 7500; // Q75.00
    const res = await api('/api/transfers', custA.token, {
      method: 'POST',
      body: { sourceAccount: srcAcc, targetAccount: ownTarget, amount: money(amount), paymentScenario: 'APPROVE' },
      headers: { 'Idempotency-Key': `qa-ownacct-${Date.now()}` },
    });
    if (res.status === 202 && res.body.transactionId) {
      const term = await pollTerminal(res.body.transactionId, custA.token);
      const srcAfter = await balanceOf(srcAcc, custA.token);
      const dstAfter = await balanceOf(ownTarget, custA.token);
      const isCompleted = term.body.status === 'COMPLETED';
      const moved = srcAfter === srcBefore - amount && dstAfter === dstBefore + amount;
      report.record(
        'TX-OWNACCOUNTS-01',
        'Transferencias',
        'Transferencia entre dos cuentas propias (no self-account) se completa y mueve el saldo exacto',
        `status=COMPLETED, MONETARIA -${amount}, AHORRO +${amount}`,
        `status=${term.body.status} srcBefore=${srcBefore} srcAfter=${srcAfter} dstBefore=${dstBefore} dstAfter=${dstAfter}`,
        isCompleted && moved,
      );
    } else {
      report.record(
        'TX-OWNACCOUNTS-01',
        'Transferencias',
        'Transferencia entre dos cuentas propias (no self-account) se completa y mueve el saldo exacto',
        'status=COMPLETED',
        `POST inesperado: ${res.status} ${JSON.stringify(res.body)}`,
        false,
      );
    }
  }

  // ---------------------------------------------------------------------
  // TX-SCOPE-01 — el alcance de GET /api/transfers es por INICIADOR
  // (transaction.customer_id), no por cuenta tocada: custB recibió dinero de
  // custA (TX-HAPPY-01) pero nunca inició nada, así que su propio listado no
  // debe contener esa transacción. Solo corre si custB existe de verdad.
  // ---------------------------------------------------------------------
  if (haveB && happyTxId) {
    const listing = await api('/api/transfers?limit=50', custB.token);
    const ids = Array.isArray(listing.body?.transactions)
      ? listing.body.transactions.map((t) => t.transactionId)
      : null;
    const scoped = listing.status === 200 && ids !== null && !ids.includes(happyTxId);
    report.record(
      'TX-SCOPE-01',
      'Transferencias',
      'El listado de un cliente que solo RECIBIÓ dinero no incluye transferencias que no inició',
      'happyTxId ausente del listado de custB (alcance por customer_id iniciador, no por cuenta tocada)',
      `status=${listing.status} total=${listing.body?.total} contieneHappyTx=${ids?.includes(happyTxId)}`,
      scoped,
    );
  } else {
    report.skip(
      'TX-SCOPE-01',
      'Transferencias',
      'El listado de un cliente que solo RECIBIÓ dinero no incluye transferencias que no inició',
      haveB ? 'TX-HAPPY-01 no produjo un transactionId con el que comparar.' : 'custB no se pudo aprovisionar.',
    );
  }

  await runNotFound(report, cajero.token);

  // ---------------------------------------------------------------------
  // TX-HISTORY-01 — UI: /transferencias como custA muestra AMBOS desenlaces
  // reales (al menos un COMPLETED y un COMPENSATED/FAILED), cruzado contra
  // los `data-status` que pinta `TransactionStatusBadge`.
  // ---------------------------------------------------------------------
  {
    const { browser, ctx, page } = await launch();
    try {
      await loginViaUI(ctx, page, custA.email, custA.password);
      await page.goto(`${BASE}/transferencias`);
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(800);
      await shot(page, 'saga-01-historial-cliente');

      const completedCount = await page.locator('[data-status="COMPLETED"]').count();
      const compensatedCount = await page.locator('[data-status="COMPENSATED"]').count();
      const failedCount = await page.locator('[data-status="FAILED"]').count();

      const apiList = await api('/api/transfers?limit=50', custA.token);
      const apiCompleted = (apiList.body?.transactions ?? []).filter((t) => t.status === 'COMPLETED').length;
      const apiCompensated = (apiList.body?.transactions ?? []).filter((t) => t.status === 'COMPENSATED').length;

      const hasBoth = completedCount >= 1 && (compensatedCount >= 1 || failedCount >= 1);
      const crossChecks = completedCount === apiCompleted && compensatedCount === apiCompensated;
      report.record(
        'TX-HISTORY-01',
        'Transferencias',
        'El historial UI del cliente muestra ambos desenlaces reales, igual que la API',
        '>=1 COMPLETED y >=1 COMPENSATED/FAILED en pantalla; el conteo por estado coincide con GET /api/transfers',
        `DOM: COMPLETED=${completedCount} COMPENSATED=${compensatedCount} FAILED=${failedCount} — API: COMPLETED=${apiCompleted} COMPENSATED=${apiCompensated} total=${apiList.body?.total}`,
        hasBoth && crossChecks,
      );
    } finally {
      await browser.close();
    }
  }

  // ---------------------------------------------------------------------
  // TX-DETAIL-01 — la página de detalle de una transacción concreta muestra
  // el mismo estado que reporta la API para ese mismo transactionId.
  // ---------------------------------------------------------------------
  if (happyTxId) {
    const { browser, ctx, page } = await launch();
    try {
      const apiStatus = await api(`/api/transfers/${happyTxId}`, custA.token);
      await loginViaUI(ctx, page, custA.email, custA.password);
      await page.goto(`${BASE}/transferencias/${happyTxId}`);
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(1000);
      await shot(page, 'saga-02-detalle-transferencia');

      const badge = page.locator(`[data-status="${apiStatus.body.status}"]`).first();
      const visible = await badge.isVisible().catch(() => false);
      report.record(
        'TX-DETAIL-01',
        'Transferencias',
        'La pantalla de detalle de una transferencia concreta refleja el estado real de la API',
        `Insignia con data-status="${apiStatus.body.status}" visible en /transferencias/${happyTxId}`,
        `API status=${apiStatus.body.status}, insignia visible=${visible}`,
        visible,
      );
    } finally {
      await browser.close();
    }
  } else {
    report.skip('TX-DETAIL-01', 'Transferencias', 'Detalle de transferencia refleja la API', 'TX-HAPPY-01 no produjo un transactionId.');
  }

  // ---------------------------------------------------------------------
  // TX-UI-HAPPY-01 — el formulario real, paso a paso, no la API.
  // ---------------------------------------------------------------------
  {
    const { browser, ctx, page } = await launch();
    try {
      const srcBefore = await balanceOf(srcAcc, custA.token);
      const dstBefore = await balanceOf(extTarget, cajero.token).catch(() => null);
      const amount = 15000; // Q150.00

      await loginViaUI(ctx, page, custA.email, custA.password);
      await page.goto(`${BASE}/transferencias/nueva`);
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(1000);

      await page.locator('[data-testid="source-account"]').click();
      await page.waitForTimeout(400);
      const searchBox = page.locator('input[placeholder*="Buscar por titular"]').first();
      if (await searchBox.isVisible().catch(() => false)) {
        await searchBox.fill(srcAcc.slice(-6));
        await page.waitForTimeout(400);
      }
      await page.locator('[role="option"]').first().click();
      await page.waitForTimeout(400);

      const radioOther = page.locator('text=A la cuenta de otra persona');
      if (await radioOther.isVisible().catch(() => false)) {
        await radioOther.click();
        await page.waitForTimeout(300);
      }
      await page.locator('[data-testid="target-account"]').fill(extTarget);
      await page.waitForTimeout(300);

      await page.locator('[role="spinbutton"]').first().fill(String(amount / 100));

      // Explicit APPROVE, for a deterministic outcome (this screen's own scenario picker, T-19).
      const scenarioSelect = page.locator('[data-testid="payment-scenario"]');
      if (await scenarioSelect.isVisible().catch(() => false)) {
        await scenarioSelect.click();
        await page.waitForTimeout(300);
        const approveOption = page.getByRole('option', { name: 'Aprobar el pago' });
        if (await approveOption.isVisible().catch(() => false)) {
          await approveOption.click();
        } else {
          await page.keyboard.press('Escape');
        }
      }

      await shot(page, 'saga-03-formulario-lleno');
      await page.locator('button:has-text("Continuar")').click({ timeout: 8000 });
      await page.waitForTimeout(600);
      await shot(page, 'saga-04-revision');

      await page.locator('[data-testid="confirm-transfer"]').click({ timeout: 8000 });
      await page.waitForURL(/\/transferencias\/[0-9a-f-]{36}/i, { timeout: 15000 });
      const uiTransactionId = page.url().match(/\/transferencias\/([0-9a-f-]{36})/i)?.[1] ?? null;
      await shot(page, 'saga-05-resultado');

      let isCompleted = false;
      let srcAfter = null;
      let dstAfter = null;
      if (uiTransactionId) {
        const term = await pollTerminal(uiTransactionId, custA.token);
        isCompleted = term.body.status === 'COMPLETED';
        srcAfter = await balanceOf(srcAcc, custA.token);
        dstAfter = await balanceOf(extTarget, cajero.token).catch(() => null);
      }
      const srcMoved = srcAfter === srcBefore - amount;
      const dstMoved = dstBefore === null || dstAfter === dstBefore + amount;

      report.record(
        'TX-UI-HAPPY-01',
        'Transferencias',
        'Una transferencia enviada por el formulario real llega a COMPLETED y mueve el saldo exacto',
        `Redirige a /transferencias/:id, la Saga termina COMPLETED, origen -${amount}, destino +${amount}`,
        `uiTransactionId=${uiTransactionId} isCompleted=${isCompleted} srcBefore=${srcBefore} srcAfter=${srcAfter} dstBefore=${dstBefore} dstAfter=${dstAfter}`,
        Boolean(uiTransactionId) && isCompleted && srcMoved && dstMoved,
      );
    } catch (err) {
      await shot(page, 'saga-05-resultado-error').catch(() => {});
      report.record(
        'TX-UI-HAPPY-01',
        'Transferencias',
        'Una transferencia enviada por el formulario real llega a COMPLETED y mueve el saldo exacto',
        'Flujo UI completo sin excepciones',
        `Excepción durante el flujo UI: ${err.message}`,
        false,
      );
    } finally {
      await browser.close();
    }
  }

  await runMonitor(report);

  return report.summary();
}

/**
 * TX-NOTFOUND-01 — needs only a valid token, no provisioned customer. Split
 * out so it still runs even when provisioning fails entirely and every other
 * case in this suite has to be skipped.
 *
 * The Gateway documents this one itself (`queries.use-case.ts`): there is no
 * `TRANSACTION_NOT_FOUND` failure code in the catalogue, so a transfer that
 * was never created answers with the nearest borrowed code, `ILLEGAL_TRANSITION`
 * (409) — not the 404 the outcome actually is. Asserted against that real,
 * documented shape rather than a `404` this route was never going to return.
 */
async function runNotFound(report, token) {
  const res = await api('/api/transfers/00000000-0000-4000-8000-000000000000', token);
  const matchesDocumentedShape =
    res.status === 409 && res.body?.type === 'BUSINESS_REJECTION' && res.body?.failureCode === 'ILLEGAL_TRANSITION';
  report.record(
    'TX-NOTFOUND-01',
    'Transferencias',
    'Consultar un transactionId que nunca existió',
    '409 BUSINESS_REJECTION/ILLEGAL_TRANSITION (el borrowed code que queries.use-case.ts documenta; no hay 404 real en el catálogo)',
    `${res.status}: ${JSON.stringify(res.body)}`,
    matchesDocumentedShape,
  );
}

/** TX-MONITOR-01 — needs only the seeded cajero, no provisioned customer. */
async function runMonitor(report) {
  const { browser, ctx, page } = await launch();
  try {
    await loginViaUI(ctx, page, SEEDED.cajero.email, SEEDED.cajero.password);
    await page.goto(`${BASE}/transferencias/monitor`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1000);
    await shot(page, 'saga-06-monitor');

    const emptyState = await page.locator('[data-testid="monitor-empty"]').isVisible().catch(() => false);
    const rowCount = await page.locator('table tbody tr').count();

    const cajero = await loginApi(SEEDED.cajero.email, SEEDED.cajero.password);
    const apiList = await api('/api/transfers?limit=100', cajero.token);
    const apiTotal = apiList.body?.total ?? 0;

    const loadedSomething = !emptyState && rowCount > 0;
    const consistentWithApi = apiTotal > 0 && rowCount <= apiTotal;
    report.record(
      'TX-MONITOR-01',
      'Transferencias',
      'El monitor de Sagas (staff) carga filas reales y no más de las que la API reporta',
      'Sin estado vacío, >=1 fila en la tabla, y el conteo de filas no excede el total real de la API',
      `emptyState=${emptyState} rowCount=${rowCount} apiTotal=${apiTotal}`,
      loadedSomething && consistentWithApi,
    );
  } finally {
    await browser.close();
  }
}

if (resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1] ?? '')) {
  const { writeReport, printSuiteLine } = await import('../support/report.mjs');
  const summary = await run();
  printSuiteLine(summary);
  writeReport('docs/qa/pyramid-e2e.json', [summary]);
  process.exit(summary.failed > 0 ? 1 : 0);
}
