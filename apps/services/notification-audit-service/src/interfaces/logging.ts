/**
 * Structured logs — and for this service, the base of the distributed logging
 * the assignment asks for (§4.1, notas SRE).
 *
 * One line of JSON per message handled, carrying what the ticket names:
 * `eventId`, `messageType`, the producer, the consumer, `correlationId`,
 * `causationId`, the result, the attempt and a timestamp. Together those turn
 * nine lines across four services into one story, which is the entire reason
 * `correlationId` exists.
 *
 * **This is not a central logger and must never become one.** Every service
 * keeps its own operational logs; what makes this one the observability base is
 * that it consumes the *events* — asynchronously, on its own queues, where its
 * being slow or absent costs the business nothing. A service that logged
 * through here would be a service that stops when this one does.
 *
 * Nothing sensitive is ever passed in. `redact` exists so that discipline has
 * one obvious place to be enforced when a field name gets close — and it is the
 * cheap counterpart to `domain/redaction.ts`, which does the same job for the
 * payloads that reach the database.
 */
export interface LogFields {
  readonly correlationId?: string;
  readonly causationId?: string | null;
  readonly eventId?: string;
  readonly messageType?: string;
  readonly producer?: string;
  readonly consumer?: string;
  readonly notificationId?: string;
  readonly notificationType?: string;
  readonly outcome?: string;
  readonly reason?: string;
  readonly attempt?: number;
  /**
   * The path an email would link to — the activation link, or the
   * password-reset one — written only by the simulated delivery channel and
   * only outside production (TD-043).
   *
   * Named for what it is rather than for the first flow that needed it: two
   * messages in the catalogue carry a token now, and a reset link logged under
   * `activationLink` would send a developer looking for the wrong screen.
   *
   * `redact` below drops anything whose *name* suggests a secret, and this one
   * deliberately does not match — the gate is the adapter's `revealLinks`
   * flag, decided once in `main.ts` from `NODE_ENV`, rather than a name this
   * filter would have to be taught to make an exception for.
   */
  readonly deliveryLink?: string;
  readonly durationMs?: number;
  readonly error?: string;
}

const FORBIDDEN = /credential|password|token|secret|email|document|recipient/i;

export class StructuredLogger {
  readonly #service: string;
  readonly #sink: (line: string) => void;

  constructor(service = 'notification-audit-service', sink: (line: string) => void = console.log) {
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
 * Drops any field whose **name** suggests a secret or a person.
 *
 * Deliberately blunt, and blunter here than in the other services: this one
 * handles every event in the system, so it is the process most likely to have
 * something private in reach. A log line that loses a field is a nuisance; a
 * log line that carries a customer's address is a disclosure in a file somebody
 * ships to an aggregator.
 */
export function redact(fields: LogFields): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(fields).filter(([key, value]) => value !== undefined && !FORBIDDEN.test(key)),
  );
}
