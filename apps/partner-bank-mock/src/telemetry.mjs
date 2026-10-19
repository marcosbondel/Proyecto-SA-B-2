/**
 * Trazas del mock, sin dependencias.
 *
 * `@bank/observability` registra el SDK de OpenTelemetry y parchea `http`,
 * Express y `pg`; es un paquete de TypeScript compilado a CommonJS con catorce
 * dependencias de OTel. Usarlo desde aquí obligaría a que la imagen del mock
 * lleve `node_modules` y el paquete compilado, cuando hoy es un `node server.mjs`
 * de un solo directorio que el Compose de desarrollo monta como volumen. Por
 * eso este módulo hace lo único que el mock necesita:
 *
 * 1. **Propagar `traceparent` correctamente.** Cada petición que entra abre un
 *    span SERVER hijo del que traía; cada llamada que sale lleva un span CLIENT
 *    como padre. El `traceId` es el mismo de punta a punta, que es lo que
 *    permite ver en Tempo el depósito cruzando los dos bancos. Esto funciona
 *    siempre, con o sin colector.
 * 2. **Exportar los spans por OTLP/HTTP (JSON)** a `OTEL_EXPORTER_OTLP_ENDPOINT`
 *    cuando está definido, con `service.name = partner-bank-mock`. Sin
 *    endpoint, o con `OTEL_SDK_DISABLED=true`, los spans se descartan.
 *
 * El exportador es de mejor esfuerzo: un colector caído nunca rompe una
 * petición, y el fallo se avisa una sola vez.
 */
import { randomBytes } from 'node:crypto';

import { TRACEPARENT_PATTERN } from './contract.mjs';

const SERVER = 2;
const CLIENT = 3;

export const newTraceId = () => randomBytes(16).toString('hex');
export const newSpanId = () => randomBytes(8).toString('hex');

/** `00-<traceId>-<spanId>-<flags>` → sus partes, o `null` si no es válido (o es todo ceros). */
export function parseTraceparent(header) {
  if (typeof header !== 'string' || !TRACEPARENT_PATTERN.test(header)) return null;
  const [, traceId, spanId, flags] = header.split('-');
  if (/^0+$/.test(traceId) || /^0+$/.test(spanId)) return null;
  return { traceId, spanId, flags };
}

function attributeValue(value) {
  if (typeof value === 'boolean') return { boolValue: value };
  if (Number.isInteger(value)) return { intValue: String(value) };
  return { stringValue: String(value) };
}

const toNano = (ms) => (BigInt(Math.round(ms)) * 1_000_000n).toString();

export function createTelemetry({
  endpoint = '',
  disabled = false,
  serviceName = 'partner-bank-mock',
  version = '',
  environment = '',
  fetchImpl = fetch,
  flushIntervalMs = 2_000,
  maxBuffered = 512,
  now = () => Date.now(),
  onExportError = () => {},
} = {}) {
  const exporting = !disabled && endpoint.length > 0;
  const url = exporting ? `${endpoint.replace(/\/+$/, '')}/v1/traces` : '';
  let buffer = [];
  let warned = false;
  let timer = null;

  async function flush() {
    if (!exporting || buffer.length === 0) return;
    const spans = buffer;
    buffer = [];
    const resourceAttributes = [
      ['service.name', serviceName],
      ['service.version', version],
      ['deployment.environment', environment],
    ]
      .filter(([, value]) => value.length > 0)
      .map(([key, value]) => ({ key, value: { stringValue: value } }));
    try {
      const response = await fetchImpl(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        signal: AbortSignal.timeout(3_000),
        body: JSON.stringify({
          resourceSpans: [
            {
              resource: { attributes: resourceAttributes },
              scopeSpans: [{ scope: { name: serviceName }, spans }],
            },
          ],
        }),
      });
      if (!response.ok) throw new Error(`OTLP ${response.status}`);
    } catch (error) {
      if (!warned) {
        warned = true;
        onExportError(error);
      }
    }
  }

  if (exporting) {
    timer = setInterval(() => void flush(), flushIntervalMs);
    timer.unref();
  }

  function startSpan({ name, kind = 'server', parent = null, attributes = {} }) {
    const traceId = parent?.traceId ?? newTraceId();
    const spanId = newSpanId();
    const flags = parent?.flags ?? '01';
    const startedAt = now();
    const collected = { ...attributes };
    let ended = false;
    return {
      traceId,
      spanId,
      /** El header que el siguiente salto debe llevar: este span es su padre. */
      traceparent: `00-${traceId}-${spanId}-${flags}`,
      setAttribute(key, value) {
        collected[key] = value;
      },
      end({ error = null } = {}) {
        if (ended) return;
        ended = true;
        if (!exporting) return;
        buffer.push({
          traceId,
          spanId,
          ...(parent === null ? {} : { parentSpanId: parent.spanId }),
          name,
          kind: kind === 'client' ? CLIENT : SERVER,
          startTimeUnixNano: toNano(startedAt),
          endTimeUnixNano: toNano(now()),
          attributes: Object.entries(collected)
            .filter(([, value]) => value !== undefined && value !== null)
            .map(([key, value]) => ({ key, value: attributeValue(value) })),
          status: error === null ? { code: 1 } : { code: 2, message: String(error) },
        });
        if (buffer.length >= maxBuffered) void flush();
      },
    };
  }

  return {
    exporting,
    startSpan,
    flush,
    async shutdown() {
      if (timer !== null) clearInterval(timer);
      await flush();
    },
  };
}
