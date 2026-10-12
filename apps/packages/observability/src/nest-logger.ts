import type { JsonLogger } from './logger';

/**
 * NestJS's own log lines — "Mapped {/api/transfers, POST} route", an unhandled
 * exception — in the same JSON as everything else.
 *
 * Without this, every component writes two formats to one stream: its JSON, and
 * Nest's coloured text. The collection agent would then have to parse both, and
 * the lines that matter most during an incident — the framework's — would be
 * the ones that carry no `traceId`, no `environment` and no `version`.
 *
 * Structural rather than `implements LoggerService`, so this package does not
 * depend on NestJS: anything with these five methods is accepted by
 * `NestFactory.create(..., { logger })` and `app.useLogger(...)`.
 */
export interface NestCompatibleLogger {
  log(message: unknown, ...optionalParams: unknown[]): void;
  error(message: unknown, ...optionalParams: unknown[]): void;
  warn(message: unknown, ...optionalParams: unknown[]): void;
  debug(message: unknown, ...optionalParams: unknown[]): void;
  verbose(message: unknown, ...optionalParams: unknown[]): void;
  fatal(message: unknown, ...optionalParams: unknown[]): void;
}

export function nestLoggerFor<F extends object>(logger: JsonLogger<F>): NestCompatibleLogger {
  // The framework's fields (`context`, `stack`, `detail`) are not in any
  // component's `LogFields`; they are the framework's to name, and
  // `redactFields` still runs over them.
  const untyped = logger as unknown as JsonLogger<Record<string, unknown>>;

  return {
    log: (message, ...params) => untyped.info(...lineFrom(message, params, false)),
    error: (message, ...params) => untyped.error(...lineFrom(message, params, true)),
    warn: (message, ...params) => untyped.warn(...lineFrom(message, params, false)),
    debug: (message, ...params) => untyped.debug(...lineFrom(message, params, false)),
    verbose: (message, ...params) => untyped.debug(...lineFrom(message, params, false)),
    fatal: (message, ...params) => untyped.error(...lineFrom(message, params, true)),
  };
}

/**
 * Nest's calling convention: the message, then optional extras, and the
 * **last** string is the context ("RouterExplorer", "ExceptionsHandler"). For
 * `error`, the extra before the context is the stack. A plain object among the
 * extras is taken as fields.
 */
function lineFrom(
  message: unknown,
  params: readonly unknown[],
  withStack: boolean,
): [string, Record<string, unknown>] {
  const strings = params.filter((param): param is string => typeof param === 'string');
  const context = strings.length > 0 ? strings[strings.length - 1] : undefined;
  const stack = withStack && strings.length > 1 ? strings[0] : undefined;

  // A plain object among the extras is structured fields — how a component
  // passes `{ correlationId }` through Nest's `Logger` without losing it to a
  // string. Merged first, so the framework's own `context` and `stack` win.
  const fields: Record<string, unknown> = Object.assign(
    {},
    ...params.filter(
      (param): param is Record<string, unknown> =>
        typeof param === 'object' &&
        param !== null &&
        !Array.isArray(param) &&
        !(param instanceof Error),
    ),
  ) as Record<string, unknown>;
  if (context !== undefined) {
    fields.context = context;
  }
  if (stack !== undefined) {
    fields.stack = stack;
  }

  if (message instanceof Error) {
    fields.error = message.message;
    fields.stack ??= message.stack;
    return [message.message, fields];
  }

  if (typeof message === 'string') {
    return [message, fields];
  }

  fields.detail = message;
  return ['nest', fields];
}
