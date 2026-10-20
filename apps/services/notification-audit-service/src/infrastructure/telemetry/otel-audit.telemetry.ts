import { labelValues, seedCounter, seriesOf } from '@bank/observability';
import { metrics, trace } from '@opentelemetry/api';
import type { Counter, Tracer } from '@opentelemetry/api';

import type { AuditObservation, AuditTelemetry } from '../../application/ports';
import type { AlertSeverity, AlertStatus, EventSeverity } from '../../domain/classification';

export const INSTRUMENTATION_NAME = 'notification-audit-service';
export const SPAN_NAME = 'audit.record';
export const EVENTS_COUNTER = 'bank.audit.events';
export const NOTIFICATIONS_COUNTER = 'bank.audit.notifications';
export const ALERTS_COUNTER = 'bank.audit.alerts.received';

/**
 * The closed label sets of the three counters, typed over the unions the code
 * emits from: `satisfies Record<Union, true>` makes the compiler refuse a set
 * that misses a member, so a value added to the union cannot be forgotten by the
 * seed that pre-creates the series at zero (a series born at its first
 * increment is invisible to Prometheus' `increase()`).
 *
 * Spelled as `recorded()` labels them: `severity` in upper case, the rest in
 * lower, and an alert's own `status` and `severity` in lower case.
 */
const SEVERITIES = { INFO: true, WARNING: true, ERROR: true } satisfies Record<EventSeverity, true>;
const OUTCOMES = { recorded: true, duplicate: true } satisfies Record<
  Lowercase<AuditObservation['outcome']>,
  true
>;
const PROCESSING = { processed: true, invalid: true, error: true } satisfies Record<
  Lowercase<AuditObservation['processingStatus']>,
  true
>;
const NOTIFICATION_RESULTS = { sent: true, failed: true, suppressed: true } satisfies Record<
  Lowercase<Exclude<AuditObservation['notification'], 'NONE'>>,
  true
>;
const ALERT_STATUSES = { firing: true, resolved: true } satisfies Record<AlertStatus, true>;
const ALERT_SEVERITIES = { critical: true, warning: true, info: true } satisfies Record<
  AlertSeverity,
  true
>;

/**
 * What the audit trail sees of itself, as OpenTelemetry (Fase 3, §4.1 —
 * Notification & Audit Service; T-45).
 *
 * Instrumented against `@opentelemetry/api` only: with no SDK registered the
 * tracer and meter are no-ops, and the day T-48 registers one this starts
 * exporting without a line here changing. The instruments are looked up when the
 * adapter is constructed, which is after a test (or T-48) has registered a
 * provider; built at import time they would be bound to the no-op meter for the
 * life of the process.
 *
 * **No label is an identifier.** The correlation id, the trace id and the
 * account an anomaly was about travel on the span and in the log, where one
 * entity is one row; a metric label per entity is a time series per entity.
 * What labels carry is a closed set: the *family* of the message (five names, not
 * the sixty message types), its severity, how it ended.
 *
 * **It counts what the service did, not what the world did.** `outcome` says
 * whether this delivery was written down or refused as a redelivery; a duplicate
 * counts as a duplicate and never as a second event, so the rate of recorded
 * events is the rate of things that happened, and the rate of duplicates is the
 * rate at which the broker redelivered.
 */
export class OtelAuditTelemetry implements AuditTelemetry {
  readonly #tracer: Tracer;
  readonly #events: Counter;
  readonly #notifications: Counter;
  readonly #alerts: Counter;

  constructor() {
    const meter = metrics.getMeter(INSTRUMENTATION_NAME);

    this.#tracer = trace.getTracer(INSTRUMENTATION_NAME);
    this.#events = meter.createCounter(EVENTS_COUNTER, {
      unit: '{event}',
      description: 'Messages the audit trail heard, by family, severity and what became of them.',
    });
    this.#notifications = meter.createCounter(NOTIFICATIONS_COUNTER, {
      unit: '{notification}',
      description: 'Notifications the audit service decided on, by severity and result.',
    });
    this.#alerts = meter.createCounter(ALERTS_COUNTER, {
      unit: '{alert}',
      description: 'SLO alerts received through the Gateway webhook, by state and severity.',
    });
    seedCounter(
      this.#events,
      EVENTS_COUNTER,
      seriesOf({
        family: [...FAMILY_NAMES],
        severity: labelValues(SEVERITIES),
        outcome: labelValues(OUTCOMES),
        processing: labelValues(PROCESSING),
      }),
    );
    seedCounter(
      this.#notifications,
      NOTIFICATIONS_COUNTER,
      seriesOf({ severity: labelValues(SEVERITIES), result: labelValues(NOTIFICATION_RESULTS) }),
    );
    seedCounter(
      this.#alerts,
      ALERTS_COUNTER,
      seriesOf({ status: labelValues(ALERT_STATUSES), severity: labelValues(ALERT_SEVERITIES) }),
    );
  }

  public recorded(observation: AuditObservation): void {
    const span = this.#tracer.startSpan(SPAN_NAME);

    span.setAttributes({
      'bank.audit.message_type': observation.messageType,
      'bank.audit.severity': observation.severity,
      'bank.audit.processing_status': observation.processingStatus,
      'bank.audit.outcome': observation.outcome,
      'bank.audit.notification': observation.notification,
      'bank.correlation_id': observation.correlationId,
    });
    span.end();

    this.#events.add(1, {
      family: familyOf(observation.messageType),
      severity: observation.severity,
      outcome: observation.outcome.toLowerCase(),
      processing: observation.processingStatus.toLowerCase(),
    });

    if (observation.notification !== 'NONE') {
      this.#notifications.add(1, {
        severity: observation.severity,
        result: observation.notification.toLowerCase(),
      });
    }

    for (const alert of observation.alerts ?? []) {
      this.#alerts.add(1, { status: alert.status, severity: alert.severity });
    }
  }
}

/**
 * The first word of a message's name — `account.debited.v1` is `account` — kept
 * only when it is one of the families the system has. Anything else is `other`,
 * so a message name nobody anticipated cannot mint a new time series.
 */
const KNOWN_FAMILIES = {
  customer: true,
  account: true,
  transaction: true,
  payment: true,
  alert: true,
};

/** Every value the `family` label can take, `other` included - what the seed enumerates. */
const FAMILY_NAMES = [...labelValues(KNOWN_FAMILIES), 'other'] as const;

export function familyOf(messageType: string): (typeof FAMILY_NAMES)[number] {
  const family = messageType.split('.')[0] ?? '';

  return Object.hasOwn(KNOWN_FAMILIES, family) ? (family as keyof typeof KNOWN_FAMILIES) : 'other';
}
