/**
 * Structured logs, with the correlation id on every line that has one.
 *
 * One line of JSON per event, because the alternative — a sentence — is
 * ungreppable across five services. The correlation id is the field that makes
 * a distributed flow readable at all: it is what ties this service's "customer
 * registered" to the Gateway's "202 accepted" twenty milliseconds earlier.
 *
 * **Nothing sensitive is ever passed in.** Credentials, activation tokens and
 * document bytes do not appear in any call site, which is a discipline rather
 * than a mechanism — `redact` exists so the discipline has one obvious place to
 * be enforced when a field name gets close.
 */
export interface LogFields {
  readonly correlationId?: string;
  readonly messageType?: string;
  readonly customerId?: string;
  readonly outcome?: string;
  /** A lifecycle step (T-41): created, verified or rejected. */
  readonly transition?: string;
  /** How a KYC decision was reached: counter or review. */
  readonly path?: string;
  /** The span a log line belongs to, so a trace and its logs can be joined (T-41). */
  readonly traceId?: string;
  readonly spanId?: string;
  readonly reason?: string;
  readonly durationMs?: number;
  readonly error?: string;
}

const FORBIDDEN = /credential|password|token|secret/i;

export class StructuredLogger {
  readonly #service: string;
  readonly #sink: (line: string) => void;

  constructor(service = 'customer-service', sink: (line: string) => void = console.log) {
    this.#service = service;
    this.#sink = sink;
  }

  public info(message: string, fields: LogFields = {}): void {
    this.#write('info', message, fields);
  }

  public warn(message: string, fields: LogFields = {}): void {
    this.#write('warn', message, fields);
  }

  public error(message: string, fields: LogFields = {}): void {
    this.#write('error', message, fields);
  }

  #write(level: string, message: string, fields: LogFields): void {
    this.#sink(
      JSON.stringify({
        level,
        service: this.#service,
        message,
        timestamp: new Date().toISOString(),
        ...redact(fields),
      }),
    );
  }
}

/**
 * Drops any field whose **name** suggests a secret.
 *
 * Deliberately blunt. A log line that loses a field is a nuisance; a log line
 * that carries an activation token is a working link in a file somebody ships
 * to a log aggregator.
 */
export function redact(fields: LogFields): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(fields).filter(([key, value]) => value !== undefined && !FORBIDDEN.test(key)),
  );
}
