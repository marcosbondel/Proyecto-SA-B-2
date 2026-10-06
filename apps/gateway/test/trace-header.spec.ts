import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { ROOT_CONTEXT, context, trace } from '@opentelemetry/api';
import type { Context, ContextManager } from '@opentelemetry/api';
import { BasicTracerProvider } from '@opentelemetry/sdk-trace-base';
import request from 'supertest';

import { CorrelationMiddleware } from '../src/interfaces/middleware/correlation.middleware';
import { activeTraceId } from '../src/application/active-trace';
import { HealthController } from '../src/interfaces/health.controller';
import { buildHarness } from './support/harness';

/**
 * T-45: "mostrar `correlationId` y `traceId` de cada operación". The frontend can
 * only show what the Gateway hands it, so the Gateway answers every request with
 * the trace it served it under — read from the *active span*, which is where the
 * SDK's HTTP instrumentation will have put it by the time T-48 registers one.
 *
 * Run against a real SDK span, because a middleware that read the id from
 * anything else (a header the caller sent, a field it minted) would pass a test
 * that handed it one, and be wrong in production.
 */

class StackContextManager implements ContextManager {
  #stack: Context[] = [ROOT_CONTEXT];

  public active(): Context {
    return this.#stack.at(-1) ?? ROOT_CONTEXT;
  }

  public with<A extends unknown[], F extends (...args: A) => ReturnType<F>>(
    ctx: Context,
    fn: F,
    thisArg?: ThisParameterType<F>,
    ...args: A
  ): ReturnType<F> {
    this.#stack.push(ctx);

    try {
      return fn.call(thisArg, ...args);
    } finally {
      this.#stack.pop();
    }
  }

  public bind<T>(_context: Context, target: T): T {
    return target;
  }

  public enable(): this {
    return this;
  }

  public disable(): this {
    this.#stack = [ROOT_CONTEXT];

    return this;
  }
}

const tracer = new BasicTracerProvider().getTracer('test');

beforeAll(() => {
  context.setGlobalContextManager(new StackContextManager());
});

afterAll(() => {
  context.disable();
});

/** What the middleware wrote on the response, without a server. */
function runMiddleware(): Record<string, string> {
  const headers: Record<string, string> = {};
  const response = {
    setHeader: (name: string, value: string) => {
      headers[name.toLowerCase()] = value;
    },
  };

  new CorrelationMiddleware().use(
    { headers: {} } as never,
    response as never,
    () => undefined,
  );

  return headers;
}

describe('the trace id the Gateway hands back', () => {
  it('is the id of the span the request is being served under', () => {
    const span = tracer.startSpan('GET /api/transfers');

    const headers = context.with(trace.setSpan(context.active(), span), runMiddleware);

    span.end();

    expect(headers['x-trace-id']).toBe(span.spanContext().traceId);
    expect(headers['x-trace-id']).toMatch(/^[0-9a-f]{32}$/);
    expect(headers['x-correlation-id']).toEqual(expect.any(String));
  });

  it('is a different header from the correlation id, and never the same value', () => {
    const span = tracer.startSpan('GET /api/transfers');

    const headers = context.with(trace.setSpan(context.active(), span), runMiddleware);

    span.end();

    expect(headers['x-trace-id']).not.toBe(headers['x-correlation-id']);
  });

  it('is absent — not empty, not zeros — while no SDK records a span', () => {
    const headers = runMiddleware();

    expect(activeTraceId()).toBeNull();
    expect(headers).not.toHaveProperty('x-trace-id');
    expect(headers['x-correlation-id']).toEqual(expect.any(String));
  });

  it('is absent under a span the SDK does not record', () => {
    const invalid = trace.wrapSpanContext({
      traceId: '0'.repeat(32),
      spanId: '0'.repeat(16),
      traceFlags: 0,
    });

    const headers = context.with(trace.setSpan(context.active(), invalid), runMiddleware);

    expect(headers).not.toHaveProperty('x-trace-id');
  });

  it('is not something a caller can supply: the header on the request changes nothing', async () => {
    const { app } = await buildHarness([HealthController]);

    try {
      const response = await request(app.getHttpServer())
        .get('/health')
        .set('X-Trace-Id', '4bf92f3577b34da6a3ce929d0e0e4736');

      expect(response.headers).not.toHaveProperty('x-trace-id');
    } finally {
      await app.close();
    }
  });

  it('reaches the browser: it is among the headers CORS exposes', () => {
    const main = readFileSync(resolve(__dirname, '..', 'src', 'main.ts'), 'utf8');

    expect(main).toMatch(/exposedHeaders:\s*\[[^\]]*'X-Trace-Id'/);
  });
});
