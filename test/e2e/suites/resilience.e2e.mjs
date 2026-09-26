import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
/**
 * resilience — the system's behaviour under bad input and concurrent load.
 *
 * No browser: every case here is pure `fetch`/`api()` against the Gateway.
 * The point is not "does it crash" (nothing here should ever 500 or hang) but
 * "does it degrade in a controlled, documented shape" — a malformed body gets
 * a 400, an unknown route gets a 404, and money under a race lands exactly
 * once, never zero and never twice.
 */
import { GW, SEEDED, api, loginApi, waitForStatus } from '../support/gateway.mjs';
import { provisionCustomer } from '../support/seed.mjs';
import { Report } from '../support/report.mjs';

/**
 * `provisionCustomer` recovers its activation link by scanning the shared
 * dev-host log for the most recent `/activar?token=...` line — not one
 * scoped to this call's own correlationId. Run alongside other suites that
 * are registering customers at the same time (this repo's E2E suites are
 * eight parallel files sharing one stack) and that race is observable: this
 * call's log scrape can return a token minted by a different suite's
 * registration a moment later, which then fails downstream as
 * ACTIVATION_TOKEN_INVALID rather than as this call's own failure. A bounded
 * retry is the honest way to route around a shared-fixture race without
 * touching `seed.mjs`, which this suite does not own.
 */
async function provisionWithRetry(opts, attempts = 5) {
  let last = null;
  for (let i = 0; i < attempts; i += 1) {
    last = await provisionCustomer(opts);
    if (last.ok) return last;
    // A small, randomised pause so a retry does not land in the exact same
    // window of another suite's registration burst it just collided with.
    await new Promise((wake) => setTimeout(wake, 500 + Math.random() * 1000));
  }
  return last;
}

export async function run() {
  const report = new Report('resilience');

  try {
    // RES-01 (MALFORMED-BODY-01) — a syntactically-broken JSON body must not
    // produce a 500 or a hung connection. Uses raw fetch to bypass api()'s
    // auto-serialization, which would otherwise silently fix the body.
    const cliente = await loginApi(SEEDED.cliente.email, SEEDED.cliente.password);
    if (!cliente.token) {
      throw new Error(`No se pudo autenticar al cliente sembrado: ${JSON.stringify(cliente.data)}`);
    }
    const malformedRes = await fetch(`${GW}/api/transfers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cliente.token}` },
      body: '{not valid json',
    });
    const malformedBody = await malformedRes.json().catch(() => ({}));
    report.record(
      'MALFORMED-BODY-01',
      'Resiliencia',
      'POST /api/transfers con un cuerpo JSON sintácticamente inválido',
      '400, no 500 y no una conexión colgada',
      `${malformedRes.status}: ${JSON.stringify(malformedBody)}`,
      malformedRes.status === 400,
    );

    // RES-02 (MISSING-FIELD-01) — a valid JSON body missing a required field
    // (targetAccount) must be a real 400 VALIDATION_ERROR, not a 500 from a
    // route that assumed the field was there.
    const missingField = await api('/api/transfers', cliente.token, {
      method: 'POST',
      body: {
        sourceAccount: '11111111-1111-4111-8111-111111111111',
        // targetAccount omitted on purpose
        amount: { amountMinor: 100, currency: 'GTQ' },
      },
    });
    report.record(
      'MISSING-FIELD-01',
      'Resiliencia',
      'POST /api/transfers con targetAccount omitido',
      '400 VALIDATION_ERROR',
      `${missingField.status}: ${missingField.body.type ?? ''}`,
      missingField.status === 400 && missingField.body.type === 'VALIDATION_ERROR',
    );

    // RES-03 (UNKNOWN-ROUTE-01) — a route that matches nothing must be a real
    // 404, not a 500 and not a redirect that silently "succeeds".
    const unknown = await api('/api/this-route-does-not-exist-abcxyz', cliente.token);
    report.record(
      'UNKNOWN-ROUTE-01',
      'Resiliencia',
      'GET a una ruta que no existe',
      '404, no 500 y no una redirección',
      `${unknown.status}: ${JSON.stringify(unknown.body)}`,
      unknown.status === 404,
    );

    // Provision one funded customer for the two race cases below. Both need a
    // real account and a real cajero to act on it.
    const cajero = await loginApi(SEEDED.cajero.email, SEEDED.cajero.password);
    if (!cajero.token) {
      throw new Error(`No se pudo autenticar al cajero sembrado: ${JSON.stringify(cajero.data)}`);
    }

    const source = await provisionWithRetry({ label: 'resilience-src' });
    if (!source.ok) {
      report.skip(
        'CONCURRENT-DEPOSIT-RACE-01',
        'Resiliencia',
        'Depósito concurrente con la misma Idempotency-Key',
        `No se pudo aprovisionar el cliente de origen: paso=${source.step} detalle=${source.detail}`,
      );
      report.skip(
        'INVALID-CURRENCY-01',
        'Resiliencia',
        'Depósito con una moneda distinta de GTQ',
        `No se pudo aprovisionar el cliente de origen: paso=${source.step} detalle=${source.detail}`,
      );
      report.skip(
        'CONCURRENT-TRANSFER-RACE-01',
        'Resiliencia',
        'Dos transferencias concurrentes que sobregirarían la cuenta',
        `No se pudo aprovisionar el cliente de origen: paso=${source.step} detalle=${source.detail}`,
      );
      return report.summary();
    }
    const sourceAccountId = source.accountIds[0];

    const beforeRace = await api(`/api/accounts/${sourceAccountId}/balance`, cajero.token);
    const beforeAmountMinor = beforeRace.body.balance?.amountMinor;
    console.log(
      `  [resilience] CONCURRENT-DEPOSIT-RACE-01 saldo antes: ${JSON.stringify(beforeRace.body.balance)}`,
    );

    // RES-04 (CONCURRENT-DEPOSIT-RACE-01) — two simultaneous deposits, the
    // exact same Idempotency-Key and the exact same body, at the same
    // account. Account Service dedups on (idempotency_key, message_type)
    // before any balance moves, so both responses must report the same
    // underlying movement and the balance must reflect exactly one deposit.
    const depositKey = `resilience-deposit-race-${sourceAccountId}`;
    const depositBody = { amount: { amountMinor: 10000, currency: 'GTQ' } };
    const [depositA, depositB] = await Promise.all([
      api(`/api/accounts/${sourceAccountId}/deposit`, cajero.token, {
        method: 'POST',
        headers: { 'Idempotency-Key': depositKey },
        body: depositBody,
      }),
      api(`/api/accounts/${sourceAccountId}/deposit`, cajero.token, {
        method: 'POST',
        headers: { 'Idempotency-Key': depositKey },
        body: depositBody,
      }),
    ]);
    console.log(
      `  [resilience] CONCURRENT-DEPOSIT-RACE-01 respuesta A: ${depositA.status} operationId=${depositA.body.operationId} balanceAfter=${JSON.stringify(depositA.body.balanceAfter)}`,
    );
    console.log(
      `  [resilience] CONCURRENT-DEPOSIT-RACE-01 respuesta B: ${depositB.status} operationId=${depositB.body.operationId} balanceAfter=${JSON.stringify(depositB.body.balanceAfter)}`,
    );

    const afterRace = await api(`/api/accounts/${sourceAccountId}/balance`, cajero.token);
    console.log(
      `  [resilience] CONCURRENT-DEPOSIT-RACE-01 saldo después: ${JSON.stringify(afterRace.body.balance)}`,
    );

    const sameOperationId =
      typeof depositA.body.operationId === 'string' &&
      depositA.body.operationId === depositB.body.operationId;
    const expectedAfterOneDeposit = beforeAmountMinor + depositBody.amount.amountMinor;
    const balanceReflectsExactlyOne = afterRace.body.balance?.amountMinor === expectedAfterOneDeposit;
    report.record(
      'CONCURRENT-DEPOSIT-RACE-01',
      'Resiliencia',
      'Dos depósitos simultáneos con la misma Idempotency-Key y el mismo cuerpo',
      `Mismo operationId en ambas respuestas; saldo final = saldo previo (${beforeAmountMinor}) + un depósito (${depositBody.amount.amountMinor}) = ${expectedAfterOneDeposit}`,
      `A.status=${depositA.status} B.status=${depositB.status} A.operationId=${depositA.body.operationId} B.operationId=${depositB.body.operationId} saldoFinal=${afterRace.body.balance?.amountMinor}`,
      depositA.status === 200 &&
        depositB.status === 200 &&
        sameOperationId &&
        balanceReflectsExactlyOne,
      'El campo real del contrato es operationId (DepositResult), no movementId — no existe ningún campo movementId en la respuesta.',
    );

    // RES-05 (INVALID-CURRENCY-01) — a deposit in a currency that is not GTQ
    // must be rejected with a real 4xx, never silently accepted. account-service's
    // domain/money.ts only ever recognises CURRENCY = 'GTQ' (amountProblem ->
    // INVALID_AMOUNT_PRECISION -> 422 per failure-code-table.ts).
    const invalidCurrency = await api(`/api/accounts/${sourceAccountId}/deposit`, cajero.token, {
      method: 'POST',
      headers: { 'Idempotency-Key': `resilience-invalid-currency-${sourceAccountId}` },
      body: { amount: { amountMinor: 5000, currency: 'USD' } },
    });
    report.record(
      'INVALID-CURRENCY-01',
      'Resiliencia',
      'Depósito con una moneda distinta de GTQ (USD)',
      '4xx (no 200, no aceptado silenciosamente)',
      `${invalidCurrency.status}: ${JSON.stringify(invalidCurrency.body)}`,
      invalidCurrency.status >= 400 && invalidCurrency.status < 500,
    );

    // RES-06 (CONCURRENT-TRANSFER-RACE-01) — the source account now holds
    // exactly one deposit (balanceReflectsExactlyOne, above). Fire two
    // simultaneous transfers that would together overdraw it if both
    // succeeded, and prove at most one completes and the balance never goes
    // negative. Each transfer gets its own idempotency key (omitted, so the
    // Gateway mints one) because these must be two genuinely different Saga
    // instances, not a replay of the same one.
    const target = await provisionWithRetry({ label: 'resilience-dst' });
    if (!target.ok) {
      report.skip(
        'CONCURRENT-TRANSFER-RACE-01',
        'Resiliencia',
        'Dos transferencias concurrentes que sobregirarían la cuenta',
        `No se pudo aprovisionar el cliente de destino: paso=${target.step} detalle=${target.detail}`,
      );
    } else {
      const targetAccountId = target.accountIds[0];
      const sourceBalanceBeforeTransfers = afterRace.body.balance?.amountMinor;
      const transferAmountMinor = 8000; // two of these (16000) exceed a 10000 balance
      const transferBody = {
        sourceAccount: sourceAccountId,
        targetAccount: targetAccountId,
        amount: { amountMinor: transferAmountMinor, currency: 'GTQ' },
      };
      console.log(
        `  [resilience] CONCURRENT-TRANSFER-RACE-01 saldo origen antes: ${sourceBalanceBeforeTransfers}, dos transferencias de ${transferAmountMinor} c/u`,
      );

      const [transferA, transferB] = await Promise.all([
        api('/api/transfers', source.token, { method: 'POST', body: transferBody }),
        api('/api/transfers', source.token, { method: 'POST', body: transferBody }),
      ]);
      console.log(
        `  [resilience] CONCURRENT-TRANSFER-RACE-01 aceptación A: ${transferA.status} transactionId=${transferA.body.transactionId}`,
      );
      console.log(
        `  [resilience] CONCURRENT-TRANSFER-RACE-01 aceptación B: ${transferB.status} transactionId=${transferB.body.transactionId}`,
      );

      const bothAccepted = transferA.status === 202 && transferB.status === 202;
      if (!bothAccepted) {
        report.record(
          'CONCURRENT-TRANSFER-RACE-01',
          'Resiliencia',
          'Dos transferencias concurrentes que sobregirarían la cuenta',
          'Ambas peticiones aceptadas (202) para poder evaluar la carrera en el debito',
          `A.status=${transferA.status} B.status=${transferB.status}`,
          false,
          `Cuerpos: A=${JSON.stringify(transferA.body)} B=${JSON.stringify(transferB.body)}`,
        );
      } else {
        const isTerminal = (r) =>
          r.status === 200 && ['COMPLETED', 'FAILED', 'COMPENSATED'].includes(r.body.status);
        const [finalA, finalB] = await Promise.all([
          waitForStatus(`/api/transfers/${transferA.body.transactionId}`, source.token, isTerminal, 15000),
          waitForStatus(`/api/transfers/${transferB.body.transactionId}`, source.token, isTerminal, 15000),
        ]);
        console.log(
          `  [resilience] CONCURRENT-TRANSFER-RACE-01 estado final A: ${finalA.body.status} reason=${finalA.body.reason}`,
        );
        console.log(
          `  [resilience] CONCURRENT-TRANSFER-RACE-01 estado final B: ${finalB.body.status} reason=${finalB.body.reason}`,
        );

        const sourceAfterTransfers = await api(`/api/accounts/${sourceAccountId}/balance`, cajero.token);
        const targetAfterTransfers = await api(`/api/accounts/${targetAccountId}/balance`, cajero.token);
        console.log(
          `  [resilience] CONCURRENT-TRANSFER-RACE-01 saldo origen después: ${JSON.stringify(sourceAfterTransfers.body.balance)}`,
        );
        console.log(
          `  [resilience] CONCURRENT-TRANSFER-RACE-01 saldo destino después: ${JSON.stringify(targetAfterTransfers.body.balance)}`,
        );

        const outcomes = [finalA.body.status, finalB.body.status];
        const completedCount = outcomes.filter((s) => s === 'COMPLETED').length;
        const sourceBalanceAfterTransfers = sourceAfterTransfers.body.balance?.amountMinor;
        const neverNegative = typeof sourceBalanceAfterTransfers === 'number' && sourceBalanceAfterTransfers >= 0;
        const atMostOneFundsAvailable = completedCount <= 1;
        const consistentWithBalance =
          typeof sourceBalanceAfterTransfers === 'number' &&
          typeof sourceBalanceBeforeTransfers === 'number' &&
          sourceBalanceAfterTransfers ===
            sourceBalanceBeforeTransfers - completedCount * transferAmountMinor;

        report.record(
          'CONCURRENT-TRANSFER-RACE-01',
          'Resiliencia',
          'Dos transferencias simultáneas desde la misma cuenta que juntas la sobregirarían',
          `A lo sumo una COMPLETED, saldo de origen nunca negativo y consistente con ${completedCount} débito(s) real(es)`,
          `estados=[${outcomes.join(', ')}] saldoOrigenAntes=${sourceBalanceBeforeTransfers} saldoOrigenDespués=${sourceBalanceAfterTransfers}`,
          atMostOneFundsAvailable && neverNegative && consistentWithBalance,
          `Q80.00 x2 = Q160.00 sobre un saldo de Q100.00: como máximo una puede completarse. reason A=${finalA.body.reason} reason B=${finalB.body.reason}`,
        );
      }
    }
  } finally {
    // No browser in this suite — nothing to close.
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
