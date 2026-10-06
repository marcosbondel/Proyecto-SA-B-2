import { isSpanContextValid, metrics, trace } from '@opentelemetry/api';
import type { Attributes, Counter, Histogram, Link, Span, Tracer } from '@opentelemetry/api';

import type {
  CreationSpan,
  LifecycleEvent,
  LifecyclePath,
  LifecycleTelemetry,
  LifecycleTransition,
} from '../../application/ports';

/** The slice of the logger this adapter uses, so it need not import `interfaces/`. */
export interface LifecycleLog {
  info(
    message: string,
    fields: {
      readonly correlationId?: string;
      readonly customerId?: string;
      readonly transition?: string;
      readonly path?: string;
      readonly traceId?: string;
      readonly spanId?: string;
      readonly outcome?: string;
      readonly reason?: string;
    },
  ): void;
}

export const INSTRUMENTATION_NAME = 'customer-service';
export const SPAN_NAME = 'customer.lifecycle';
export const DECISIONS_COUNTER = 'bank.customer.kyc.decisions';
export const TIME_TO_DECISION_HISTOGRAM = 'bank.customer.kyc.time_to_decision';
export const REFUSALS_COUNTER = 'bank.customer.registration.refusals';

/**
 * Seconds from creation to a KYC decision, from "at the counter" to "the
 * customer never came back". The default OpenTelemetry buckets stop at ten
 * seconds, which would put every real review in the last bucket and make the
 * p95 unreadable.
 */
export const TIME_TO_DECISION_BUCKETS_S = [
  1, 5, 30, 60, 300, 900, 3_600, 14_400, 86_400, 259_200, 604_800,
];

/** `traceId` and `spanId` for a log line; empty while no SDK records the span. */
function traceFields(span: Span): { traceId?: string; spanId?: string } {
  const context = span.spanContext();

  return isSpanContextValid(context) ? { traceId: context.traceId, spanId: context.spanId } : {};
}

const TRACEPARENT = /^00-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/;

/** W3C `traceparent` for a span, or `null` when no SDK is recording it. */
export function traceparentOf(span: Span): string | null {
  const context = span.spanContext();

  return isSpanContextValid(context)
    ? `00-${context.traceId}-${context.spanId}-${context.traceFlags.toString(16).padStart(2, '0')}`
    : null;
}

/** The inverse of {@link traceparentOf}; anything malformed yields no link. */
function linkTo(traceparent: string | null): Link[] {
  const match = traceparent === null ? null : TRACEPARENT.exec(traceparent);

  if (match === null) {
    return [];
  }

  return [
    {
      context: {
        traceId: match[1]!,
        spanId: match[2]!,
        traceFlags: Number.parseInt(match[3]!, 16),
        isRemote: true,
      },
    },
  ];
}

/**
 * The lifecycle as OpenTelemetry sees it.
 *
 * Instrumented against `@opentelemetry/api` only: with no SDK registered the
 * tracer and meter are no-ops, and the day T-48 registers one this starts
 * exporting without a line here changing.
 *
 * **The `customerId` is a span attribute and a log field, never a metric
 * label.** One time series per customer is the failure the metrics are built to
 * avoid; the per-customer story is told by the log, joined on the correlation
 * id.
 *
 * **Creation and decision share a trace by link, not by parent.** They are
 * different messages, hours apart: the creation span's context is stored with
 * the customer, and the decision span carries a link to it.
 *
 * The instruments are looked up when the adapter is constructed, which is
 * after a test (or T-48) has registered a provider. Built at import time they
 * would be bound to the no-op meter for the life of the process.
 */
export class OtelLifecycleTelemetry implements LifecycleTelemetry {
  readonly #tracer: Tracer;
  readonly #decisions: Counter;
  readonly #refusals: Counter;
  readonly #timeToDecision: Histogram;
  readonly #log: LifecycleLog;
  readonly #correlationId: string | undefined;

  constructor(log: LifecycleLog, correlationId?: string) {
    const meter = metrics.getMeter(INSTRUMENTATION_NAME);

    this.#tracer = trace.getTracer(INSTRUMENTATION_NAME);
    this.#decisions = meter.createCounter(DECISIONS_COUNTER, {
      unit: '{decision}',
      description: 'KYC decisions on customers, by result.',
    });
    this.#refusals = meter.createCounter(REFUSALS_COUNTER, {
      unit: '{registration}',
      description: 'Registrations turned away before a customer existed, by reason.',
    });
    this.#timeToDecision = meter.createHistogram(TIME_TO_DECISION_HISTOGRAM, {
      unit: 's',
      description: 'Time from a customer being created to a KYC decision.',
      advice: { explicitBucketBoundaries: TIME_TO_DECISION_BUCKETS_S },
    });
    this.#log = log;
    this.#correlationId = correlationId;
  }

  /**
   * Binds the adapter to the delivery being handled, the same way the publisher
   * is: one shared instance with a mutable "current correlation id" would hand
   * one request's id to another under any concurrency.
   */
  public forCorrelation(correlationId: string): OtelLifecycleTelemetry {
    return new OtelLifecycleTelemetry(this.#log, correlationId);
  }

  public beginCreation(): CreationSpan {
    // Named for the likelier outcome and renamed if the registration is refused.
    const span = this.#tracer.startSpan(`${SPAN_NAME} created`);

    return {
      traceparent: traceparentOf(span),

      created: (event) => {
        span.setAttributes(this.#spanAttributes('created', event.customerId, event.path));
        span.end();

        this.#log.info('customer created', {
          correlationId: this.#correlationId,
          customerId: event.customerId,
          transition: 'created',
          path: event.path,
          outcome: 'APPLIED',
          ...traceFields(span),
        });
      },

      refused: (event) => {
        span.updateName(`${SPAN_NAME} refused`);
        span.setAttributes({
          ...this.#spanAttributes('refused', event.customerId),
          'bank.customer.refusal': event.reason,
        });
        span.end();

        this.#refusals.add(1, { reason: event.reason });
        this.#log.info('customer registration refused', {
          correlationId: this.#correlationId,
          customerId: event.customerId,
          transition: 'refused',
          outcome: 'REFUSED',
          reason: event.reason,
          ...traceFields(span),
        });
      },
    };
  }

  public record(event: LifecycleEvent): void {
    const span = this.#tracer.startSpan(`${SPAN_NAME} ${event.transition}`, {
      links: linkTo(event.creationTrace),
    });

    span.setAttributes(this.#spanAttributes(event.transition, event.customerId, event.path));
    span.end();

    this.#decisions.add(1, { result: event.transition, path: event.path });

    if (event.transition === 'verified') {
      const seconds = Math.max(0, (event.at.getTime() - Date.parse(event.createdAt)) / 1_000);

      this.#timeToDecision.record(seconds, { path: event.path });
    }

    this.#log.info(`customer ${event.transition}`, {
      correlationId: this.#correlationId,
      customerId: event.customerId,
      transition: event.transition,
      path: event.path,
      outcome: 'APPLIED',
      ...traceFields(span),
    });
  }

  public ignored(event: {
    readonly transition: 'verified' | 'rejected';
    readonly customerId: string;
    readonly reason: string;
  }): void {
    this.#log.info(`customer ${event.transition} ignored`, {
      correlationId: this.#correlationId,
      customerId: event.customerId,
      transition: event.transition,
      outcome: 'IGNORED',
      reason: event.reason,
    });
  }

  #spanAttributes(
    transition: LifecycleTransition | 'refused',
    customerId: string,
    path?: LifecyclePath,
  ): Attributes {
    return {
      'bank.customer.transition': transition,
      ...(path === undefined ? {} : { 'bank.customer.path': path }),
      'bank.customer.id': customerId,
      ...(this.#correlationId === undefined ? {} : { 'bank.correlation_id': this.#correlationId }),
    };
  }
}
