/**
 * What the bank tells somebody, and which events are worth telling them about.
 *
 * The policy is a pure function of the message, so "does a compensated transfer
 * notify the customer" is a question anyone can answer by reading one table
 * instead of tracing a consumer. It is also the only place that decides it: a
 * second `if` in a handler is how one event ends up notifying twice.
 */

import { classify, classifyAlerts, type EventSeverity } from './classification';

export type NotificationStatus = 'PENDING' | 'SENT' | 'FAILED';

export interface Notification {
  readonly notificationId: string;
  /** Named after the event that caused it. No version suffix; nothing routes on it. */
  readonly type: string;
  readonly channel: 'EMAIL';
  /** Simulated. No mail leaves this system (§4.1). */
  readonly recipient: string | null;
  /** The transaction, account or customer this is about. */
  readonly referenceId: string | null;
  readonly subject: string;
  readonly status: NotificationStatus;
  readonly correlationId: string;
  readonly createdAt: Date;
  readonly processedAt: Date | null;
  /**
   * Whose inbox this belongs in — the subject, not the address.
   *
   * The same value `recipient` is derived from, kept rather than discarded.
   * Without it a notification is a row nobody can claim, which is what made the
   * prototype's `N-01` impossible (TD-041). `null` when nobody originated the
   * work: the nightly deactivation job has no customer in its envelope.
   */
  readonly customerId: string | null;
  /** When the recipient read it, or `null` while it is still unread. */
  readonly readAt: Date | null;
  /**
   * The severity of the event that caused it. See `NotificationIntent.severity`.
   * `null` for a row created before T-30 — see `migrations.ts`.
   */
  readonly severity: EventSeverity | null;
}

/** What the policy decides, before an id or a clock is involved. */
export interface NotificationIntent {
  readonly type: string;
  readonly subject: string;
  readonly referenceId: string | null;
  /**
   * The severity of the event that caused this notification, computed by
   * `classify()` rather than written by hand in `POLICY` below — so the
   * severity attached to a notification and the severity attached to the
   * audit row it came from can never disagree.
   */
  readonly severity: EventSeverity;
  /**
   * The path a real email would link to, when the message carries what it takes
   * to build one. Today that is exactly one message: the activation event, the
   * only place in the catalogue where a clear token travels.
   *
   * **It is never stored.** The repository writes `type`, `subject` and
   * `referenceId` and does not see this field; it exists to reach the delivery
   * channel and nothing else. Where it may then go is the adapter's decision,
   * and the adapter gates it on the environment — see
   * `SimulatedNotificationAdapter`.
   */
  readonly link?: string;
  /**
   * What makes two notifications the same one even when two different events
   * caused them (T-45). `caused_by` already makes a *redelivery* of one event
   * produce one notification; this is for the event the producer announces
   * twice under two message ids — Account Service republishes an anomaly whose
   * first publication failed, and a person told twice about the same window
   * stops believing the second warning. Absent for the great majority, whose
   * event id is identity enough.
   */
  readonly dedupeKey?: string;
  /**
   * Who the notification is *for* when it is not a customer (T-45): the people
   * who operate the bank. An SLO alert has no customer, and a notification with
   * no recipient is reported `FAILED` by the channel — which is exactly how the
   * first version of this feature showed up in the operators' console, as an
   * alert nobody had been told about and a red banner saying so.
   */
  readonly audience?: 'OPERATORS';
}

/**
 * The simulated address of the operators, for the notifications that are theirs.
 *
 * Derived from nothing and naming nobody: like a customer's simulated address it
 * exists so the channel has somewhere to say it delivered, and unlike one it
 * could never be mistaken for a person's.
 */
export const OPERATORS_RECIPIENT = 'operadores@simulado.bonking.gt';

/**
 * Which events produce a notification, and what it says.
 *
 * Fifteen entries and not sixty-eight. The trail records everything; the *inbox*
 * records the things a person would want to be told, and a notification for
 * `account.debit.requested.v1` would be the bank narrating its own plumbing.
 * The three the ticket names — completed, failed, compensated — are the first
 * three rows, and the rest are the events the Claude Design prototype's
 * notification centre draws.
 *
 * **`transfer.compensated` is not a variant of `transfer.failed`.** A failed
 * transfer is money that never left; a compensated one is money that left and
 * came back, and somebody who saw the debit on their statement needs to be told
 * the second thing specifically. Collapsing them is how a customer concludes
 * the bank lost their money.
 */
const POLICY: Readonly<
  Record<string, { readonly type: string; readonly subject: string; readonly reference: string }>
> = {
  'transaction.completed.v1': {
    type: 'transfer.completed',
    subject: 'Tu transferencia se completó',
    reference: 'transactionId',
  },
  'transaction.failed.v1': {
    type: 'transfer.failed',
    subject: 'Tu transferencia no se realizó',
    reference: 'transactionId',
  },
  'transaction.compensated.v1': {
    type: 'transfer.compensated',
    subject: 'Tu transferencia fue revertida y el monto regresó a tu cuenta',
    reference: 'transactionId',
  },
  'customer.registered.v1': {
    type: 'customer.registered',
    subject: 'Recibimos tu registro',
    reference: 'customerId',
  },
  'customer.activation.requested.v1': {
    type: 'customer.activation',
    subject: 'Activa tu cuenta de bonking',
    reference: 'customerId',
  },
  /*
   * Password recovery, added for the prototype's `P-07`. Two entries rather
   * than one, and the second is the one that matters: "tu contraseña cambió"
   * is worth sending precisely when the person reading it did not ask for the
   * change, which is how somebody finds out their account was taken.
   */
  'customer.password-reset.issued.v1': {
    type: 'customer.password-reset',
    subject: 'Restablece tu contraseña de bonking',
    reference: 'customerId',
  },
  'customer.password-reset.completed.v1': {
    type: 'customer.password-changed',
    subject: 'Tu contraseña fue cambiada',
    reference: 'customerId',
  },
  /*
   * A password changed from inside a session. Worth telling somebody for the
   * same reason the reset completion is: the message matters precisely when the
   * person reading it did not make the change. The refusal is *not* here — a
   * wrong current password belongs in the trail, not in an inbox, or a
   * mistyped password would email you about it.
   */
  'customer.password-changed.v1': {
    type: 'customer.password-changed',
    subject: 'Tu contraseña fue cambiada',
    reference: 'customerId',
  },
  'customer.email.verified.v1': {
    type: 'customer.activated',
    subject: 'Tu cuenta quedó activa',
    reference: 'customerId',
  },
  'customer.updated.v1': {
    type: 'customer.updated',
    subject: 'Tus datos personales fueron actualizados',
    reference: 'customerId',
  },
  'customer.identity.validated.v1': {
    type: 'identity.validated',
    subject: 'Tu identidad fue verificada',
    reference: 'customerId',
  },
  'customer.identity.rejected.v1': {
    type: 'identity.rejected',
    subject: 'No pudimos verificar tu identidad',
    reference: 'customerId',
  },
  /*
   * Added by T-31, alongside the Saga's own KYC gate: the customer whose
   * transfer this later blocks should hear the verdict from the bank, not
   * only discover it as a rejected transfer with no explanation.
   */
  'customer.kyc.verified.v1': {
    type: 'kyc.verified',
    subject: 'Verificamos tu identidad para operaciones (KYC)',
    reference: 'customerId',
  },
  'customer.kyc.rejected.v1': {
    type: 'kyc.rejected',
    subject: 'No pudimos completar tu verificación de identidad (KYC)',
    reference: 'customerId',
  },
  'account.opened.v1': {
    type: 'account.opened',
    subject: 'Tu cuenta fue creada',
    reference: 'accountId',
  },
  'account.deactivated.v1': {
    type: 'account.deactivated',
    subject: 'Tu cuenta fue desactivada por inactividad',
    reference: 'accountId',
  },
  'account.reactivated.v1': {
    type: 'account.reactivated',
    subject: 'Tu cuenta volvió a estar activa',
    reference: 'accountId',
  },
  /*
   * T-45 (Fase 3, §4.1 — Account Service): the anomaly the producer detected
   * becomes a `WARNING` notification. It goes to the account's holder — the
   * event carries a `customerId` — and, like every notification, to the
   * administrator's console. It says only that something unusual happened:
   * no count, no window and no amount, because the inbox is a customer's and
   * the numbers belong to the audit trail. When the event names no customer it
   * goes to the operators instead — see `isAnomalyWithoutHolder`.
   */
  'account.anomaly.detected.v1': {
    type: 'account.anomaly',
    subject: 'Detectamos actividad inusual en tu cuenta',
    reference: 'accountId',
  },
};

const SLO_ALERT = 'alert.slo.received.v1';

/** The longest subject a notification row holds (`VARCHAR(200)`). */
const MAX_SUBJECT = 200;

/**
 * The notification this message calls for, or `null` for the great majority
 * that call for none.
 *
 * Takes the **raw** payload rather than the redacted one, because the reference
 * it reads is an identifier and identifiers survive redaction anyway — but
 * taking the raw one keeps this policy independent of what the redaction rule
 * happens to hide this week.
 */
export function notificationFor(messageType: string, payload: unknown): NotificationIntent | null {
  if (messageType === SLO_ALERT) {
    return sloAlertNotification(payload);
  }

  const rule = POLICY[messageType];

  if (rule === undefined) {
    return null;
  }

  const link = linkFrom(messageType, payload);
  const dedupeKey = dedupeKeyFor(messageType, payload);
  const forOperators = isAnomalyWithoutHolder(messageType, payload);

  return {
    type: rule.type,
    subject: forOperators ? ANOMALY_FOR_OPERATORS_SUBJECT : rule.subject,
    referenceId: readString(payload, rule.reference),
    severity: classify({ messageType, processingStatus: 'PROCESSED' }),
    ...(link === null ? {} : { link }),
    ...(dedupeKey === null ? {} : { dedupeKey }),
    ...(forOperators ? { audience: 'OPERATORS' as const } : {}),
  };
}

/**
 * What the operators read when an anomaly names no customer. The holder's
 * subject speaks to the holder ("tu cuenta"); said to the operators it would
 * claim an owner the event never named. Like the holder's, it carries no count,
 * window or amount — those are in the audit trail.
 */
const ANOMALY_FOR_OPERATORS_SUBJECT = 'Actividad inusual detectada en una cuenta';

/**
 * An anomaly whose `customerId` the contract left optional and the producer did
 * not send (T-45). There is no inbox to put it in, and a notification with no
 * recipient is reported `FAILED` by the channel, so the warning would be
 * recorded and told to nobody. It goes to the operators instead — the audience
 * an SLO alert already uses — rather than being dropped or invented a holder.
 */
function isAnomalyWithoutHolder(messageType: string, payload: unknown): boolean {
  return (
    messageType === 'account.anomaly.detected.v1' &&
    subjectCustomerIdFrom(messageType, payload) === null
  );
}

/**
 * The same anomaly, however many times it is announced: one account and one
 * window. `windowStart` is part of the key because the next window on the same
 * account is a different anomaly and deserves its own warning.
 */
function dedupeKeyFor(messageType: string, payload: unknown): string | null {
  if (messageType !== 'account.anomaly.detected.v1') {
    return null;
  }

  const accountId = readString(payload, 'accountId');
  const windowStart = readString(payload, 'windowStart');

  return accountId === null || windowStart === null ? null : `anomaly:${accountId}:${windowStart}`;
}

/**
 * One notification for one webhook, however many alerts it batches (T-45).
 *
 * A Grafana notification groups alerts that fire together; telling the
 * operators fifty times about one incident would bury the one that matters. The
 * subject names the alert when there is one and counts them when there are
 * several; the details are in the audit trail, which stores every alert of the
 * batch. The severity is the batch's worst (`classifyAlerts`), so the
 * notification and the audit row it came from cannot disagree.
 *
 * Tolerant of a payload that is not what the contract says, because this runs
 * before anybody has checked: it falls back to a generic subject rather than
 * throwing, and the audit row carries the `INVALID` verdict.
 */
function sloAlertNotification(payload: unknown): NotificationIntent {
  const alerts = alertsIn(payload);
  const firing = alerts.filter((alert) => alert.status === 'firing').length;

  const subject =
    alerts.length === 0
      ? 'Alerta de SLO'
      : alerts.length === 1
        ? `Alerta de SLO ${firing === 1 ? 'activa' : 'resuelta'}: ${alerts[0]?.alertName ?? ''}`
        : `${String(alerts.length)} alertas de SLO (${String(firing)} activas)`;

  return {
    type: 'alert.slo',
    subject: subject.slice(0, MAX_SUBJECT),
    referenceId: null,
    severity: classifyAlerts(payload),
    audience: 'OPERATORS',
  };
}

function alertsIn(
  payload: unknown,
): readonly { readonly alertName?: string; readonly status?: string }[] {
  const alerts =
    typeof payload === 'object' && payload !== null
      ? (payload as { alerts?: unknown }).alerts
      : undefined;

  return Array.isArray(alerts)
    ? alerts.filter((alert): alert is { alertName?: string; status?: string } =>
        typeof alert === 'object' && alert !== null,
      )
    : [];
}

/**
 * The two messages that carry a token, and the path each one links to.
 *
 * These are the only contracts in the catalogue where a clear secret travels,
 * and both say the value "must never be logged or echoed". This function does
 * not break that rule — it hands the link to the delivery channel, which is
 * what an email would do with it. What the channel then does is gated on the
 * environment, one file over.
 *
 * A path rather than an absolute URL, because this service does not know where
 * the frontend is deployed and inventing a host would produce a link that is
 * confidently wrong.
 */
const LINKS: Readonly<Record<string, { readonly path: string; readonly field: string }>> = {
  'customer.activation.requested.v1': { path: '/activar', field: 'activationToken' },
  'customer.password-reset.issued.v1': { path: '/restablecer', field: 'resetToken' },
};

function linkFrom(messageType: string, payload: unknown): string | null {
  const rule = LINKS[messageType];

  if (rule === undefined) {
    return null;
  }

  const token = readString(payload, rule.field);

  return token === null ? null : `${rule.path}?token=${encodeURIComponent(token)}`;
}

/** Every message type that notifies. For the tests, and for the documentation. */
export function notifyingMessageTypes(): readonly string[] {
  return [...Object.keys(POLICY), SLO_ALERT];
}

/**
 * The simulated address a notification is sent to.
 *
 * Derived from the customer the flow is acting for, never from an `email` field
 * on the payload — and the difference matters. Copying the real address would
 * put a working email in a table that exists to be read by staff, which is the
 * one thing the redaction rule two files over is written to prevent. A derived
 * address demonstrates the delivery without becoming a mailing list.
 *
 * `null` when nobody originated the work: an account deactivated by the nightly
 * job has no customer in its envelope, and inventing a recipient for it would
 * be inventing evidence.
 */
export function simulatedRecipientFor(customerId: string | null): string | null {
  if (customerId === null || customerId.length < 8) {
    return null;
  }

  return `cliente-${customerId.slice(0, 8)}@simulado.bonking.gt`;
}

/**
 * Whom a notification is *about*, when the envelope cannot say.
 *
 * The envelope's identity is the right source for anything a signed-in person
 * caused, and there are two flows where it is `null`.
 *
 * The first is **public registration**, which has no session by design. That
 * made the activation notification undeliverable for the only actor that ever
 * needs it: no recipient, so the channel reported `FAILED` and the link was
 * never written anywhere. Sign-up could not be completed by anybody, in any
 * environment (TD-044).
 *
 * The second is a **transfer that went through Payment Service's retry
 * sweeper**. The sweeper republishes on a timer, and a timer has no session to
 * inherit an identity from, so every terminal event downstream of a retried
 * payment arrived here with nobody to tell. The notification that went missing
 * is the worst one to lose: a transfer that exhausts the ladder compensates —
 * the money goes back — and the customer was never told it had.
 *
 * So for both families the subject is read from the payload, where `customerId`
 * is a declared field of every one of these contracts. It is not a weakening of
 * anything: the address is still *derived* from the identifier and never copied
 * from the payload's `email`, so nothing here turns the audit database into a
 * mailing list — which is the rule `redaction.ts` exists to keep.
 */
export function subjectCustomerIdFrom(messageType: string, payload: unknown): string | null {
  if (
    !messageType.startsWith('customer.') &&
    !messageType.startsWith('transaction.') &&
    messageType !== 'account.opened.v1' &&
    messageType !== 'account.deactivated.v1' &&
    messageType !== 'account.reactivated.v1' &&
    messageType !== 'account.anomaly.detected.v1'
  ) {
    return null;
  }

  return readString(payload, 'customerId');
}

/**
 * The **real** address a notification may be delivered to, for the one event
 * sanctioned to carry it.
 *
 * `customer.activation.requested.v1` is the single contract whose payload holds
 * a real `email` — its own comment names it the exception to T-02's "does not
 * cross" list (coherence check M-5): Notification cannot deliver a message
 * without an address. Every other event carries no real address, so this is
 * `null` for all of them, and a real provider has exactly one real inbox to
 * reach: the activation email, which is the one that has to arrive for anybody
 * to finish signing up.
 *
 * **Transient by construction.** It is handed to the delivery channel and never
 * to the repository, so the audit database still stores only the *simulated*
 * recipient from `simulatedRecipientFor`. The redaction rule two files over is
 * untouched: no real address is ever written down, it is only used to send.
 */
export function deliverableEmailFrom(messageType: string, payload: unknown): string | null {
  if (!DELIVERABLE.has(messageType)) {
    return null;
  }

  return readString(payload, 'email');
}

/**
 * The events sanctioned to carry a real address, and the reason they are.
 *
 * Neither email can be delivered without one, and neither reaches a person who
 * has a session — one is finishing a sign-up, the other has lost their
 * password. Every other event in the catalogue carries no real address at all.
 */
const DELIVERABLE = new Set([
  'customer.activation.requested.v1',
  'customer.password-reset.issued.v1',
  'customer.identity.rejected.v1',
  'customer.password-changed.v1',
]);

function readString(payload: unknown, field: string): string | null {
  if (typeof payload !== 'object' || payload === null) {
    return null;
  }

  const value = (payload as Record<string, unknown>)[field];

  return typeof value === 'string' ? value : null;
}
