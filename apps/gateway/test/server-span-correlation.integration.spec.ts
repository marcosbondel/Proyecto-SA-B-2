import { execFileSync, spawn } from 'node:child_process';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { createServer, request as httpRequest } from 'node:http';
import type { IncomingMessage, Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';

/**
 * The correlation id on the HTTP **SERVER** span, against the real
 * `HttpInstrumentation` (T-60, F).
 *
 * The first fix tagged `trace.getActiveSpan()` and a unit test with a hand-made
 * active span passed — while in the cluster the SERVER span still had no
 * `bank.correlation_id`, because inside a middleware the active span is the
 * Express/Nest INTERNAL span the instrumentation opened *under* it. That is the
 * failure a mocked span cannot show, so this runs the compiled middlewares in a
 * separate process with the SDK registered, and reads what leaves it over OTLP.
 * Integration by the repository's rule: it crosses a real process.
 */

jest.setTimeout(60_000);

const PACKAGE_ROOT = join(__dirname, '..');
const FIXTURE = join(__dirname, 'fixtures', 'instrumented-gateway.js');
const CORRELATION = '6f1c8a30-9c2e-4a71-b8f5-2d6e7c0a1b93';
const SECRET = 'SECRET-activation-token-0123456789';
const KIND_SERVER = 2;
const KIND_INTERNAL = 1;

interface OtlpAttribute {
  readonly key: string;
  readonly value: { readonly stringValue?: string };
}
interface OtlpSpan {
  readonly traceId: string;
  readonly spanId: string;
  readonly parentSpanId?: string;
  readonly name: string;
  readonly kind: number;
  readonly attributes: readonly OtlpAttribute[];
}

const attribute = (span: OtlpSpan | undefined, key: string): string | undefined =>
  span?.attributes.find((item) => item.key === key)?.value.stringValue;

/** OTLP/JSON encodes ids as hex; some exporters emit base64. Normalise to hex. */
const hex = (id: string | undefined): string | undefined =>
  id === undefined || /^[0-9a-f]+$/.test(id) ? id : Buffer.from(id, 'base64').toString('hex');

function get(
  port: number,
  path: string,
  headers: Record<string, string> = {},
): Promise<{ status: number; headers: IncomingMessage['headers'] }> {
  return new Promise((resolve, reject) => {
    const outgoing = httpRequest({ host: '127.0.0.1', port, path, headers }, (response) => {
      response.resume();
      response.on('end', () =>
        resolve({ status: response.statusCode ?? 0, headers: response.headers }),
      );
    });
    outgoing.on('error', reject);
    outgoing.end();
  });
}

describe('the Gateway middlewares under the real SDK', () => {
  let receiver: Server;
  const spans: OtlpSpan[] = [];
  let logs: Record<string, unknown>[];
  let generated: string;

  beforeAll(async () => {
    // The fixture runs the compiled gateway, so it is compiled first, from source.
    execFileSync(
      process.execPath,
      [require.resolve('typescript/bin/tsc'), '-p', 'tsconfig.build.json'],
      {
        cwd: PACKAGE_ROOT,
        stdio: 'inherit',
      },
    );

    receiver = createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on('data', (chunk: Buffer) => chunks.push(chunk));
      request.on('end', () => {
        if (request.url === '/v1/traces') {
          const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as {
            resourceSpans: { scopeSpans: { spans: OtlpSpan[] }[] }[];
          };
          spans.push(
            ...body.resourceSpans.flatMap((resource) =>
              resource.scopeSpans.flatMap((scope) => scope.spans),
            ),
          );
        }
        response.writeHead(200, { 'content-type': 'application/json' }).end('{}');
      });
    });
    await new Promise<void>((resolve) => receiver.listen(0, '127.0.0.1', resolve));

    const child: ChildProcessWithoutNullStreams = spawn(process.execPath, [FIXTURE], {
      cwd: PACKAGE_ROOT,
      env: {
        PATH: process.env.PATH ?? '',
        OTEL_EXPORTER_OTLP_ENDPOINT: `http://127.0.0.1:${String((receiver.address() as AddressInfo).port)}`,
        OTEL_METRIC_EXPORT_INTERVAL: '60000',
      },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });
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

    await get(port, '/api/accounts/9c2e/balance', { 'x-correlation-id': CORRELATION });
    const anonymous = await get(port, '/api/accounts/9c2e/balance');
    generated = String(anonymous.headers['x-correlation-id']);
    await get(port, `/api/customers/verify-email?token=${SECRET}`);
    await get(port, '/shutdown');

    const code = await exited;
    if (code !== 0) {
      throw new Error(`fixture exited with ${String(code)}:\n${stderr}`);
    }

    logs = stdout
      .split('\n')
      .filter((line) => line.startsWith('{'))
      .map((line) => JSON.parse(line) as Record<string, unknown>);
  });

  afterAll(async () => {
    await new Promise((resolve) => receiver.close(resolve));
  });

  const servers = (): OtlpSpan[] => spans.filter((span) => span.kind === KIND_SERVER);

  it('puts bank.correlation_id on the HTTP SERVER span when the caller sent one', () => {
    const matching = servers().filter(
      (span) => attribute(span, 'bank.correlation_id') === CORRELATION,
    );

    expect(matching).toHaveLength(1);
    expect(attribute(matching[0], 'url.path')).toBe('/api/accounts/9c2e/balance');
  });

  it('puts the GENERATED correlation id there too, the same one it answered with', () => {
    expect(generated).toMatch(/^[0-9a-f-]{36}$/);
    expect(servers().some((span) => attribute(span, 'bank.correlation_id') === generated)).toBe(
      true,
    );
  });

  it('is on a span of kind SERVER, not only on the framework span that handled it', () => {
    const tagged = spans.filter((span) => attribute(span, 'bank.correlation_id') === CORRELATION);

    expect(tagged.some((span) => span.kind === KIND_SERVER)).toBe(true);
    // The Express middleware span is a child of the server span, and is tagged too.
    expect(tagged.every((span) => span.kind === KIND_SERVER || span.kind === KIND_INTERNAL)).toBe(
      true,
    );
  });

  it('writes one access-log line per request, joined to the SERVER span by traceId and spanId', () => {
    const line = logs.find((entry) => entry.correlationId === CORRELATION);
    const server = servers().find((span) => attribute(span, 'bank.correlation_id') === CORRELATION);

    expect(line).toMatchObject({
      level: 'info',
      message: 'http request',
      method: 'GET',
      route: '/api/accounts/:accountId/balance',
      status: 200,
      traceId: hex(server?.traceId),
      spanId: hex(server?.spanId),
    });
    expect(logs.filter((entry) => entry.message === 'http request')).toHaveLength(4); // the three requests and /shutdown
  });

  it('never lets the activation token reach the log line or the exported spans', () => {
    expect(JSON.stringify(logs)).not.toContain(SECRET);
    expect(JSON.stringify(spans)).not.toContain(SECRET);
    expect(logs.some((entry) => entry.route === '/api/customers/verify-email')).toBe(true);
  });
});
