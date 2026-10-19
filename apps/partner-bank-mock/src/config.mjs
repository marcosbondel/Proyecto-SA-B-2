/**
 * La configuración del mock, en dos mitades con ciclos de vida distintos.
 *
 * - **Estática** (`settings`): quién es el mock, a quién le habla y con qué
 *   llaves. Se lee del entorno al arrancar y no cambia: cambiarla es otro banco.
 * - **Fallos** (`faults`): cómo se porta el mock. Se lee del entorno para el
 *   valor inicial y se cambia **en caliente** por `PUT /admin/config`, porque
 *   reiniciar un pod para pasar de ACCEPT a REJECT fue lo que costó una medición
 *   entera en T-51 (el pod viejo seguía en los Endpoints).
 *
 * Todo valor inválido en el entorno es un error de arranque, no un valor por
 * defecto silencioso: un mock que arranca en un modo distinto del pedido es peor
 * que uno que no arranca.
 */
import { REASON_CODES } from './contract.mjs';

export const MODES = ['ACCEPT', 'REJECT', 'TIMEOUT', 'SLOW', 'UNAVAILABLE'];
export const STATUS_BEHAVIORS = ['PROCESSING', 'NOT_FOUND', 'UNREACHABLE'];
export const REVERSAL_BEHAVIORS = ['COMPLETE', 'FAIL', 'STALL'];
export const FAIL_TARGETS = ['result', 'transfer', 'status', 'callback'];

export const DEFAULT_FAULTS = Object.freeze({
  mode: 'ACCEPT',
  rejectReason: 'ACCOUNT_NOT_FOUND',
  delayMs: 1_000,
  slowMs: 10_000,
  ackDelayMs: 0,
  failCount: 0,
  failTargets: ['result'],
  failureRate: 0,
  statusBehavior: 'PROCESSING',
  honorExpiry: true,
  reversal: 'COMPLETE',
});

const FAULT_KEYS = Object.keys(DEFAULT_FAULTS);

function isNonNegativeInteger(value) {
  return Number.isInteger(value) && value >= 0;
}

/**
 * Valida un conjunto completo de fallos. Devuelve los problemas (vacío si es válido).
 * Se usa igual para el entorno y para `PUT /admin/config`: una sola regla.
 */
export function faultProblems(faults) {
  const problems = [];
  const oneOf = (key, allowed) => {
    if (!allowed.includes(faults[key]))
      problems.push(`${key}: debe ser uno de ${allowed.join(', ')}`);
  };
  oneOf('mode', MODES);
  oneOf('rejectReason', REASON_CODES);
  oneOf('statusBehavior', STATUS_BEHAVIORS);
  oneOf('reversal', REVERSAL_BEHAVIORS);
  for (const key of ['delayMs', 'slowMs', 'ackDelayMs', 'failCount']) {
    if (!isNonNegativeInteger(faults[key])) problems.push(`${key}: debe ser un entero >= 0`);
  }
  if (
    typeof faults.failureRate !== 'number' ||
    faults.failureRate < 0 ||
    faults.failureRate > 100
  ) {
    problems.push('failureRate: debe ser un número entre 0 y 100');
  }
  if (typeof faults.honorExpiry !== 'boolean') problems.push('honorExpiry: debe ser booleano');
  if (
    !Array.isArray(faults.failTargets) ||
    faults.failTargets.some((target) => !FAIL_TARGETS.includes(target))
  ) {
    problems.push(`failTargets: lista de ${FAIL_TARGETS.join(', ')}`);
  }
  return problems;
}

/** Aplica un parche parcial sobre los fallos actuales. `{ faults }` o `{ problems }`. */
export function patchFaults(current, patch) {
  if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) {
    return { problems: ['el cuerpo debe ser un objeto'] };
  }
  const unknown = Object.keys(patch).filter((key) => !FAULT_KEYS.includes(key));
  if (unknown.length > 0) {
    return {
      problems: unknown.map(
        (key) => `${key}: campo desconocido (válidos: ${FAULT_KEYS.join(', ')})`,
      ),
    };
  }
  const next = { ...current, ...patch };
  const problems = faultProblems(next);
  return problems.length > 0 ? { problems } : { faults: next };
}

function text(env, name, fallback) {
  const value = env[name];
  return value === undefined || value === '' ? fallback : value;
}

function integer(env, name, fallback) {
  const raw = env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value)) throw new Error(`${name} debe ser un entero (recibido: ${raw})`);
  return value;
}

function flag(env, name, fallback) {
  const raw = env[name];
  if (raw === undefined || raw === '') return fallback;
  if (!['true', 'false'].includes(raw))
    throw new Error(`${name} debe ser true o false (recibido: ${raw})`);
  return raw === 'true';
}

/** Lee la configuración completa del entorno. Lanza si algo es inválido. */
export function readConfig(env = process.env) {
  const gatewayUrl = text(env, 'PARTNER_GATEWAY_URL', '').replace(/\/+$/, '');
  const settings = {
    port: integer(env, 'PARTNER_MOCK_PORT', 3021),
    bankCode: text(env, 'PARTNER_MOCK_BANK_CODE', 'BANK99'),
    ourBankCode: text(env, 'INTERBANK_BANK_CODE', 'BANK02'),
    // La URL base de NUESTRO banco, con el prefijo del contrato: se acepta con o sin él.
    ourBaseUrl:
      gatewayUrl === '' || gatewayUrl.endsWith('/interbank/v1')
        ? gatewayUrl
        : `${gatewayUrl}/interbank/v1`,
    requireApiKey: text(env, 'PARTNER_MOCK_API_KEY', ''),
    sendApiKey: text(env, 'PARTNER_MOCK_CALLBACK_API_KEY', ''),
    adminToken: text(env, 'PARTNER_MOCK_ADMIN_TOKEN', ''),
    originAccount: text(env, 'PARTNER_MOCK_ORIGIN_ACCOUNT', '99-000000001'),
    requireTraceparent: flag(env, 'PARTNER_MOCK_REQUIRE_TRACEPARENT', true),
    callbackRetryBaseMs: integer(env, 'PARTNER_MOCK_CALLBACK_RETRY_BASE_MS', 2_000),
    callbackRetryMaxMs: integer(env, 'PARTNER_MOCK_CALLBACK_RETRY_MAX_MS', 300_000),
    callbackMaxAttempts: integer(env, 'PARTNER_MOCK_CALLBACK_MAX_ATTEMPTS', 12),
    callbackTimeoutMs: integer(env, 'PARTNER_MOCK_CALLBACK_TIMEOUT_MS', 5_000),
    otlpEndpoint: text(env, 'OTEL_EXPORTER_OTLP_ENDPOINT', ''),
    telemetryDisabled: env.OTEL_SDK_DISABLED === 'true',
  };

  const targets = text(env, 'PARTNER_CALLBACK_FAIL_TARGETS', DEFAULT_FAULTS.failTargets.join(','))
    .split(',')
    .map((target) => target.trim())
    .filter((target) => target.length > 0);
  const rate = env.PARTNER_CALLBACK_FAILURE_RATE;
  const faults = {
    mode: text(env, 'PARTNER_CALLBACK_MODE', DEFAULT_FAULTS.mode),
    rejectReason: text(env, 'PARTNER_CALLBACK_REJECT_REASON', DEFAULT_FAULTS.rejectReason),
    delayMs: integer(env, 'PARTNER_CALLBACK_DELAY_MS', DEFAULT_FAULTS.delayMs),
    slowMs: integer(env, 'PARTNER_CALLBACK_SLOW_MS', DEFAULT_FAULTS.slowMs),
    ackDelayMs: integer(env, 'PARTNER_CALLBACK_ACK_DELAY_MS', DEFAULT_FAULTS.ackDelayMs),
    failCount: integer(env, 'PARTNER_CALLBACK_FAIL_COUNT', DEFAULT_FAULTS.failCount),
    failTargets: targets,
    failureRate: rate === undefined || rate === '' ? DEFAULT_FAULTS.failureRate : Number(rate),
    statusBehavior: text(env, 'PARTNER_CALLBACK_STATUS_BEHAVIOR', DEFAULT_FAULTS.statusBehavior),
    honorExpiry: flag(env, 'PARTNER_CALLBACK_HONOR_EXPIRY', DEFAULT_FAULTS.honorExpiry),
    reversal: text(env, 'PARTNER_CALLBACK_REVERSAL', DEFAULT_FAULTS.reversal),
  };
  const problems = faultProblems(faults);
  if (problems.length > 0)
    throw new Error(`Configuración de fallos inválida: ${problems.join('; ')}`);

  return { settings, faults };
}
