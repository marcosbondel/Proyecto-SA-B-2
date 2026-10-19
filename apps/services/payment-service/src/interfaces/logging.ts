import { JsonLogger, redactFields } from '@bank/observability';
import type { LogSink } from '@bank/observability';

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
  readonly depositId?: string;
  readonly status?: string;
  readonly outcome?: string;
  readonly reason?: string;
  readonly durationMs?: number;
  readonly error?: string;
  /** The sweep step that failed (T-60); the rest of the pass carries on. */
  readonly step?: string;
  /** The attempt number, and what the simulated provider answered on it (T-44). */
  readonly attempt?: number;
  readonly providerResult?: string;
  readonly errorType?: string;
  /** Always `true` for a provider failure: there is no real provider in this system. */
  readonly simulated?: boolean;
  /**
   * `scenario` when the transfer scripted the answer, `configuration` when the
   * ConfigMap's rates did, `runtime` when an administrator's override did (T-60).
   */
  readonly source?: string;
  readonly latencyMs?: number;
  readonly failureRatePercent?: number;
  readonly timeoutRatePercent?: number;
  readonly traceId?: string;
  readonly spanId?: string;
}

/**
 * The line itself — the fields the assignment requires, their order, the trace
 * ids from the active span, and the redaction of secrets and personal data — is
 * `@bank/observability`'s `JsonLogger`, the one format all seven components
 * write since T-48. What stays in this file is the list above: what this
 * service is allowed to say.
 */
export class StructuredLogger extends JsonLogger<LogFields> {
  constructor(service = 'payment-service', sink?: LogSink) {
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
