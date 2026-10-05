/**
 * Provisions a fresh, fully-onboarded customer for suites that need one
 * without re-running the whole registration → activation → identity-verdict →
 * KYC → account-opening chain by hand every time.
 *
 * This replaces `run-cajero-audit-flow.mjs`'s hard-coded fixture
 * (`carlostest@bankusac.gt`, a customerId baked into the file) with a customer
 * created fresh on every run, the way `happypath.e2e.mjs` already did for its
 * own registration section — except every suite that needs "a validated
 * client with an account" no longer has to reimplement the chain.
 */
import { GW, SEEDED, api, loginApi, waitForStatus } from './gateway.mjs';
import { ActivationLinkUnavailable, getActivationLink } from './activation.mjs';
import { DUMMY_PNG } from './browser.mjs';

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

/** multipart/form-data registration — fetch's FormData does the boundary work `api()`'s JSON path does not. */
async function registerCustomer({ fullName, email, password, dpi, dateOfBirth = '1995-06-20', address = 'Ciudad de Guatemala' }) {
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

/**
 * Registers, activates via the log-scraped link, has the seeded cajero
 * validate identity + KYC, then opens one MONETARIA account (and, if
 * `openSavings` is set, an AHORRO one too).
 *
 * Returns `null` — never throws — when a step could not be completed (e.g. no
 * activation link could be recovered), so a suite can `skip()` the cases that
 * depend on it with a clear reason instead of crashing the whole run.
 */
export async function provisionCustomer({ label = 'e2e', openSavings = false } = {}) {
  const rnd = Math.floor(100000 + Math.random() * 899999);
  const email = `qa.${label}.${rnd}@example.com`;
  const password = 'StrongQA#2026!';
  const dpi = `2${String(rnd).padStart(4, '0')}9${String(rnd).padStart(4, '0')}0101`.slice(0, 13);
  const fullName = `QA ${label} ${rnd}`;

  const reg = await registerCustomer({ fullName, email, password, dpi });
  if (reg.status !== 202 || !reg.body.customerId) {
    return { ok: false, step: 'register', detail: `${reg.status}: ${JSON.stringify(reg.body)}` };
  }
  const customerId = reg.body.customerId;

  let activationPath;
  try {
    activationPath = await getActivationLink({
      correlationId: reg.body.correlationId,
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
  const token = login.token;

  const cajero = await cajeroToken();
  await api(`/api/customers/${customerId}/identity-verdict`, cajero, {
    method: 'POST',
    body: { verdict: 'VALIDATED' },
  });
  await api(`/api/customers/${customerId}/kyc-status`, cajero, {
    method: 'POST',
    body: { status: 'VERIFIED' },
  });

  // Both verdicts are async (202); poll the customer record for both to land
  // rather than sleeping a guessed duration.
  const validated = await waitForStatus(
    `/api/customers/${customerId}`,
    cajero,
    (r) => r.body.identityStatus === 'VALIDATED' && r.body.kycStatus === 'VERIFIED',
    8000,
  );
  if (validated.body.identityStatus !== 'VALIDATED' || validated.body.kycStatus !== 'VERIFIED') {
    return {
      ok: false,
      step: 'identity-kyc',
      detail: `identityStatus=${validated.body.identityStatus} kycStatus=${validated.body.kycStatus}`,
      customerId,
    };
  }

  const accountIds = [];
  const openMonetaria = await api('/api/accounts', token, {
    method: 'POST',
    body: { accountType: 'MONETARIA' },
  });
  if (openMonetaria.status === 202 && openMonetaria.body.accountId) {
    accountIds.push(openMonetaria.body.accountId);
  } else {
    return { ok: false, step: 'open-account', detail: `${openMonetaria.status}: ${JSON.stringify(openMonetaria.body)}`, customerId };
  }

  if (openSavings) {
    const openAhorro = await api('/api/accounts', token, {
      method: 'POST',
      // Since T-27 an AHORRO account cannot be opened empty: it needs its
      // type's minimum (Q100.00) as an opening deposit, or the open is refused
      // with MINIMUM_BALANCE_VIOLATION and the account never exists — which
      // surfaced downstream as a 404 when a suite read its balance.
      body: { accountType: 'AHORRO', initialDeposit: { amountMinor: 10000, currency: 'GTQ' } },
    });
    if (openAhorro.status === 202 && openAhorro.body.accountId) {
      accountIds.push(openAhorro.body.accountId);
    }
  }

  return { ok: true, email, password, customerId, token, accountIds };
}
