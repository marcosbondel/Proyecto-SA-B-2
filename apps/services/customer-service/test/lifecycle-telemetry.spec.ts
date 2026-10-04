import { createHash } from 'node:crypto';

import type { CustomerRegisterV1, Identity } from '@bank/contracts';
import { metrics, trace } from '@opentelemetry/api';
import {
  AggregationTemporality,
  DataPointType,
  InMemoryMetricExporter,
  MeterProvider,
  PeriodicExportingMetricReader,
} from '@opentelemetry/sdk-metrics';
import type { HistogramMetricData, SumMetricData } from '@opentelemetry/sdk-metrics';
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';

import { RegisterCustomerUseCase } from '../src/application/register-customer.use-case';
import { SetIdentityVerdictUseCase } from '../src/application/set-identity-verdict.use-case';
import { SetKycStatusUseCase } from '../src/application/set-kyc-status.use-case';
import {
  DECISIONS_COUNTER,
  OtelLifecycleTelemetry,
  TIME_TO_DECISION_BUCKETS_S,
  REFUSALS_COUNTER,
  TIME_TO_DECISION_HISTOGRAM,
} from '../src/infrastructure/telemetry/otel-lifecycle.telemetry';
import { StructuredLogger } from '../src/interfaces/logging';
import {
  FakeHasher,
  FixedClock,
  InMemoryCustomerRepository,
  PredictableTokens,
  RecordingPublisher,
  StubDocumentReader,
} from './support/in-memory';

/**
 * T-41: the customer lifecycle, observed.
 *
 * Everything runs against **real** OpenTelemetry SDK providers with in-memory
 * exporters. The API is a no-op without an SDK, so a test that only checked
 * "the use case did not throw" would pass against code that emitted nothing —
 * which is exactly the defect these tests exist to catch.
 */

const CREATED_AT = new Date('2026-09-01T12:00:00.000Z');
const PHOTO_BYTES = Buffer.from('a pretend jpeg');
const PHOTO_DIGEST = createHash('sha256').update(PHOTO_BYTES).digest('hex');
const CORRELATION_ID = 'c0ffee00-1111-4222-8333-444455556666';
const STAFF: Identity = {
  role: 'CAJERO_RECEPTOR',
  customerId: '22222222-2222-4222-8222-222222222222',
};

/** A token shaped like the Gateway's session JWT, to prove none leaks anywhere. */
const JWT = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJtYXJpYSJ9.c2lnbmF0dXJl';

const REGISTER: CustomerRegisterV1 = {
  customerId: '7f1c8a30-9c2e-4a71-b8f5-2d6e7c0a1b93',
  fullName: 'María Fernanda López García',
  identityDocument: '2547896320101',
  email: 'maria.lopez@correo.com',
  dateOfBirth: '1996-04-18',
  address: '12 calle 3-45 zona 1, Guatemala',
  role: 'CLIENTE',
  credential: 'una-clave-larga',
  photo: {
    objectKey: 'photo.jpg',
    contentType: 'image/jpeg',
    sizeBytes: PHOTO_BYTES.byteLength,
    sha256: PHOTO_DIGEST,
  },
};

const spans = new InMemorySpanExporter();
const metricExporter = new InMemoryMetricExporter(AggregationTemporality.DELTA);
const meterProvider = new MeterProvider({
  readers: [
    new PeriodicExportingMetricReader({
      exporter: metricExporter,
      // Never fires on its own: the tests flush explicitly.
      exportIntervalMillis: 3_600_000,
    }),
  ],
});

beforeAll(() => {
  trace.setGlobalTracerProvider(
    new BasicTracerProvider({ spanProcessors: [new SimpleSpanProcessor(spans)] }),
  );
  metrics.setGlobalMeterProvider(meterProvider);
});

afterAll(async () => {
  await meterProvider.shutdown();
});

beforeEach(async () => {
  // Unflushed measurements from the previous test would otherwise land in this
  // one's first collection: the reader holds them until somebody asks.
  await meterProvider.forceFlush();
  spans.reset();
  metricExporter.reset();
});

function build(photo: Buffer | null = PHOTO_BYTES) {
  const lines: string[] = [];
  const logger = new StructuredLogger('customer-service', (line) => lines.push(line));
  const repository = new InMemoryCustomerRepository();
  const publisher = new RecordingPublisher();
  const clock = new FixedClock(CREATED_AT);
  const tokens = new PredictableTokens();
  const telemetry = new OtelLifecycleTelemetry(logger).forCorrelation(CORRELATION_ID);

  return {
    lines,
    clock,
    repository,
    register: new RegisterCustomerUseCase({
      repository,
      publisher,
      hasher: new FakeHasher(),
      tokens,
      documents: new StubDocumentReader(photo),
      clock,
      telemetry,
    }),
    setVerdict: new SetIdentityVerdictUseCase({ repository, publisher, clock, tokens, telemetry }),
    setKycStatus: new SetKycStatusUseCase({ repository, publisher, clock, telemetry }),
  };
}

async function flushedMetrics() {
  await meterProvider.forceFlush();

  return metricExporter
    .getMetrics()
    .flatMap((resource) => resource.scopeMetrics)
    .flatMap((scope) => scope.metrics);
}

function spanNames(): string[] {
  return spans.getFinishedSpans().map((span) => span.name);
}

/** The smallest bucket bound that covers 95 % of the observations. */
function p95UpperBound(histogram: HistogramMetricData): number {
  const points = histogram.dataPoints;
  const buckets = points.reduce<number[]>(
    (sum, point) => point.value.buckets.counts.map((count, i) => (sum[i] ?? 0) + count),
    [],
  );
  const total = buckets.reduce((a, b) => a + b, 0);
  const boundaries = points[0]!.value.buckets.boundaries;

  let seen = 0;
  for (let i = 0; i < buckets.length; i += 1) {
    seen += buckets[i]!;
    if (seen / total >= 0.95) {
      return boundaries[i] ?? Number.POSITIVE_INFINITY;
    }
  }

  return Number.POSITIVE_INFINITY;
}

describe('creating a customer', () => {
  it('emits one span carrying the correlation id, and one log line', async () => {
    const context = build();

    await context.register.execute(REGISTER, 'key-1');

    expect(spanNames()).toEqual(['customer.lifecycle created']);
    expect(spans.getFinishedSpans()[0]!.attributes).toMatchObject({
      'bank.customer.transition': 'created',
      'bank.customer.path': 'review',
      'bank.customer.id': REGISTER.customerId,
      'bank.correlation_id': CORRELATION_ID,
    });

    const log = JSON.parse(context.lines[0]!);
    expect(log).toMatchObject({
      level: 'info',
      message: 'customer created',
      correlationId: CORRELATION_ID,
      customerId: REGISTER.customerId,
      transition: 'created',
    });
    expect(context.lines).toHaveLength(1);
    // The log line belongs to the span, so a trace and its logs can be joined.
    expect(log.traceId).toBe(spans.getFinishedSpans()[0]!.spanContext().traceId);
    expect(log.spanId).toBe(spans.getFinishedSpans()[0]!.spanContext().spanId);
  });

  it('does not count a creation as a KYC decision', async () => {
    await build().register.execute(REGISTER, 'key-1');

    expect(await flushedMetrics()).toEqual([]);
  });

  it('emits nothing for a redelivered command', async () => {
    const context = build();

    await context.register.execute(REGISTER, 'key-1');
    await context.register.execute(REGISTER, 'key-1');

    expect(spanNames()).toEqual(['customer.lifecycle created']);
    expect(context.lines).toHaveLength(1);
  });
});

describe('verifying a customer', () => {
  it('emits the span, the log, the counter and the histogram', async () => {
    const context = build();
    await context.register.execute(REGISTER, 'key-1');
    spans.reset();
    context.lines.length = 0;

    context.clock.advanceTo(new Date(CREATED_AT.getTime() + 90_000));
    await context.setKycStatus.execute(
      { customerId: REGISTER.customerId, status: 'VERIFIED' },
      STAFF,
      'key-kyc-1',
    );

    expect(spanNames()).toEqual(['customer.lifecycle verified']);
    expect(spans.getFinishedSpans()[0]!.attributes['bank.correlation_id']).toBe(CORRELATION_ID);
    expect(JSON.parse(context.lines[0]!)).toMatchObject({
      message: 'customer verified',
      correlationId: CORRELATION_ID,
      customerId: REGISTER.customerId,
      transition: 'verified',
      path: 'review',
    });

    const collected = await flushedMetrics();
    const counter = collected.find((m) => m.descriptor.name === DECISIONS_COUNTER) as SumMetricData;
    const histogram = collected.find(
      (m) => m.descriptor.name === TIME_TO_DECISION_HISTOGRAM,
    ) as HistogramMetricData;

    expect(counter.dataPointType).toBe(DataPointType.SUM);
    expect(counter.descriptor.unit).toBe('{decision}');
    expect(counter.dataPoints).toHaveLength(1);
    expect(counter.dataPoints[0]!.attributes).toEqual({ result: 'verified', path: 'review' });
    expect(counter.dataPoints[0]!.value).toBe(1);

    expect(histogram.descriptor.unit).toBe('s');
    expect(histogram.dataPoints[0]!.value.sum).toBe(90);
    expect(histogram.dataPoints[0]!.value.count).toBe(1);
  });

  it('records a customer registered at the counter as created and verified on the counter path', async () => {
    const context = build();

    await context.register.execute({ ...REGISTER, photo: null }, 'key-staff', STAFF);

    expect(spanNames()).toEqual(['customer.lifecycle created', 'customer.lifecycle verified']);

    const collected = await flushedMetrics();
    const counter = collected.find((m) => m.descriptor.name === DECISIONS_COUNTER) as SumMetricData;
    const histogram = collected.find(
      (m) => m.descriptor.name === TIME_TO_DECISION_HISTOGRAM,
    ) as HistogramMetricData;

    expect(counter.dataPoints[0]!.attributes).toEqual({ result: 'verified', path: 'counter' });
    expect(histogram.dataPoints[0]!.attributes).toEqual({ path: 'counter' });
    expect(histogram.dataPoints[0]!.value.sum).toBe(0);
  });

  it('confirms through the teller verdict as well', async () => {
    const context = build();
    await context.register.execute(REGISTER, 'key-1');
    spans.reset();

    await context.setVerdict.execute(
      { customerId: REGISTER.customerId, verdict: 'VALIDATED' },
      STAFF,
      'verdict-1',
    );

    expect(spanNames()).toEqual(['customer.lifecycle verified']);
  });
});

describe('rejecting a customer', () => {
  it('counts a KYC rejection and emits no time-to-verification', async () => {
    const context = build();
    await context.register.execute(REGISTER, 'key-1');
    spans.reset();

    await context.setKycStatus.execute(
      { customerId: REGISTER.customerId, status: 'REJECTED' },
      STAFF,
      'key-kyc-1',
    );

    expect(spanNames()).toEqual(['customer.lifecycle rejected']);

    const collected = await flushedMetrics();
    const counter = collected.find((m) => m.descriptor.name === DECISIONS_COUNTER) as SumMetricData;

    expect(counter.dataPoints[0]!.attributes).toEqual({ result: 'rejected', path: 'review' });
    expect(collected.some((m) => m.descriptor.name === TIME_TO_DECISION_HISTOGRAM)).toBe(false);
  });

  it('counts the rejection that follows an unusable photo at registration', async () => {
    const context = build(null);

    await context.register.execute(REGISTER, 'key-1');

    expect(spanNames()).toEqual(['customer.lifecycle created', 'customer.lifecycle rejected']);
  });

  it('rejects through the teller verdict as well', async () => {
    const context = build();
    await context.register.execute(REGISTER, 'key-1');
    spans.reset();

    await context.setVerdict.execute(
      { customerId: REGISTER.customerId, verdict: 'REJECTED' },
      STAFF,
      'verdict-1',
    );

    expect(spanNames()).toEqual(['customer.lifecycle rejected']);
  });
});

describe('a decision that changes nothing', () => {
  it('logs it, and neither traces nor counts it', async () => {
    const context = build();
    await context.register.execute(REGISTER, 'key-1');
    await context.setKycStatus.execute(
      { customerId: REGISTER.customerId, status: 'VERIFIED' },
      STAFF,
      'key-kyc-1',
    );
    await flushedMetrics();
    spans.reset();
    metricExporter.reset();
    context.lines.length = 0;

    await context.setKycStatus.execute(
      { customerId: REGISTER.customerId, status: 'VERIFIED' },
      STAFF,
      'key-kyc-2',
    );

    expect(spans.getFinishedSpans()).toEqual([]);
    expect(await flushedMetrics()).toEqual([]);
    expect(JSON.parse(context.lines[0]!)).toMatchObject({
      message: 'customer verified ignored',
      outcome: 'IGNORED',
      customerId: REGISTER.customerId,
    });
  });

  it('logs a decision on a customer that does not exist', async () => {
    const context = build();

    await context.setKycStatus.execute(
      { customerId: REGISTER.customerId, status: 'REJECTED' },
      STAFF,
      'key-kyc-1',
    );

    expect(spans.getFinishedSpans()).toEqual([]);
    expect(JSON.parse(context.lines[0]!)).toMatchObject({
      outcome: 'IGNORED',
      reason: 'UNKNOWN_CUSTOMER',
    });
  });
});

describe('a registration that is refused', () => {
  it('leaves a refused span, a log line and a counter, and no document', async () => {
    const context = build();
    await context.register.execute(REGISTER, 'key-1');
    spans.reset();
    context.lines.length = 0;
    await flushedMetrics();
    metricExporter.reset();

    // The same document under another id and address: the DPI is already in use.
    await context.register.execute(
      {
        ...REGISTER,
        customerId: '7f1c8a30-9c2e-4a71-b8f5-2d6e7c0a1b95',
        email: 'otra.persona@correo.com',
      },
      'key-2',
    );

    expect(spanNames()).toEqual(['customer.lifecycle refused']);
    expect(spans.getFinishedSpans()[0]!.attributes).toMatchObject({
      'bank.customer.transition': 'refused',
      'bank.customer.refusal': 'DOCUMENT_ALREADY_REGISTERED',
      'bank.correlation_id': CORRELATION_ID,
    });

    expect(context.lines).toHaveLength(1);
    expect(JSON.parse(context.lines[0]!)).toMatchObject({
      message: 'customer registration refused',
      outcome: 'REFUSED',
      reason: 'DOCUMENT_ALREADY_REGISTERED',
      correlationId: CORRELATION_ID,
    });
    expect(context.lines[0]).not.toContain(REGISTER.identityDocument);
    expect(context.lines[0]).not.toContain('otra.persona@correo.com');

    const collected = await flushedMetrics();
    const refusals = collected.find((m) => m.descriptor.name === REFUSALS_COUNTER) as SumMetricData;

    expect(refusals.dataPoints).toHaveLength(1);
    expect(refusals.dataPoints[0]!.attributes).toEqual({ reason: 'DOCUMENT_ALREADY_REGISTERED' });
    // A refusal is not a KYC decision: it must not move the verified/rejected counter.
    expect(collected.some((m) => m.descriptor.name === DECISIONS_COUNTER)).toBe(false);
  });

  it('refuses a role that may not be created, with its own reason', async () => {
    const context = build();

    await context.register.execute({ ...REGISTER, role: 'ADMINISTRADOR' }, 'key-1');

    expect(spanNames()).toEqual(['customer.lifecycle refused']);
    expect(spans.getFinishedSpans()[0]!.attributes['bank.customer.refusal']).toBe(
      'ROLE_NOT_ELIGIBLE',
    );
  });
});

describe('the creation and the decision share a trace by link', () => {
  const TRACEPARENT = /^00-([0-9a-f]{32})-([0-9a-f]{16})-[0-9a-f]{2}$/;

  it('stores the creation context and links the later decision back to it', async () => {
    const context = build();

    await context.register.execute(REGISTER, 'key-1');

    const created = spans.getFinishedSpans()[0]!;
    const stored = context.repository.creationTraces.get(REGISTER.customerId);

    expect(stored).toMatch(TRACEPARENT);
    expect(stored).toContain(created.spanContext().traceId);
    expect(stored).toContain(created.spanContext().spanId);

    spans.reset();
    context.clock.advanceTo(new Date(CREATED_AT.getTime() + 60_000));
    await context.setKycStatus.execute(
      { customerId: REGISTER.customerId, status: 'VERIFIED' },
      STAFF,
      'key-kyc-1',
    );

    const verified = spans.getFinishedSpans()[0]!;

    expect(verified.links).toHaveLength(1);
    expect(verified.links[0]!.context.traceId).toBe(created.spanContext().traceId);
    expect(verified.links[0]!.context.spanId).toBe(created.spanContext().spanId);
  });

  it('links a teller verdict and a rejection the same way', async () => {
    const context = build();
    await context.register.execute(REGISTER, 'key-1');
    const created = spans.getFinishedSpans()[0]!;
    spans.reset();

    await context.setVerdict.execute(
      { customerId: REGISTER.customerId, verdict: 'REJECTED' },
      STAFF,
      'verdict-1',
    );

    expect(spans.getFinishedSpans()[0]!.links[0]!.context.spanId).toBe(
      created.spanContext().spanId,
    );
  });

  it('links the verification of a counter registration to its own creation', async () => {
    const context = build();

    await context.register.execute({ ...REGISTER, photo: null }, 'key-staff', STAFF);

    const [created, verified] = spans.getFinishedSpans();

    expect(verified!.links[0]!.context.spanId).toBe(created!.spanContext().spanId);
    expect(verified!.links[0]!.context.traceId).toBe(created!.spanContext().traceId);
  });

  it('records no link for a customer created before the context was stored', async () => {
    const context = build();
    await context.register.execute(REGISTER, 'key-1');
    context.repository.creationTraces.delete(REGISTER.customerId);
    spans.reset();

    await context.setKycStatus.execute(
      { customerId: REGISTER.customerId, status: 'VERIFIED' },
      STAFF,
      'key-kyc-1',
    );

    expect(spans.getFinishedSpans()[0]!.links).toEqual([]);
  });
});

describe('the time-to-verification histogram', () => {
  it('lets a p95 be computed from its buckets', async () => {
    const waitsInSeconds = [10, 20, 40, 100, 200, 400, 800, 2_000, 3_000, 80_000];

    for (const [index, wait] of waitsInSeconds.entries()) {
      const context = build();
      const customerId = `7f1c8a30-9c2e-4a71-b8f5-2d6e7c0a1b${String(index).padStart(2, '0')}`;
      const email = `person${String(index)}@correo.com`;
      const document = `25478963201${String(index).padStart(2, '0')}`;

      await context.register.execute(
        { ...REGISTER, customerId, email, identityDocument: document },
        `key-${String(index)}`,
      );
      context.clock.advanceTo(new Date(CREATED_AT.getTime() + wait * 1_000));
      await context.setKycStatus.execute(
        { customerId, status: 'VERIFIED' },
        STAFF,
        `kyc-${String(index)}`,
      );
    }

    const histogram = (await flushedMetrics()).find(
      (m) => m.descriptor.name === TIME_TO_DECISION_HISTOGRAM,
    ) as HistogramMetricData;

    expect(histogram.dataPoints[0]!.value.buckets.boundaries).toEqual(TIME_TO_DECISION_BUCKETS_S);
    expect(histogram.dataPoints[0]!.value.count).toBe(waitsInSeconds.length);
    // Nine of ten waits are under an hour and the tenth is 80 000 s, so the
    // 95th percentile falls in the day-long bucket, not in an average.
    expect(p95UpperBound(histogram)).toBe(86_400);
  });
});

describe('what never appears', () => {
  it('keeps the document, email, photo, address, credential and any JWT out of logs, spans and metric labels', async () => {
    const context = build();

    await context.register.execute(REGISTER, 'key-1', {
      ...STAFF,
      // A session token riding on the identity must stay out of every signal.
      ...({ token: JWT } as object),
    });
    await context.register.execute(
      {
        ...REGISTER,
        customerId: '7f1c8a30-9c2e-4a71-b8f5-2d6e7c0a1b94',
        identityDocument: '2547896320102',
        email: 'otra@correo.com',
      },
      'key-2',
    );
    await context.setKycStatus.execute(
      { customerId: '7f1c8a30-9c2e-4a71-b8f5-2d6e7c0a1b94', status: 'REJECTED' },
      STAFF,
      'key-kyc-1',
    );

    const everything = JSON.stringify([
      context.lines,
      spans.getFinishedSpans().map((span) => span.attributes),
      spans.getFinishedSpans().map((span) => span.name),
      await flushedMetrics(),
    ]);

    for (const secret of [
      REGISTER.identityDocument,
      '2547896320102',
      REGISTER.email,
      'otra@correo.com',
      REGISTER.address,
      REGISTER.credential,
      REGISTER.photo!.objectKey,
      PHOTO_DIGEST,
      JWT,
    ]) {
      expect(everything).not.toContain(secret);
    }

    expect(everything).not.toMatch(/eyJ[\w-]+\.[\w-]+\.[\w-]+/);
  });

  it('never uses an identifier as a metric label', async () => {
    const context = build();
    await context.register.execute(REGISTER, 'key-1');
    await context.setKycStatus.execute(
      { customerId: REGISTER.customerId, status: 'VERIFIED' },
      STAFF,
      'key-kyc-1',
    );

    for (const metric of await flushedMetrics()) {
      for (const point of metric.dataPoints) {
        expect(Object.keys(point.attributes).sort()).not.toContain('customerId');
        expect(JSON.stringify(point.attributes)).not.toContain(REGISTER.customerId);
        expect(JSON.stringify(point.attributes)).not.toContain(CORRELATION_ID);
      }
    }
  });
});
