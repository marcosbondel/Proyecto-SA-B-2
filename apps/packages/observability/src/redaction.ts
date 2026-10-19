import { SpanStatusCode } from '@opentelemetry/api';
import type { AttributeValue, Context, Span as ApiSpan } from '@opentelemetry/api';
import type { ReadableSpan, Span, SpanProcessor } from '@opentelemetry/sdk-trace-base';

import { maskText } from './logger';

/**
 * What a trace may not carry (Fase 3, §8.3 "Datos sensibles expuestos").
 *
 * A span attribute is a log line that lives in Tempo for days and is readable
 * by everyone who can open Grafana. The activation link of a customer is
 * `GET /api/customers/verify-email?token=…`: the instrumentations record the
 * URL they were handed, so without this the token was one search away.
 *
 * Three layers, because no single one covers every writer of an attribute:
 *
 * 1. `SENSITIVE_QUERY_PARAMS` configures `HttpInstrumentation`, which builds
 *    `url.query` and `url.full` itself and knows how to redact a *named*
 *    parameter, nothing else.
 * 2. `RedactingSpanProcessor` rewrites **every** span just before it is handed
 *    to an exporter, whoever wrote the attribute: the NestJS instrumentation
 *    writes `url.full = req.originalUrl` verbatim, undici writes it for
 *    outbound `fetch`, and our own code attaches exception events whose
 *    message quotes whatever the failing library quoted.
 * 3. The Collector of the observability chart repeats the rule on the way out,
 *    so a component that forgot to start the SDK this way is still covered.
 */

/** What replaces a redacted query value; the one the HTTP instrumentation uses. */
export const REDACTED = 'REDACTED';

/**
 * Query parameter **names** whose value never reaches a trace, exactly as the
 * HTTP instrumentation wants them (it compares names verbatim, case included).
 * The tail is the instrumentation's own default list, which a custom list
 * replaces rather than extends.
 */
export const SENSITIVE_QUERY_PARAMS: readonly string[] = [
  'token',
  'resetToken',
  'activationToken',
  'access_token',
  'accessToken',
  'refresh_token',
  'refreshToken',
  'id_token',
  'idToken',
  'password',
  'credential',
  'currentCredential',
  'newCredential',
  'secret',
  'client_secret',
  'apiKey',
  'api_key',
  'api-key',
  'key',
  'code',
  'authorization',
  'jwt',
  'email',
  'correo',
  'document',
  'documentNumber',
  'dpi',
  'sig',
  'Signature',
  'AWSAccessKeyId',
  'X-Goog-Signature',
  'X-Amz-Signature',
  'X-Amz-Credential',
  'X-Amz-Security-Token',
];

/**
 * The same rule by **shape**, for places that hold a query string as text and
 * for names no list anticipated (`resetToken`, `X-Auth-Token`, `userEmail`).
 */
const SENSITIVE_PARAM_NAME =
  /token|password|passwd|secret|credential|authorization|api[-_]?key|jwt|e-?mail|correo|document|dpi|photo|selfie|^code$|^key$|^otp$|^sig(nature)?$/i;

/**
 * Attribute **keys** whose value is dropped whatever it holds. The set is the
 * logger's deny-list minus the words that are also ordinary span vocabulary
 * (`code.function`, `http.response.status_code`, `messaging.message.key`).
 */
const SENSITIVE_ATTRIBUTE_KEY =
  /token|password|passwd|secret|credential|authorization|api[-_]?key|jwt|cookie|e-?mail|correo|document|dpi|photo|selfie/i;

/**
 * `name=value` pairs, wherever they sit in a string: after a `?`, an `&`, a
 * `;`, whitespace, or at the very start (`url.query` has no leading `?`).
 */
const QUERY_PAIR = /([?&;\s]|^)([^=&#?;\s"']+)=([^&#\s"']*)/g;

/**
 * Replaces the **value** of every sensitive query parameter in `text`, leaving
 * the name so the line stays readable: `/activar?token=abc` becomes
 * `/activar?token=***`.
 *
 * The audience is a human reading a log or a trace; a hash or a prefix of the
 * token would still be a way to correlate it, so nothing of the value stays.
 */
export function maskQueryParams(text: string, replacement: string = REDACTED): string {
  return text.replace(QUERY_PAIR, (match, lead: string, name: string) =>
    SENSITIVE_PARAM_NAME.test(safeDecode(name)) ? `${lead}${name}=${replacement}` : match,
  );
}

/** Everything a span string must go through: sensitive parameters, then secret shapes. */
export function redactSpanText(text: string): string {
  return maskText(maskQueryParams(text));
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * The shape `Span.recordException` accepts, with its text masked.
 *
 * The SDK copies `error.message` and `error.stack` into the event as they are,
 * and a driver's message often quotes the offending value (a duplicate email, a
 * malformed token). Both fields go through `maskText`; the `name` is a class
 * name and stays.
 */
export function maskedException(error: Error): { name: string; message: string; stack?: string } {
  return {
    name: error.name,
    message: redactSpanText(error.message),
    ...(error.stack === undefined ? {} : { stack: redactSpanText(error.stack) }),
  };
}

/** `recordException` plus an ERROR status, both with masked text. */
export function recordFailure(span: ApiSpan, error: unknown): void {
  if (error instanceof Error) {
    span.recordException(maskedException(error));
    span.setStatus({ code: SpanStatusCode.ERROR, message: redactSpanText(error.message) });
    return;
  }

  span.setStatus({
    code: SpanStatusCode.ERROR,
    ...(error === undefined ? {} : { message: redactSpanText(String(error)) }),
  });
}

type MutableAttributes = Record<string, AttributeValue | undefined>;

interface MutableSpan {
  name: string;
  attributes: MutableAttributes;
  events: { attributes?: MutableAttributes }[];
  links: { attributes?: MutableAttributes }[];
  status: { code: number; message?: string };
}

/**
 * Rewrites a span's text just before it is exported.
 *
 * **Why `onEnd` and not `onStart`.** The instrumentations set most of what is
 * dangerous at creation, but not all of it: an exception event is added when
 * the request fails, the HTTP instrumentation sets `url.query` after the
 * response, and application code may `setAttribute` at any point of the span's
 * life. `onStart` would miss everything written afterwards; `onEnd` sees the
 * span as the exporter will. The attributes of a `ReadableSpan` are typed
 * read-only but are the same object the exporter reads (`BatchSpanProcessor`
 * holds the span itself and serialises it later), so editing them in place
 * *before* the exporting processor runs is what makes the export clean.
 *
 * **Register it first.** Processors run in the order they were given; this one
 * has to precede every exporter, which is what `startTelemetry` does.
 */
export class RedactingSpanProcessor implements SpanProcessor {
  public onStart(_span: Span, _parentContext: Context): void {
    // Deliberately empty: see the class comment. Present because the
    // interface requires it.
  }

  public onEnd(span: ReadableSpan): void {
    redactSpan(span as unknown as MutableSpan);
  }

  public forceFlush(): Promise<void> {
    return Promise.resolve();
  }

  public shutdown(): Promise<void> {
    return Promise.resolve();
  }
}

/** Exposed for tests that build a span by hand; production goes through the processor. */
export function redactSpan(span: MutableSpan): void {
  span.name = redactSpanText(span.name);
  redactAttributes(span.attributes);

  for (const event of span.events) {
    redactAttributes(event.attributes);
  }

  for (const link of span.links) {
    redactAttributes(link.attributes);
  }

  if (typeof span.status.message === 'string') {
    span.status.message = redactSpanText(span.status.message);
  }
}

function redactAttributes(attributes: MutableAttributes | undefined): void {
  if (attributes === undefined) {
    return;
  }

  for (const key of Object.keys(attributes)) {
    const value = attributes[key];

    if (SENSITIVE_ATTRIBUTE_KEY.test(key)) {
      attributes[key] = REDACTED;
    } else if (typeof value === 'string') {
      attributes[key] = redactSpanText(value);
    } else if (Array.isArray(value)) {
      attributes[key] = (value as readonly unknown[]).map((item) =>
        typeof item === 'string' ? redactSpanText(item) : item,
      ) as AttributeValue;
    }
  }
}
