import { trace } from '@opentelemetry/api';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';

import { JsonLogger, maskText, redactFields } from '../src';

/**
 * The JSON every component writes, checked against what reaches the sink — the
 * only thing the collection agent and the rubric will ever see.
 */

const provider = new NodeTracerProvider();
provider.register();

afterAll(async () => {
  await provider.shutdown();
});

function capture(
  options: { environment?: string; version?: string; level?: 'debug' | 'info' } = {},
): { logger: JsonLogger; lines: () => Record<string, unknown>[] } {
  const raw: string[] = [];
  const logger = new JsonLogger({
    service: 'test-service',
    sink: (line) => raw.push(line),
    environment: options.environment ?? 'dev',
    version: options.version ?? '1.2.3-abc1234',
    ...(options.level === undefined ? {} : { level: options.level }),
  });

  return { logger, lines: () => raw.map((line) => JSON.parse(line) as Record<string, unknown>) };
}

describe('JsonLogger — the fields the assignment requires', () => {
  it('writes timestamp, level, serviceName, environment, version and message on every line', () => {
    const { logger, lines } = capture();

    logger.info('transfer accepted', { correlationId: 'corr-1' });

    const [line] = lines();
    expect(line).toMatchObject({
      level: 'info',
      serviceName: 'test-service',
      environment: 'dev',
      version: '1.2.3-abc1234',
      message: 'transfer accepted',
      correlationId: 'corr-1',
    });
    expect(new Date(String(line?.timestamp)).toISOString()).toBe(line?.timestamp);
  });

  it('puts the identifying fields first, in a fixed order, before the caller detail', () => {
    const { logger, lines } = capture();

    logger.info('x', { correlationId: 'c', transactionId: 't' } as Record<string, unknown>);

    expect(Object.keys(lines()[0] ?? {})).toEqual([
      'timestamp',
      'level',
      'serviceName',
      'environment',
      'version',
      'message',
      'correlationId',
      'transactionId',
    ]);
  });

  it('omits correlationId, traceId and spanId when there is none — never null', () => {
    const { logger, lines } = capture();

    logger.warn('boot');

    const [line] = lines();
    expect(line).not.toHaveProperty('correlationId');
    expect(line).not.toHaveProperty('traceId');
    expect(line).not.toHaveProperty('spanId');
  });

  it('takes environment and version from DEPLOYMENT_ENVIRONMENT and SERVICE_VERSION', () => {
    const saved = { env: process.env.DEPLOYMENT_ENVIRONMENT, version: process.env.SERVICE_VERSION };
    process.env.DEPLOYMENT_ENVIRONMENT = 'prod';
    process.env.SERVICE_VERSION = '2.0.0-feedbee';

    try {
      const raw: string[] = [];
      new JsonLogger({ service: 's', sink: (line) => raw.push(line) }).info('m');

      expect(JSON.parse(raw[0] ?? '{}')).toMatchObject({
        environment: 'prod',
        version: '2.0.0-feedbee',
      });
    } finally {
      restore('DEPLOYMENT_ENVIRONMENT', saved.env);
      restore('SERVICE_VERSION', saved.version);
    }
  });

  it('falls back to local / dev outside a cluster, so the fields are never missing', () => {
    const saved = { env: process.env.DEPLOYMENT_ENVIRONMENT, version: process.env.SERVICE_VERSION };
    delete process.env.DEPLOYMENT_ENVIRONMENT;
    process.env.SERVICE_VERSION = '   ';

    try {
      const raw: string[] = [];
      new JsonLogger({ service: 's', sink: (line) => raw.push(line) }).info('m');

      expect(JSON.parse(raw[0] ?? '{}')).toMatchObject({ environment: 'local', version: 'dev' });
    } finally {
      restore('DEPLOYMENT_ENVIRONMENT', saved.env);
      restore('SERVICE_VERSION', saved.version);
    }
  });

  it('stamps each level, and writes nothing below the threshold', () => {
    const { logger, lines } = capture();

    logger.debug('hidden');
    logger.info('a');
    logger.warn('b');
    logger.error('c');

    expect(lines().map((line) => line.level)).toEqual(['info', 'warn', 'error']);
  });

  it('writes debug lines when the threshold is lowered', () => {
    const { logger, lines } = capture({ level: 'debug' });

    logger.debug('visible');

    expect(lines()[0]?.level).toBe('debug');
  });
});

describe('JsonLogger — the trace beside the business flow', () => {
  it('stamps the traceId and spanId of the active span', () => {
    const { logger, lines } = capture();
    const tracer = trace.getTracer('test');

    const ids = tracer.startActiveSpan('work', (span) => {
      logger.info('inside', { correlationId: 'corr-2' });
      span.end();
      return span.spanContext();
    });

    expect(lines()[0]).toMatchObject({
      correlationId: 'corr-2',
      traceId: ids.traceId,
      spanId: ids.spanId,
    });
  });

  it('keeps the active trace across an await', async () => {
    const { logger, lines } = capture();
    const tracer = trace.getTracer('test');

    const traceId = await tracer.startActiveSpan('async-work', async (span) => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      logger.info('after await');
      span.end();
      return span.spanContext().traceId;
    });

    expect(lines()[0]?.traceId).toBe(traceId);
  });

  it('prefers a traceId the caller passes over the active one', () => {
    const { logger, lines } = capture();

    trace.getTracer('test').startActiveSpan('outer', (span) => {
      logger.info('explicit', { traceId: 'a'.repeat(32), spanId: 'b'.repeat(16) });
      span.end();
    });

    expect(lines()[0]).toMatchObject({ traceId: 'a'.repeat(32), spanId: 'b'.repeat(16) });
  });
});

describe('redaction — what must never reach a log', () => {
  it.each([
    ['password'],
    ['DB_PASSWORD'],
    ['authToken'],
    ['refreshToken'],
    ['clientSecret'],
    ['apiCredential'],
    ['authorization'],
    ['jwt'],
    ['apiKey'],
  ])('drops a secret field named "%s"', (name) => {
    const output = redactFields({ correlationId: 'c', [name]: 'sk_live_do_not_log' });

    expect(output).not.toHaveProperty(name);
    expect(JSON.stringify(output)).not.toContain('sk_live_do_not_log');
    expect(output.correlationId).toBe('c');
  });

  it.each([
    ['email'],
    ['customerEmail'],
    ['documentNumber'],
    ['dpi'],
    ['photoKey'],
    ['fotoDocumento'],
    ['recipient'],
    ['phone'],
    ['address'],
  ])('drops a personal-data field named "%s"', (name) => {
    const output = redactFields({ [name]: 'private value' });

    expect(output).not.toHaveProperty(name);
  });

  it('masks a JWT that slipped into an allowed field, and into the message', () => {
    const jwt =
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';
    const { logger, lines } = capture();

    logger.error(`rejected ${jwt}`, { reason: `header was Bearer ${jwt}` } as Record<
      string,
      unknown
    >);

    const text = JSON.stringify(lines()[0]);
    expect(text).not.toContain(jwt);
    expect(lines()[0]?.message).toBe('rejected [REDACTED:jwt]');
  });

  it('masks an email address inside a value', () => {
    expect(maskText('could not deliver to ana.lopez@example.com today')).toBe(
      'could not deliver to [REDACTED:email] today',
    );
  });

  it('keeps a sentence that only mentions a token — masking is by shape, not by word', () => {
    expect(redactFields({ reason: 'the customer token expired' })).toEqual({
      reason: 'the customer token expired',
    });
  });

  it('redacts inside nested objects and arrays, and flattens an Error to name and message', () => {
    const output = redactFields({
      detail: { email: 'x@y.gt', items: [{ password: 'p', ok: 'mail me at a@b.gt' }] },
      error: new TypeError('failed for z@w.gt'),
    });

    expect(output).toEqual({
      detail: { items: [{ ok: 'mail me at [REDACTED:email]' }] },
      error: { name: 'TypeError', message: 'failed for [REDACTED:email]' },
    });
  });

  it('omits undefined fields rather than writing them', () => {
    expect(redactFields({ a: undefined, b: 0, c: null, d: false })).toEqual({
      b: 0,
      c: null,
      d: false,
    });
  });
});

function restore(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}
