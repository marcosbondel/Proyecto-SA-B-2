import { context, isSpanContextValid, metrics, trace } from '@opentelemetry/api';
import type { Attributes, Context, Counter, Histogram, Span, Tracer } from '@opentelemetry/api';

import type {
  TransferObservation,
  TransferRoot,
  TransferStep,
  TransferTelemetry,
} from '../../application/ports';

/** The slice of the logger this adapter uses, so it need not import `interfaces/`. */
export interface TransferLog {
  info(
    message: string,
    fields: {
      readonly correlationId?: string;
      readonly transactionId?: string;
      readonly from?: string;
      readonly status?: string;
      readonly phaseStatus?: string;
      readonly outcome?: string;
      readonly reason?: string;
      readonly attempt?: number;
      readonly durationMs?: number;
      readonly traceId?: string;
      readonly spanId?: string;
    },
  ): void;
  error(
    message: string,
    fields: { readonly correlationId?: string; readonly transactionId?: string; readonly error?: string },
  ): void;
}

export const INSTRUMENTATION_NAME = 'transaction-service';
export const ROOT_SPAN = 'transfer.requested';
export const TRANSFER_SPAN = 'transfer';
export const STEP_SPAN_PREFIX = 'saga.step';
export const COMPENSATION_ORDERED_SPAN = 'saga.compensation ordered';
export const COMPENSATION_COMPLETED_SPAN = 'saga.compensation completed';
export const PAYMENT_ATTEMPT_SPAN = 'saga.payment attempt';
export const DURATION_HISTOGRAM = 'bank.transfer.duration';
export const FINISHED_COUNTER = 'bank.transfer.finished';
export const STARTED_COUNTER = 'bank.transfer.started';

/**
 * Seconds from `transfer.requested` to a final state. Dense around five, because
 * SLO-2 reads "completed in under 5.0 s" and a histogram can only answer that
 * exactly if a bucket boundary sits exactly there; sparse and long above it, up
 * to the length of the payment retry ladder (1 s, 5 s, 30 s) and a little past.
 */
export const DURATION_BUCKETS_S = [
  0.1, 0.25, 0.5, 1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10, 15, 30, 45, 60, 90, 120,
];

const TRACEPARENT = /^00-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/;
const TERMINAL = new Set(['COMPLETED', 'FAILED', 'COMPENSATED']);

/** W3C `traceparent` for a span, or `null` when no SDK is recording it. */
export function traceparentOf(span: Span): string | null {
  const spanContext = span.spanContext();

  return isSpanContextValid(spanContext)
    ? `00-${spanContext.traceId}-${spanContext.spanId}-${spanContext.traceFlags.toString(16).padStart(2, '0')}`
    : null;
}

/** The inverse of {@link traceparentOf}; anything malformed yields the active context. */
function parentFrom(traceparent: string | null): Context {
  const match = traceparent === null ? null : TRACEPARENT.exec(traceparent);

  if (match === null) {
    return context.active();
  }

  return trace.setSpanContext(context.active(), {
    traceId: match[1]!,
    spanId: match[2]!,
    traceFlags: Number.parseInt(match[3]!, 16),
    isRemote: true,
  });
}

/** `traceId` and `spanId` for a log line; empty while no SDK records the span. */
function traceFields(span: Span): { traceId?: string; spanId?: string } {
  const spanContext = span.spanContext();

  return isSpanContextValid(spanContext)
    ? { traceId: spanContext.traceId, spanId: spanContext.spanId }
    : {};
}

/**
 * A transfer as OpenTelemetry sees it (Fase 3, T-43).
 *
 * Instrumented against `@opentelemetry/api` only: with no SDK registered the
 * tracer and meter are no-ops, and the day T-48 registers one this starts
 * exporting without a line here changing.
 *
 * **One trace per transfer, built from the database.** A transfer is several
 * messages, handled at different moments by possibly different pods, so no span
 * can stay open across them. The first span (`transfer.requested`) is opened
 * before the row is inserted and its context stored with it; every later step
 * is a child of that stored context. When the transfer reaches a final state, a
 * `transfer` span covering the whole duration — from the request's own
 * timestamp to the completion — is emitted with the Fase 2 phases as span
 * events: `PENDING` at the start and `APPROVED` or `FAILED` at the end.
 *
 * **This is the transaction-service's view of the Saga.** The steps other
 * services perform (the debit in Account, the attempts in Payment) join the same
 * trace only once the `traceparent` crosses the broker, which is T-48. The
 * stored context is exactly what that propagation will inject.
 *
 * **The transaction id is a log field and a span attribute, never a metric
 * label.** The only labels are `result` (three values) and `reason` (a closed
 * set of failure codes), so the series count is fixed whatever the traffic.
 */
export class OtelTransferTelemetry implements TransferTelemetry {
  readonly #tracer: Tracer;
  readonly #started: Counter;
  readonly #finished: Counter;
  readonly #duration: Histogram;
  readonly #log: TransferLog;

  constructor(log: TransferLog) {
    const meter = metrics.getMeter(INSTRUMENTATION_NAME);

    this.#tracer = trace.getTracer(INSTRUMENTATION_NAME);
    this.#started = meter.createCounter(STARTED_COUNTER, {
      unit: '{transfer}',
      description: 'Transfers accepted, before any step of the Saga has run.',
    });
    this.#finished = meter.createCounter(FINISHED_COUNTER, {
      unit: '{transfer}',
      description: 'Transfers that reached a final state, by result and reason.',
    });
    this.#duration = meter.createHistogram(DURATION_HISTOGRAM, {
      unit: 's',
      description: 'Time from transfer.requested to a final state.',
      advice: { explicitBucketBoundaries: DURATION_BUCKETS_S },
    });
    this.#log = log;
  }

  public openTransfer(): TransferRoot {
    const span = this.#tracer.startSpan(ROOT_SPAN);

    return {
      traceparent: traceparentOf(span),

      accepted: (event) => {
        this.#guard(event.transactionId, event.correlationId, () => {
          span.setAttributes({
            'bank.transfer.id': event.transactionId,
            'bank.transfer.status': 'PENDING',
            'bank.transfer.phase_status': 'PENDING',
            'bank.correlation_id': event.correlationId,
          });
          span.end();

          this.#started.add(1);
          this.#log.info('transfer started', {
            correlationId: event.correlationId,
            transactionId: event.transactionId,
            status: 'PENDING',
            phaseStatus: 'PENDING',
            ...traceFields(span),
          });
        });
      },

      duplicate: () => {
        // A retry of a transfer that already exists: nothing was created, so the
        // span that was opened for it says so and counts for nothing.
        span.setAttribute('bank.transfer.duplicate', true);
        span.end();
      },
    };
  }

  public step(step: TransferStep): void {
    this.#guard(step.transactionId, step.correlationId, () => {
      const parent = parentFrom(step.observation.traceContext);
      const span = this.#tracer.startSpan(spanNameOf(step), {}, parent);

      span.setAttributes(this.#stepAttributes(step));
      span.end();

      this.#log.info('transfer step', {
        correlationId: step.correlationId,
        transactionId: step.transactionId,
        from: step.from,
        status: step.to,
        phaseStatus: step.phase,
        ...(step.failureReason === null ? {} : { reason: step.failureReason }),
        outcome: step.event,
        ...traceFields(span),
      });

      if (TERMINAL.has(step.to) && step.completedAt !== null) {
        this.#finish(step, parent);
      }
    });
  }

  public paymentAttempt(attempt: {
    readonly transactionId: string;
    readonly correlationId: string;
    readonly attempt: number;
    readonly errorType: string;
    readonly willRetry: boolean;
    readonly observation: TransferObservation;
  }): void {
    this.#guard(attempt.transactionId, attempt.correlationId, () => {
      const span = this.#tracer.startSpan(
        PAYMENT_ATTEMPT_SPAN,
        {},
        parentFrom(attempt.observation.traceContext),
      );

      span.setAttributes({
        'bank.transfer.id': attempt.transactionId,
        'bank.payment.attempt': attempt.attempt,
        'bank.payment.error_type': attempt.errorType,
        'bank.payment.will_retry': attempt.willRetry,
        'bank.correlation_id': attempt.correlationId,
      });
      span.end();

      this.#log.info('transfer payment attempt', {
        correlationId: attempt.correlationId,
        transactionId: attempt.transactionId,
        attempt: attempt.attempt,
        outcome: attempt.willRetry ? 'retrying' : 'exhausted',
        reason: attempt.errorType,
        ...traceFields(span),
      });
    });
  }

  /**
   * The transfer has ended: its duration span with the Fase 2 phases as events,
   * and the two metrics. Duration is measured from the request's own timestamp
   * to the completion stamped in the same write that closed the transfer, never
   * from a clock read here — so a replica that handles the last event late does
   * not make the transfer look slow.
   */
  #finish(step: TransferStep, parent: Context): void {
    const completedAt = step.completedAt!;
    const { requestedAt } = step.observation;
    const durationMs = Math.max(0, completedAt.getTime() - requestedAt.getTime());
    const result = step.to.toLowerCase();
    const reason = step.failureReason ?? 'NONE';

    const span = this.#tracer.startSpan(TRANSFER_SPAN, { startTime: requestedAt }, parent);

    span.setAttributes({
      'bank.transfer.id': step.transactionId,
      'bank.transfer.status': step.to,
      'bank.transfer.phase_status': step.phase,
      'bank.transfer.duration_ms': durationMs,
      'bank.correlation_id': step.correlationId,
      ...(step.failureReason === null ? {} : { 'bank.transfer.failure_reason': step.failureReason }),
    });
    // The Fase 2 phases, as the assignment names them, at the moments they were reached.
    span.addEvent('PENDING', { 'bank.transfer.status': 'PENDING' }, requestedAt);
    span.addEvent(step.phase, { 'bank.transfer.status': step.to }, completedAt);
    span.end(completedAt);

    this.#duration.record(durationMs / 1_000, { result });
    this.#finished.add(1, { result, reason });

    this.#log.info('transfer finished', {
      correlationId: step.correlationId,
      transactionId: step.transactionId,
      status: step.to,
      phaseStatus: step.phase,
      ...(step.failureReason === null ? {} : { reason: step.failureReason }),
      outcome: result,
      durationMs,
      ...traceFields(span),
    });
  }

  #stepAttributes(step: TransferStep): Attributes {
    return {
      'bank.transfer.id': step.transactionId,
      'bank.saga.event': step.event,
      'bank.transfer.from_status': step.from,
      'bank.transfer.status': step.to,
      'bank.transfer.phase_status': step.phase,
      ...(step.command === null ? {} : { 'bank.saga.command': step.command }),
      ...(step.failureReason === null ? {} : { 'bank.transfer.failure_reason': step.failureReason }),
      'bank.correlation_id': step.correlationId,
    };
  }

  /** Telemetry never throws: the transition it describes has already committed. */
  #guard(transactionId: string, correlationId: string, work: () => void): void {
    try {
      work();
    } catch (error) {
      try {
        this.#log.error('transfer telemetry failed', {
          correlationId,
          transactionId,
          error: error instanceof Error ? error.message : String(error),
        });
      } catch {
        // The reporting failed too. Nothing is left to tell anyone.
      }
    }
  }
}

/**
 * The compensation gets spans of its own, so a transfer that had to be undone
 * is told apart from one that was not by looking at its trace alone.
 */
function spanNameOf(step: TransferStep): string {
  if (step.event === 'DEBIT_COMPENSATED') {
    return COMPENSATION_COMPLETED_SPAN;
  }

  if (step.command === 'COMPENSATION') {
    return COMPENSATION_ORDERED_SPAN;
  }

  return `${STEP_SPAN_PREFIX} ${step.event}`;
}
