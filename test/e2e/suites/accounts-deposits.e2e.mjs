import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
/**
 * accounts-deposits — account opening, listing, balances, the deposit window
 * (A-05), its RBAC and idempotency, the movements statement, and the account
 * status route's real authorization scope.
 *
 * A few cases here deliberately assert something OTHER than what a first read
 * of the Gateway's own doc comments would suggest, because the real handlers
 * (read below, not assumed) say otherwise:
 *
 * - `GET /api/accounts/:id/balance` and `.../operations` answer a non-owner
 *   with `404 ACCOUNT_NOT_FOUND`, never `403 FORBIDDEN_ACCOUNT_ACCESS` —
 *   `get-balance.use-case.ts` and `get-operations.use-case.ts` say so
 *   explicitly: a distinguishable refusal on a read would be a way to probe
 *   for which account numbers exist. `FORBIDDEN_ACCOUNT_ACCESS` is real, but
 *   it belongs to the deposit route alone.
 * - `POST /api/accounts/:id/status` is not admin-only. The Gateway's
 *   `@Roles('ADMINISTRADOR', 'CAJERO_RECEPTOR', 'CLIENTE')` and
 *   `set-account-status.use-case.ts`'s own comment ("ADMINISTRADOR &
 *   CAJERO_RECEPTOR can change status on any account. CLIENTE can only
 *   change status on their own accounts.") both say a cajero may deactivate
 *   *any* account, not just their own window's customer. What a `CLIENTE`
 *   cannot do is silent rather than rejected: the route still answers `202`
 *   (it is fire-and-forget, like every other command here), and the account's
 *   status simply never changes — which is the shape this suite proves,
 *   rather than a `403` that never arrives.
 * - `AHORRO`'s Q100.00 minimum opening deposit (T-27,
 *   `openingDepositRefusal` in `account.ts`) is enforced by Account Service,
 *   never by the Gateway — so `POST /api/accounts` still answers `202` with a
 *   minted `accountId` for a refused opening. The account never actually
 *   exists. `provisionCustomer({ openSavings: true })` opens its AHORRO
 *   account with no initial deposit, so it always hits this refusal; this
 *   suite opens its own AHORRO accounts with a qualifying deposit instead of
 *   relying on that helper for AHORRO coverage.
 */
import { randomUUID } from 'node:crypto';

import { BASE, SEEDED, api, loginApi, waitForStatus } from '../support/gateway.mjs';
import { launch, loginViaUI, shot } from '../support/browser.mjs';
import { provisionCustomer } from '../support/seed.mjs';
import { Report } from '../support/report.mjs';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function run() {
  const report = new Report('accounts-deposits');

  const cajero = await loginApi(SEEDED.cajero.email, SEEDED.cajero.password);
  const admin = await loginApi(SEEDED.admin.email, SEEDED.admin.password);
  if (!cajero.token || !admin.token) {
    throw new Error(
      `No se pudo autenticar cajero/admin sembrados (cajero=${cajero.status}, admin=${admin.status}). ` +
        '¿Está el stack corriendo con SEED_DEMO_DATA=true?',
    );
  }

  // --- Setup: one provisioned customer with a MONETARIA account, reused across most cases. ---
  const customer = await provisionCustomer({ label: 'acc-dep' });
  if (!customer.ok) {
    report.skip(
      'ACC-SETUP',
      'Cuentas',
      'Aprovisionar un cliente validado con cuenta MONETARIA',
      `No se pudo completar el aprovisionamiento en el paso '${customer.step}': ${customer.detail}`,
    );
    return report.summary();
  }

  // ACC-OPEN-01 — the MONETARIA account provisionCustomer() opened is a real 202 + UUID accountId.
  const monetariaId = customer.accountIds[0];
  report.record(
    'ACC-OPEN-01',
    'Cuentas',
    'Apertura de cuenta MONETARIA para un cliente recién aprovisionado',
    'accountId presente y con formato UUID v4',
    `accountId=${monetariaId ?? 'N/A'}`,
    typeof monetariaId === 'string' && UUID_V4.test(monetariaId),
  );

  // ACC-OPEN-02 — open an AHORRO account too, this time WITH a qualifying initial
  // deposit (Q100.00 minimum, T-27), since provisionCustomer's own AHORRO opening
  // (no deposit) is proven to be silently refused by AHORRO-MIN-01 below.
  const openAhorro = await api('/api/accounts', customer.token, {
    method: 'POST',
    body: { accountType: 'AHORRO', initialDeposit: { amountMinor: 10000, currency: 'GTQ' } },
  });
  let ahorroId = openAhorro.status === 202 ? openAhorro.body.accountId : null;
  let bothAccountTypesConfirmed = false;
  if (typeof ahorroId === 'string') {
    const afterOpen = await waitForStatus(
      '/api/accounts',
      customer.token,
      (r) => Array.isArray(r.body.accounts) && r.body.accounts.some((a) => a.accountId === ahorroId),
    );
    const accountsById = new Map((afterOpen.body.accounts ?? []).map((a) => [a.accountId, a]));
    const monetariaRow = accountsById.get(monetariaId);
    const ahorroRow = accountsById.get(ahorroId);
    bothAccountTypesConfirmed =
      monetariaRow?.accountType === 'MONETARIA' && ahorroRow?.accountType === 'AHORRO';
  }
  report.record(
    'ACC-OPEN-02',
    'Cuentas',
    'Apertura de cuenta AHORRO con depósito inicial que cumple el mínimo (Q100.00)',
    'GET /api/accounts muestra ambas cuentas con su accountType real (MONETARIA y AHORRO)',
    `openStatus=${openAhorro.status} ahorroId=${ahorroId ?? 'N/A'} confirmedTypes=${bothAccountTypesConfirmed}`,
    openAhorro.status === 202 && typeof ahorroId === 'string' && bothAccountTypesConfirmed,
  );

  const accountIds = [monetariaId, ahorroId].filter((id) => typeof id === 'string');

  // ACC-LIST-01 — GET /api/accounts as the customer returns exactly the accounts created above (set-equality).
  const listing = await api('/api/accounts', customer.token);
  const listedIds = new Set((listing.body.accounts ?? []).map((a) => a.accountId));
  const expectedIds = new Set(accountIds);
  const setEqual =
    listedIds.size === expectedIds.size && [...expectedIds].every((id) => listedIds.has(id));
  report.record(
    'ACC-LIST-01',
    'Cuentas',
    'GET /api/accounts devuelve exactamente las cuentas creadas para el cliente',
    `{${[...expectedIds].join(', ')}}`,
    `status=${listing.status} ids={${[...listedIds].join(', ')}}`,
    listing.status === 200 && setEqual,
  );

  // --- UI cases: real browser against the real Gateway. ---
  const { browser, ctx, page } = await launch();
  try {
    // ACC-LIST-02 — /cuentas renders both account-type labels via the real login form.
    await loginViaUI(ctx, page, customer.email, customer.password);
    await page.goto(`${BASE}/cuentas`);
    await page.waitForLoadState('networkidle');
    await page.waitForSelector('[data-testid="account-row"]', { timeout: 10000 }).catch(() => {});
    await shot(page, 'acc-01-cuentas-listado');
    const bodyText = await page.locator('body').innerText();
    const hasMonetaria = bodyText.includes('Monetaria');
    const hasAhorro = bodyText.includes('Ahorro');
    report.record(
      'ACC-LIST-02',
      'Cuentas (UI)',
      '/cuentas muestra las etiquetas de tipo "Monetaria" y "Ahorro" para el cliente',
      'Ambas etiquetas visibles en el texto de la página',
      `Monetaria=${hasMonetaria} Ahorro=${hasAhorro}`,
      hasMonetaria && hasAhorro,
    );

    // ACC-DETAIL-01 — the detail page's rendered balance matches the API's balance, before any deposit.
    const apiBalanceBefore = await api(`/api/accounts/${monetariaId}/balance`, customer.token);
    await page.goto(`${BASE}/cuentas/${monetariaId}`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(800);
    await shot(page, 'acc-02-detalle-cuenta');
    const detailText = await page.locator('body').innerText();
    const expectedBalanceText = formatQuetzalesForMatch(apiBalanceBefore.body?.balance?.amountMinor);
    const detailShowsBalance =
      expectedBalanceText !== null && detailText.includes(expectedBalanceText);
    report.record(
      'ACC-DETAIL-01',
      'Cuentas (UI)',
      'El detalle de cuenta muestra el mismo saldo que reporta GET /api/accounts/:id/balance',
      `Texto "${expectedBalanceText ?? 'N/A'}" presente en la página`,
      `apiBalance=${apiBalanceBefore.status}:${apiBalanceBefore.body?.balance?.amountMinor ?? 'N/A'} found=${detailShowsBalance}`,
      apiBalanceBefore.status === 200 && detailShowsBalance,
    );
  } finally {
    await browser.close();
  }

  // DEP-01 — a well-formed but nonexistent account UUID, deposited to as cajero.
  const nonexistentAccountId = randomUUID();
  const depNonexistent = await api(`/api/accounts/${nonexistentAccountId}/deposit`, cajero.token, {
    method: 'POST',
    headers: { 'Idempotency-Key': randomUUID() },
    body: { amount: { amountMinor: 10000, currency: 'GTQ' }, description: 'Depósito a cuenta inexistente' },
  });
  report.record(
    'DEP-01',
    'Depósitos',
    'Depósito a un UUID de cuenta bien formado pero inexistente',
    '404 con failureCode ACCOUNT_NOT_FOUND (get-balance/deposit use-cases lo modelan así)',
    `${depNonexistent.status}: ${depNonexistent.body.failureCode ?? depNonexistent.body.type ?? ''}`,
    depNonexistent.status === 404 && depNonexistent.body.failureCode === 'ACCOUNT_NOT_FOUND',
  );

  // DEP-02 — amountMinor: 0 is rejected before it ever reaches Account Service (MoneyDto's @Min(1)).
  const depZero = await api(`/api/accounts/${monetariaId}/deposit`, cajero.token, {
    method: 'POST',
    headers: { 'Idempotency-Key': randomUUID() },
    body: { amount: { amountMinor: 0, currency: 'GTQ' }, description: 'Depósito de monto cero' },
  });
  report.record(
    'DEP-02',
    'Depósitos',
    'Depósito con amountMinor: 0',
    'Rechazado (no 200), típicamente 400 VALIDATION_ERROR sobre amount.amountMinor',
    `${depZero.status}: type=${depZero.body.type ?? ''} field=${depZero.body.field ?? ''}`,
    depZero.status !== 200,
  );

  // DEP-03 — a negative amountMinor is rejected the same way.
  const depNegative = await api(`/api/accounts/${monetariaId}/deposit`, cajero.token, {
    method: 'POST',
    headers: { 'Idempotency-Key': randomUUID() },
    body: { amount: { amountMinor: -500, currency: 'GTQ' }, description: 'Depósito de monto negativo' },
  });
  report.record(
    'DEP-03',
    'Depósitos',
    'Depósito con amountMinor negativo',
    'Rechazado (no 200)',
    `${depNegative.status}: type=${depNegative.body.type ?? ''} field=${depNegative.body.field ?? ''}`,
    depNegative.status !== 200,
  );

  // DEP-04 — a real deposit of Q5,000.00 increases the balance by exactly that amount.
  const balanceBeforeDep04 = await api(`/api/accounts/${monetariaId}/balance`, customer.token);
  const dep04Key = randomUUID();
  const dep04 = await api(`/api/accounts/${monetariaId}/deposit`, cajero.token, {
    method: 'POST',
    headers: { 'Idempotency-Key': dep04Key },
    body: { amount: { amountMinor: 500000, currency: 'GTQ' }, description: 'Depósito en ventanilla Q5,000.00' },
  });
  const balanceAfterDep04 = await api(`/api/accounts/${monetariaId}/balance`, customer.token);
  const deltaDep04 =
    (balanceAfterDep04.body?.balance?.amountMinor ?? NaN) -
    (balanceBeforeDep04.body?.balance?.amountMinor ?? NaN);
  report.record(
    'DEP-04',
    'Depósitos',
    'Depósito real de Q5,000.00 incrementa el saldo exactamente en esa cantidad',
    'status 200 y delta de saldo = 500000',
    `status=${dep04.status} before=${balanceBeforeDep04.body?.balance?.amountMinor} after=${balanceAfterDep04.body?.balance?.amountMinor} delta=${deltaDep04}`,
    dep04.status === 200 && deltaDep04 === 500000,
  );

  // DEP-05 — replaying the SAME Idempotency-Key with the same body returns the identical
  // operationId (the field this route actually names it, not `movementId`) and moves the
  // balance exactly once, not twice.
  const dep05Replay = await api(`/api/accounts/${monetariaId}/deposit`, cajero.token, {
    method: 'POST',
    headers: { 'Idempotency-Key': dep04Key },
    body: { amount: { amountMinor: 500000, currency: 'GTQ' }, description: 'Depósito en ventanilla Q5,000.00' },
  });
  const balanceAfterReplay = await api(`/api/accounts/${monetariaId}/balance`, customer.token);
  const sameOperationId =
    dep04.status === 200 &&
    dep05Replay.status === 200 &&
    dep04.body.operationId === dep05Replay.body.operationId;
  const balanceMovedOnlyOnce =
    (balanceAfterReplay.body?.balance?.amountMinor ?? NaN) ===
    (balanceAfterDep04.body?.balance?.amountMinor ?? NaN);
  report.record(
    'DEP-05',
    'Depósitos',
    'Repetir la misma Idempotency-Key para el mismo depósito no lo duplica',
    'Mismo operationId en ambas respuestas y el saldo no se mueve una segunda vez',
    `firstOperationId=${dep04.body.operationId} replayOperationId=${dep05Replay.body.operationId} balanceAfterFirst=${balanceAfterDep04.body?.balance?.amountMinor} balanceAfterReplay=${balanceAfterReplay.body?.balance?.amountMinor}`,
    sameOperationId && balanceMovedOnlyOnce,
  );

  // OPS-01 — the operations list for the account reflects the DEP-04 deposit by its real amount.
  const operations = await api(`/api/accounts/${monetariaId}/operations`, customer.token);
  const matchingOperation = (operations.body.operations ?? []).find(
    (op) => op.amount?.amountMinor === 500000 && op.type === 'CREDIT',
  );
  report.record(
    'OPS-01',
    'Movimientos',
    'GET /api/accounts/:id/operations refleja el depósito real hecho en DEP-04',
    'Una entrada CREDIT con amount.amountMinor = 500000',
    `status=${operations.status} found=${matchingOperation !== undefined} operationId=${matchingOperation?.operationId ?? 'N/A'}`,
    operations.status === 200 && matchingOperation !== undefined,
  );

  // RBAC-DEP-01 — a CLIENTE token cannot deposit, even into their own account (staff-only route).
  const rbacDeposit = await api(`/api/accounts/${monetariaId}/deposit`, customer.token, {
    method: 'POST',
    headers: { 'Idempotency-Key': randomUUID() },
    body: { amount: { amountMinor: 100, currency: 'GTQ' }, description: 'Intento de depósito por cliente' },
  });
  report.record(
    'RBAC-DEP-01',
    'RBAC',
    'Un CLIENTE no puede depositar, ni siquiera en su propia cuenta (@Roles CAJERO_RECEPTOR/ADMINISTRADOR)',
    '403',
    `${rbacDeposit.status}: ${rbacDeposit.body.type ?? ''}`,
    rbacDeposit.status === 403,
  );

  // FORBIDDEN-ACCESS-01 — Customer A's token requesting Customer B's balance.
  // get-balance.use-case.ts answers a non-owner with ACCOUNT_NOT_FOUND (404), on
  // purpose, never FORBIDDEN_ACCOUNT_ACCESS — a distinguishable refusal on a read
  // would let a probe discover which account numbers exist.
  const customerB = await provisionCustomer({ label: 'acc-dep-b' });
  if (customerB.ok) {
    const crossBalance = await api(`/api/accounts/${customerB.accountIds[0]}/balance`, customer.token);
    report.record(
      'FORBIDDEN-ACCESS-01',
      'RBAC',
      "El token del cliente A consultando el saldo de una cuenta del cliente B",
      '404 con failureCode ACCOUNT_NOT_FOUND (no 403: un read no debe distinguir "ajena" de "inexistente")',
      `${crossBalance.status}: ${crossBalance.body.failureCode ?? crossBalance.body.type ?? ''}`,
      crossBalance.status === 404 && crossBalance.body.failureCode === 'ACCOUNT_NOT_FOUND',
    );
  } else {
    report.skip(
      'FORBIDDEN-ACCESS-01',
      'RBAC',
      "El token del cliente A consultando el saldo de una cuenta del cliente B",
      `No se pudo aprovisionar al segundo cliente en el paso '${customerB.step}': ${customerB.detail}`,
    );
  }

  // RBAC-STATUS-01 — a CAJERO_RECEPTOR token changing the status of an account that is
  // NOT theirs. set-account-status.use-case.ts's own comment says this is allowed for
  // any account ("ADMINISTRADOR & CAJERO_RECEPTOR can change status on any account"),
  // contradicting the assumption that this route is admin-only — the Gateway's own
  // @Roles decorator already admits CAJERO_RECEPTOR too. Proven here as a real 202
  // followed by the account's status actually flipping.
  const cajeroStatusKey = randomUUID();
  const cajeroStatusChange = await api(`/api/accounts/${monetariaId}/status`, cajero.token, {
    method: 'POST',
    headers: { 'Idempotency-Key': cajeroStatusKey },
    body: { status: 'INACTIVE', reason: 'QA: cajero desactiva una cuenta que no es suya (RBAC-STATUS-01)' },
  });
  const cajeroStatusApplied = await waitForStatus(
    '/api/accounts',
    customer.token,
    (r) => (r.body.accounts ?? []).find((a) => a.accountId === monetariaId)?.status === 'INACTIVE',
  );
  const cajeroStatusIsInactive =
    (cajeroStatusApplied.body.accounts ?? []).find((a) => a.accountId === monetariaId)?.status ===
    'INACTIVE';
  report.record(
    'RBAC-STATUS-01',
    'RBAC',
    'Un CAJERO_RECEPTOR cambia el estado de una cuenta ajena (permitido por el código real, no admin-only)',
    '202 y el estado real de la cuenta pasa a INACTIVE',
    `status=${cajeroStatusChange.status} appliedInactive=${cajeroStatusIsInactive}`,
    cajeroStatusChange.status === 202 && cajeroStatusIsInactive,
    'Contradice la suposición "admin-only": @Roles admite CAJERO_RECEPTOR y el use-case lo autoriza explícitamente para cualquier cuenta.',
  );

  // Reactivate before RBAC-STATUS-02/03 need the account ACTIVE again.
  await api(`/api/accounts/${monetariaId}/status`, admin.token, {
    method: 'POST',
    headers: { 'Idempotency-Key': randomUUID() },
    body: { status: 'ACTIVE', reason: 'QA: reactivación entre casos' },
  });
  await waitForStatus(
    '/api/accounts',
    customer.token,
    (r) => (r.body.accounts ?? []).find((a) => a.accountId === monetariaId)?.status === 'ACTIVE',
  );

  // RBAC-STATUS-02 — ADMINISTRADOR deactivates an account; poll confirms the real status field.
  const adminStatusChange = await api(`/api/accounts/${monetariaId}/status`, admin.token, {
    method: 'POST',
    headers: { 'Idempotency-Key': randomUUID() },
    body: { status: 'INACTIVE', reason: 'QA: desactivación administrativa (RBAC-STATUS-02)' },
  });
  const adminStatusApplied = await waitForStatus(
    '/api/accounts',
    customer.token,
    (r) => (r.body.accounts ?? []).find((a) => a.accountId === monetariaId)?.status === 'INACTIVE',
  );
  const adminStatusIsInactive =
    (adminStatusApplied.body.accounts ?? []).find((a) => a.accountId === monetariaId)?.status ===
    'INACTIVE';
  report.record(
    'RBAC-STATUS-02',
    'RBAC',
    'ADMINISTRADOR desactiva una cuenta',
    '202 y GET /api/accounts refleja status: INACTIVE para esa cuenta',
    `status=${adminStatusChange.status} appliedInactive=${adminStatusIsInactive}`,
    adminStatusChange.status === 202 && adminStatusIsInactive,
  );

  // Reactivate again before the next case, which needs it ACTIVE to observe a non-change.
  await api(`/api/accounts/${monetariaId}/status`, admin.token, {
    method: 'POST',
    headers: { 'Idempotency-Key': randomUUID() },
    body: { status: 'ACTIVE', reason: 'QA: reactivación antes de RBAC-STATUS-03' },
  });
  await waitForStatus(
    '/api/accounts',
    customer.token,
    (r) => (r.body.accounts ?? []).find((a) => a.accountId === monetariaId)?.status === 'ACTIVE',
  );

  // RBAC-STATUS-03 — a CLIENTE token attempting to change ANOTHER customer's account
  // status. The Gateway's guard admits CLIENTE at all (it is meant for "their own
  // accounts"), and the command is fire-and-forget, so the HTTP answer is still 202 —
  // but set-account-status.use-case.ts's ownership check
  // (`identity.role === 'CLIENTE' && before.customerId !== identity.customerId`) means
  // the account's real status must never move. The 202 is not evidence of anything by
  // itself; only the poll is.
  if (customerB.ok) {
    const foreignStatusChange = await api(`/api/accounts/${monetariaId}/status`, customerB.token, {
      method: 'POST',
      headers: { 'Idempotency-Key': randomUUID() },
      body: { status: 'INACTIVE', reason: 'QA: cliente B intenta desactivar la cuenta del cliente A (RBAC-STATUS-03)' },
    });
    // No predicate to wait FOR here — we are proving absence of a change, so give the
    // (fire-and-forget) command a fixed window to have taken effect if it were going to.
    await new Promise((resolve) => setTimeout(resolve, 1500));
    const afterForeignAttempt = await api('/api/accounts', customer.token);
    const stillActive =
      (afterForeignAttempt.body.accounts ?? []).find((a) => a.accountId === monetariaId)?.status ===
      'ACTIVE';
    report.record(
      'RBAC-STATUS-03',
      'RBAC',
      'Un CLIENTE no puede cambiar el estado de una cuenta que no es suya (rechazo silencioso, no HTTP)',
      '202 en la respuesta (comando fire-and-forget) pero el status real permanece ACTIVE',
      `status=${foreignStatusChange.status} stillActive=${stillActive}`,
      foreignStatusChange.status === 202 && stillActive,
      'set-account-status.use-case.ts descarta el mensaje sin publicar nada cuando el CLIENTE no es dueño de la cuenta: el 202 no es una garantía de que algo cambió.',
    );
  } else {
    report.skip(
      'RBAC-STATUS-03',
      'RBAC',
      'Un CLIENTE no puede cambiar el estado de una cuenta que no es suya',
      `No se pudo aprovisionar al segundo cliente en el paso '${customerB.step}': ${customerB.detail}`,
    );
  }

  // AHORRO-MIN-01 — proving `openingDepositRefusal` (account.ts): an AHORRO opened with
  // less than Q100.00 still gets a 202 + accountId from the Gateway (it is fire-and-forget
  // and never checks the rule itself), but the account never actually exists — it must
  // never show up in GET /api/accounts.
  const underMinimum = await api('/api/accounts', customer.token, {
    method: 'POST',
    body: { accountType: 'AHORRO', initialDeposit: { amountMinor: 5000, currency: 'GTQ' } },
  });
  const underMinimumId = underMinimum.status === 202 ? underMinimum.body.accountId : null;
  // Give account-service a fixed window to have processed (and refused) the command;
  // there is no successful state to poll FOR, since none should ever arrive.
  await new Promise((resolve) => setTimeout(resolve, 1500));
  const afterUnderMinimum = await api('/api/accounts', customer.token);
  const neverAppeared =
    typeof underMinimumId === 'string' &&
    !(afterUnderMinimum.body.accounts ?? []).some((a) => a.accountId === underMinimumId);
  report.record(
    'AHORRO-MIN-01',
    'Cuentas',
    'Abrir AHORRO con un depósito inicial de Q50.00 (< Q100.00 mínimo, T-27) es rechazado en silencio',
    'La Gateway responde 202 con accountId (no valida la regla), pero esa cuenta nunca aparece en GET /api/accounts',
    `openStatus=${underMinimum.status} accountId=${underMinimumId ?? 'N/A'} neverAppeared=${neverAppeared}`,
    underMinimum.status === 202 && neverAppeared,
    'openingDepositRefusal() en account.ts refusa con MINIMUM_BALANCE_VIOLATION; el 202 de la Gateway no es prueba de apertura real.',
  );

  // BILLERS-01 — the billers catalogue responds for a signed-in CLIENTE (deep coverage lives in the payments suite).
  const billers = await api('/api/accounts/billers', customer.token);
  report.record(
    'BILLERS-01',
    'Cuentas',
    'GET /api/accounts/billers responde con el catálogo de prestadores',
    '200 con un arreglo billers',
    `status=${billers.status} count=${Array.isArray(billers.body.billers) ? billers.body.billers.length : 'N/A'}`,
    billers.status === 200 && Array.isArray(billers.body.billers),
  );

  return report.summary();
}

/**
 * The exact same computation `app/lib/money.ts`'s `formatQuetzales` does —
 * `Intl.NumberFormat('es-GT', ...)` and a literal `Q ` prefix, space included
 * — so this matches the rendered text rather than a guess at its shape.
 */
function formatQuetzalesForMatch(amountMinor) {
  if (typeof amountMinor !== 'number' || Number.isNaN(amountMinor)) {
    return null;
  }
  const formatted = new Intl.NumberFormat('es-GT', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amountMinor / 100);
  return `Q ${formatted}`;
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
