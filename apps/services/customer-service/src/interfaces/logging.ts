import { JsonLogger, redactFields } from '@bank/observability';
import type { LogSink } from '@bank/observability';

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

/**
 * The line itself — the fields the assignment requires, their order, the trace
 * ids from the active span, and the redaction of secrets and personal data — is
 * `@bank/observability`'s `JsonLogger`, the one format all seven components
 * write since T-48. What stays in this file is the list above: what this
 * service is allowed to say.
 */
export class StructuredLogger extends JsonLogger<LogFields> {
  constructor(service = 'customer-service', sink?: LogSink) {
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
