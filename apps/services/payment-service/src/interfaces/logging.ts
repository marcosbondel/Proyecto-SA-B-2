/**
 * Structured logs, with the correlation id on every line that has one.
 *
 * One line of JSON per event, because the alternative — a sentence — is
 * ungreppable across five services. For this service in particular the
 * correlation id is not a nicety: a transfer is nine messages across four
 * services, and `correlationId` is the only field that turns those nine lines
 * into one story. The ticket asks for exactly that as evidence.
 *
 * `transactionId` is logged beside it because the two answer different
 * questions — the correlation names the flow, the transaction names the thing
 * the flow was about, and a retry gives one flow a second identifier.
 *
 * **Nothing sensitive is ever passed in.** This service handles no credential
 * and no token; `redact` exists so that discipline has one obvious place to be
 * enforced when a field name gets close.
 */
export interface LogFields {
  readonly correlationId?: string;
  readonly messageType?: string;
  readonly transactionId?: string;
  readonly paymentId?: string;
  readonly status?: string;
  readonly outcome?: string;
  readonly reason?: string;
  readonly durationMs?: number;
  readonly error?: string;
}

const FORBIDDEN = /credential|password|token|secret/i;

export class StructuredLogger {
  readonly #service: string;
  readonly #sink: (line: string) => void;

  constructor(service = 'payment-service', sink: (line: string) => void = console.log) {
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
 * that carries a secret is a working key in a file somebody ships to a log
 * aggregator.
 */
export function redact(fields: LogFields): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(fields).filter(([key, value]) => value !== undefined && !FORBIDDEN.test(key)),
  );
}
