import { JsonLogger } from '@bank/observability';
import request from 'supertest';
import type { INestApplication } from '@nestjs/common';

import { EventEmitter } from 'node:events';

import { Controller, Get, Module } from '@nestjs/common';
import type { MiddlewareConsumer, NestModule } from '@nestjs/common';
import { Test } from '@nestjs/testing';

import { CorrelationMiddleware } from '../src/interfaces/middleware/correlation.middleware';
import { accessLogMiddleware } from '../src/interfaces/middleware/access-log.middleware';
import { AccountsController } from '../src/interfaces/accounts.controller';
import { CustomersController } from '../src/interfaces/customers.controller';
import { HealthController } from '../src/interfaces/health.controller';
import { buildHarness } from './support/harness';
import type { Harness } from './support/harness';

/**
 * One structured line per request (T-60): the Gateway used to write only its
 * startup lines, so a request through it left nothing in Loki that carried its
 * `correlationId`. The lines here go through the real `JsonLogger`, so what is
 * asserted is what would reach stdout, redaction included.
 */

const ACTOR = '3f2a1c04-9c2e-4a71-b8f5-2d6e7c0a1b93';
const ACCOUNT = '8b7e5d21-9c2e-4a71-b8f5-2d6e7c0a1b93';
const CORRELATION = '6f1c8a30-9c2e-4a71-b8f5-2d6e7c0a1b93';
const SECRET = 'SECRET-activation-token-0123456789';

interface Line {
  readonly level: string;
  readonly message: string;
  readonly serviceName: string;
  readonly method?: string;
  readonly route?: string;
  readonly status?: number;
  readonly durationMs?: number;
  readonly correlationId?: string;
  readonly role?: string;
  readonly traceId?: string;
}

describe('the Gateway access log', () => {
  let harness: Harness;
  let app: INestApplication;
  let raw: string[];

  const lines = (): Line[] => raw.map((line) => JSON.parse(line) as Line);

  /** The line is written on `finish`, which supertest may resolve a tick before. */
  const settle = async (): Promise<void> => {
    await new Promise((resolve) => setImmediate(resolve));
  };

  beforeEach(async () => {
    raw = [];
    const logger = new JsonLogger({ service: 'gateway', sink: (line) => raw.push(line) });

    harness = await buildHarness([HealthController, AccountsController, CustomersController], [], {
      accessLog: logger,
    });
    app = harness.app;
  });

  afterEach(async () => {
    await app.close();
  });

  const auth = (role: 'CLIENTE' | 'ADMINISTRADOR' = 'CLIENTE'): string =>
    `Bearer ${harness.tokens.sign({ customerId: ACTOR, username: 'ana', role })}`;

  it('writes one info line with method, route template, status, duration and correlationId', async () => {
    // No token: a 401 from the guard, which is the gateway working.
    await request(app.getHttpServer())
      .get(`/api/accounts/${ACCOUNT}/balance`)
      .set('X-Correlation-Id', CORRELATION);
    await settle();

    expect(lines()).toHaveLength(1);
    expect(lines()[0]).toMatchObject({
      level: 'info',
      message: 'http request',
      serviceName: 'gateway',
      method: 'GET',
      route: '/api/accounts/:accountId/balance',
      status: 401,
      correlationId: CORRELATION,
    });
    expect(lines()[0]?.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('logs the route TEMPLATE, never the identifier that was in the URL', async () => {
    await request(app.getHttpServer())
      .get(`/api/accounts/${ACCOUNT}/balance`)
      .set('Authorization', auth());
    await settle();

    expect(raw.join('\n')).not.toContain(ACCOUNT);
  });

  it('never writes the query string, so an activation token cannot reach the log', async () => {
    const response = await request(app.getHttpServer()).get(
      `/api/customers/verify-email?token=${SECRET}`,
    );
    await settle();

    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(raw.join('\n')).not.toContain(SECRET);
    expect(raw.join('\n')).not.toContain('token=');
    expect(lines()[0]?.route).toBe('/api/customers/verify-email');
  });

  it('uses the generated correlation id when the caller brought none, the one it returns', async () => {
    const response = await request(app.getHttpServer())
      .get(`/api/accounts/${ACCOUNT}/balance`)
      .set('Authorization', auth());
    await settle();

    expect(lines()[0]?.correlationId).toBe(response.headers['x-correlation-id']);
  });

  it('logs a real 5xx as error, with the role of whoever asked', async () => {
    // The harness has no scripted reply, so the handler fails: a genuine 500.
    await request(app.getHttpServer())
      .get(`/api/accounts/${ACCOUNT}/balance`)
      .set('Authorization', auth());
    await settle();

    expect(lines()[0]).toMatchObject({ level: 'error', status: 500, role: 'CLIENTE' });
  });

  it('logs a 4xx as info and says the status', async () => {
    await request(app.getHttpServer()).get(`/api/accounts/${ACCOUNT}/balance`);
    await settle();

    expect(lines()[0]).toMatchObject({ level: 'info', status: 401 });
  });

  it('names an unmatched request "unmatched" instead of echoing its path', async () => {
    await request(app.getHttpServer()).get(`/nope/${SECRET}?token=${SECRET}`);
    await settle();

    expect(lines()[0]).toMatchObject({ route: 'unmatched', status: 404 });
    expect(raw.join('\n')).not.toContain(SECRET);
  });

  it.each(['/health', '/ready', '/metrics'])('writes nothing for %s', async (path) => {
    await request(app.getHttpServer()).get(path);
    await settle();

    expect(raw).toHaveLength(0);
  });

  it('records the role the guard verified, and none for an anonymous request', async () => {
    await request(app.getHttpServer()).get(`/api/accounts/${ACCOUNT}/balance`);
    await request(app.getHttpServer())
      .get(`/api/accounts/${ACCOUNT}/balance`)
      .set('Authorization', auth('ADMINISTRADOR'));
    await settle();

    expect(lines()[0]).not.toHaveProperty('role');
    expect(lines()[1]?.role).toBe('ADMINISTRADOR');
  });
});

describe('the access log level', () => {
  function serve(status: number): { level: string; fields: Record<string, unknown> }[] {
    const written: { level: string; fields: Record<string, unknown> }[] = [];
    const logger = {
      info: (_message: string, fields: Record<string, unknown>) =>
        written.push({ level: 'info', fields }),
      error: (_message: string, fields: Record<string, unknown>) =>
        written.push({ level: 'error', fields }),
    };
    const response = Object.assign(new EventEmitter(), {
      statusCode: status,
      writableFinished: true,
    });
    const request = {
      method: 'POST',
      originalUrl: '/api/transfers?token=x',
      baseUrl: '',
      route: { path: '/api/transfers' },
      correlationId: CORRELATION,
    };

    accessLogMiddleware(logger)(request as never, response as never, () => undefined);
    response.emit('finish');
    response.emit('close');

    return written;
  }

  it('is info below 500', () => {
    expect(serve(200)[0]?.level).toBe('info');
    expect(serve(499)[0]?.level).toBe('info');
  });

  it('is error from 500, and a 503 is not downgraded', () => {
    expect(serve(500)[0]?.level).toBe('error');
    expect(serve(503)[0]?.level).toBe('error');
  });

  it('writes exactly one line even though both finish and close fire', () => {
    expect(serve(200)).toHaveLength(1);
  });

  it('marks a response the client abandoned', () => {
    const written: Record<string, unknown>[] = [];
    const response = Object.assign(new EventEmitter(), {
      statusCode: 200,
      writableFinished: false,
    });

    accessLogMiddleware({
      info: (_message, fields) => written.push(fields),
      error: (_message, fields) => written.push(fields),
    })(
      {
        method: 'GET',
        originalUrl: '/api/x',
        baseUrl: '',
        route: { originalUrl: '/api/x' },
        correlationId: 'c',
      } as never,
      response as never,
      () => undefined,
    );
    response.emit('close');

    expect(written[0]).toMatchObject({ aborted: true });
  });
});

/**
 * The same middleware mounted the way production mounts it —
 * `consumer.apply(...).forRoutes('*path')` in a real Nest module — because the
 * `path` and `baseUrl` Express hands a middleware mounted that way are not the
 * ones a middleware attached with `app.use` sees.
 */
@Controller()
class ProbeController {
  @Get('health')
  public health(): { status: string } {
    return { status: 'ok' };
  }

  @Get('api/things/:thingId')
  public thing(): { ok: boolean } {
    return { ok: true };
  }
}

@Module({ controllers: [ProbeController] })
class ProbeModule implements NestModule {
  public static sink: string[] = [];

  public configure(consumer: MiddlewareConsumer): void {
    const logger = new JsonLogger({
      service: 'gateway',
      sink: (line) => ProbeModule.sink.push(line),
    });

    consumer.apply(CorrelationMiddleware, accessLogMiddleware(logger)).forRoutes('*path');
  }
}

describe('the access log mounted through a Nest module, as AppModule does', () => {
  let app: INestApplication;

  beforeEach(async () => {
    ProbeModule.sink = [];
    const moduleRef = await Test.createTestingModule({ imports: [ProbeModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('logs the template and the correlation id, and skips the probe', async () => {
    await request(app.getHttpServer()).get('/health');
    const response = await request(app.getHttpServer()).get('/api/things/42?token=SECRET-1');
    await new Promise((resolve) => setImmediate(resolve));

    const written = ProbeModule.sink.map((line) => JSON.parse(line) as Record<string, unknown>);

    expect(written).toHaveLength(1);
    expect(written[0]).toMatchObject({
      route: '/api/things/:thingId',
      status: 200,
      correlationId: response.headers['x-correlation-id'],
    });
    expect(ProbeModule.sink.join('\n')).not.toMatch(/SECRET-1|token=|\/42/);
  });
});
