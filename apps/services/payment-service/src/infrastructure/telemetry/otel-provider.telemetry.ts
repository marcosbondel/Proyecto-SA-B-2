import { isSpanContextValid, metrics, trace } from '@opentelemetry/api';
import type { Counter, Histogram, Span, Tracer } from '@opentelemetry/api';

import type { ProviderCall, ProviderTelemetry } from '../../application/ports';
import type { SimulationSettings } from '../../domain/simulation';

/** What a log line from this adapter may carry. */
export interface ProviderLogFields {
  readonly correlationId?: string;
  readonly transactionId?: string;
  readonly paymentId?: string;
  readonly attempt?: number;
  readonly providerResult?: string;
  readonly errorType?: string;
  readonly simulated?: boolean;
  readonly source?: string;
  readonly latencyMs?: number;
  readonly outcome?: string;
  readonly failureRatePercent?: number;
  readonly timeoutRatePercent?: number;
  readonly traceId?: string;
  readonly spanId?: string;
}

/** The slice of the logger this adapter uses, so it need not import `interfaces/`. */
export interface ProviderLog {
  info(message: string, fields: ProviderLogFields): void;
  warn(message: string, fields: ProviderLogFields): void;
}

export const INSTRUMENTATION_NAME = 'payment-service';
export const CALLS_COUNTER = 'bank.payment.provider.calls';
export const DURATION_HISTOGRAM = 'bank.payment.provider.duration';
export const CHANGES_COUNTER = 'bank.payment.simulation.changes';
export const CALL_SPAN = 'payment.provider call';
export const SIMULATED_FAILURE_EVENT = 'simulated_failure';

/**
 * Seconds the simulated provider takes to answer, from "instant" to the 30 s
 * ceiling the contract allows. Dense below five seconds, because that is where
 * a slow provider starts costing the transfer its SLO-2 budget; the default
 * OpenTelemetry buckets stop at ten seconds and would put a 30 s answer in the
 * overflow bucket, making the p95 unreadable.
 */
export const DURATION_BUCKETS_S = [0.005, 0.025, 0.1, 0.25, 0.5, 1, 2, 3, 5, 10, 20, 30];

/**
 * The simulated provider as OpenTelemetry sees it (Fase 3, T-44).
 *
 * Instrumented against `@opentelemetry/api` only: with no SDK registered the
 * tracer and meter are no-ops, and the day T-48 registers one this starts
 * exporting without a line here changing.
 *
 * **The failure rate is a ratio of two series of one counter.** `calls` is
 * labelled by `result` (`success`, `failure`, `timeout`), so the external
 * failure rate is `sum(calls{result!="success"}) / sum(calls)` — one metric
 * rather than a rate that has to be kept consistent with its own denominator.
 * The only other label is `source` (`scenario`, `configuration` or `runtime`),
 * so a dashboard can tell the failures somebody scripted, the ones the
 * ConfigMap's rates produced and the ones an administrator injected while the
 * system was running. All closed sets.
 *
 * **The payment and transaction ids are log fields and span attributes, never
 * metric labels.** The per-payment story is told by the log, joined on the
 * correlation id.
 *
 * **Every failure it logs is marked `simulated: true`.** There is no real
 * provider in this system; the mark is what lets whoever reads the log, or a
 * Loki query, tell a drill from an incident once there is one.
 */
export class OtelProviderTelemetry implements ProviderTelemetry {
  readonly #tracer: Tracer;
  readonly #calls: Counter;
  readonly #duration: Histogram;
  readonly #changes: Counter;
  readonly #log: ProviderLog;

  constructor(log: ProviderLog) {
    const meter = metrics.getMeter(INSTRUMENTATION_NAME);

    this.#tracer = trace.getTracer(INSTRUMENTATION_NAME);
    this.#calls = meter.createCounter(CALLS_COUNTER, {
      unit: '{call}',
      description: 'Calls to the simulated external provider, by result and by what decided it.',
    });
    this.#duration = meter.createHistogram(DURATION_HISTOGRAM, {
      unit: 's',
      description: 'Time the simulated external provider took to answer.',
      advice: { explicitBucketBoundaries: DURATION_BUCKETS_S },
    });
    this.#changes = meter.createCounter(CHANGES_COUNTER, {
      unit: '{change}',
      description: 'Changes to the provider simulation made at run time, by action.',
    });
    this.#log = log;
  }

  public providerCall(call: ProviderCall): void {
    const result = call.result.toLowerCase();
    const source = call.source.toLowerCase();
    const span = this.#tracer.startSpan(CALL_SPAN);

    span.setAttributes({
      'bank.payment.id': call.paymentId,
      'bank.transfer.id': call.transactionId,
      'bank.payment.attempt': call.attempt,
      'bank.payment.provider.result': result,
      'bank.payment.provider.source': source,
      'bank.payment.provider.latency_ms': call.latencyMs,
      'bank.payment.will_retry': call.willRetry,
      ...(call.errorType === null ? {} : { 'bank.payment.error_type': call.errorType }),
      ...(call.correlationId === null ? {} : { 'bank.correlation_id': call.correlationId }),
    });

    if (call.result !== 'SUCCESS') {
      span.addEvent(SIMULATED_FAILURE_EVENT, {
        'bank.payment.provider.result': result,
        'bank.payment.simulated': true,
      });
    }

    span.end();

    this.#calls.add(1, { result, source });
    this.#duration.record(call.latencyMs / 1_000, { result });

    const fields: ProviderLogFields = {
      ...(call.correlationId === null ? {} : { correlationId: call.correlationId }),
      transactionId: call.transactionId,
      paymentId: call.paymentId,
      attempt: call.attempt,
      providerResult: call.result,
      simulated: true,
      source,
      latencyMs: call.latencyMs,
      ...traceFields(span),
    };

    if (call.result === 'SUCCESS') {
      this.#log.info('provider answered', { ...fields, outcome: 'success' });

      return;
    }

    this.#log.warn('simulated provider failure', {
      ...fields,
      ...(call.errorType === null ? {} : { errorType: call.errorType }),
      outcome: call.willRetry ? 'retrying' : 'exhausted',
    });
  }

  public simulationChanged(change: {
    readonly action: 'UPDATE' | 'RESET' | 'DENIED';
    readonly settings: SimulationSettings;
    readonly correlationId: string | null;
  }): void {
    const action = change.action.toLowerCase();

    this.#changes.add(1, { action });

    this.#log.warn(`provider simulation ${action}`, {
      ...(change.correlationId === null ? {} : { correlationId: change.correlationId }),
      outcome: action,
      failureRatePercent: change.settings.failureRatePercent,
      timeoutRatePercent: change.settings.timeoutRatePercent,
      latencyMs: change.settings.latencyMs,
    });
  }
}

/** `traceId` and `spanId` for a log line; empty while no SDK records the span. */
function traceFields(span: Span): { traceId?: string; spanId?: string } {
  const context = span.spanContext();

  return isSpanContextValid(context) ? { traceId: context.traceId, spanId: context.spanId } : {};
}
