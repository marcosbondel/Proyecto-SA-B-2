import { SpanKind } from '@opentelemetry/api';
import { InMemorySpanExporter, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base';
import type { ReadableSpan } from '@opentelemetry/sdk-trace-base';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';

import {
  dropManualTraceHeaders,
  maskedException,
  maskQueryParams,
  RedactingSpanProcessor,
  recordFailure,
  redactSpanText,
  SENSITIVE_QUERY_PARAMS,
} from '../src';

/**
 * No trace may carry a token, a JWT, a bearer credential, an e-mail address or
 * a document number (Fase 3, §8.3 "Datos sensibles expuestos"). Every case here
 * builds real spans through the real SDK, ends them, and reads what an exporter
 * would be handed — so the assertion is about the exported object, not about
 * the helper that produced it.
 */

const TOKEN = 'k3Y9-activation_TOKEN-0123456789abcdef';
const JWT = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.c2lnbmF0dXJl';
const EMAIL = 'cliente.real@example.com';
const DOCUMENT = '2987654321012';

const exporter = new InMemorySpanExporter();
// Same order as `startTelemetry`: the redactor first, the exporter after it.
const provider = new NodeTracerProvider({
  spanProcessors: [new RedactingSpanProcessor(), new SimpleSpanProcessor(exporter)],
});
const tracer = provider.getTracer('test');

afterEach(() => {
  exporter.reset();
});

afterAll(async () => {
  await provider.shutdown();
});

/** Everything an exporter would serialise, as one string to search. */
function exported(): string {
  return JSON.stringify(
    exporter.getFinishedSpans().map((span: ReadableSpan) => ({
      name: span.name,
      attributes: span.attributes,
      events: span.events,
      status: span.status,
      links: span.links,
    })),
  );
}

function assertClean(serialised: string): void {
  expect(serialised).not.toContain(TOKEN);
  expect(serialised).not.toContain(JWT);
  expect(serialised).not.toContain(EMAIL);
  expect(serialised).not.toContain(DOCUMENT);
  expect(serialised).not.toMatch(/token=(?!REDACTED)/);
  expect(serialised).not.toMatch(/Bearer\s+(?!\[REDACTED\])[A-Za-z0-9]/);
}

describe('RedactingSpanProcessor', () => {
  it('redacts the activation token in url.full as the NestJS instrumentation writes it, at span start', () => {
    const span = tracer.startSpan('Controller.verifyEmail', {
      kind: SpanKind.INTERNAL,
      attributes: {
        'http.request.method': 'GET',
        'url.full': `/api/customers/verify-email?token=${TOKEN}`,
      },
    });
    span.end();

    const [finished] = exporter.getFinishedSpans();

    expect(finished?.attributes['url.full']).toBe('/api/customers/verify-email?token=REDACTED');
    assertClean(exported());
  });

  it('redacts an attribute written AFTER the span started (why it works on end, not on start)', () => {
    const span = tracer.startSpan('GET /api/customers/verify-email', { kind: SpanKind.SERVER });
    span.setAttribute('url.query', `token=${TOKEN}&lang=es`);
    span.setAttribute('http.target', `/api/customers/verify-email?token=${TOKEN}`);
    span.setAttribute('http.url', `http://gateway:3000/api/customers/verify-email?token=${TOKEN}`);
    span.end();

    const [finished] = exporter.getFinishedSpans();

    expect(finished?.attributes['url.query']).toBe('token=REDACTED&lang=es');
    expect(finished?.attributes['http.target']).toBe('/api/customers/verify-email?token=REDACTED');
    expect(finished?.attributes['http.url']).toBe(
      'http://gateway:3000/api/customers/verify-email?token=REDACTED',
    );
    assertClean(exported());
  });

  it('keeps the parameters that are not secret, so the URL stays useful', () => {
    const span = tracer.startSpan('GET /api/accounts');
    span.setAttribute('url.full', '/api/accounts?page=2&limit=20&password=hunter2&sig=abc');
    span.end();

    expect(exporter.getFinishedSpans()[0]?.attributes['url.full']).toBe(
      '/api/accounts?page=2&limit=20&password=REDACTED&sig=REDACTED',
    );
  });

  it('redacts a token whose name is not on the list but looks like a secret', () => {
    const span = tracer.startSpan('GET /x');
    span.setAttribute(
      'url.full',
      `/x?resetToken=${TOKEN}&X-Auth-Token=${TOKEN}&userEmail=${EMAIL}&document=${DOCUMENT}`,
    );
    span.end();

    assertClean(exported());
    expect(exporter.getFinishedSpans()[0]?.attributes['url.full']).toContain('document=REDACTED');
  });

  it('masks a JWT, a bearer credential and an e-mail address inside any string attribute', () => {
    const span = tracer.startSpan('publish');
    span.setAttribute('bank.note', `session ${JWT} for ${EMAIL}`);
    span.setAttribute('http.note', `Authorization failed: Bearer ${TOKEN}`);
    span.setAttribute('bank.list', [`a ${EMAIL}`, 'plain']);
    span.end();

    const [finished] = exporter.getFinishedSpans();

    expect(finished?.attributes['bank.note']).toBe('session [REDACTED:jwt] for [REDACTED:email]');
    expect(finished?.attributes['http.note']).toBe('Authorization failed: Bearer [REDACTED]');
    expect(finished?.attributes['bank.list']).toEqual(['a [REDACTED:email]', 'plain']);
    assertClean(exported());
  });

  it('drops the value of an attribute whose KEY names a secret or a person', () => {
    const span = tracer.startSpan('handler');
    span.setAttribute('http.request.header.authorization', `Bearer ${TOKEN}`);
    span.setAttribute('bank.customer.document', DOCUMENT);
    span.setAttribute('bank.customer.email', EMAIL);
    span.setAttribute('http.response.status_code', 200);
    span.setAttribute('code.function', 'verifyEmail');
    span.end();

    const [finished] = exporter.getFinishedSpans();

    expect(finished?.attributes['http.request.header.authorization']).toBe('REDACTED');
    expect(finished?.attributes['bank.customer.document']).toBe('REDACTED');
    expect(finished?.attributes['bank.customer.email']).toBe('REDACTED');
    expect(finished?.attributes['http.response.status_code']).toBe(200);
    expect(finished?.attributes['code.function']).toBe('verifyEmail');
    assertClean(exported());
  });

  it('masks the text of a recorded exception and of the span status', () => {
    const span = tracer.startSpan('handler');
    const failure = new Error(`duplicate key (email)=(${EMAIL}) token=${TOKEN} jwt ${JWT}`);
    span.recordException(failure);
    span.setStatus({ code: 2, message: failure.message });
    span.end();

    assertClean(exported());
    expect(exporter.getFinishedSpans()[0]?.status.message).toContain('token=REDACTED');
  });

  it('masks the span name and the attributes of events and links', () => {
    const linked = tracer.startSpan('linked').spanContext();
    const span = tracer.startSpan(`GET /a?token=${TOKEN}`, {
      links: [{ context: linked, attributes: { 'link.url': `/b?token=${TOKEN}` } }],
    });
    span.addEvent('retry', { 'event.url': `/c?token=${TOKEN}` });
    span.end();

    assertClean(exported());
  });

  it('leaves a span with nothing sensitive exactly as it was', () => {
    const span = tracer.startSpan('GET /api/accounts', {
      attributes: { 'http.route': '/api/accounts/:accountId', 'bank.correlation_id': 'c-1' },
    });
    span.end();

    const [finished] = exporter.getFinishedSpans();

    expect(finished?.name).toBe('GET /api/accounts');
    expect(finished?.attributes).toMatchObject({
      'http.route': '/api/accounts/:accountId',
      'bank.correlation_id': 'c-1',
    });
  });
});

describe('maskQueryParams', () => {
  it('replaces the value and keeps the name, with the replacement the caller picks', () => {
    expect(maskQueryParams(`/activar?token=${TOKEN}`, '***')).toBe('/activar?token=***');
    expect(maskQueryParams(`/restablecer?token=${TOKEN}&x=1`, '***')).toBe(
      '/restablecer?token=***&x=1',
    );
  });

  it('handles a bare query string, percent-encoded names and several secrets', () => {
    expect(maskQueryParams(`token=${TOKEN}&a=b`)).toBe('token=REDACTED&a=b');
    expect(maskQueryParams(`%74oken=${TOKEN}`)).toBe('%74oken=REDACTED');
    expect(maskQueryParams('a=1&password=x&secret=y')).toBe(
      'a=1&password=REDACTED&secret=REDACTED',
    );
  });

  it('does not touch text that merely mentions the word', () => {
    expect(maskQueryParams('the token expired')).toBe('the token expired');
    expect(maskQueryParams('/api/accounts?page=1&code_version=3')).toBe(
      '/api/accounts?page=1&code_version=3',
    );
  });
});

describe('the HttpInstrumentation redaction list', () => {
  it.each([
    'token',
    'resetToken',
    'activationToken',
    'access_token',
    'password',
    'credential',
    'apiKey',
    'authorization',
    'email',
    'document',
    // The instrumentation's own defaults, which a custom list replaces.
    'sig',
    'X-Amz-Signature',
    'X-Goog-Signature',
  ])('names %s', (name) => {
    expect(SENSITIVE_QUERY_PARAMS).toContain(name);
  });
});

describe('masked exceptions', () => {
  it('masks message and stack but keeps the class name', () => {
    const error = new TypeError(`bad ${JWT}`);

    const masked = maskedException(error);

    expect(masked.name).toBe('TypeError');
    expect(masked.message).toBe('bad [REDACTED:jwt]');
    expect(masked.stack).not.toContain(JWT);
  });

  it('recordFailure writes an ERROR status with a masked message', () => {
    const span = tracer.startSpan('handler');
    recordFailure(span, new Error(`cannot send to ${EMAIL}`));
    recordFailure(span, `Bearer ${TOKEN}`);
    span.end();

    assertClean(exported());
    expect(exporter.getFinishedSpans()[0]?.events[0]?.name).toBe('exception');
  });

  it('redactSpanText chains both maskings', () => {
    expect(redactSpanText(`/x?token=${TOKEN} ${EMAIL}`)).toBe('/x?token=REDACTED [REDACTED:email]');
  });
});

describe('dropManualTraceHeaders', () => {
  const manual = '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01';

  it('removes a hand-set traceparent from the flat array form (undici 6+)', () => {
    const request = {
      headers: ['content-type', 'application/json', 'traceparent', manual, 'X-Api-Key', 'k'],
    };

    dropManualTraceHeaders(request);

    expect(request.headers).toEqual(['content-type', 'application/json', 'X-Api-Key', 'k']);
  });

  it('is case-insensitive and also drops tracestate', () => {
    const request = { headers: ['TraceParent', manual, 'tracestate', 'a=b', 'accept', '*/*'] };

    dropManualTraceHeaders(request);

    expect(request.headers).toEqual(['accept', '*/*']);
  });

  it('removes it from the string form (undici 5)', () => {
    const request = { headers: `accept: */*\r\ntraceparent: ${manual}\r\nx-a: 1\r\n` };

    dropManualTraceHeaders(request);

    expect(request.headers).toBe('accept: */*\r\nx-a: 1\r\n');
  });

  it('leaves a request with no trace headers alone', () => {
    const request = { headers: ['accept', '*/*'] };

    dropManualTraceHeaders(request);

    expect(request.headers).toEqual(['accept', '*/*']);
  });
});
