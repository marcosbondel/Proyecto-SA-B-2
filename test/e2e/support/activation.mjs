/**
 * Recovers the activation link (and the password-reset link) a customer-facing
 * flow produces, from every source that could plausibly hold it.
 *
 * Two sources are tried, in order, and NEITHER is the database:
 *
 *  1. `notification-audit-service`'s own log line, when `REVEAL_ACTIVATION_LINKS=true`
 *     (docs/operations/CONTAINERS.md) — a developer-only mailcatcher, closed by
 *     default in production. Scraped from whichever log source is configured:
 *     `docker compose logs` (dev or images profile — CI brings the stack up
 *     with `docker compose -f infra/docker/docker-compose.dev.yml up -d --wait`,
 *     so this path has to keep working there) **or** a plain log file, for a
 *     `dev:host` run where the seven processes are plain `node` on the host
 *     with no container to ask — set `E2E_LOG_FILE` to point at it (this repo's
 *     `pnpm dev:host` convention is `tmp/dev-host.log`).
 *
 *  2. `GET /api/audit` as an administrator, looking for the
 *     `customer.activation.requested.v1` / `customer.password-reset.issued.v1`
 *     event by the flow's own `correlationId`.
 *
 * **The second source is expected to fail, every time, by design**, and the
 * code tries it anyway rather than skip it, because the alternative — a helper
 * that only works when someone happens to have started the stack with logs
 * reachable — is exactly the fragility this module replaces. Two things make
 * it structurally impossible for the audit trail to ever hand back a plaintext
 * token:
 *
 *   - `apps/services/notification-audit-service/src/application/ports.ts` types
 *     the notification's `link` field "Passed through, never persisted" — it
 *     reaches the simulated delivery channel and nowhere else.
 *   - The *origin* event's own field — `activationToken` on
 *     `customer.activation.requested.v1`, `resetToken` on
 *     `customer.password-reset.issued.v1` — matches the deny-list in
 *     `src/domain/redaction.ts` (`/credential|password|token|.../i`) by name
 *     alone, so it is replaced with `[redactado]` **before the insert**, for
 *     every caller, administrators included. That redaction is the point of
 *     TD-043: production must not be able to leak this token even to its own
 *     operators.
 *
 * So when neither source produces a link, this throws rather than returning
 * `null`. A case that cannot obtain its token must be reported failed, with the
 * reason visible, not silently skipped — a helper that swallowed this would
 * turn "the stack isn't giving me a token" into an invisible green.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { api } from './gateway.mjs';

export class ActivationLinkUnavailable extends Error {
  constructor(message) {
    super(message);
    this.name = 'ActivationLinkUnavailable';
  }
}

const COMPOSE_FILES = [
  'infra/docker/docker-compose.dev.yml',
  'infra/docker/docker-compose.images.yml',
];

/** `dev:host` has no container to ask; this repo's convention is `tmp/dev-host.log` (`pnpm dev:host > tmp/dev-host.log 2>&1`). Override with `E2E_LOG_FILE`. */
const HOST_LOG_FILE = process.env.E2E_LOG_FILE || 'tmp/dev-host.log';

function scrapeCompose(file) {
  try {
    return execFileSync(
      'docker',
      ['compose', '-f', file, 'logs', '--tail', '400', 'notification-audit-service'],
      { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] },
    );
  } catch {
    return '';
  }
}

function scrapeHostLogFile() {
  const path = resolve(HOST_LOG_FILE);
  if (!existsSync(path)) return '';
  try {
    // Tail-ish: a running dev log can grow past comfortable memory over a long
    // session, so only the most recent slice is read.
    const content = readFileSync(path, 'utf-8');
    return content.length > 2_000_000 ? content.slice(-2_000_000) : content;
  } catch {
    return '';
  }
}

/**
 * El enlace de esta solicitud si se puede distinguir, y el último si no.
 *
 * Buscar sólo por el patrón del enlace funciona con una suite a la vez y falla
 * en cuanto hay dos: la línea más reciente puede pertenecer a otro cliente
 * registrado en el mismo segundo, y entonces se activa la cuenta de alguien más
 * y el login falla con un 401 que no tiene que ver con lo que la prueba quería
 * comprobar. Tres suites se toparon con eso a la vez.
 *
 * Filtrar por `correlationId` sería exacto, y se intenta primero. El respaldo
 * existe porque no está comprobado que la correlación del registro llegue
 * siempre hasta la línea que `notification-audit-service` escribe con el
 * `deliveryLink`: el intento de verificarlo contra el stack vivo salió sin
 * conclusión — `customer-service` estaba caído por TD-076 y no se produjo
 * ninguna notificación que mirar. Hasta que alguien lo confirme, un filtro sin
 * respaldo podría devolver `null` siempre y romper el aprovisionamiento entero,
 * que es peor que la carrera que esto viene a reducir.
 *
 * Lo que esto **no** arregla: dos registros simultáneos cuya correlación no se
 * propague siguen pudiendo cruzarse. Corriendo en serie —que es como los
 * ejecuta `run-all.mjs`— no ocurre; en paralelo, la prueba lo reporta como
 * `skip` con su motivo, que es la respuesta honesta.
 */
function extractLink(pattern, logs, correlationId) {
  const lines = logs.split('\n').reverse();

  if (correlationId !== undefined) {
    for (const line of lines) {
      if (!line.includes(correlationId)) continue;

      const scoped = line.match(pattern);
      if (scoped) return scoped[0];
    }
  }

  for (const line of lines) {
    const m = line.match(pattern);
    if (m) return m[0];
  }

  return null;
}

async function fromLogs(pattern, timeoutMs, intervalMs, correlationId) {
  const start = Date.now();
  do {
    const hostLog = scrapeHostLogFile();
    const fromHost = hostLog ? extractLink(pattern, hostLog, correlationId) : null;
    if (fromHost) return fromHost;

    for (const file of COMPOSE_FILES) {
      const logs = scrapeCompose(file);
      if (logs === '') continue;
      const link = extractLink(pattern, logs, correlationId);
      if (link) return link;
    }

    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  } while (Date.now() - start < timeoutMs);
  return null;
}

/**
 * The audit-trail fallback. Tries anyway (see module doc for why it is
 * expected to fail); returns the redaction marker's presence as `redacted`
 * so a caller can report *that* it was found-but-redacted rather than
 * absent, which is a materially different fact for a report to carry.
 */
async function fromAudit(messageType, tokenField, linkPath, correlationId, adminToken) {
  if (!correlationId || !adminToken) {
    return { link: null, redacted: false, queried: false };
  }
  const res = await api(`/api/audit?correlationId=${encodeURIComponent(correlationId)}`, adminToken);
  if (res.status !== 200 || !Array.isArray(res.body.events)) {
    return { link: null, redacted: false, queried: true };
  }
  const event = res.body.events.find((e) => e.messageType === messageType);
  if (!event) {
    return { link: null, redacted: false, queried: true };
  }
  const raw = event.payload?.[tokenField] ?? event.payload?.link;
  if (typeof raw === 'string' && raw !== '[redactado]' && /^[a-zA-Z0-9_-]{16,}$/.test(raw)) {
    return { link: `${linkPath}?token=${raw}`, redacted: false, queried: true };
  }
  return { link: null, redacted: raw === '[redactado]', queried: true };
}

/**
 * @param {object} opts
 * @param {string} [opts.correlationId] - the flow's correlationId, to look the
 *   event up by if the log sources come up empty. Without it the audit
 *   fallback is skipped outright rather than attempted with no filter.
 * @param {string} [opts.adminToken] - a bearer token for `ADMINISTRADOR`,
 *   required for the audit fallback (`GET /api/audit` is admin-only, D-06).
 * @param {number} [opts.timeoutMs]
 * @returns {Promise<string>} the link's path, e.g. `/activar?token=...`
 * @throws {ActivationLinkUnavailable} when no source produced a usable token.
 */
export async function getActivationLink({ correlationId, adminToken, timeoutMs = 12000, intervalMs = 800 } = {}) {
  const logLink = await fromLogs(/\/activar\?token=[a-zA-Z0-9_-]+/, timeoutMs, intervalMs, correlationId);
  if (logLink) return logLink;

  const audit = await fromAudit(
    'customer.activation.requested.v1',
    'activationToken',
    '/activar',
    correlationId,
    adminToken,
  );
  if (audit.link) return audit.link;

  throw new ActivationLinkUnavailable(
    'No se pudo recuperar el enlace de activación. Fuentes intentadas: ' +
      `(1) logs (docker compose dev/images, y el archivo host '${HOST_LOG_FILE}' vía E2E_LOG_FILE) — ` +
      'sin coincidencia, revisa REVEAL_ACTIVATION_LINKS=true y que el log sea accesible; ' +
      `(2) GET /api/audit?correlationId — ${audit.queried ? (audit.redacted ? 'el evento existe pero el token llegó redactado ([redactado]), por diseño (src/domain/redaction.ts + ports.ts "never persisted")' : 'no se encontró el evento customer.activation.requested.v1') : 'no se intentó (falta correlationId o adminToken)'}` +
      '. Esta fuente nunca puede tener éxito mientras la redacción sea la esperada: es la prueba de que TD-043 sigue cerrado, no un defecto de este helper.',
  );
}

export async function getPasswordResetLink({ correlationId, adminToken, timeoutMs = 12000, intervalMs = 800 } = {}) {
  const logLink = await fromLogs(/\/restablecer\?token=[a-zA-Z0-9_-]+/, timeoutMs, intervalMs, correlationId);
  if (logLink) return logLink;

  const audit = await fromAudit(
    'customer.password-reset.issued.v1',
    'resetToken',
    '/restablecer',
    correlationId,
    adminToken,
  );
  if (audit.link) return audit.link;

  throw new ActivationLinkUnavailable(
    'No se pudo recuperar el enlace de restablecimiento de contraseña. Fuentes intentadas: ' +
      `(1) logs — sin coincidencia; (2) GET /api/audit?correlationId — ${audit.queried ? (audit.redacted ? 'evento encontrado pero el token está redactado por diseño' : 'evento customer.password-reset.issued.v1 no encontrado') : 'no se intentó (falta correlationId o adminToken)'}.`,
  );
}
