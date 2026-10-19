import { JsonLogger, redactFields } from '@bank/observability';
import type { LogSink } from '@bank/observability';

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
  /** The W3C trace id, when an SDK records one (T-45). */
  readonly traceId?: string;
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
   * password-reset one — written only by the simulated delivery channel, with
   * the token masked (`token=***`) unless `REVEAL_ACTIVATION_LINKS` is on, which
   * is for a developer's machine (TD-043, T-60).
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

/**
 * The line itself — the fields the assignment requires, their order, the trace
 * ids from the active span, and the redaction of secrets and personal data — is
 * `@bank/observability`'s `JsonLogger`, the one format all seven components
 * write since T-48. What stays in this file is the list above: what this
 * service is allowed to say.
 */
export class StructuredLogger extends JsonLogger<LogFields> {
  constructor(service = 'notification-audit-service', sink?: LogSink) {
    super({ service, ...(sink === undefined ? {} : { sink }) });
  }
}

/**
 * The shared redaction, under the name this service's tests already use: drops
 * any field whose **name** suggests a secret or a person, and masks a JWT or an
 * email address wherever one appears in a value.
 */
export function redact(fields: LogFields): Record<string, unknown> {
  return redactFields(fields as Readonly<Record<string, unknown>>);
}
