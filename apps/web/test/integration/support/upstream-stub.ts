import { createHash } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';

import { findFreePort } from './ports';

export interface UpstreamRequestSummary {
  readonly method: string;
  readonly url: string;
  readonly headers: Record<string, string | string[] | undefined>;
  readonly bodySha256: string;
  readonly bodyLength: number;
}

export interface UpstreamStub {
  readonly baseUrl: string;
  readonly close: () => Promise<void>;
}

/** 90 bytes that look enough like a JPEG to be a believable "photo" — the exact bytes are what the sha256 assertion is about, not the format. */
/** The trace id the stub's `/traced` route answers with. */
export const UPSTREAM_TRACE_ID = '4bf92f3577b34da6a3ce929d0e0e4736';

export function fakeJpegBytes(): Buffer {
  const marker = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
  const filler = Buffer.alloc(86, 0x42);

  return Buffer.concat([marker, filler]);
}

/**
 * A `node:http` server standing in for the Gateway, entirely under this test
 * process's control — unlike the Nitro server under test, which runs as its
 * own OS process and cannot have its behaviour reprogrammed once started.
 *
 * Routes (all under whatever prefix the proxy forwards, matched by suffix so
 * the leading `/api` the proxy keeps does not need to be special-cased here):
 *
 * - `…/echo` — replies with a JSON summary of what it received (method, full
 *   URL including the query string, a chosen subset of headers, and a sha256
 *   + byte length of the body) and mirrors back `authorization` and
 *   `x-correlation-id` as response headers, so a test can assert both
 *   directions of the trip in one request.
 * - `…/status/<code>` — replies with exactly that status code.
 * - `…/binary` — replies with `fakeJpegBytes()` as `image/jpeg`.
 * - `…/big` — reads the whole body and replies with its sha256 and length,
 *   for the >1MB case.
 * - anything else — behaves like `…/echo`.
 */
export async function startUpstreamStub(): Promise<UpstreamStub> {
  const server: Server = createServer((req, res) => {
    void handle(req, res);
  });

  const port = await findFreePort();

  await new Promise<void>((resolveListen) => {
    server.listen(port, '127.0.0.1', resolveListen);
  });

  return {
    baseUrl: `http://127.0.0.1:${String(port)}/`,
    close: () =>
      new Promise<void>((resolveClose) => {
        server.close(() => {
          resolveClose();
        });
      }),
  };
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = req.url ?? '/';
  const path = url.split('?')[0] ?? '';

  if (path.endsWith('/binary')) {
    const bytes = fakeJpegBytes();

    res.writeHead(200, { 'content-type': 'image/jpeg', 'content-length': String(bytes.length) });
    res.end(bytes);
    return;
  }

  // T-45: an upstream that says which trace it served the request under, the way
  // the Gateway does once an SDK is registered.
  if (path.endsWith('/traced')) {
    res.writeHead(200, {
      'content-type': 'application/json',
      'x-correlation-id': 'corr-traced',
      'x-trace-id': UPSTREAM_TRACE_ID,
    });
    res.end('{}');
    return;
  }

  const statusMatch = /\/status\/(\d{3})$/.exec(path);

  if (statusMatch) {
    res.writeHead(Number(statusMatch[1]), { 'content-type': 'application/json' });
    res.end(JSON.stringify({ status: Number(statusMatch[1]) }));
    return;
  }

  const chunks: Buffer[] = [];

  for await (const chunk of req) {
    chunks.push(chunk as Buffer);
  }
  const body = Buffer.concat(chunks);
  const sha256 = createHash('sha256').update(body).digest('hex');

  if (path.endsWith('/big')) {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ bodySha256: sha256, bodyLength: body.length }));
    return;
  }

  const summary: UpstreamRequestSummary = {
    method: req.method ?? '',
    url,
    headers: {
      authorization: req.headers.authorization,
      'x-correlation-id': req.headers['x-correlation-id'],
      'content-type': req.headers['content-type'],
      'x-api-key': req.headers['x-api-key'],
      'idempotency-key': req.headers['idempotency-key'],
      traceparent: req.headers.traceparent,
      tracestate: req.headers.tracestate,
    },
    bodySha256: sha256,
    bodyLength: body.length,
  };

  const correlationId = req.headers['x-correlation-id'];

  res.writeHead(200, {
    'content-type': 'application/json',
    ...(typeof correlationId === 'string' ? { 'x-correlation-id': correlationId } : {}),
  });
  res.end(JSON.stringify(summary));
}
