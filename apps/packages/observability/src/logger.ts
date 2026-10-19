import { isSpanContextValid, trace } from '@opentelemetry/api';

import { identityFrom } from './identity';

/**
 * The one log format every component writes (Fase 3, §4.1 "Logging estructurado").
 *
 * One line of JSON per event, on stdout. Nothing here ships a line anywhere:
 * the collection agent of T-49 reads the pods' stdout and forwards it to Loki,
 * which is what the assignment means by "los servicios no envían sus logs a este
 * microservicio por el broker". A logger that pushed over the network would make
 * every service slower whenever the log store is, and silent whenever it is down.
 *
 * Every line carries the fields the assignment lists, in a fixed order so a
 * human reading raw output finds them in the same place every time:
 *
 * | Field | Source |
 * | --- | --- |
 * | `timestamp` | the clock, ISO 8601 UTC |
 * | `level` | `debug`, `info`, `warn` or `error` |
 * | `serviceName` | the constructor |
 * | `environment` | `DEPLOYMENT_ENVIRONMENT` — `dev` / `prod`, the Fase 2 namespaces |
 * | `version` | `SERVICE_VERSION` — the tag of the deployed image |
 * | `correlationId` | the caller's fields: the business flow (Fase 1) |
 * | `traceId`, `spanId` | the caller's fields, else the active span: the technical trace |
 *
 * A field the caller did not provide is **absent**, never `null`: a `traceId`
 * of nothing would read as a trace somebody could look up.
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/** Where a finished line goes. `console.log` in production, an array in a test. */
export type LogSink = (line: string) => void;

export interface LoggerOptions {
  readonly service: string;
  readonly sink?: LogSink;
  /** Overrides `DEPLOYMENT_ENVIRONMENT`; tests use it to stay independent of the shell. */
  readonly environment?: string;
  /** Overrides `SERVICE_VERSION`. */
  readonly version?: string;
  /** Lowest level written. Overrides `LOG_LEVEL`; `info` when neither is set. */
  readonly level?: LogLevel;
}

const LEVEL_ORDER: Readonly<Record<LogLevel, number>> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

/**
 * A structured logger whose fields are typed by the component that owns it.
 *
 * `F` is the component's own `LogFields` interface — the list of things it is
 * allowed to say. The type is the first guard against logging something
 * private; `redactFields` below is the second, for when a wider object is
 * spread in and the type is not looking.
 */
export class JsonLogger<F extends object = Record<string, unknown>> {
  readonly #service: string;
  readonly #sink: LogSink;
  readonly #environment: string;
  readonly #version: string;
  readonly #threshold: number;

  constructor(options: LoggerOptions) {
    const identity = identityFrom(process.env);

    this.#service = options.service;
    this.#sink = options.sink ?? ((line: string): void => console.log(line));
    this.#environment = options.environment ?? identity.environment;
    this.#version = options.version ?? identity.version;
    this.#threshold = LEVEL_ORDER[options.level ?? levelFrom(process.env.LOG_LEVEL)];
  }

  public get serviceName(): string {
    return this.#service;
  }

  public debug(message: string, fields?: F): void {
    this.#write('debug', message, fields);
  }

  public info(message: string, fields?: F): void {
    this.#write('info', message, fields);
  }

  public warn(message: string, fields?: F): void {
    this.#write('warn', message, fields);
  }

  public error(message: string, fields?: F): void {
    this.#write('error', message, fields);
  }

  #write(level: LogLevel, message: string, fields: F | undefined): void {
    if (LEVEL_ORDER[level] < this.#threshold) {
      return;
    }

    const rest = redactFields((fields ?? {}) as Record<string, unknown>);
    const { correlationId, traceId, spanId, ...detail } = rest;
    const active = activeSpanIds();

    this.#sink(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        level,
        serviceName: this.#service,
        environment: this.#environment,
        version: this.#version,
        message: maskText(message),
        ...(correlationId === undefined ? {} : { correlationId }),
        ...pick('traceId', traceId ?? active?.traceId),
        ...pick('spanId', spanId ?? active?.spanId),
        ...detail,
      }),
    );
  }
}

function pick(key: string, value: unknown): Record<string, unknown> {
  return value === undefined || value === null ? {} : { [key]: value };
}

function levelFrom(raw: string | undefined): LogLevel {
  const candidate = raw?.trim().toLowerCase();

  return candidate === 'debug' || candidate === 'warn' || candidate === 'error'
    ? candidate
    : 'info';
}

/** The ids of the span this code is running inside, or `undefined` with no SDK. */
function activeSpanIds(): { traceId: string; spanId: string } | undefined {
  const context = trace.getActiveSpan()?.spanContext();

  return context !== undefined && isSpanContextValid(context)
    ? { traceId: context.traceId, spanId: context.spanId }
    : undefined;
}

/**
 * Field **names** that are dropped outright, whatever their value.
 *
 * Two families, one rule. Secrets — a credential in a log is a working key in a
 * file somebody ships to an aggregator. And the personal data the assignment
 * names (§4.1): the document number, the email, the document photo — the
 * customer's, which must not be in the one place every operator can read.
 *
 * Deliberately blunt and name-based. A line that loses a field is a nuisance; a
 * line that carries a customer's DPI is a disclosure. `deliveryLink` does not
 * match on purpose: the audit service masks the token in it unless a developer
 * asked to see it, a decision made once in its adapter, not an exception taught
 * to this filter.
 */
const DROPPED_FIELD =
  /credential|password|passwd|secret|token|authorization|cookie|jwt|api[-_]?key|e-?mail|correo|document|dpi|photo|foto|selfie|recipient|phone|telefono|address|direccion/i;

/**
 * Values masked wherever they appear — in a field that was allowed through, in
 * an error message, in the message itself. A JWT and an email address are
 * recognisable by shape, so a `reason` that happens to quote one does not leak
 * it. A sentence that merely *mentions* a token survives: masking by content is
 * for things that look like the secret, not for the word.
 */
const MASKS: readonly (readonly [RegExp, string])[] = [
  [/\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]*/g, '[REDACTED:jwt]'],
  [/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, 'Bearer [REDACTED]'],
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[REDACTED:email]'],
];

/** Replaces every recognisable secret or address inside a string. */
export function maskText(text: string): string {
  return MASKS.reduce(
    (masked, [pattern, replacement]) => masked.replace(pattern, replacement),
    text,
  );
}

const MAX_DEPTH = 5;

/**
 * Removes what must not be logged and masks what slipped into a value.
 *
 * Fields that are `undefined` are omitted rather than written: absent and
 * unknown are different things, and `JSON.stringify` would drop them anyway —
 * dropping them here keeps the behaviour explicit.
 */
export function redactFields(fields: Readonly<Record<string, unknown>>): Record<string, unknown> {
  return redactObject(fields, 0);
}

function redactObject(
  fields: Readonly<Record<string, unknown>>,
  depth: number,
): Record<string, unknown> {
  const output: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined || DROPPED_FIELD.test(key)) {
      continue;
    }

    output[key] = redactValue(value, depth + 1);
  }

  return output;
}

function redactValue(value: unknown, depth: number): unknown {
  if (typeof value === 'string') {
    return maskText(value);
  }

  if (value instanceof Error) {
    return { name: value.name, message: maskText(value.message) };
  }

  if (depth > MAX_DEPTH || value === null || typeof value !== 'object') {
    return depth > MAX_DEPTH && typeof value === 'object' && value !== null ? '[truncated]' : value;
  }

  if (Array.isArray(value)) {
    return value.map((item: unknown) => redactValue(item, depth + 1));
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  return redactObject(value as Record<string, unknown>, depth);
}
