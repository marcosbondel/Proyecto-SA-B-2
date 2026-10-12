import { createEnvelope, EXCHANGES } from '@bank/contracts';
import type { MessageEnvelope } from '@bank/contracts';
import { metrics, SpanKind, SpanStatusCode, trace } from '@opentelemetry/api';
import type { ConsumeMessage } from 'amqplib';
import { MeterProvider, MetricReader } from '@opentelemetry/sdk-metrics';
import type { DataPoint, Histogram as HistogramPoint } from '@opentelemetry/sdk-metrics';
import { InMemorySpanExporter, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base';
import type { ReadableSpan } from '@opentelemetry/sdk-trace-base';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';

import { MessageBroker } from '../src/broker';
import { resetMessagingInstruments } from '../src/telemetry';

/**
 * T-48: the W3C trace context crossing the broker, checked against a faked
 * connection so that every branch — ack, retry, dead letter, unparseable,
 * reply, parked — can be driven on purpose. `trace-propagation.integration`
 * proves the same thing against a real RabbitMQ.
 */

// ------------------------------------------------------------------ the SDK

const spans = new InMemorySpanExporter();
const provider = new NodeTracerProvider({ spanProcessors: [new SimpleSpanProcessor(spans)] });
provider.register();

class CollectingReader extends MetricReader {
  protected override onForceFlush(): Promise<void> {
    return Promise.resolve();
  }
  protected override onShutdown(): Promise<void> {
    return Promise.resolve();
  }
}
const reader = new CollectingReader();
metrics.setGlobalMeterProvider(new MeterProvider({ readers: [reader] }));
resetMessagingInstruments();

afterAll(async () => {
  await provider.shutdown();
});

beforeEach(() => {
  spans.reset();
  published.length = 0;
  publishFailure = null;
  createdChannels.length = 0;
});

// ------------------------------------------------------------- the broker

interface Published {
  readonly exchange: string;
  readonly routingKey: string;
  readonly options: { readonly headers: Record<string, unknown> };
}

const published: Published[] = [];
let publishFailure: Error | null = null;

type SetupFn = (channel: FakeChannel) => Promise<void>;
const createdChannels: { setup: SetupFn }[] = [];

jest.mock('amqp-connection-manager', () => ({
  connect: () => ({
    isConnected: () => true,
    createChannel: (options: { setup: SetupFn }) => {
      createdChannels.push(options);
      return {
        waitForConnect: () => Promise.resolve(),
        publish: (
          exchange: string,
          routingKey: string,
          _content: Buffer,
          options: Published['options'],
        ) => {
          if (publishFailure !== null) {
            return Promise.reject(publishFailure);
          }
          published.push({ exchange, routingKey, options });
          return Promise.resolve();
        },
      };
    },
    close: () => Promise.resolve(),
  }),
}));

/** A channel that records what the adapter did with each delivery. */
class FakeChannel {
  public consumer: ((message: ConsumeMessage | null) => void) | null = null;
  public readonly acked: ConsumeMessage[] = [];
  public readonly requeued: { queue: string; headers: Record<string, unknown> }[] = [];
  public readonly parked: { exchange: string; headers: Record<string, unknown> }[] = [];

  assertQueue(): Promise<void> {
    return Promise.resolve();
  }
  assertExchange(): Promise<void> {
    return Promise.resolve();
  }
  bindQueue(): Promise<void> {
    return Promise.resolve();
  }
  prefetch(): Promise<void> {
    return Promise.resolve();
  }
  consume(_queue: string, callback: (message: ConsumeMessage | null) => void): Promise<void> {
    this.consumer = callback;
    return Promise.resolve();
  }
  ack(message: ConsumeMessage): void {
    this.acked.push(message);
  }
  sendToQueue(
    queue: string,
    _content: Buffer,
    options: { headers: Record<string, unknown> },
  ): void {
    this.requeued.push({ queue, headers: options.headers });
  }
  publish(
    exchange: string,
    _key: string,
    _content: Buffer,
    options: { headers: Record<string, unknown> },
  ): void {
    this.parked.push({ exchange, headers: options.headers });
  }
}

function newBroker(): MessageBroker {
  return new MessageBroker({
    url: 'amqp://unused',
    exchanges: [EXCHANGES.events],
    errorExchange: EXCHANGES.errors,
  });
}

/** Subscribes, runs the setup the adapter registered, and returns the channel to drive. */
async function consuming(
  subscribe: (broker: MessageBroker) => Promise<void>,
): Promise<FakeChannel> {
  await subscribe(newBroker());
  const channel = new FakeChannel();
  await createdChannels[createdChannels.length - 1]!.setup(channel);
  return channel;
}

/** Delivers one message and waits until the adapter acknowledged it. */
async function deliver(
  channel: FakeChannel,
  body: Buffer,
  headers: Record<string, unknown>,
  routingKey = 'account.debited.v1',
): Promise<void> {
  const before = channel.acked.length;
  channel.consumer?.({
    content: body,
    fields: { routingKey, deliveryTag: 1, redelivered: false, exchange: EXCHANGES.events },
    properties: { headers },
  } as unknown as ConsumeMessage);

  for (let i = 0; i < 50 && channel.acked.length === before; i += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

const ENVELOPE = createEnvelope(
  { transactionId: '33333333-3333-4333-8333-333333333333' },
  { messageType: 'account.debited.v1', producer: 'account-service', identity: null },
);

const TRACE_ID = '4bf92f3577b34da6a3ce929d0e0e4736';
const PARENT_ID = '00f067aa0ba902b7';
const TRACEPARENT = `00-${TRACE_ID}-${PARENT_ID}-01`;

function body(envelope: MessageEnvelope<unknown> = ENVELOPE): Buffer {
  return Buffer.from(JSON.stringify(envelope));
}

function finished(kind: SpanKind): ReadableSpan[] {
  return spans.getFinishedSpans().filter((span) => span.kind === kind);
}

async function publishedOnce(): Promise<Published> {
  const broker = newBroker();
  await broker.start();
  await broker.publish(EXCHANGES.events, 'account.debited.v1', ENVELOPE, {
    headers: { 'x-custom': 'kept' },
  });
  return published[0]!;
}

async function collected(name: string): Promise<DataPoint<number | HistogramPoint>[]> {
  const { resourceMetrics } = await reader.collect();
  return resourceMetrics.scopeMetrics
    .flatMap((scope) => scope.metrics)
    .filter((metric) => metric.descriptor.name === name)
    .flatMap((metric) => metric.dataPoints as DataPoint<number | HistogramPoint>[]);
}

// ----------------------------------------------------------------- publish

describe('publish — the PRODUCER side', () => {
  it('injects a traceparent naming the producer span, inside the caller’s trace', async () => {
    const tracer = trace.getTracer('test');
    const parentTrace = await tracer.startActiveSpan('http request', async (span) => {
      await publishedOnce();
      span.end();
      return span.spanContext().traceId;
    });

    const [producer] = finished(SpanKind.PRODUCER);
    expect(published[0]?.options.headers.traceparent).toBe(
      `00-${parentTrace}-${producer?.spanContext().spanId}-01`,
    );
  });

  it('names the span after the exchange and sets the messaging attributes', async () => {
    await publishedOnce();

    const [producer] = finished(SpanKind.PRODUCER);
    expect(producer?.name).toBe(`publish ${EXCHANGES.events}`);
    expect(producer?.attributes).toMatchObject({
      'messaging.system': 'rabbitmq',
      'messaging.operation.type': 'send',
      'messaging.destination.name': EXCHANGES.events,
      'messaging.rabbitmq.destination.routing_key': 'account.debited.v1',
      'messaging.message.id': ENVELOPE.messageId,
      'messaging.message.conversation_id': ENVELOPE.correlationId,
      'bank.correlation_id': ENVELOPE.correlationId,
      'bank.message.type': 'account.debited.v1',
    });
  });

  it('starts a trace of its own when nothing is active, and still injects it', async () => {
    const message = await publishedOnce();

    const [producer] = finished(SpanKind.PRODUCER);
    expect(producer?.parentSpanContext).toBeUndefined();
    expect(message.options.headers.traceparent).toContain(producer?.spanContext().traceId);
  });

  it('keeps the caller’s headers beside the trace context', async () => {
    const message = await publishedOnce();

    expect(message.options.headers).toMatchObject({
      'x-causation-id': ENVELOPE.causationId,
      'x-idempotency-key': ENVELOPE.idempotencyKey,
      'x-custom': 'kept',
    });
  });

  it('marks the span failed and rethrows when the broker refuses the publish', async () => {
    publishFailure = new Error('channel closed');
    const broker = newBroker();
    await broker.start();

    await expect(broker.publish(EXCHANGES.events, 'account.debited.v1', ENVELOPE)).rejects.toThrow(
      'channel closed',
    );

    const [producer] = finished(SpanKind.PRODUCER);
    expect(producer?.status.code).toBe(SpanStatusCode.ERROR);
  });
});

// --------------------------------------------------------------- consume

describe('subscribe — the CONSUMER side', () => {
  it('runs the handler inside a CONSUMER span that continues the incoming trace', async () => {
    let seen: { traceId: string; spanId: string } | undefined;
    const channel = await consuming((broker) =>
      broker.subscribe({ queue: 'transaction.saga', bindings: [] }, () => {
        seen = trace.getActiveSpan()?.spanContext();
      }),
    );

    await deliver(channel, body(), { traceparent: TRACEPARENT });

    const [consumer] = finished(SpanKind.CONSUMER);
    expect(consumer?.spanContext().traceId).toBe(TRACE_ID);
    expect(consumer?.parentSpanContext?.spanId).toBe(PARENT_ID);
    expect(seen).toMatchObject({ traceId: TRACE_ID, spanId: consumer?.spanContext().spanId });
  });

  it('describes the delivery: queue, routing key, attempt, message and outcome', async () => {
    const channel = await consuming((broker) =>
      broker.subscribe({ queue: 'transaction.saga', bindings: [] }, () => undefined),
    );

    await deliver(channel, body(), { traceparent: TRACEPARENT });

    const [consumer] = finished(SpanKind.CONSUMER);
    expect(consumer?.name).toBe('process transaction.saga');
    expect(consumer?.attributes).toMatchObject({
      'messaging.operation.type': 'process',
      'messaging.destination.name': 'transaction.saga',
      'messaging.rabbitmq.destination.routing_key': 'account.debited.v1',
      'bank.message.attempt': 1,
      'bank.correlation_id': ENVELOPE.correlationId,
      'bank.delivery.outcome': 'ack',
    });
    expect(consumer?.status.code).not.toBe(SpanStatusCode.ERROR);
  });

  it('starts a new trace for a delivery that carries no traceparent', async () => {
    const channel = await consuming((broker) =>
      broker.subscribe({ queue: 'transaction.saga', bindings: [] }, () => undefined),
    );

    await deliver(channel, body(), {});

    const [consumer] = finished(SpanKind.CONSUMER);
    expect(consumer?.parentSpanContext).toBeUndefined();
    expect(consumer?.spanContext().traceId).not.toBe(TRACE_ID);
  });

  it('sends a failed delivery down the ladder with its traceparent intact, and marks the span', async () => {
    const channel = await consuming((broker) =>
      broker.subscribe({ queue: 'transaction.saga', bindings: [] }, () => {
        throw new Error('database away');
      }),
    );

    await deliver(channel, body(), { traceparent: TRACEPARENT });

    const [consumer] = finished(SpanKind.CONSUMER);
    expect(channel.requeued[0]?.headers.traceparent).toBe(TRACEPARENT);
    expect(consumer?.attributes['bank.delivery.outcome']).toBe('retry');
    expect(consumer?.status).toMatchObject({
      code: SpanStatusCode.ERROR,
      message: 'database away',
    });
  });

  it('records the last failed attempt as a dead letter', async () => {
    const channel = await consuming((broker) =>
      broker.subscribe({ queue: 'transaction.saga', bindings: [] }, () => {
        throw new Error('still failing');
      }),
    );

    await deliver(channel, body(), { traceparent: TRACEPARENT, 'x-attempt': 4 });

    const [consumer] = finished(SpanKind.CONSUMER);
    expect(channel.parked[0]?.headers.traceparent).toBe(TRACEPARENT);
    expect(consumer?.attributes).toMatchObject({
      'bank.delivery.outcome': 'dead_letter',
      'bank.message.attempt': 4,
    });
  });

  it('records an unparseable delivery as invalid, still inside the incoming trace', async () => {
    const channel = await consuming((broker) =>
      broker.subscribe({ queue: 'transaction.saga', bindings: [] }, () => undefined),
    );

    await deliver(channel, Buffer.from('not json'), { traceparent: TRACEPARENT });

    const [consumer] = finished(SpanKind.CONSUMER);
    expect(consumer?.spanContext().traceId).toBe(TRACE_ID);
    expect(consumer?.attributes['bank.delivery.outcome']).toBe('invalid');
    expect(consumer?.status.code).toBe(SpanStatusCode.ERROR);
  });
});

describe('subscribeExclusive and drainErrors', () => {
  it('names a reply span after the role, not after the per-pod queue', async () => {
    const channel = await consuming((broker) =>
      broker.subscribeExclusive(
        { queue: 'gateway.replies.pod-7f9c', bindings: [], telemetryName: 'gateway.replies' },
        () => undefined,
      ),
    );

    await deliver(channel, body(), { traceparent: TRACEPARENT });

    const [consumer] = finished(SpanKind.CONSUMER);
    expect(consumer?.name).toBe('process gateway.replies');
    expect(consumer?.attributes['messaging.destination.name']).toBe('gateway.replies');
    expect(consumer?.spanContext().traceId).toBe(TRACE_ID);
  });

  it('records a parked message inside the trace of the flow that failed', async () => {
    let seenTrace: string | undefined;
    const channel = await consuming((broker) =>
      broker.drainErrors(() => {
        seenTrace = trace.getActiveSpan()?.spanContext().traceId;
        return Promise.resolve();
      }),
    );

    await deliver(channel, body(), { traceparent: TRACEPARENT });

    expect(seenTrace).toBe(TRACE_ID);
    expect(finished(SpanKind.CONSUMER)[0]?.name).toBe('process bank.errors.drain');
  });
});

// ---------------------------------------------------------------- metrics

describe('throughput metrics — by exchange and by queue, never by message', () => {
  it('counts published messages by exchange, with no per-message attribute', async () => {
    await publishedOnce();

    const points = await collected('messaging.client.sent.messages');
    const point = points.find(
      (candidate) => candidate.attributes['messaging.destination.name'] === EXCHANGES.events,
    );

    expect(point?.value).toBeGreaterThanOrEqual(1);
    expect(Object.keys(point?.attributes ?? {}).sort()).toEqual(
      ['messaging.destination.name', 'messaging.operation.name', 'messaging.system'].sort(),
    );
  });

  it('counts consumed deliveries by queue and outcome', async () => {
    const channel = await consuming((broker) =>
      broker.subscribe({ queue: 'metrics.queue', bindings: [] }, () => undefined),
    );

    await deliver(channel, body(), { traceparent: TRACEPARENT });

    const points = await collected('messaging.client.consumed.messages');
    const point = points.find(
      (candidate) => candidate.attributes['messaging.destination.name'] === 'metrics.queue',
    );

    expect(point?.value).toBe(1);
    expect(point?.attributes).toEqual({
      'messaging.system': 'rabbitmq',
      'messaging.operation.name': 'process',
      'messaging.destination.name': 'metrics.queue',
      'bank.delivery.outcome': 'ack',
    });
  });
});
