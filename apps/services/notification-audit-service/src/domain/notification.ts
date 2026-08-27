/**
 * What the bank tells somebody, and which events are worth telling them about.
 *
 * The policy is a pure function of the message, so "does a compensated transfer
 * notify the customer" is a question anyone can answer by reading one table
 * instead of tracing a consumer. It is also the only place that decides it: a
 * second `if` in a handler is how one event ends up notifying twice.
 */

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
}

/** What the policy decides, before an id or a clock is involved. */
export interface NotificationIntent {
  readonly type: string;
  readonly subject: string;
  readonly referenceId: string | null;
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
}

/**
 * Which events produce a notification, and what it says.
 *
 * Eleven entries and not fifty-five. The trail records everything; the *inbox*
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
  'customer.email.verified.v1': {
    type: 'customer.activated',
    subject: 'Tu cuenta quedó activa',
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
};

/**
 * The notification this message calls for, or `null` for the great majority
 * that call for none.
 *
 * Takes the **raw** payload rather than the redacted one, because the reference
 * it reads is an identifier and identifiers survive redaction anyway — but
 * taking the raw one keeps this policy independent of what the redaction rule
 * happens to hide this week.
 */
export function notificationFor(
  messageType: string,
  payload: unknown,
): NotificationIntent | null {
  const rule = POLICY[messageType];

  if (rule === undefined) {
    return null;
  }

  const link = activationLinkFrom(messageType, payload);

  return {
    type: rule.type,
    subject: rule.subject,
    referenceId: readString(payload, rule.reference),
    ...(link === null ? {} : { link }),
  };
}

/**
 * The activation link, for the one message that carries a token.
 *
 * `customer.activation.requested.v1` is the single contract in the catalogue
 * where a clear secret travels, and its own comment says the value "must never
 * be logged or echoed". This function does not break that rule — it hands the
 * link to the delivery channel, which is what an email would do with it. What
 * the channel then does is gated on the environment, one file over.
 *
 * A path rather than an absolute URL, because this service does not know where
 * the frontend is deployed and inventing a host would produce a link that is
 * confidently wrong.
 */
function activationLinkFrom(messageType: string, payload: unknown): string | null {
  if (messageType !== 'customer.activation.requested.v1') {
    return null;
  }

  const token = readString(payload, 'activationToken');

  return token === null ? null : `/activar?token=${encodeURIComponent(token)}`;
}

/** Every message type that notifies. For the tests, and for the documentation. */
export function notifyingMessageTypes(): readonly string[] {
  return Object.keys(POLICY);
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

function readString(payload: unknown, field: string): string | null {
  if (typeof payload !== 'object' || payload === null) {
    return null;
  }

  const value = (payload as Record<string, unknown>)[field];

  return typeof value === 'string' ? value : null;
}
