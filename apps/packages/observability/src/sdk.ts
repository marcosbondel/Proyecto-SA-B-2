import type { IncomingMessage } from 'node:http';

import { diag, DiagLogLevel, metrics } from '@opentelemetry/api';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { registerInstrumentations } from '@opentelemetry/instrumentation';
import { ExpressInstrumentation } from '@opentelemetry/instrumentation-express';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { NestInstrumentation } from '@opentelemetry/instrumentation-nestjs-core';
import { PgInstrumentation } from '@opentelemetry/instrumentation-pg';
import { resourceFromAttributes } from '@opentelemetry/resources';
import type { Resource } from '@opentelemetry/resources';
import { MeterProvider, PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import type { IMetricReader } from '@opentelemetry/sdk-metrics';
import { BatchSpanProcessor } from '@opentelemetry/sdk-trace-base';
import type { SpanProcessor } from '@opentelemetry/sdk-trace-base';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from '@opentelemetry/semantic-conventions';

import { identityFrom } from './identity';

/**
 * Registers the OpenTelemetry SDK for one process (Fase 3, §4.1
 * "Instrumentación con OpenTelemetry").
 *
 * Called **once, first**, from each component's `src/instrumentation.ts`, which
 * `src/main.ts` imports before anything else. The order is the whole contract:
 * the HTTP, Express, NestJS and `pg` instrumentations work by patching those
 * modules as they are loaded, and a module required before the patch is never
 * instrumented — with no error, just no spans.
 *
 * What it registers, and what it deliberately does not:
 *
 * - **A tracer provider with the W3C propagator.** `provider.register()`
 *   installs `tracecontext` + `baggage` and an AsyncLocalStorage context
 *   manager, which is what makes the active span survive an `await`. It is
 *   registered **even without an exporter**: propagation across the broker and
 *   the `traceId` on every log line are worth having on a laptop with no
 *   collector, and they cost nothing to keep.
 * - **Exporters only when there is somewhere to export to.** With no
 *   `OTEL_EXPORTER_OTLP_ENDPOINT` the process records spans and drops them,
 *   instead of retrying a `localhost:4318` that does not exist and logging the
 *   failure every few seconds. The chart sets it to the in-cluster Collector
 *   (T-49); Compose sets it when a collector runs.
 * - **No logs over OTLP.** Logs go to stdout as JSON (`JsonLogger`) and the
 *   collection agent ships them; see the comment there.
 * - **No amqplib instrumentation.** `@bank/messaging` injects and extracts
 *   `traceparent` itself, so the propagation the rubric looks for is code this
 *   repository owns and tests, not a monkey-patch of a library major version
 *   the contrib package does not promise to support.
 *
 * `OTEL_SDK_DISABLED=true` turns all of it off, which is the standard switch
 * and the escape hatch if instrumentation is ever the suspect.
 */
export interface TelemetryOptions {
  /** The `service.name` resource attribute: the component, never the pod. */
  readonly serviceName: string;
  /** Defaults to `process.env`. */
  readonly env?: NodeJS.ProcessEnv;
}

export interface TelemetryHandle {
  /** Whether an SDK was registered at all (`false` under `OTEL_SDK_DISABLED`). */
  readonly enabled: boolean;
  /** Whether spans and metrics leave the process (an OTLP endpoint is configured). */
  readonly exporting: boolean;
  readonly resource: Resource | null;
  /** Flushes what is buffered and stops the exporters. Safe to call twice. */
  shutdown(): Promise<void>;
}

/** Probes are called every few seconds by kubelet; tracing them buries every real request. */
const PROBE_PATHS = /^\/(health|ready)(\/|\?|$)/;

/** Fifteen seconds: enough resolution for a burn-rate alert, cheap enough to keep. */
const DEFAULT_METRIC_EXPORT_INTERVAL_MS = 15_000;

let registered: TelemetryHandle | null = null;

export function startTelemetry(options: TelemetryOptions): TelemetryHandle {
  if (registered !== null) {
    return registered;
  }

  const env = options.env ?? process.env;

  if (isTrue(env.OTEL_SDK_DISABLED)) {
    registered = disabledHandle();
    return registered;
  }

  if (isTrue(env.OTEL_DEBUG)) {
    diag.setLogger({ ...console, verbose: console.debug }, DiagLogLevel.WARN);
  }

  // Stable HTTP and database semantic conventions (`http.request.method`,
  // `http.response.status_code`, `db.query.text`) rather than the deprecated
  // names the instrumentations still emit by default. Set before they are
  // constructed, because they read it once — and from `process.env`, whatever
  // `options.env` says.
  process.env.OTEL_SEMCONV_STABILITY_OPT_IN ??= 'http,database';

  const resource = telemetryResource(options.serviceName, env);
  const exporting = nonEmpty(env.OTEL_EXPORTER_OTLP_ENDPOINT) !== undefined;

  const spanProcessors: SpanProcessor[] = exporting
    ? [new BatchSpanProcessor(new OTLPTraceExporter())]
    : [];
  const tracerProvider = new NodeTracerProvider({ resource, spanProcessors });
  tracerProvider.register();

  const readers: IMetricReader[] = exporting
    ? [
        new PeriodicExportingMetricReader({
          exporter: new OTLPMetricExporter(),
          exportIntervalMillis: positiveInteger(
            env.OTEL_METRIC_EXPORT_INTERVAL,
            DEFAULT_METRIC_EXPORT_INTERVAL_MS,
          ),
        }),
      ]
    : [];
  const meterProvider = new MeterProvider({ resource, readers });
  metrics.setGlobalMeterProvider(meterProvider);

  registerInstrumentations({
    tracerProvider,
    meterProvider,
    instrumentations: [
      new HttpInstrumentation({
        ignoreIncomingRequestHook: (request: IncomingMessage) =>
          PROBE_PATHS.test(request.url ?? ''),
        // An outgoing call with no request in flight is the exporter or a
        // health check, not a step of anybody's flow.
        requireParentforOutgoingSpans: true,
      }),
      new ExpressInstrumentation(),
      new NestInstrumentation(),
      new PgInstrumentation({ requireParentSpan: true }),
    ],
  });

  let stopped: Promise<void> | null = null;

  registered = {
    enabled: true,
    exporting,
    resource,
    shutdown: async (): Promise<void> => {
      stopped ??= Promise.allSettled([tracerProvider.shutdown(), meterProvider.shutdown()]).then(
        () => undefined,
      );
      await stopped;
    },
  };

  return registered;
}

/**
 * The resource every span and metric of this process carries.
 *
 * `deployment.environment.name` is the current semantic convention;
 * `deployment.environment` is the name the assignment and most dashboards still
 * use, so both are set and neither query comes back empty.
 */
export function telemetryResource(
  serviceName: string,
  env: NodeJS.ProcessEnv = process.env,
): Resource {
  const identity = identityFrom(env);

  return resourceFromAttributes({
    [ATTR_SERVICE_NAME]: serviceName,
    [ATTR_SERVICE_VERSION]: identity.version,
    'deployment.environment.name': identity.environment,
    'deployment.environment': identity.environment,
    'service.namespace': 'bank-usac',
    // The pod, so two replicas are told apart in a trace without becoming two services.
    ...(nonEmpty(env.HOSTNAME) === undefined ? {} : { 'service.instance.id': env.HOSTNAME }),
  });
}

function disabledHandle(): TelemetryHandle {
  return { enabled: false, exporting: false, resource: null, shutdown: () => Promise.resolve() };
}

function isTrue(value: string | undefined): boolean {
  return value?.trim().toLowerCase() === 'true';
}

function nonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim();

  return trimmed === undefined || trimmed.length === 0 ? undefined : trimmed;
}

function positiveInteger(raw: string | undefined, fallback: number): number {
  const parsed = Number(raw);

  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}
