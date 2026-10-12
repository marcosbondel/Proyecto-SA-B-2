import { execFileSync, spawn } from 'node:child_process';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createServer, request as httpRequest } from 'node:http';
import type { IncomingMessage, Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';

/**
 * The SDK as it runs in an image: a **separate Node process** that registers it
 * first, serves HTTP, and exports over OTLP/HTTP to whatever
 * `OTEL_EXPORTER_OTLP_ENDPOINT` names. This test is that endpoint — a stand-in
 * for the Collector of T-49 — and reads the child's stdout the way the
 * collection agent will.
 *
 * Integration by the repository's rule: it crosses a real process boundary
 * (`node test/fixtures/instrumented-process.js`), and what it checks is only
 * observable from outside one — what actually leaves the process, and in what
 * shape. Nothing here needs a service from Docker, so it never skips.
 */

jest.setTimeout(60_000);

const PACKAGE_ROOT = join(__dirname, '..');
const FIXTURE = join(__dirname, 'fixtures', 'instrumented-process.js');

interface OtlpValue {
  readonly stringValue?: string;
  readonly intValue?: string | number;
}
interface OtlpAttribute {
  readonly key: string;
  readonly value: OtlpValue;
}
interface OtlpSpan {
  readonly traceId: string;
  readonly spanId: string;
  readonly parentSpanId?: string;
  readonly name: string;
  readonly kind: number;
  readonly attributes: readonly OtlpAttribute[];
  readonly status?: { readonly code?: number };
}
interface Received {
  readonly path: string;
  readonly body: Record<string, unknown>;
}

/** What one run of the child produced, seen from outside. */
interface Run {
  readonly received: readonly Received[];
  readonly logs: readonly Record<string, unknown>[];
  readonly sentTraceId: string;
  readonly sentParentId: string;
}

/** The fixture runs the compiled package, so the package is compiled first — always, from source. */
beforeAll(() => {
  execFileSync(
    process.execPath,
    [require.resolve('typescript/bin/tsc'), '-p', 'tsconfig.build.json'],
    {
      cwd: PACKAGE_ROOT,
      stdio: 'inherit',
    },
  );
});

/** A minimal OTLP/HTTP receiver: records every JSON body posted to it. */
async function startReceiver(): Promise<{ server: Server; port: number; received: Received[] }> {
  const received: Received[] = [];
  const server = createServer((request: IncomingMessage, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8');
      received.push({ path: request.url ?? '', body: JSON.parse(text) as Record<string, unknown> });
      response.writeHead(200, { 'content-type': 'application/json' }).end('{}');
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));

  return { server, port: (server.address() as AddressInfo).port, received };
}

function get(port: number, path: string, headers: Record<string, string> = {}): Promise<number> {
  return new Promise((resolve, reject) => {
    const outgoing = httpRequest({ host: '127.0.0.1', port, path, headers }, (response) => {
      response.resume();
      response.on('end', () => resolve(response.statusCode ?? 0));
    });
    outgoing.on('error', reject);
    outgoing.end();
  });
}

/** Spawns the child with `env`, drives it through the four routes, waits for it to flush and exit. */
async function runChild(
  env: Record<string, string>,
  receiver: { received: Received[] },
): Promise<Run> {
  const child: ChildProcessWithoutNullStreams = spawn(process.execPath, [FIXTURE], {
    cwd: PACKAGE_ROOT,
    env: { PATH: process.env.PATH ?? '', ...env },
  });

  let stdout = '';
  child.stdout.on('data', (chunk: Buffer) => {
    stdout += chunk.toString('utf8');
  });
  let stderr = '';
  child.stderr.on('data', (chunk: Buffer) => {
    stderr += chunk.toString('utf8');
  });

  const exited = new Promise<number | null>((resolve) => child.on('exit', resolve));

  const port = await new Promise<number>((resolve, reject) => {
    const timer = setInterval(() => {
      const match = /READY (\d+)/.exec(stdout);
      if (match !== null) {
        clearInterval(timer);
        resolve(Number(match[1]));
      }
    }, 20);
    void exited.then(() => {
      clearInterval(timer);
      reject(new Error(`fixture exited before it was ready:\n${stderr}`));
    });
  });

  const sentTraceId = randomBytes(16).toString('hex');
  const sentParentId = randomBytes(8).toString('hex');

  await get(port, '/work', { traceparent: `00-${sentTraceId}-${sentParentId}-01` });
  await get(port, '/health');
  await get(port, '/fail');
  await get(port, '/shutdown');

  const code = await exited;
  if (code !== 0) {
    throw new Error(`fixture exited with ${String(code)}:\n${stderr}`);
  }

  const logs = stdout
    .split('\n')
    .filter((line) => line.startsWith('{'))
    .map((line) => JSON.parse(line) as Record<string, unknown>);

  return { received: [...receiver.received], logs, sentTraceId, sentParentId };
}

function spansOf(run: Run): OtlpSpan[] {
  return run.received
    .filter((item) => item.path === '/v1/traces')
    .flatMap((item) => item.body.resourceSpans as { scopeSpans: { spans: OtlpSpan[] }[] }[])
    .flatMap((resource) => resource.scopeSpans)
    .flatMap((scope) => scope.spans);
}

function resourceAttributes(run: Run): Record<string, string> {
  const first = run.received.find((item) => item.path === '/v1/traces');
  const resource = (
    first?.body.resourceSpans as { resource: { attributes: OtlpAttribute[] } }[]
  )[0];

  return Object.fromEntries(
    (resource?.resource.attributes ?? []).map((attribute) => [
      attribute.key,
      attribute.value.stringValue ?? '',
    ]),
  );
}

function attribute(span: OtlpSpan | undefined, key: string): string | number | undefined {
  const value = span?.attributes.find((item) => item.key === key)?.value;

  return value?.stringValue ?? (value?.intValue === undefined ? undefined : Number(value.intValue));
}

/** OTLP/JSON encodes span ids as hex; some exporters emit base64. Normalise to hex. */
function hex(id: string | undefined): string | undefined {
  if (id === undefined || /^[0-9a-f]+$/.test(id)) {
    return id;
  }

  return Buffer.from(id, 'base64').toString('hex');
}

function serverSpan(run: Run, route: string): OtlpSpan | undefined {
  return spansOf(run).find(
    (span) => span.kind === 2 && String(attribute(span, 'url.path') ?? '') === route,
  );
}

describe('a process with the SDK and an OTLP endpoint', () => {
  let run: Run;
  let receiver: Awaited<ReturnType<typeof startReceiver>>;

  beforeAll(async () => {
    receiver = await startReceiver();
    run = await runChild(
      {
        OTEL_EXPORTER_OTLP_ENDPOINT: `http://127.0.0.1:${String(receiver.port)}`,
        OTEL_METRIC_EXPORT_INTERVAL: '60000',
        SERVICE_VERSION: '9.9.9-integration',
        DEPLOYMENT_ENVIRONMENT: 'dev',
        HOSTNAME: 'fixture-pod-1',
      },
      receiver,
    );
  });

  afterAll(async () => {
    await new Promise((resolve) => receiver.server.close(resolve));
  });

  it('exports its spans over OTLP/HTTP to the configured endpoint', () => {
    expect(spansOf(run).length).toBeGreaterThan(0);
  });

  it('names itself with service.name, service.version and the deployment environment', () => {
    expect(resourceAttributes(run)).toMatchObject({
      'service.name': 'fixture-service',
      'service.version': '9.9.9-integration',
      'deployment.environment.name': 'dev',
      'deployment.environment': 'dev',
      'service.instance.id': 'fixture-pod-1',
    });
  });

  it('records an incoming request as a SERVER span with the stable HTTP conventions', () => {
    const span = serverSpan(run, '/work');

    expect(attribute(span, 'http.request.method')).toBe('GET');
    expect(attribute(span, 'http.response.status_code')).toBe(200);
  });

  it('marks a 5xx response as an error on its span', () => {
    const span = serverSpan(run, '/fail');

    expect(attribute(span, 'http.response.status_code')).toBe(500);
    expect(span?.status?.code).toBe(2);
  });

  it('does not trace the kubelet probes', () => {
    expect(serverSpan(run, '/health')).toBeUndefined();
  });

  it('continues the trace named by an incoming traceparent header', () => {
    const span = serverSpan(run, '/work');

    expect(hex(span?.traceId)).toBe(run.sentTraceId);
    expect(hex(span?.parentSpanId)).toBe(run.sentParentId);
  });

  it('keeps a span opened inside the handler in the same trace, as a child of the server span', () => {
    const server = serverSpan(run, '/work');
    const child = spansOf(run).find((span) => span.name === 'fixture.child');

    expect(hex(child?.traceId)).toBe(run.sentTraceId);
    expect(hex(child?.parentSpanId)).toBe(hex(server?.spanId));
  });

  it('writes the log line of that handler with the same traceId and the child span’s id', () => {
    const line = run.logs.find((entry) => entry.message === 'work done');
    const child = spansOf(run).find((span) => span.name === 'fixture.child');

    expect(line).toMatchObject({
      traceId: run.sentTraceId,
      spanId: hex(child?.spanId),
      correlationId: 'corr-fixture',
    });
  });

  it('stamps that log line with serviceName, environment and version', () => {
    const line = run.logs.find((entry) => entry.message === 'work done');

    expect(line).toMatchObject({
      serviceName: 'fixture-service',
      environment: 'dev',
      version: '9.9.9-integration',
      level: 'info',
    });
  });

  it('exports metrics, including the HTTP server duration histogram by status code', () => {
    const metrics = run.received
      .filter((item) => item.path === '/v1/metrics')
      .flatMap(
        (item) =>
          item.body.resourceMetrics as {
            scopeMetrics: {
              metrics: {
                name: string;
                histogram?: { dataPoints: { attributes: OtlpAttribute[] }[] };
              }[];
            }[];
          }[],
      )
      .flatMap((resource) => resource.scopeMetrics)
      .flatMap((scope) => scope.metrics);
    const duration = metrics.find((metric) => metric.name === 'http.server.request.duration');
    const statuses = (duration?.histogram?.dataPoints ?? []).map((point) =>
      Number(
        point.attributes.find((item) => item.key === 'http.response.status_code')?.value.intValue,
      ),
    );

    expect(statuses).toEqual(expect.arrayContaining([200, 500]));
  });
});

describe('a process with the SDK but no endpoint (a laptop, CI)', () => {
  it('exports nothing, yet still writes the traceId on its log lines', async () => {
    const receiver = await startReceiver();

    try {
      const run = await runChild({}, receiver);
      const line = run.logs.find((entry) => entry.message === 'work done');

      expect(run.received).toHaveLength(0);
      expect(line?.traceId).toBe(run.sentTraceId);
    } finally {
      await new Promise((resolve) => receiver.server.close(resolve));
    }
  });
});

describe('a process with OTEL_SDK_DISABLED=true', () => {
  let run: Run;

  beforeAll(async () => {
    const receiver = await startReceiver();

    try {
      run = await runChild(
        {
          OTEL_SDK_DISABLED: 'true',
          OTEL_EXPORTER_OTLP_ENDPOINT: `http://127.0.0.1:${String(receiver.port)}`,
        },
        receiver,
      );
    } finally {
      await new Promise((resolve) => receiver.server.close(resolve));
    }
  });

  it('exports nothing even though an endpoint is configured', () => {
    expect(run.received).toHaveLength(0);
  });

  it('writes log lines without a traceId — there is no trace to name', () => {
    const line = run.logs.find((entry) => entry.message === 'work done');

    expect(line).toBeDefined();
    expect(line).not.toHaveProperty('traceId');
  });
});
