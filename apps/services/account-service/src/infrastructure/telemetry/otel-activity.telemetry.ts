import { labelValues, seedCounter, seriesOf } from '@bank/observability';
import { isSpanContextValid, metrics, trace } from '@opentelemetry/api';
import type { Counter, Span, Tracer } from '@opentelemetry/api';

import type { ActivityTelemetry, AnomalyRecord } from '../../application/ports';
import type { AccountType } from '../../domain/account';

/** The slice of the logger this adapter uses, so it need not import `interfaces/`. */
export interface ActivityLog {
  info(
    message: string,
    fields: {
      readonly correlationId?: string;
      readonly accountId?: string;
      readonly customerId?: string;
      readonly accountType?: string;
      readonly operation?: string;
      readonly transactionId?: string;
      readonly operationCount?: number;
      readonly threshold?: number;
      readonly windowMinutes?: number;
      readonly republished?: boolean;
      readonly traceId?: string;
      readonly spanId?: string;
    },
  ): void;
  warn(
    message: string,
    fields: {
      readonly correlationId?: string;
      readonly accountId?: string;
      readonly operationCount?: number;
      readonly threshold?: number;
      readonly windowMinutes?: number;
      readonly republished?: boolean;
      readonly traceId?: string;
      readonly spanId?: string;
    },
  ): void;
  error(
    message: string,
    fields: {
      readonly correlationId?: string;
      readonly accountId?: string;
      readonly stage?: string;
      readonly error?: string;
    },
  ): void;
}

export const INSTRUMENTATION_NAME = 'account-service';
export const OPERATIONS_COUNTER = 'bank.account.operations';
export const ANOMALIES_COUNTER = 'bank.account.anomalies';
export const ANOMALY_SPAN = 'account.activity anomaly';

/**
 * The closed label sets, typed over the unions the code emits from:
 * `satisfies Record<Union, true>` makes the compiler refuse a set that misses a
 * member, so a value added to the union cannot be forgotten by the seed that
 * pre-creates the series at zero (a series born at its first increment is
 * invisible to Prometheus' `increase()`).
 *
 * The values are spelled exactly as `operation()` and `anomaly()` label them:
 * the account type in upper case (`MONETARIA`, `AHORRO`), the operation in lower.
 */
const ACCOUNT_TYPES = { MONETARIA: true, AHORRO: true } satisfies Record<AccountType, true>;
const OPERATIONS = { debit: true, credit: true, compensation: true } satisfies Record<
  Parameters<ActivityTelemetry['operation']>[0]['operation'],
  true
>;
/** The only rule there is; `anomaly()` labels every anomaly with it. */
const ANOMALY_RULES = { HIGH_FREQUENCY: true };

/**
 * Account activity as OpenTelemetry sees it (Fase 3, T-42).
 *
 * Instrumented against `@opentelemetry/api` only: with no SDK registered the
 * tracer and meter are no-ops, and the day T-48 registers one this starts
 * exporting without a line here changing.
 *
 * **The account id is a log field and a span attribute, never a metric label.**
 * One time series per account is the failure the metrics are built to avoid;
 * the per-account story is told by the log, joined on the correlation id. The
 * only labels are `account_type` (two values), `operation` (three) and `rule`
 * (one) — closed sets, so the series count is fixed whatever the traffic.
 *
 * The instruments are looked up when the adapter is constructed, which is after
 * a test (or T-48) has registered a provider. Built at import time they would be
 * bound to the no-op meter for the life of the process.
 */
export class OtelActivityTelemetry implements ActivityTelemetry {
  readonly #tracer: Tracer;
  readonly #operations: Counter;
  readonly #anomalies: Counter;
  readonly #log: ActivityLog;
  readonly #correlationId: string | undefined;

  constructor(log: ActivityLog, correlationId?: string) {
    const meter = metrics.getMeter(INSTRUMENTATION_NAME);

    this.#tracer = trace.getTracer(INSTRUMENTATION_NAME);
    this.#operations = meter.createCounter(OPERATIONS_COUNTER, {
      unit: '{operation}',
      description: 'Balance movements on accounts, by account type and operation.',
    });
    this.#anomalies = meter.createCounter(ANOMALIES_COUNTER, {
      unit: '{anomaly}',
      description: 'High-frequency anomalies detected on accounts, by account type.',
    });
    seedCounter(
      this.#operations,
      OPERATIONS_COUNTER,
      seriesOf({ account_type: labelValues(ACCOUNT_TYPES), operation: labelValues(OPERATIONS) }),
    );
    seedCounter(
      this.#anomalies,
      ANOMALIES_COUNTER,
      seriesOf({ account_type: labelValues(ACCOUNT_TYPES), rule: labelValues(ANOMALY_RULES) }),
    );
    this.#log = log;
    this.#correlationId = correlationId;
  }

  /**
   * Binds the adapter to the delivery being handled, the same way the publisher
   * is: one shared instance with a mutable "current correlation id" would hand
   * one request's id to another under any concurrency.
   */
  public forCorrelation(correlationId: string): OtelActivityTelemetry {
    return new OtelActivityTelemetry(this.#log, correlationId);
  }

  public operation(event: {
    readonly accountId: string;
    readonly accountType: string;
    readonly operation: 'debit' | 'credit' | 'compensation';
    readonly transactionId: string | null;
  }): void {
    this.#operations.add(1, { account_type: event.accountType, operation: event.operation });

    this.#log.info('account operation', {
      correlationId: this.#correlationId,
      accountId: event.accountId,
      accountType: event.accountType,
      operation: event.operation,
      ...(event.transactionId === null ? {} : { transactionId: event.transactionId }),
    });
  }

  public anomaly(event: AnomalyRecord & { readonly republished: boolean }): void {
    const span = this.#tracer.startSpan(ANOMALY_SPAN);

    span.setAttributes({
      'bank.account.id': event.accountId,
      'bank.account.type': event.accountType,
      'bank.anomaly.rule': 'HIGH_FREQUENCY',
      'bank.anomaly.operation_count': event.operationCount,
      'bank.anomaly.threshold': event.threshold,
      'bank.anomaly.window_minutes': event.windowMinutes,
      ...(this.#correlationId === undefined ? {} : { 'bank.correlation_id': this.#correlationId }),
    });
    span.end();

    // A republication is the same anomaly announced again, not a second one.
    if (!event.republished) {
      this.#anomalies.add(1, { account_type: event.accountType, rule: 'HIGH_FREQUENCY' });
    }

    this.#log.warn(event.republished ? 'account anomaly republished' : 'account anomaly detected', {
      correlationId: this.#correlationId,
      accountId: event.accountId,
      operationCount: event.operationCount,
      threshold: event.threshold,
      windowMinutes: event.windowMinutes,
      republished: event.republished,
      ...traceFields(span),
    });
  }

  public failed(event: {
    readonly accountId: string;
    readonly stage: 'detection' | 'publication';
    readonly reason: string;
  }): void {
    this.#log.error('account activity monitoring failed', {
      correlationId: this.#correlationId,
      accountId: event.accountId,
      stage: event.stage,
      error: event.reason,
    });
  }
}

/** `traceId` and `spanId` for a log line; empty while no SDK records the span. */
function traceFields(span: Span): { traceId?: string; spanId?: string } {
  const context = span.spanContext();

  return isSpanContextValid(context) ? { traceId: context.traceId, spanId: context.spanId } : {};
}
