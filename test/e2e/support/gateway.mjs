/**
 * HTTP access to the Gateway, shared by every E2E suite.
 *
 * Every suite used to carry its own copy of `loginApi`/`api` with subtly
 * different bodies (one used `password`, the contract field is `credential`;
 * one swallowed non-JSON bodies differently). One copy here is the only way a
 * fix to how a request is built reaches every suite at once.
 */

export const GW = process.env.GATEWAY_URL || 'http://localhost:3000';
export const BASE = process.env.APP_BASE_URL || 'http://localhost:3010';

/** `SEED_PASSWORD`'s default (docs/operations/CONTAINERS.md); overridable for a stack seeded differently. */
export const SEED_PASSWORD = process.env.SEED_PASSWORD || 'BankUsac#2026';

/** The three ready-to-use users `SEED_DEMO_DATA` inserts, one per role. */
export const SEEDED = {
  admin: { email: 'admin@bankusac.gt', password: SEED_PASSWORD, role: 'ADMINISTRADOR' },
  cajero: { email: 'cajero@bankusac.gt', password: SEED_PASSWORD, role: 'CAJERO_RECEPTOR' },
  cliente: { email: 'cliente@bankusac.gt', password: SEED_PASSWORD, role: 'CLIENTE' },
};

/**
 * `POST /api/auth/login`. The field is `credential`, not `password` — the
 * gateway's own DTO (`apps/gateway/src/interfaces/dto/login.dto.ts`) names it
 * that, and a suite that sends `password` gets a 400 that looks like a login
 * failure if nobody reads the body.
 */
export async function loginApi(email, credential) {
  const res = await fetch(`${GW}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, credential }),
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, token: data.token ?? null, data };
}

/** Convenience over the three seeded logins. Throws if any of them fails, so a broken stack fails loudly at setup rather than as 40 mysterious 401s. */
export async function loginAllRoles() {
  const [admin, cajero, cliente] = await Promise.all([
    loginApi(SEEDED.admin.email, SEEDED.admin.password),
    loginApi(SEEDED.cajero.email, SEEDED.cajero.password),
    loginApi(SEEDED.cliente.email, SEEDED.cliente.password),
  ]);
  for (const [role, auth] of [['admin', admin], ['cajero', cajero], ['cliente', cliente]]) {
    if (auth.token === null) {
      throw new Error(
        `No se pudo autenticar el usuario sembrado '${role}' (status ${auth.status}). ` +
          `¿Está el stack corriendo con SEED_DEMO_DATA=true? Respuesta: ${JSON.stringify(auth.data)}`,
      );
    }
  }
  return {
    admin: { token: admin.token, ...SEEDED.admin },
    cajero: { token: cajero.token, ...SEEDED.cajero },
    cliente: { token: cliente.token, ...SEEDED.cliente },
  };
}

/**
 * A raw call against the Gateway. Returns `{ status, body, headers }` always —
 * never throws on a non-2xx status, because a 403 or a 404 is frequently the
 * assertion under test, not a failure of the test itself.
 */
export async function api(path, token, opts = {}) {
  const headers = { ...opts.headers };
  if (token) headers.Authorization = `Bearer ${token}`;
  let body = opts.body;
  if (body !== undefined && body !== null && typeof body === 'object' && !Buffer.isBuffer(body)) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(body);
  }
  const res = await fetch(`${GW}${path}`, { ...opts, headers, body });
  const parsed = await res.json().catch(() => ({}));
  return { status: res.status, body: parsed, headers: res.headers };
}

/**
 * Polls `path` until `predicate(response)` is true or `timeoutMs` elapses.
 *
 * Async commands (`202`) answer before the effect lands — a transfer's Saga,
 * an identity verdict, an account-status change. A fixed `setTimeout` before
 * reading the result is either too short (flaky) or wastefully long on a fast
 * box; this polls at `intervalMs` and returns the last observation either way,
 * so a caller that times out still gets to see what actually happened.
 */
export async function waitForStatus(path, token, predicate, timeoutMs = 10000, intervalMs = 400) {
  const start = Date.now();
  let last = await api(path, token);
  while (Date.now() - start < timeoutMs) {
    if (predicate(last)) return last;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
    last = await api(path, token);
  }
  return last;
}
