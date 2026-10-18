import {
  context,
  metrics,
  propagation,
  ROOT_CONTEXT,
  SpanKind,
  SpanStatusCode,
  trace,
} from '@opentelemetry/api';
import type {
  Attributes,
  Context,
  Counter,
  Histogram,
  Span,
  TextMapGetter,
} from '@opentelemetry/api';

import type { MessageEnvelope } from '@bank/contracts';
import { maskedException, redactSpanText } from '@bank/observability';

/**
 * Context propagation across RabbitMQ (Fase 3, §4.1: "Propagar el contexto con
 * el estándar W3C Trace Context (traceparent) en los headers de cada mensaje
 * del broker … de modo que productor y consumidor queden en la misma traza").
 *
 * The broker is where a distributed trace is most easily lost: an HTTP hop is
 * auto-instrumented, a message is not. So the adapter does it itself, on both
 * ends, against `@opentelemetry/api` alone:
 *
 * - **Publishing** opens a PRODUCER span and injects the active context into
 *   the AMQP `headers` — `traceparent`, and `tracestate` / `baggage` when there
 *   are any. The span is the parent the consumer will attach to, so the trace
 *   shows the message *leaving* as well as arriving.
 * - **Consuming** extracts the context from those headers and runs the handler
 *   inside a CONSUMER span that is its child. Everything the handler does — the
 *   use case's own spans (T-41 to T-45), the SQL, the next publish — therefore
 *   lands in the same trace, and the next hop continues it.
 *
 * With no SDK registered the global propagator is a no-op and every span is
 * non-recording: nothing is injected, nothing is extracted, and the adapter
 * behaves byte-for-byte as it did before T-48.
 *
 * The `correlationId` stays what it was in Fase 1 — the business flow — and is
 * set on every span as `messaging.message.conversation_id` (its semantic
 * convention) and `bank.correlation_id` (what the other services already use).
 * Trace id and correlation id answer different questions, and a retried
 * transfer has one correlation and possibly several traces.
 *
 * Metric attributes are a closed, small set: the system, the operation, the
 * exchange or queue, and the outcome. Never the routing key, the message id or
 * the correlation id — those are per-message and belong to spans and logs.
 */
const SCOPE = '@bank/messaging';
const SYSTEM = 'rabbitmq';

/** What happened to one delivery. Closed set: it is a metric attribute. */
export type DeliveryOutcome = 'ack' | 'retry' | 'dead_letter' | 'invalid' | 'dropped';

interface Instruments {
  readonly sent: Counter;
  readonly sendDuration: Histogram;
  readonly consumed: Counter;
  readonly processDuration: Histogram;
}

let instruments: Instruments | null = null;

/**
 * Created on first use, never at import: `metrics.getMeter` returns a no-op
 * meter for good if it is called before the SDK registers its provider, and
 * this module may be imported before that has happened.
 */
function meters(): Instruments {
  if (instruments === null) {
    const meter = metrics.getMeter(SCOPE);
    instruments = {
      sent: meter.createCounter('messaging.client.sent.messages', {
        description: 'Messages published to an exchange, by outcome.',
        unit: '{message}',
      }),
      sendDuration: meter.createHistogram('messaging.client.operation.duration', {
        description: 'Time from publish to the broker confirming it.',
        unit: 's',
        advice: { explicitBucketBoundaries: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5] },
      }),
      consumed: meter.createCounter('messaging.client.consumed.messages', {
        description: 'Deliveries taken from a queue, by outcome.',
        unit: '{message}',
      }),
      processDuration: meter.createHistogram('messaging.process.duration', {
        description: 'Time a handler spent on one delivery.',
        unit: 's',
        advice: {
          explicitBucketBoundaries: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30],
        },
      }),
    };
  }

  return instruments;
}

/** For tests that swap the meter provider between cases. */
export function resetMessagingInstruments(): void {
  instruments = null;
}

const HEADER_GETTER: TextMapGetter<Record<string, unknown>> = {
  keys: (carrier) => Object.keys(carrier),
  get: (carrier, key) => {
    const value = carrier[key];

    if (typeof value === 'string') {
      return value;
    }

    // amqplib hands back a long string header as a Buffer in some paths.
    return Buffer.isBuffer(value) ? value.toString('utf8') : undefined;
  },
};

function envelopeAttributes(envelope: MessageEnvelope<unknown> | null): Attributes {
  if (envelope === null) {
    return {};
  }

  return {
    'messaging.message.id': envelope.messageId,
    'messaging.message.conversation_id': envelope.correlationId,
    'bank.correlation_id': envelope.correlationId,
    'bank.message.type': envelope.messageType,
  };
}

/**
 * Publishes inside a PRODUCER span and hands `send` the headers to put on the
 * wire — the caller's own headers plus the injected trace context.
 */
export async function tracePublish(
  exchange: string,
  routingKey: string,
  envelope: MessageEnvelope<unknown>,
  headers: Record<string, unknown>,
  send: (headers: Record<string, unknown>) => Promise<void>,
): Promise<void> {
  const tracer = trace.getTracer(SCOPE);
  const startedAt = performance.now();
  const metricAttributes: Attributes = {
    'messaging.system': SYSTEM,
    'messaging.operation.name': 'publish',
    'messaging.destination.name': exchange,
  };

  await tracer.startActiveSpan(
    `publish ${exchange}`,
    {
      kind: SpanKind.PRODUCER,
      attributes: {
        'messaging.system': SYSTEM,
        'messaging.operation.type': 'send',
        'messaging.operation.name': 'publish',
        'messaging.destination.name': exchange,
        'messaging.rabbitmq.destination.routing_key': routingKey,
        ...envelopeAttributes(envelope),
      },
    },
    async (span: Span) => {
      const carrier: Record<string, string> = {};
      propagation.inject(context.active(), carrier);

      try {
        await send({ ...headers, ...carrier });
        meters().sent.add(1, metricAttributes);
      } catch (error) {
        const errorType = error instanceof Error ? error.name : 'Error';
        markFailed(span, error);
        meters().sent.add(1, { ...metricAttributes, 'error.type': errorType });
        throw error;
      } finally {
        meters().sendDuration.record(secondsSince(startedAt), metricAttributes);
        span.end();
      }
    },
  );
}

/** The context a delivery was published in, or the root when it carries none. */
export function contextFromHeaders(headers: Record<string, unknown> | undefined): Context {
  return propagation.extract(ROOT_CONTEXT, headers ?? {}, HEADER_GETTER);
}

/** One delivery being processed: the span and the bookkeeping to close it. */
export interface DeliveryTrace {
  /** Runs `work` with the CONSUMER span active, so everything inside joins the trace. */
  run<T>(work: () => T): T;
  /** The envelope, once parsed — adds its identifiers to the span. */
  describe(envelope: MessageEnvelope<unknown>): void;
  /** Closes the span and records the outcome. Call exactly once. */
  finish(outcome: DeliveryOutcome, error?: unknown): void;
}

/**
 * Opens the CONSUMER span for one delivery, as a child of the context its
 * headers carry.
 *
 * `destination` is the queue for the metric attribute. For the Gateway's
 * per-replica reply queue it is a stable label instead of the queue name, or
 * every pod would mint a new time series.
 */
export function traceDelivery(
  destination: string,
  routingKey: string,
  headers: Record<string, unknown> | undefined,
  attempt: number,
): DeliveryTrace {
  const tracer = trace.getTracer(SCOPE);
  const parent = contextFromHeaders(headers);
  const startedAt = performance.now();
  const span = tracer.startSpan(
    `process ${destination}`,
    {
      kind: SpanKind.CONSUMER,
      attributes: {
        'messaging.system': SYSTEM,
        'messaging.operation.type': 'process',
        'messaging.operation.name': 'process',
        'messaging.destination.name': destination,
        'messaging.rabbitmq.destination.routing_key': routingKey,
        'bank.message.attempt': attempt,
      },
    },
    parent,
  );
  const active = trace.setSpan(parent, span);
  let finished = false;

  return {
    run: <T>(work: () => T): T => context.with(active, work),
    describe: (envelope) => {
      span.setAttributes(envelopeAttributes(envelope));
    },
    finish: (outcome, error) => {
      if (finished) {
        return;
      }
      finished = true;

      span.setAttribute('bank.delivery.outcome', outcome);
      if (outcome !== 'ack' && outcome !== 'dropped') {
        markFailed(span, error);
      }

      const attributes: Attributes = {
        'messaging.system': SYSTEM,
        'messaging.operation.name': 'process',
        'messaging.destination.name': destination,
        'bank.delivery.outcome': outcome,
      };
      meters().consumed.add(1, attributes);
      meters().processDuration.record(secondsSince(startedAt), attributes);
      span.end();
    },
  };
}

function markFailed(span: Span, error: unknown): void {
  if (error instanceof Error) {
    // The broker rejects with the driver's own message, which quotes values
    // (a duplicate email, a malformed token); a span is readable by everyone
    // who opens Grafana, so the text goes through the same masking as a log.
    span.recordException(maskedException(error));
    span.setAttribute('error.type', error.name);
    span.setStatus({ code: SpanStatusCode.ERROR, message: redactSpanText(error.message) });
    return;
  }

  span.setStatus({
    code: SpanStatusCode.ERROR,
    ...(error === undefined ? {} : { message: redactSpanText(String(error)) }),
  });
}

function secondsSince(startedAt: number): number {
  return (performance.now() - startedAt) / 1000;
}
