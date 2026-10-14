import { metrics, trace } from '@opentelemetry/api';
import type { Counter, Histogram, Tracer } from '@opentelemetry/api';

import type { InterbankTelemetry } from '../../application/interbank.ports';

export const DEPOSITS_COUNTER = 'bank.interbank.deposits';
export const DURATION_HISTOGRAM = 'bank.interbank.deposit.duration';
export const CALLBACKS_COUNTER = 'bank.interbank.callbacks';
export const STATE_EVENT = 'bank.interbank.state_changed';

type LogFields = {
  readonly correlationId: string;
  readonly depositId?: string;
  readonly status?: string;
  readonly reason?: string;
  readonly durationMs?: number;
  readonly outcome?: string;
};

/** Closed metric labels; entity identifiers live only in correlated logs. */
export class OtelInterbankTelemetry implements InterbankTelemetry {
  readonly #deposits: Counter;
  readonly #duration: Histogram;
  readonly #callbacks: Counter;
  readonly #tracer: Tracer;

  constructor(
    readonly log: {
      info(message: string, fields: LogFields): void;
      warn(message: string, fields: LogFields): void;
    },
  ) {
    const meter = metrics.getMeter('payment-service.interbank');
    this.#tracer = trace.getTracer('payment-service.interbank');
    this.#deposits = meter.createCounter(DEPOSITS_COUNTER, {
      unit: '{deposit}',
      description: 'Incoming interbank deposits by final result. Success rate is accepted / total.',
    });
    this.#duration = meter.createHistogram(DURATION_HISTOGRAM, {
      unit: 's',
      description: 'Time from receipt to a final interbank deposit decision.',
      advice: { explicitBucketBoundaries: [0.005, 0.025, 0.1, 0.25, 0.5, 1, 2, 5, 10, 30, 60] },
    });
    this.#callbacks = meter.createCounter(CALLBACKS_COUNTER, {
      unit: '{attempt}',
      description: 'Outbound partner callbacks by delivery result.',
    });
  }

  stateChanged(change: Parameters<InterbankTelemetry['stateChanged']>[0]): void {
    const attributes = {
      'bank.correlation_id': change.correlationId,
      'bank.interbank.stage': change.stage,
      ...(change.reason === null ? {} : { 'bank.interbank.reason': change.reason }),
    };
    const span = this.#tracer.startSpan('payment.interbank state');
    span.setAttributes(attributes);
    span.addEvent(STATE_EVENT, attributes);
    span.end();
    const fields: LogFields = {
      correlationId: change.correlationId,
      depositId: change.depositId,
      status: change.stage,
      ...(change.reason === null ? {} : { reason: change.reason }),
      ...(change.durationMs === null ? {} : { durationMs: change.durationMs }),
    };
    this.log.info('interbank deposit state changed', fields);

    if (change.stage === 'ACCEPTED' || change.stage === 'REJECTED') {
      const result = change.stage.toLowerCase();
      this.#deposits.add(1, { result });
      if (change.durationMs !== null) this.#duration.record(change.durationMs / 1000, { result });
    }
  }

  callbackAttempt(attempt: Parameters<InterbankTelemetry['callbackAttempt']>[0]): void {
    this.#callbacks.add(1, { result: attempt.result });
    const fields = { correlationId: attempt.correlationId, outcome: attempt.result };
    if (attempt.result === 'delivered') this.log.info('interbank callback delivered', fields);
    else this.log.warn('interbank callback failed; retry scheduled', fields);
  }
}
