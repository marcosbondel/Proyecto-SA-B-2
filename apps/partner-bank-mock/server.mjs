/**
 * partner-bank-mock — el banco pareja simulado (T-57, reescrito en T-60 / B8).
 *
 * Implementa el contrato interbancario OFICIAL del curso
 * (`docs/references/interbank-contract-v1.openapi.yaml`, v1.0.0) en sus DOS roles,
 * porque cada banco es a la vez receptor y emisor. Sirve para desarrollo local,
 * para inyectar fallos y para las pruebas de carga; es el último recurso de
 * evaluación si el banco pareja real no está disponible (§4.1 del enunciado).
 *
 * El contrato provisional anterior (Bearer, `/api/interbank/*`, `/deposits`)
 * está retirado y este proceso ya no lo habla.
 *
 * ---------------------------------------------------------------------------
 * RUTAS
 * ---------------------------------------------------------------------------
 * Sin autenticación
 *   GET  /health                              {status, bankCode, callbackMode, callbackDelayMs, faults}
 *   GET  /interbank/v1/health                 {status: UP, bankCode}   (503 en modo UNAVAILABLE)
 *
 * Receptor — `X-Api-Key` = PARTNER_MOCK_API_KEY, `traceparent` obligatorio
 *   POST /interbank/v1/transfers              202 · 200 repetido · 409 · 400 · 401 · 422
 *   GET  /interbank/v1/transfers/{id}         estado del depósito
 *   POST /interbank/v1/transfers/{id}/cancel  CANCELLED | ALREADY_ACCEPTED | ALREADY_REJECTED
 *   POST /interbank/v1/reversals              202
 *   GET  /interbank/v1/reversals/{id}
 *   GET  /interbank/v1/reconciliation?date=&page=&pageSize=
 *
 * Emisor — lo que NUESTRO banco contesta
 *   POST /interbank/v1/transfers/{id}/result  el callback de nuestro banco (200)
 *
 * Administración — `X-Admin-Token` = PARTNER_MOCK_ADMIN_TOKEN (sin él, 403)
 *   GET  /admin/config                        fallos armados + contadores restantes
 *   PUT  /admin/config                        cambia fallos EN CALIENTE (parche parcial)
 *   POST /admin/reset                         borra el estado y restaura los fallos iniciales
 *   GET  /admin/received[/{id}]               lo que el mock recibió de nosotros
 *   POST /admin/received/{id}/callback        fuerza el desenlace {status, reasonCode?} y manda el callback
 *   POST /admin/transfers                     ORIGINA un depósito hacia nuestro banco
 *   GET  /admin/transfers[/{id}]              lo que enviamos, lo que contestó nuestro banco y el callback
 *
 * `POST /admin/transfers` recibe
 *   { destinationAccount, amount ("150.00" o 150), description?, originAccount?,
 *     repeat?: n          reenvía n veces la solicitud IDÉNTICA (misma Idempotency-Key),
 *     interbankTransferId?, expiresInSeconds?, idempotencyKey?,
 *     apiKey?: string|null   (null = sin X-Api-Key),
 *     overrides?: {campo: valor|null}  (mandar algo inválido a propósito; null borra el campo) }
 *
 * ---------------------------------------------------------------------------
 * VARIABLES DE ENTORNO
 * ---------------------------------------------------------------------------
 * Identidad y conexión
 *   PARTNER_MOCK_PORT              3021
 *   PARTNER_MOCK_BANK_CODE         BANK99   código del mock (el INTERBANK_PARTNER_BANK_CODE de nuestro banco)
 *   INTERBANK_BANK_CODE            BANK02   código de NUESTRO banco
 *   PARTNER_GATEWAY_URL            URL de nuestro Gateway, p. ej. http://gateway:3000. Se le añade
 *                                  `/interbank/v1` (si ya lo trae, se respeta). Es la URL base a la que
 *                                  el mock manda callbacks y depósitos.
 *   PARTNER_MOCK_API_KEY           la llave que el mock EXIGE en X-Api-Key = nuestro INTERBANK_API_KEY_OUTBOUND.
 *                                  Vacía = el mock rechaza todo con 401 (falla cerrado).
 *   PARTNER_MOCK_CALLBACK_API_KEY  la llave que el mock ENVÍA a nuestro banco = nuestro INTERBANK_API_KEY_INBOUND.
 *   PARTNER_MOCK_ADMIN_TOKEN       token de /admin/*. Vacío = administración deshabilitada.
 *   PARTNER_MOCK_ORIGIN_ACCOUNT    99-000000001   cuenta origen de los depósitos que el mock origina
 *   PARTNER_MOCK_REQUIRE_TRACEPARENT  true       400 si falta `traceparent` en una petición del contrato
 *
 * Entrega del callback (el receptor reintenta con espera creciente, como pide el contrato)
 *   PARTNER_MOCK_CALLBACK_RETRY_BASE_MS  2000    1.ª espera; se duplica en cada intento
 *   PARTNER_MOCK_CALLBACK_RETRY_MAX_MS   300000  tope de la espera
 *   PARTNER_MOCK_CALLBACK_MAX_ATTEMPTS   12
 *   PARTNER_MOCK_CALLBACK_TIMEOUT_MS     5000    plazo de cada llamada HTTP saliente
 *
 * Fallos iniciales (todos cambian en caliente con PUT /admin/config; los nombres JSON van entre paréntesis)
 *   PARTNER_CALLBACK_MODE          ACCEPT (mode)   ACCEPT | REJECT | TIMEOUT | SLOW | UNAVAILABLE
 *       ACCEPT       202 y, tras delayMs, callback ACCEPTED (salvo cuenta ...999999999 → ACCOUNT_NOT_FOUND,
 *                    ...000000000 → ACCOUNT_INACTIVE, monto > 10000.00 → AMOUNT_LIMIT_EXCEEDED, banco
 *                    destino distinto → PROCESSING_ERROR)
 *       REJECT       callback REJECTED con rejectReason tras delayMs
 *       TIMEOUT      acepta el depósito (202) y NUNCA manda callback; el estado queda PROCESSING
 *       SLOW         como ACCEPT pero el callback sale tras slowMs
 *       UNAVAILABLE  todo el contrato responde 503 + Retry-After (también /interbank/v1/health)
 *   PARTNER_CALLBACK_DELAY_MS      1000  (delayMs)   espera antes del callback en ACCEPT y REJECT
 *   PARTNER_CALLBACK_SLOW_MS       10000 (slowMs)    espera antes del callback en SLOW
 *   PARTNER_CALLBACK_ACK_DELAY_MS  0     (ackDelayMs) retrasa también el 202 (receptor lento)
 *   PARTNER_CALLBACK_REJECT_REASON ACCOUNT_NOT_FOUND (rejectReason)  uno de los siete motivos del contrato
 *   PARTNER_CALLBACK_STATUS_BEHAVIOR PROCESSING (statusBehavior) cómo contestan GET y cancel de un depósito sin
 *                                  desenlace: PROCESSING (normal) | NOT_FOUND (GET 404, como si nunca llegó) |
 *                                  UNREACHABLE (corta la conexión en GET y cancel, para cualquier id)
 *   PARTNER_CALLBACK_FAIL_COUNT    0     (failCount)  las primeras N operaciones de cada objetivo fallan
 *   PARTNER_CALLBACK_FAIL_TARGETS  result (failTargets) lista separada por comas de:
 *                                  result    nuestro callback al mock responde 503 N veces (prueba NUESTROS reintentos)
 *                                  transfer  POST /transfers y /reversals responden 503 N veces
 *                                  status    GET /transfers/{id} y cancel responden 503 N veces
 *                                  callback  los intentos del callback del mock fallan N veces y el mock reintenta
 *   PARTNER_CALLBACK_FAILURE_RATE  0     (failureRate) % de fallo aleatorio sobre esos mismos objetivos
 *   PARTNER_CALLBACK_HONOR_EXPIRY  true  (honorExpiry) false = acredita aunque haya vencido (ACCEPTED tardío)
 *   PARTNER_CALLBACK_REVERSAL      COMPLETE (reversal) COMPLETE | FAIL | STALL para POST /reversals
 *
 * Observabilidad
 *   OTEL_EXPORTER_OTLP_ENDPOINT    p. ej. http://otel-collector:4318 — exporta los spans (service.name =
 *                                  partner-bank-mock) con el MISMO traceId que trae `traceparent`
 *   OTEL_SDK_DISABLED              true apaga la exportación (el traceparent se propaga igual)
 *   DEPLOYMENT_ENVIRONMENT, SERVICE_VERSION   etiquetas de logs y spans
 *
 * Logs: una línea de JSON por petición y por cambio de estado, en stdout. Nunca llevan llaves ni tokens.
 */
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createPartnerBankMock } from './src/app.mjs';
import { readConfig } from './src/config.mjs';
import { createLogger } from './src/logger.mjs';

export { createPartnerBankMock };
export { readConfig };

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const log = createLogger();
  const { settings, faults } = readConfig(process.env);
  if (settings.requireApiKey === '') {
    log.warn('config_warning', {
      message: 'PARTNER_MOCK_API_KEY vacía: el contrato rechazará toda petición con 401',
    });
  }
  const server = createPartnerBankMock({ settings, faults, log });
  server.listen(settings.port, () => {
    log.info('listening', {
      port: settings.port,
      bankCode: settings.bankCode,
      ourBaseUrl: settings.ourBaseUrl,
      mode: faults.mode,
      adminEnabled: settings.adminToken.length > 0,
    });
  });
  for (const signal of ['SIGTERM', 'SIGINT']) {
    process.once(signal, () => server.close(() => process.exit(0)));
  }
}
