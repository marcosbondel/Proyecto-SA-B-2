/**
 * How severe an event is, and the rule that decides it.
 *
 * §4.1 asks for exactly this — "clasificar eventos: INFO, WARNING, ERROR" — and
 * defines nothing beyond the three names. Everything below is this ticket's own
 * decision, made once so every reader of the trail sees the same answer.
 *
 * The question the axis answers is **"does somebody who operates the bank need
 * to look at this?"**, not "did something go wrong for the customer" — those
 * are different questions with different answers for the same event. A
 * transfer refused for insufficient funds is a bad afternoon for one customer
 * and nothing an operator needs to see (`WARNING`); a transfer that had to be
 * unwound after the money already moved is exactly what an operator watches
 * for (`ERROR`), even though from the customer's side "my money came back" is
 * the *good* outcome of that flow.
 */
export type EventSeverity = 'INFO' | 'WARNING' | 'ERROR';

/**
 * What this function may look at, and nothing else.
 *
 * Deliberately **not** the payload. The payload is stored redacted
 * (`redaction.ts`), so a severity derived from it would not be re-derivable
 * from the row this service actually wrote — and a classification nobody can
 * recompute from the evidence is worthless in an audit trail. `messageType`
 * and `processingStatus` are exactly what a reader of `audit_events` already
 * has in front of them.
 */
export interface Classifiable {
  readonly messageType: string;
  readonly processingStatus: 'PROCESSED' | 'INVALID' | 'ERROR';
  /**
   * `true` when this record came from the `bank.errors` drain in `main.ts`
   * rather than from one of the four family queues. Carried as a boolean
   * rather than the drain's consumer name, so this module never has to know
   * `ERROR_DRAIN_CONSUMER`.
   */
  readonly parked?: boolean;
  /**
   * Read for one message type only: the SLO alert (T-45), whose severity *is*
   * what it says. Every other classification stays a function of the name and
   * the status, as above. The alert's own fields (`status`, `severity`) are not
   * among those redaction removes, so the stored row still holds what this was
   * derived from.
   */
  readonly payload?: unknown;
}

/**
 * The severity of every event this service can meaningfully hear from, over
 * the four families the audit queues bind to (`customer.#`, `account.#`,
 * `transaction.#`, `payment.#` — no other event reaches `audit_events`).
 *
 * **INFO** — the system did what it was asked. Includes `account.deactivated`:
 * the nightly sweep does exactly what it is supposed to, and putting a
 * scheduled job's own success in `WARNING` would turn the severity filter into
 * nightly noise nobody reads.
 *
 * **WARNING** — an expected refusal, and nothing to undo. Every `*.rejected`
 * contract, `payment.attempt.failed` (one rung of the ladder, not its end —
 * the Saga is still climbing) and `transaction.failed` (the money never left).
 *
 * **ERROR** — something that had already happened had to be undone, or the
 * flow ended badly and terminally: `transaction.compensated`,
 * `account.debit.compensated`, `payment.failed` (the ladder's terminal
 * refusal, which is what closes the Saga with a compensation).
 *
 * A test cross-checks this table against `@bank/contracts`' own catalogue of
 * `category: 'event'` contracts and fails if one is missing — the fallback
 * below is a production safety net, not permission to leave a contract
 * unclassified.
 */
const CATALOGUE: Readonly<Record<string, EventSeverity>> = {
  // customer.*
  'customer.registered.v1': 'INFO',
  'customer.register.rejected.v1': 'WARNING',
  'customer.login.succeeded.v1': 'INFO',
  'customer.login.rejected.v1': 'WARNING',
  'customer.activation.requested.v1': 'INFO',
  'customer.email.verified.v1': 'INFO',
  'customer.email.verification.rejected.v1': 'WARNING',
  'customer.password-reset.issued.v1': 'INFO',
  'customer.password-reset.completed.v1': 'INFO',
  'customer.password-reset.rejected.v1': 'WARNING',
  'customer.password-changed.v1': 'WARNING',
  'customer.password-change.rejected.v1': 'WARNING',
  'customer.updated.v1': 'WARNING',
  'customer.identity.validated.v1': 'INFO',
  'customer.identity.rejected.v1': 'WARNING',
  'customer.kyc.verified.v1': 'INFO',
  'customer.kyc.rejected.v1': 'WARNING',
  /*
   * Added by T-31. A fixed severity rather than one that reads `allowed`:
   * `classify()` never looks at the payload (the payload is redacted before
   * this ever runs), and a customer's own refusal is already recorded at
   * `WARNING` by `transaction.failed.v1` with `reason: 'KYC_NOT_VERIFIED'` —
   * this event is the gate answering a question, not the refusal itself.
   */
  'customer.kyc.checked.v1': 'INFO',

  // account.*
  'account.opened.v1': 'INFO',
  'account.open.rejected.v1': 'WARNING',
  'account.deactivated.v1': 'WARNING',
  'account.reactivated.v1': 'WARNING',
  /**
   * T-42. A pattern worth a person's attention, not a failure: the account did
   * what it was asked and the system noticed how often. The assignment names
   * this one `WARNING` (§4.1, Account Service).
   */
  'account.anomaly.detected.v1': 'WARNING',
  'account.deposited.v1': 'INFO',
  'account.deposit.rejected.v1': 'WARNING',
  'account.debited.v1': 'INFO',
  'account.debit.rejected.v1': 'WARNING',
  'account.credited.v1': 'INFO',
  'account.interbank.credited.v1': 'INFO',
  'account.interbank.credit.rejected.v1': 'WARNING',
  'account.credit.rejected.v1': 'WARNING',
  'account.debit.compensated.v1': 'ERROR',
  'account.commission.charged.v1': 'INFO',

  // transaction.*
  'transaction.initiated.v1': 'INFO',
  'transaction.completed.v1': 'INFO',
  'transaction.failed.v1': 'WARNING',
  'transaction.compensated.v1': 'ERROR',

  // payment.*
  'payment.attempt.failed.v1': 'WARNING',
  'payment.succeeded.v1': 'INFO',
  'payment.interbank.accepted.v1': 'INFO',
  'payment.interbank.rejected.v1': 'WARNING',
  'payment.failed.v1': 'ERROR',
};

/**
 * The words a message's own name is written in, for a contract the catalogue
 * above does not (yet) list.
 *
 * The catalogue is meant to be exhaustive over today's 37 event contracts —
 * this exists only so a future contract added without updating this file
 * degrades to a reasonable guess instead of an unhandled case, on the same
 * principle as `messageTypeLabel` in the web's `lib/audit.ts`.
 */
function classifyBySuffix(messageType: string): EventSeverity {
  if (/(rejected|failed)$/.test(messageType.replace(/\.v\d+$/, ''))) {
    return 'WARNING';
  }

  if (/(compensated)$/.test(messageType.replace(/\.v\d+$/, ''))) {
    return 'ERROR';
  }

  return 'INFO';
}

/**
 * The one classification any processed message receives.
 *
 * Order matters and is the whole rule:
 *
 * 1. `processingStatus === 'ERROR'` — this service itself failed to record the
 *    message. Worth an operator's attention regardless of what the message
 *    would otherwise have meant.
 * 2. `parked` — the message arrived through the `bank.errors` drain, which by
 *    construction means the system could not process it at all: its retry
 *    ladder was exhausted, or it could not even be parsed. Worse than an
 *    ordinary business refusal, and independent of the message's own name.
 * 3. `processingStatus === 'INVALID'` — the message arrived but this consumer
 *    could not read it. A message whose meaning could not be verified is not
 *    classified by that meaning.
 * 4. Otherwise, the catalogue above, or the suffix fallback for whatever it
 *    does not list.
 */
export function classify(event: Classifiable): EventSeverity {
  if (event.processingStatus === 'ERROR') {
    return 'ERROR';
  }

  if (event.parked === true) {
    return 'ERROR';
  }

  if (event.processingStatus === 'INVALID') {
    return 'WARNING';
  }

  if (event.messageType === SLO_ALERT) {
    return classifyAlerts(event.payload);
  }

  return CATALOGUE[event.messageType] ?? classifyBySuffix(event.messageType);
}

/**
 * Not in the catalogue above, on purpose: that table is exactly the *event*
 * contracts (a test holds it to that), and the alert is a command the Gateway
 * publishes. Its severity is not a property of its name at all.
 */
const SLO_ALERT = 'alert.slo.received.v1';

/**
 * What an SLO webhook is worth to whoever operates the bank (T-45).
 *
 * The question is the one the axis always asks — does somebody need to look at
 * this? — and the answer lives in the alert itself:
 *
 * - **ERROR** — at least one alert is firing and critical: an objective is
 *   being broken or its error budget is burning fast enough to break it.
 * - **WARNING** — something is firing at `warning`, and nothing critical.
 * - **INFO** — nothing is firing above `info`: everything in the batch has
 *   resolved, or what fires is informational. Recovery is not noise (it closes
 *   the story the firing alert opened) but it needs nobody.
 *
 * A batch holds alerts of mixed severity, and the most serious one decides.
 * A payload that is not an alert list at all falls back to `WARNING`: a
 * message that arrived and could not be read is worth a look.
 */
export function classifyAlerts(payload: unknown): EventSeverity {
  return worstOf(alertSummaries(payload));
}

/**
 * The state and severity of each alert in a webhook payload, **only the ones that
 * say something this service knows how to count**: a state outside
 * `firing`/`resolved` or a severity outside `critical`/`warning`/`info` is
 * skipped, because the values end up as metric labels and a label that came off
 * the wire is a label anybody can mint.
 */
export function alertSummaries(
  payload: unknown,
): readonly {
  readonly status: 'firing' | 'resolved';
  readonly severity: 'critical' | 'warning' | 'info';
}[] {
  const alerts =
    typeof payload === 'object' && payload !== null
      ? (payload as { alerts?: unknown }).alerts
      : undefined;

  if (!Array.isArray(alerts)) {
    return [];
  }

  return (alerts as readonly { status?: unknown; severity?: unknown }[]).flatMap((alert) =>
    (alert?.status === 'firing' || alert?.status === 'resolved') &&
    (alert.severity === 'critical' || alert.severity === 'warning' || alert.severity === 'info')
      ? [{ status: alert.status, severity: alert.severity }]
      : [],
  );
}

function worstOf(
  alerts: readonly { readonly status: string; readonly severity: string }[],
): EventSeverity {
  if (alerts.length === 0) {
    return 'WARNING';
  }

  let worst: EventSeverity = 'INFO';

  for (const alert of alerts) {
    if (alert.status !== 'firing') {
      continue;
    }

    if (alert.severity === 'critical') {
      return 'ERROR';
    }

    if (alert.severity === 'warning') {
      worst = 'WARNING';
    }
  }

  return worst;
}

/** The catalogue above, for the tests that cross-check it and for documentation. */
export function severityCatalogue(): ReadonlyMap<string, EventSeverity> {
  return new Map(Object.entries(CATALOGUE));
}
