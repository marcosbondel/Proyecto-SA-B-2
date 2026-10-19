import { trace } from '@opentelemetry/api';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';

import {
  continueTrace,
  currentTraceparent,
  JsonLogger,
  nestLoggerFor,
  telemetryResource,
  withTraceparent,
} from '../src';

/**
 * The outbox bridge, the NestJS adapter and the resource — the three pieces a
 * component wires in its `main.ts`, each checked in-process.
 */

const provider = new NodeTracerProvider();
provider.register();

afterAll(async () => {
  await provider.shutdown();
});

const TRACEPARENT = /^00-[0-9a-f]{32}-[0-9a-f]{16}-0[01]$/;

describe('currentTraceparent / withTraceparent — the outbox crossing a gap in time', () => {
  it('has nothing to store when no span is active', () => {
    expect(currentTraceparent()).toBeNull();
  });

  it('captures the active span as a W3C traceparent', () => {
    const tracer = trace.getTracer('test');

    const [stored, ids] = tracer.startActiveSpan('handler', (span) => {
      const value = currentTraceparent();
      span.end();
      return [value, span.spanContext()] as const;
    });

    expect(stored).toMatch(TRACEPARENT);
    expect(stored).toContain(ids.traceId);
    expect(stored).toContain(ids.spanId);
  });

  it('resumes the stored trace later: a span opened inside is a child of the stored one', () => {
    const tracer = trace.getTracer('test');
    const stored = tracer.startActiveSpan('handler', (span) => {
      const value = currentTraceparent();
      span.end();
      return value;
    });

    const relayed = withTraceparent(stored, () =>
      tracer.startActiveSpan('relay publish', (span) => {
        span.end();
        return span.spanContext().traceId;
      }),
    );

    expect(stored).toContain(relayed);
  });

  it('starts from the root when nothing was stored, never from whatever the caller had active', () => {
    const tracer = trace.getTracer('test');

    const [outer, inner] = tracer.startActiveSpan('timer tick', (span) => {
      const insideNull = withTraceparent(null, () => trace.getActiveSpan());
      span.end();
      return [span, insideNull] as const;
    });

    expect(outer).toBeDefined();
    expect(inner).toBeUndefined();
  });

  it('treats a malformed traceparent as no parent', () => {
    expect(withTraceparent('not-a-traceparent', () => trace.getActiveSpan())).toBeUndefined();
  });
});

describe('continueTrace — a scheduled job as a step of the trace that scheduled it', () => {
  it('opens a span that is a child of the stored traceparent, active while the work runs', async () => {
    const tracer = trace.getTracer('test');
    const [stored, origin] = tracer.startActiveSpan('payment opened', (span) => {
      const value = currentTraceparent();
      span.end();
      return [value, span.spanContext()] as const;
    });

    const inside = await continueTrace(stored, 'payment.retry', { 'bank.attempt': 2 }, () =>
      Promise.resolve(currentTraceparent()),
    );

    expect(inside).toContain(origin.traceId);
    expect(inside).not.toContain(origin.spanId);
  });

  it('rethrows what the work threw, unchanged', async () => {
    const failure = new Error('provider timeout');

    await expect(
      continueTrace(null, 'payment.retry', {}, () => Promise.reject(failure)),
    ).rejects.toBe(failure);
  });
});

describe('nestLoggerFor — the framework in the same JSON', () => {
  function capture(): {
    lines: () => Record<string, unknown>[];
    nest: ReturnType<typeof nestLoggerFor>;
  } {
    const raw: string[] = [];
    const logger = new JsonLogger({
      service: 'gateway',
      sink: (line) => raw.push(line),
      environment: 'dev',
      version: 'v',
    });

    return {
      nest: nestLoggerFor(logger),
      lines: () => raw.map((l) => JSON.parse(l) as Record<string, unknown>),
    };
  }

  it('writes Nest’s log() as info, with the last string as the context', () => {
    const { nest, lines } = capture();

    nest.log('Mapped {/api/transfers, POST} route', 'RouterExplorer');

    expect(lines()[0]).toMatchObject({
      level: 'info',
      serviceName: 'gateway',
      message: 'Mapped {/api/transfers, POST} route',
      context: 'RouterExplorer',
    });
  });

  it('writes error(message, stack, context) as error with the stack and the context', () => {
    const { nest, lines } = capture();

    nest.error('boom', 'Error: boom\n    at x', 'ExceptionsHandler');

    expect(lines()[0]).toMatchObject({
      level: 'error',
      message: 'boom',
      stack: 'Error: boom\n    at x',
      context: 'ExceptionsHandler',
    });
  });

  it('turns an Error object into its message, keeping the stack', () => {
    const { nest, lines } = capture();

    nest.fatal(new Error('fatal thing'));

    expect(lines()[0]).toMatchObject({
      level: 'error',
      message: 'fatal thing',
      error: 'fatal thing',
    });
    expect(String(lines()[0]?.stack)).toContain('fatal thing');
  });

  it('keeps a non-string message as a detail field', () => {
    const { nest, lines } = capture();

    nest.warn({ attempts: 3 }, 'Broker');

    expect(lines()[0]).toMatchObject({ level: 'warn', detail: { attempts: 3 }, context: 'Broker' });
  });

  it('takes a plain object among the extras as structured fields', () => {
    const { nest, lines } = capture();

    nest.error('[corr-9] BROKER_UNAVAILABLE: down', { correlationId: 'corr-9' }, 'gateway');

    expect(lines()[0]).toMatchObject({
      level: 'error',
      correlationId: 'corr-9',
      context: 'gateway',
      message: '[corr-9] BROKER_UNAVAILABLE: down',
    });
  });

  it('maps verbose and debug to debug, which the default threshold hides', () => {
    const { nest, lines } = capture();

    nest.verbose('noise');
    nest.debug('noise');

    expect(lines()).toHaveLength(0);
  });
});

describe('telemetryResource — who is emitting', () => {
  it('names the component, its version and its environment', () => {
    const resource = telemetryResource('payment-service', {
      SERVICE_VERSION: '1.4.0-c0ffee1',
      DEPLOYMENT_ENVIRONMENT: 'prod',
      HOSTNAME: 'payment-service-7f9c-abcde',
    });

    expect(resource.attributes).toMatchObject({
      'service.name': 'payment-service',
      'service.version': '1.4.0-c0ffee1',
      'deployment.environment.name': 'prod',
      'deployment.environment': 'prod',
      'service.namespace': 'bank-usac',
      'service.instance.id': 'payment-service-7f9c-abcde',
    });
  });

  it('falls back to local / dev and leaves the instance out when there is no hostname', () => {
    const resource = telemetryResource('gateway', {});

    expect(resource.attributes).toMatchObject({
      'service.version': 'dev',
      'deployment.environment.name': 'local',
    });
    expect(resource.attributes).not.toHaveProperty('service.instance.id');
  });
});
