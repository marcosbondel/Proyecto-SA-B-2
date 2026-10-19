/**
 * El banco pareja simulado: el contrato interbancario v1 en sus dos roles.
 *
 * Un banco real es a la vez **receptor** (recibe depósitos, los acredita o
 * rechaza y avisa por callback) y **emisor** (envía depósitos, recibe el
 * callback, consulta y cancela). El mock hace las dos cosas, y por eso tiene
 * dos mitades que no se mezclan:
 *
 * - Receptor (`/interbank/v1/*`, lo que NUESTRO banco le envía): se porta según
 *   los fallos armados — `ACCEPT`, `REJECT`, `TIMEOUT`, `SLOW`, `UNAVAILABLE`
 *   más los contadores y las tasas — y contesta con un callback real a
 *   `{nuestra URL base}/transfers/{id}/result`.
 * - Emisor (`/admin/transfers`, lo que se le pide al mock que ORIGINE hacia
 *   nuestro banco): prueba **nuestra** ruta de entrada, incluida la idempotencia
 *   (reenvío idéntico) que nos impide acreditar dos veces.
 *
 * La API de administración (`/admin/*`, con `X-Admin-Token`) es lo único que no
 * es del contrato. Cambia los fallos en caliente, sin reiniciar.
 */
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';

import { patchFaults } from './config.mjs';
import {
  MAX_AMOUNT_MINOR,
  MIN_AMOUNT_MINOR,
  TRANSFER_TTL_MS,
  errorBody,
  isDate,
  isUuid,
  sameContent,
  toMinor,
  validate,
} from './contract.mjs';
import { createLogger } from './logger.mjs';
import { createTelemetry, parseTraceparent } from './telemetry.mjs';

const PREFIX = '/interbank/v1';
const MAX_BODY_BYTES = 65_536;
/** Cuentas que el mock trata como inexistentes o inactivas, según el acuerdo (§9). */
const NOT_FOUND_ACCOUNT = /999999999$/;
const INACTIVE_ACCOUNT = /000000000$/;

/** Fecha sin milisegundos: la forma de los ejemplos del contrato y la más portable. */
const iso = (date) => date.toISOString().replace(/\.\d{3}Z$/, 'Z');

const digest = (value) => createHash('sha256').update(value).digest();
function secretMatches(expected, presented) {
  if (expected.length === 0 || typeof presented !== 'string') return false;
  return timingSafeEqual(digest(expected), digest(presented));
}

class HttpError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const badRequest = (message) => new HttpError(400, 'VALIDATION_ERROR', message);

export function createPartnerBankMock({
  settings,
  faults: initialFaults,
  log = createLogger(),
  telemetry = createTelemetry({
    endpoint: settings.otlpEndpoint,
    disabled: settings.telemetryDisabled,
    version: process.env.SERVICE_VERSION ?? '',
    environment: process.env.DEPLOYMENT_ENVIRONMENT ?? '',
    onExportError: (error) =>
      log.warn('telemetry_export_failed', {
        message: error instanceof Error ? error.message : String(error),
      }),
  }),
  now = () => new Date(),
  random = Math.random,
  fetchImpl = fetch,
}) {
  let faults = { ...initialFaults };
  let remaining = {};
  /** Lo que ESTE banco recibió de nosotros, por `interbankTransferId`. */
  const received = new Map();
  const reversals = new Map();
  /** Lo que ESTE banco originó hacia nosotros, por `interbankTransferId`. */
  const outbound = new Map();
  const timers = new Set();

  function armCounters() {
    remaining = Object.fromEntries(faults.failTargets.map((target) => [target, faults.failCount]));
  }
  armCounters();

  // ---- tiempo -----------------------------------------------------------

  /** Una espera que `close()` y `reset` pueden cancelar, y que no retiene el proceso. */
  function wait(ms) {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        timers.delete(timer);
        resolve();
      }, ms);
      timer.unref();
      timers.add(timer);
    });
  }

  function schedule(ms, task) {
    const timer = setTimeout(() => {
      timers.delete(timer);
      void task();
    }, ms);
    timer.unref();
    timers.add(timer);
    return timer;
  }

  function clearTimers() {
    for (const timer of timers) clearTimeout(timer);
    timers.clear();
  }

  // ---- inyección de fallos ----------------------------------------------

  /** ¿Esta operación falla por un contador o por la tasa aleatoria? `target` ∈ result|transfer|status|callback. */
  function injectedFailure(target) {
    if (!faults.failTargets.includes(target)) return null;
    if ((remaining[target] ?? 0) > 0) {
      remaining[target] -= 1;
      return 'fail-count';
    }
    if (faults.failureRate > 0 && random() * 100 < faults.failureRate) return 'failure-rate';
    return null;
  }

  function unavailable(target, context) {
    const reason = injectedFailure(target);
    if (reason === null) return;
    log.warn('fault_injected', { kind: reason, target, ...context });
    throw new HttpError(503, 'SERVICE_UNAVAILABLE', 'Fallo inyectado por el banco simulado');
  }

  // ---- estado -----------------------------------------------------------

  function transition(record, status, reasonCode, reasonMessage, context = {}) {
    const from = record.status;
    record.status = status;
    if (reasonCode === undefined) delete record.reasonCode;
    else record.reasonCode = reasonCode;
    if (reasonMessage === undefined) delete record.reasonMessage;
    else record.reasonMessage = reasonMessage;
    record.updatedAt = iso(now());
    record.history.push({
      at: record.updatedAt,
      status,
      ...(reasonCode === undefined ? {} : { reasonCode }),
    });
    log.info('transfer_state', {
      interbankTransferId: record.id,
      from,
      to: status,
      ...(reasonCode === undefined ? {} : { reasonCode }),
      ...context,
    });
  }

  function newRecord(id, request, traceparent) {
    const at = iso(now());
    return {
      id,
      request,
      status: 'PROCESSING',
      receivedAt: at,
      updatedAt: at,
      history: [{ at, status: 'PROCESSING' }],
      traceparent,
      timer: null,
      callback: { state: 'NONE', attempts: 0 },
    };
  }

  const statusOf = (record) => ({
    interbankTransferId: record.id,
    status: record.status,
    ...(record.reasonCode === undefined ? {} : { reasonCode: record.reasonCode }),
    updatedAt: record.updatedAt,
  });

  const omit = (record, ...keys) =>
    Object.fromEntries(Object.entries(record).filter(([key]) => !keys.includes(key)));
  const summary = (record) => omit(record, 'timer');

  // ---- receptor: qué se decide y cuándo ---------------------------------

  /** Lo que el mock decidirá para un depósito, fijado al recibirlo. `null` = nunca contesta. */
  function plan(request) {
    if (faults.mode === 'TIMEOUT') return null;
    if (faults.mode === 'REJECT') {
      return { status: 'REJECTED', reasonCode: faults.rejectReason, delayMs: faults.delayMs };
    }
    const delayMs = faults.mode === 'SLOW' ? faults.slowMs : faults.delayMs;
    const rejection = businessRejection(request);
    return rejection === null
      ? { status: 'ACCEPTED', delayMs }
      : { status: 'REJECTED', ...rejection, delayMs };
  }

  function businessRejection(request) {
    if (request.destinationBankCode !== settings.bankCode) {
      return { reasonCode: 'PROCESSING_ERROR', reasonMessage: 'El banco destino no es este banco' };
    }
    if (toMinor(request.amount) > MAX_AMOUNT_MINOR) {
      return {
        reasonCode: 'AMOUNT_LIMIT_EXCEEDED',
        reasonMessage: 'Excede el máximo por operación',
      };
    }
    if (NOT_FOUND_ACCOUNT.test(request.destinationAccount)) {
      return { reasonCode: 'ACCOUNT_NOT_FOUND', reasonMessage: 'La cuenta destino no existe' };
    }
    if (INACTIVE_ACCOUNT.test(request.destinationAccount)) {
      return { reasonCode: 'ACCOUNT_INACTIVE', reasonMessage: 'La cuenta destino está inactiva' };
    }
    return null;
  }

  /** Llega la hora de decidir un depósito: aplica el plan, salvo que ya no proceda. */
  function settle(record, decision) {
    record.timer = null;
    if (record.status !== 'PROCESSING') {
      log.info('decision_skipped', { interbankTransferId: record.id, status: record.status });
      return;
    }
    let { status, reasonCode, reasonMessage } = decision;
    if (faults.honorExpiry && now().getTime() >= Date.parse(record.request.expiresAt)) {
      // El contrato: el receptor no acredita después de `expiresAt`.
      status = 'REJECTED';
      reasonCode = 'EXPIRED';
      reasonMessage = 'El depósito venció antes de procesarse';
    }
    transition(record, status, reasonCode, reasonMessage);
    void deliverCallback(record);
  }

  // ---- receptor: el callback hacia nosotros -----------------------------

  function resultBody(record) {
    // Un depósito que llegó DESPUÉS de su cancelación está CANCELLED aquí y se informa REJECTED/CANCELLED.
    const outcome = record.callbackOverride ?? {
      status: record.status,
      ...(record.reasonCode === undefined ? {} : { reasonCode: record.reasonCode }),
      ...(record.reasonMessage === undefined ? {} : { reasonMessage: record.reasonMessage }),
    };
    return {
      interbankTransferId: record.id,
      destinationBankCode: settings.bankCode,
      ...outcome,
      processedAt: record.updatedAt,
    };
  }

  /**
   * `POST {nuestra URL base}/transfers/{id}/result`, con la espera creciente que
   * el contrato le exige al receptor (2 s, 4 s, 8 s…). Reintenta lo transitorio
   * (5xx, red, fallo inyectado) y se detiene ante lo que un reintento no arregla
   * (4xx): un 404 significa que el emisor no conoce ese id, y repetirlo no lo
   * hará conocerlo.
   */
  async function deliverCallback(record) {
    const callback = { state: 'PENDING', attempts: 0 };
    record.callback = callback;
    if (settings.ourBaseUrl === '') {
      callback.state = 'GAVE_UP';
      callback.lastError = 'PARTNER_GATEWAY_URL no está configurada';
      log.error('callback_not_sent', {
        interbankTransferId: record.id,
        message: callback.lastError,
      });
      return;
    }
    const parent = parseTraceparent(record.traceparent);
    const body = resultBody(record);

    while (callback.attempts < settings.callbackMaxAttempts) {
      callback.attempts += 1;
      const attempt = callback.attempts;
      const span = telemetry.startSpan({
        name: 'POST /interbank/v1/transfers/{id}/result',
        kind: 'client',
        parent,
        attributes: { 'http.request.method': 'POST', 'bank.interbank.transfer_id': record.id },
      });

      let outcome = injectedFailure('callback');
      let httpStatus;
      if (outcome === null) {
        try {
          const response = await fetchImpl(`${settings.ourBaseUrl}/transfers/${record.id}/result`, {
            method: 'POST',
            redirect: 'error',
            signal: AbortSignal.timeout(settings.callbackTimeoutMs),
            headers: {
              'content-type': 'application/json',
              'x-api-key': settings.sendApiKey,
              traceparent: span.traceparent,
            },
            body: JSON.stringify(body),
          });
          httpStatus = response.status;
          await response.arrayBuffer().catch(() => undefined);
          outcome = response.ok ? 'delivered' : httpStatus >= 500 ? 'retry' : 'rejected';
        } catch (error) {
          outcome = 'retry';
          callback.lastError = error instanceof Error ? error.message : String(error);
        }
      } else {
        callback.lastError = `fallo inyectado (${outcome})`;
      }
      span.setAttribute('http.response.status_code', httpStatus);
      span.end({
        error: outcome === 'delivered' ? null : (callback.lastError ?? `HTTP ${httpStatus}`),
      });
      callback.lastHttpStatus = httpStatus;
      log.info('callback_attempt', {
        interbankTransferId: record.id,
        attempt,
        outcome,
        status: body.status,
        ...(httpStatus === undefined ? {} : { httpStatus }),
        traceId: span.traceId,
        spanId: span.spanId,
      });

      if (outcome === 'delivered') {
        callback.state = 'DELIVERED';
        return;
      }
      if (outcome === 'rejected') {
        callback.state = 'GAVE_UP';
        log.error('callback_rejected', { interbankTransferId: record.id, httpStatus });
        return;
      }
      await wait(
        Math.min(settings.callbackRetryBaseMs * 2 ** (attempt - 1), settings.callbackRetryMaxMs),
      );
    }
    callback.state = 'GAVE_UP';
    log.error('callback_gave_up', { interbankTransferId: record.id, attempts: callback.attempts });
  }

  // ---- emisor: enviar un depósito a nuestro banco ------------------------

  /** `POST {nuestra URL base}/transfers`. Nunca lanza: el resultado, bueno o malo, es el dato. */
  async function sendTransfer(request, { idempotencyKey, apiKey, parent = null } = {}) {
    const span = telemetry.startSpan({
      name: 'POST /interbank/v1/transfers',
      kind: 'client',
      parent,
      attributes: {
        'http.request.method': 'POST',
        'bank.interbank.transfer_id': request.interbankTransferId,
      },
    });
    const sent = { at: iso(now()), request, traceparent: span.traceparent, traceId: span.traceId };
    try {
      if (settings.ourBaseUrl === '') throw new Error('PARTNER_GATEWAY_URL no está configurada');
      const key = apiKey === undefined ? settings.sendApiKey : apiKey;
      const response = await fetchImpl(`${settings.ourBaseUrl}/transfers`, {
        method: 'POST',
        redirect: 'error',
        signal: AbortSignal.timeout(settings.callbackTimeoutMs),
        headers: {
          'content-type': 'application/json',
          ...(key === null ? {} : { 'x-api-key': key }),
          'idempotency-key': idempotencyKey ?? request.interbankTransferId,
          traceparent: span.traceparent,
        },
        body: JSON.stringify(request),
      });
      sent.httpStatus = response.status;
      const text = await response.text();
      try {
        sent.body = JSON.parse(text);
      } catch {
        sent.body = text;
      }
      span.setAttribute('http.response.status_code', response.status);
      span.end();
    } catch (error) {
      sent.error = error instanceof Error ? error.message : String(error);
      span.end({ error: sent.error });
    }
    log.info('outbound_sent', {
      interbankTransferId: request.interbankTransferId,
      httpStatus: sent.httpStatus,
      ...(sent.error === undefined ? {} : { error: sent.error }),
      traceId: span.traceId,
      spanId: span.spanId,
    });
    return sent;
  }

  function buildOutboundRequest(input) {
    const createdAt = now();
    const expiresInMs = (input.expiresInSeconds ?? TRANSFER_TTL_MS / 1000) * 1000;
    const amount = typeof input.amount === 'number' ? input.amount.toFixed(2) : input.amount;
    const request = {
      interbankTransferId: input.interbankTransferId ?? randomUUID(),
      originBankCode: settings.bankCode,
      destinationBankCode: settings.ourBankCode,
      originAccount: input.originAccount ?? settings.originAccount,
      destinationAccount: input.destinationAccount,
      amount,
      currency: 'GTQ',
      ...(input.description === undefined ? {} : { description: input.description }),
      createdAt: iso(createdAt),
      expiresAt: iso(new Date(createdAt.getTime() + expiresInMs)),
    };
    // `overrides` existe para mandar a propósito algo inválido y ver que lo rechazamos.
    for (const [key, value] of Object.entries(input.overrides ?? {})) {
      if (value === null) delete request[key];
      else request[key] = value;
    }
    return request;
  }

  function recordOutbound(request, kind) {
    const id = request.interbankTransferId;
    let entry = outbound.get(id);
    if (entry === undefined) {
      entry = { id, kind, request, status: 'SENT', sends: [], callbacks: [] };
      // El banco que recibe es el de la URL base, sea cual sea el código que lleve la solicitud.
      if (request.destinationBankCode !== settings.ourBankCode) {
        entry.destinationBankCodeMismatch = {
          requested: request.destinationBankCode,
          receiver: settings.ourBankCode,
        };
      }
      outbound.set(id, entry);
    }
    return entry;
  }

  // ---- reversos ----------------------------------------------------------

  async function processReversal(reversal, original) {
    const fail = (message) => {
      reversal.status = 'FAILED';
      reversal.reasonMessage = message;
      log.warn('reversal_state', { reversalId: reversal.reversalId, status: 'FAILED', message });
    };
    if (faults.reversal === 'STALL') return;
    if (faults.reversal === 'FAIL') return fail('Fallo inyectado por el banco simulado');
    if (original.status !== 'ACCEPTED') return fail('El depósito original no fue acreditado');
    if (toMinor(reversal.request.amount) !== toMinor(original.request.amount)) {
      return fail('El monto no coincide con el depósito original');
    }
    // El contrato: la devolución es un depósito NUEVO hacia el emisor, por el flujo normal.
    const refund = buildOutboundRequest({
      destinationAccount: original.request.originAccount,
      originAccount: original.request.destinationAccount,
      amount: original.request.amount,
      description: `Reverso ${reversal.reversalId}`.slice(0, 140),
    });
    const entry = recordOutbound(refund, 'REFUND');
    const sent = await sendTransfer(refund, { parent: parseTraceparent(reversal.traceparent) });
    entry.sends.push(sent);
    if (sent.httpStatus === 202 || sent.httpStatus === 200) {
      reversal.status = 'COMPLETED';
      reversal.refundTransferId = refund.interbankTransferId;
      log.info('reversal_state', { reversalId: reversal.reversalId, status: 'COMPLETED' });
    } else {
      fail(`Nuestro banco respondió ${sent.httpStatus ?? sent.error} al depósito de devolución`);
    }
  }

  const reversalView = (reversal) => omit(reversal, 'request', 'traceparent');

  // ---- HTTP --------------------------------------------------------------

  async function readJson(request) {
    let size = 0;
    const chunks = [];
    for await (const chunk of request) {
      size += chunk.length;
      if (size > MAX_BODY_BYTES)
        throw new HttpError(413, 'VALIDATION_ERROR', 'Cuerpo demasiado grande');
      chunks.push(chunk);
    }
    try {
      return JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch {
      throw badRequest('El cuerpo no es JSON válido');
    }
  }

  function send(response, status, body, headers = {}) {
    response.writeHead(status, { 'content-type': 'application/json', ...headers });
    response.end(JSON.stringify(body));
  }

  function requireValid(schema, value) {
    const problems = validate(schema, value);
    if (problems.length > 0) throw badRequest(problems.join('; '));
  }

  function requireUuid(value, what) {
    if (!isUuid(value)) throw badRequest(`${what} debe ser un UUID`);
  }

  function publicSettings() {
    return {
      port: settings.port,
      bankCode: settings.bankCode,
      ourBankCode: settings.ourBankCode,
      ourBaseUrl: settings.ourBaseUrl,
      originAccount: settings.originAccount,
      requireTraceparent: settings.requireTraceparent,
      callbackRetryBaseMs: settings.callbackRetryBaseMs,
      callbackMaxAttempts: settings.callbackMaxAttempts,
      requireApiKeyConfigured: settings.requireApiKey.length > 0,
      sendApiKeyConfigured: settings.sendApiKey.length > 0,
      adminEnabled: settings.adminToken.length > 0,
      telemetryExporting: telemetry.exporting,
    };
  }

  const view = () => ({ settings: publicSettings(), faults, remaining });

  /** Cada petición de `/interbank/v1/*` salvo `health`: llave, disponibilidad, traceparent. */
  function guardContract(request) {
    if (!secretMatches(settings.requireApiKey, request.headers['x-api-key'])) {
      throw new HttpError(401, 'UNAUTHORIZED', 'API key ausente o inválida');
    }
    if (faults.mode === 'UNAVAILABLE') {
      throw new HttpError(503, 'SERVICE_UNAVAILABLE', 'El banco simulado está en modo UNAVAILABLE');
    }
    if (settings.requireTraceparent && parseTraceparent(request.headers.traceparent) === null) {
      throw badRequest('El header traceparent es obligatorio (W3C Trace Context)');
    }
  }

  function guardAdmin(request) {
    if (settings.adminToken.length === 0) {
      throw new HttpError(
        403,
        'UNAUTHORIZED',
        'La administración está deshabilitada (PARTNER_MOCK_ADMIN_TOKEN)',
      );
    }
    if (!secretMatches(settings.adminToken, request.headers['x-admin-token'])) {
      throw new HttpError(401, 'UNAUTHORIZED', 'Token de administración ausente o inválido');
    }
  }

  const ROUTES = [];
  const route = (method, pattern, handler) => ROUTES.push({ method, pattern, handler });
  const SEGMENT = '([^/]+)';

  // -- sin autenticación --------------------------------------------------

  route('GET', /^\/health$/, async (context) => {
    // Qué fallo está armado, sin token: es la pregunta que se hace cualquiera que vea un depósito rechazado.
    send(context.response, 200, {
      status: 'ok',
      bankCode: settings.bankCode,
      callbackMode: faults.mode,
      callbackDelayMs: faults.delayMs,
      faults,
    });
  });

  route('GET', new RegExp(`^${PREFIX}/health$`), async (context) => {
    if (faults.mode === 'UNAVAILABLE') {
      throw new HttpError(503, 'SERVICE_UNAVAILABLE', 'El banco simulado está en modo UNAVAILABLE');
    }
    send(context.response, 200, { status: 'UP', bankCode: settings.bankCode });
  });

  // -- receptor -----------------------------------------------------------

  route('POST', new RegExp(`^${PREFIX}/transfers$`), async ({ request, response, span }) => {
    guardContract(request);
    unavailable('transfer', {});
    const body = await readJson(request);
    const key = request.headers['idempotency-key'];
    if (!isUuid(key)) throw badRequest('Idempotency-Key es obligatorio y debe ser un UUID');
    requireValid('TransferRequest', body);
    if (key !== body.interbankTransferId) {
      throw badRequest('Idempotency-Key debe ser igual a interbankTransferId');
    }
    const amountMinor = toMinor(body.amount);
    if (amountMinor < MIN_AMOUNT_MINOR) throw badRequest('amount: el mínimo es 0.01');
    if (body.originBankCode !== settings.ourBankCode) {
      throw new HttpError(
        401,
        'UNAUTHORIZED',
        'El banco que llama no participa en esta transferencia',
      );
    }
    const id = body.interbankTransferId;
    span.setAttribute('bank.interbank.transfer_id', id);

    let record = received.get(id);
    if (record?.request) {
      if (!sameContent(record.request, body)) {
        throw new HttpError(
          409,
          'IDEMPOTENCY_CONFLICT',
          'Ya existe una solicitud con ese id y contenido distinto',
        );
      }
      // Misma solicitud: el estado actual, sin procesar de nuevo. Nunca se acredita dos veces.
      log.info('transfer_replayed', { interbankTransferId: id, status: record.status });
      return send(response, 200, statusOf(record));
    }
    if (Date.parse(body.expiresAt) <= now().getTime()) {
      throw new HttpError(422, 'EXPIRED', 'El mensaje llegó después de expiresAt; no se procesa');
    }

    if (record) {
      // Un `cancel` llegó antes que el depósito: el original no se acredita, y el callback lo dice.
      record.request = body;
      record.traceparent = span.traceparent;
      record.callbackOverride = {
        status: 'REJECTED',
        reasonCode: 'CANCELLED',
        reasonMessage: 'Cancelado antes de llegar',
      };
      log.info('transfer_received', {
        interbankTransferId: id,
        mode: faults.mode,
        decision: 'CANCELLED',
      });
      record.timer = schedule(faults.delayMs, () => {
        record.timer = null;
        void deliverCallback(record);
      });
    } else {
      record = newRecord(id, body, span.traceparent);
      received.set(id, record);
      const decision = plan(body);
      log.info('transfer_received', {
        interbankTransferId: id,
        mode: faults.mode,
        amount: body.amount,
        decision: decision === null ? 'NEVER' : decision.status,
      });
      if (decision !== null)
        record.timer = schedule(decision.delayMs, () => settle(record, decision));
    }

    if (faults.ackDelayMs > 0) await wait(faults.ackDelayMs);
    send(response, 202, {
      interbankTransferId: id,
      status: 'PROCESSING',
      receivedAt: record.receivedAt,
    });
  });

  route(
    'GET',
    new RegExp(`^${PREFIX}/transfers/${SEGMENT}$`),
    async ({ request, response, params }) => {
      guardContract(request);
      requireUuid(params[0], 'interbankTransferId');
      if (faults.statusBehavior === 'UNREACHABLE') return unreachable(response);
      unavailable('status', { interbankTransferId: params[0] });
      const record = received.get(params[0]);
      if (record === undefined || !record.request) {
        throw new HttpError(404, 'NOT_FOUND', 'No hay registro de ese id');
      }
      if (record.status === 'PROCESSING' && faults.statusBehavior === 'NOT_FOUND') {
        throw new HttpError(404, 'NOT_FOUND', 'No hay registro de ese id');
      }
      send(response, 200, statusOf(record));
    },
  );

  route(
    'POST',
    new RegExp(`^${PREFIX}/transfers/${SEGMENT}/cancel$`),
    async ({ request, response, params }) => {
      guardContract(request);
      const id = params[0];
      requireUuid(id, 'interbankTransferId');
      if (faults.statusBehavior === 'UNREACHABLE') return unreachable(response);
      unavailable('status', { interbankTransferId: id });
      // Los campos de más son válidos por contrato: `CancelRequest` no declara additionalProperties.
      requireValid('CancelRequest', await readJson(request));

      let record = received.get(id);
      let result;
      if (record === undefined) {
        // Nunca llegó: se guarda el id para rechazar la llegada tardía del mensaje original.
        record = newRecord(id, null, undefined);
        received.set(id, record);
        transition(record, 'CANCELLED', undefined, undefined, { cause: 'cancel-before-arrival' });
        result = 'CANCELLED';
      } else if (record.status === 'ACCEPTED') {
        result = 'ALREADY_ACCEPTED';
      } else if (record.status === 'REJECTED') {
        result = 'ALREADY_REJECTED';
      } else if (record.status === 'CANCELLED') {
        result = 'CANCELLED';
      } else {
        if (record.timer !== null) clearTimeout(record.timer);
        record.timer = null;
        transition(record, 'CANCELLED', undefined, undefined, { cause: 'cancel' });
        result = 'CANCELLED';
      }
      log.info('transfer_cancel', { interbankTransferId: id, result });
      send(response, 200, { interbankTransferId: id, result });
    },
  );

  route('POST', new RegExp(`^${PREFIX}/reversals$`), async ({ request, response, span }) => {
    guardContract(request);
    unavailable('transfer', {});
    const body = await readJson(request);
    requireValid('ReversalRequest', body);
    const existing = reversals.get(body.reversalId);
    if (existing !== undefined) return send(response, 202, reversalView(existing));

    const original = received.get(body.originalTransferId);
    if (original === undefined || !original.request) {
      throw new HttpError(404, 'NOT_FOUND', 'No hay registro del depósito original');
    }
    const reversal = {
      reversalId: body.reversalId,
      originalTransferId: body.originalTransferId,
      status: 'PROCESSING',
      request: body,
      traceparent: span.traceparent,
    };
    reversals.set(reversal.reversalId, reversal);
    log.info('reversal_state', { reversalId: reversal.reversalId, status: 'PROCESSING' });
    schedule(faults.delayMs, () => processReversal(reversal, original));
    send(response, 202, reversalView(reversal));
  });

  route(
    'GET',
    new RegExp(`^${PREFIX}/reversals/${SEGMENT}$`),
    async ({ request, response, params }) => {
      guardContract(request);
      requireUuid(params[0], 'reversalId');
      const reversal = reversals.get(params[0]);
      if (reversal === undefined)
        throw new HttpError(404, 'NOT_FOUND', 'No hay registro de ese reverso');
      send(response, 200, reversalView(reversal));
    },
  );

  route('GET', new RegExp(`^${PREFIX}/reconciliation$`), async ({ request, response, url }) => {
    guardContract(request);
    const date = url.searchParams.get('date');
    const page = url.searchParams.has('page') ? Number(url.searchParams.get('page')) : 1;
    const pageSize = url.searchParams.has('pageSize')
      ? Number(url.searchParams.get('pageSize'))
      : 100;
    if (date === null || !isDate(date)) {
      throw badRequest('date es obligatorio (YYYY-MM-DD)');
    }
    if (!Number.isInteger(page) || page < 1) throw badRequest('page debe ser un entero >= 1');
    if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 500) {
      throw badRequest('pageSize debe estar entre 1 y 500');
    }
    const rows = [...received.values()]
      .filter((record) => record.request && record.receivedAt.startsWith(date))
      .sort((a, b) => a.receivedAt.localeCompare(b.receivedAt));
    const items = rows.slice((page - 1) * pageSize, page * pageSize).map((record) => ({
      interbankTransferId: record.id,
      amount: record.request.amount,
      currency: record.request.currency,
      status: record.status,
      updatedAt: record.updatedAt,
    }));
    send(response, 200, { date, page, pageSize, totalItems: rows.length, items });
  });

  // -- emisor: nuestros callbacks llegan aquí ------------------------------

  route(
    'POST',
    new RegExp(`^${PREFIX}/transfers/${SEGMENT}/result$`),
    async ({ request, response, params }) => {
      guardContract(request);
      const id = params[0];
      requireUuid(id, 'interbankTransferId');
      unavailable('result', { interbankTransferId: id });
      const body = await readJson(request);
      requireValid('TransferResult', body);
      if (body.interbankTransferId !== id)
        throw badRequest('interbankTransferId no coincide con la ruta');
      const entry = outbound.get(id);
      if (entry === undefined) throw new HttpError(404, 'NOT_FOUND', 'No hay registro de ese id');
      /*
       * Quién llama lo dice la API key (ya validada arriba), no el cuerpo: el
       * callback siempre viene del banco que de verdad recibió la solicitud —el
       * de la URL a la que el mock llamó—, aunque el `destinationBankCode` que
       * el mock puso en ella fuera otro (`overrides` de /admin/transfers). Un
       * 401 aquí haría que nuestro banco reintentara para siempre un rechazo
       * correcto. La diferencia no se esconde: queda marcada en el registro.
       */
      if (body.destinationBankCode !== entry.request.destinationBankCode) {
        entry.destinationBankCodeMismatch = {
          requested: entry.request.destinationBankCode,
          receiver: settings.ourBankCode,
          callback: body.destinationBankCode,
        };
        log.warn('callback_destination_mismatch', {
          interbankTransferId: id,
          requested: entry.request.destinationBankCode,
          callback: body.destinationBankCode,
        });
      }
      const first = entry.callbacks.length === 0;
      const duplicate = entry.callbacks.some((seen) => sameContent(seen.body, body));
      entry.callbacks.push({ receivedAt: iso(now()), duplicate, body });
      if (first) {
        entry.status = body.status;
        if (body.reasonCode !== undefined) entry.reasonCode = body.reasonCode;
      } else if (entry.status !== body.status) {
        // Un ACCEPTED sobre un REJECTED (o al revés) es el incidente que el contrato describe: se registra.
        log.warn('conflicting_callback', {
          interbankTransferId: id,
          recorded: entry.status,
          received: body.status,
        });
      }
      log.info('callback_received', { interbankTransferId: id, status: body.status, duplicate });
      send(response, 200, { interbankTransferId: id, received: true });
    },
  );

  // -- administración -------------------------------------------------------

  route('GET', /^\/admin\/config$/, async ({ request, response }) => {
    guardAdmin(request);
    send(response, 200, view());
  });

  route('PUT', /^\/admin\/config$/, async ({ request, response }) => {
    guardAdmin(request);
    const result = patchFaults(faults, await readJson(request));
    if (result.problems) throw badRequest(result.problems.join('; '));
    faults = result.faults;
    armCounters();
    log.info('config_changed', { faults });
    send(response, 200, view());
  });

  route('POST', /^\/admin\/reset$/, async ({ request, response }) => {
    guardAdmin(request);
    clearTimers();
    received.clear();
    reversals.clear();
    outbound.clear();
    faults = { ...initialFaults };
    armCounters();
    log.info('state_reset', {});
    send(response, 200, view());
  });

  route('GET', /^\/admin\/received$/, async ({ request, response }) => {
    guardAdmin(request);
    send(response, 200, { items: [...received.values()].map(summary) });
  });

  route(
    'GET',
    new RegExp(`^/admin/received/${SEGMENT}$`),
    async ({ request, response, params }) => {
      guardAdmin(request);
      const record = received.get(params[0]);
      if (record === undefined) throw new HttpError(404, 'NOT_FOUND', 'No hay registro de ese id');
      send(response, 200, summary(record));
    },
  );

  // Fuerza el desenlace de un depósito y manda el callback aunque haya vencido: la vía para probar el ACCEPTED tardío.
  route(
    'POST',
    new RegExp(`^/admin/received/${SEGMENT}/callback$`),
    async ({ request, response, params }) => {
      guardAdmin(request);
      const record = received.get(params[0]);
      if (record === undefined || !record.request)
        throw new HttpError(404, 'NOT_FOUND', 'No hay registro de ese id');
      const body = await readJson(request);
      if (!['ACCEPTED', 'REJECTED'].includes(body?.status))
        throw badRequest('status debe ser ACCEPTED o REJECTED');
      if (body.reasonCode !== undefined) requireValid('ReasonCode', body.reasonCode);
      if (record.timer !== null) clearTimeout(record.timer);
      record.timer = null;
      delete record.callbackOverride;
      transition(record, body.status, body.reasonCode, body.reasonMessage, { cause: 'admin' });
      void deliverCallback(record);
      send(response, 202, summary(record));
    },
  );

  route('POST', /^\/admin\/transfers$/, async ({ request, response }) => {
    guardAdmin(request);
    const input = await readJson(request);
    if (
      input === null ||
      typeof input !== 'object' ||
      typeof input.destinationAccount !== 'string'
    ) {
      throw badRequest('destinationAccount es obligatorio');
    }
    if (input.amount === undefined) throw badRequest('amount es obligatorio');
    const repeat = input.repeat ?? 0;
    if (!Number.isInteger(repeat) || repeat < 0 || repeat > 20)
      throw badRequest('repeat debe estar entre 0 y 20');

    const transfer = buildOutboundRequest(input);
    const entry = recordOutbound(transfer, 'ADMIN');
    const options = { idempotencyKey: input.idempotencyKey, apiKey: input.apiKey };
    // `repeat` reenvía la solicitud IDÉNTICA —misma clave de idempotencia— tantas veces como se pida.
    for (let index = 0; index <= repeat; index += 1) {
      entry.sends.push(await sendTransfer(transfer, options));
    }
    const first = entry.sends[0];
    send(response, 202, {
      interbankTransferId: transfer.interbankTransferId,
      traceId: first.traceId,
      sends: entry.sends.slice(-(repeat + 1)).map(({ httpStatus, body, error, traceparent }) => ({
        httpStatus,
        body,
        error,
        traceparent,
      })),
    });
  });

  route('GET', /^\/admin\/transfers$/, async ({ request, response }) => {
    guardAdmin(request);
    send(response, 200, { items: [...outbound.values()] });
  });

  route(
    'GET',
    new RegExp(`^/admin/transfers/${SEGMENT}$`),
    async ({ request, response, params }) => {
      guardAdmin(request);
      const entry = outbound.get(params[0]);
      if (entry === undefined) throw new HttpError(404, 'NOT_FOUND', 'No hay registro de ese id');
      send(response, 200, entry);
    },
  );

  /** Una conexión que se corta sin responder: el «banco inalcanzable» de los sondeos. */
  function unreachable(response) {
    log.warn('fault_injected', { kind: 'unreachable' });
    response.socket?.destroy();
  }

  // ---- servidor ---------------------------------------------------------

  const ID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

  const server = createServer(async (request, response) => {
    const startedAt = now().getTime();
    const url = new URL(request.url ?? '/', 'http://localhost');
    const label = `${request.method} ${url.pathname.replace(ID, '{id}')}`;
    const span = telemetry.startSpan({
      name: label,
      parent: parseTraceparent(request.headers.traceparent),
      attributes: { 'http.request.method': request.method, 'url.path': url.pathname },
    });

    response.on('close', () => {
      span.setAttribute('http.response.status_code', response.statusCode);
      span.end({ error: response.statusCode >= 500 ? `HTTP ${response.statusCode}` : null });
      // `/health` lo consultan los probes cada pocos segundos: no se loguea para no enterrar lo demás.
      if (url.pathname !== '/health') {
        log.info('http_request', {
          method: request.method,
          path: label.slice(request.method.length + 1),
          status: response.statusCode,
          durationMs: now().getTime() - startedAt,
          traceId: span.traceId,
          spanId: span.spanId,
        });
      }
    });

    try {
      const match = ROUTES.map((candidate) => ({
        candidate,
        found: candidate.method === request.method ? candidate.pattern.exec(url.pathname) : null,
      })).find(({ found }) => found !== null);
      if (match === undefined) throw new HttpError(404, 'NOT_FOUND', 'Ruta desconocida');
      await match.candidate.handler({
        request,
        response,
        url,
        span,
        params: match.found.slice(1).map(decodeURIComponent),
      });
    } catch (error) {
      if (response.headersSent || response.destroyed) return;
      if (error instanceof HttpError) {
        send(
          response,
          error.status,
          errorBody(error.code, error.message, now()),
          error.status === 503 ? { 'retry-after': '1' } : {},
        );
      } else {
        log.error('unhandled_error', {
          message: error instanceof Error ? error.message : String(error),
          traceId: span.traceId,
        });
        send(
          response,
          500,
          errorBody('SERVICE_UNAVAILABLE', 'Error interno del banco simulado', now()),
        );
      }
    }
  });

  // `close()` cancela lo pendiente y corta las conexiones en espera: sin esto, una prueba (o un
  // SIGTERM) quedaría esperando un callback programado o un `202` retenido por `ackDelayMs`.
  const closeServer = server.close.bind(server);
  server.close = (callback) => {
    clearTimers();
    const result = closeServer(callback);
    server.closeAllConnections();
    void telemetry.shutdown();
    return result;
  };

  server.mock = {
    get faults() {
      return faults;
    },
    received,
    outbound,
    reversals,
    telemetry,
  };
  return server;
}
