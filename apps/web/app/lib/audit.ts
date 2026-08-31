import type { Role } from './navigation.ts';

/**
 * Everything the Auditoría module *decides*, as plain functions.
 *
 * Same reason as `payment.ts` and `transaction.ts`: the frontend has no
 * component-test framework (TD-010), so a rule written inside a `.vue` file is
 * a rule nobody can assert on. What lives here is the part of the audit
 * interface that can be **wrong about evidence** — whether a correlation
 * identifier is even askable, what order a trail is shown in, which service
 * produced a message, whether a notification actually went out — and every one
 * of those is one line away from making an audit screen say something the
 * record does not.
 *
 * Nothing here talks to the Gateway.
 */

/** The events of one flow, as `audit.query.replied.v1` carries them. */
export interface AuditEventRow {
  readonly messageId: string;
  readonly messageType: string;
  readonly producer: string;
  readonly causationId: string | null;
  readonly occurredAt: string;
  /** Added by T-20, optional on the wire. Absent from an older reply. */
  readonly processingStatus?: 'PROCESSED' | 'INVALID' | 'ERROR';
  /** Redacted by the owning service. Absent when nothing survived. */
  readonly payload?: Record<string, unknown>;
}

/** The notifications of one flow, as the same reply carries them. */
export interface AuditNotification {
  readonly channel: 'EMAIL';
  readonly subject: string;
  readonly sentAt: string | null;
}

/** A notification as the console reads it, which is richer. See TD-040. */
export interface NotificationRow {
  readonly notificationId: string;
  readonly type: string;
  readonly channel: 'EMAIL';
  readonly recipient: string | null;
  readonly referenceId: string | null;
  readonly subject: string;
  readonly status: NotificationStatus;
  readonly correlationId: string;
  readonly createdAt: string;
  readonly processedAt: string | null;
}

export type NotificationStatus = 'PENDING' | 'SENT' | 'FAILED';

/**
 * Whether this string is something the Gateway will accept.
 *
 * The pattern mirrors `AuditController`'s exactly, and the duplication is
 * deliberate in the same way `account.ts` duplicates the deactivation rule
 * (TD-029): catching a mistyped identifier next to the field beats sending it
 * and rendering a `400` the person has to interpret. The Gateway still checks —
 * this is convenience, and the refusal is its.
 *
 * Version 4 specifically, because that is what the contract says and because a
 * v1 UUID pasted from somewhere else would produce a `400` that looks like the
 * bank losing a record.
 */
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isCorrelationId(value: string): boolean {
  return UUID_V4.test(value.trim());
}

/** What is wrong with what somebody typed, or `null` if nothing is. */
export type CorrelationProblem = 'EMPTY' | 'NOT_A_UUID';

export function correlationProblem(value: string): CorrelationProblem | null {
  const trimmed = value.trim();

  if (trimmed.length === 0) {
    return 'EMPTY';
  }

  return UUID_V4.test(trimmed) ? null : 'NOT_A_UUID';
}

export const CORRELATION_PROBLEM_TEXT: Readonly<Record<CorrelationProblem, string>> = {
  EMPTY: 'Ingresá un identificador de correlación para consultar.',
  NOT_A_UUID: 'Un identificador de correlación es un UUID v4, como 7d41e8b2-9a3f-4c15-8ee0-1b2f9a4c7d10.',
};

/**
 * The trail in the order it is shown, oldest first.
 *
 * The service already orders this, and the screen orders it again — which is
 * not distrust, it is the difference between a list that happens to arrive
 * sorted and one that is sorted. The tie-break matters for the same reason it
 * does over there: five services on five clocks produce equal timestamps often
 * enough that "sorted by time" is not a total order, and the same trail
 * rendering in two orders on two loads is how somebody stops believing an audit
 * screen.
 */
export function orderedTrail(events: readonly AuditEventRow[]): readonly AuditEventRow[] {
  return [...events].sort((left, right) => {
    const byTime = Date.parse(left.occurredAt) - Date.parse(right.occurredAt);

    return byTime !== 0 ? byTime : left.messageId.localeCompare(right.messageId);
  });
}

/**
 * The colour a message name is written in — the prototype's own rule.
 *
 * `bonking.dc.html` tints a row by what the name contains: a failure in the
 * error family, a completion in the success family, everything else graphite.
 * It is a **weak** signal on purpose and stays weak here: a trail is a record
 * rather than a verdict, and colouring nine rows by inferred sentiment would
 * make somebody read the colours instead of the messages.
 */
export type TrailTint = 'failure' | 'success' | 'neutral';

export function tintFor(messageType: string): TrailTint {
  if (/(failed|rejected|compensated)/.test(messageType)) {
    return 'failure';
  }

  return /(completed|succeeded|credited|verified|validated|registered|opened)/.test(messageType)
    ? 'success'
    : 'neutral';
}

/** What the filters narrow by. Applied here, over rows already on screen. */
export interface TrailFilter {
  readonly producer?: string;
  readonly messageType?: string;
}

/**
 * The rows a filter leaves.
 *
 * Filtered in the browser rather than at the Gateway, and that is the honest
 * reading rather than a shortcut: `audit.query.requested.v1` takes a
 * `correlationId` and nothing else, so a `producer` sent to the server would be
 * a parameter nobody reads. A trail is one flow — nine rows, not nine thousand
 * — so there is nothing to page through and nothing to be gained by asking
 * twice.
 */
export function filterTrail(
  events: readonly AuditEventRow[],
  filter: TrailFilter,
): readonly AuditEventRow[] {
  return events
    .filter((event) => filter.producer === undefined || event.producer === filter.producer)
    .filter((event) => filter.messageType === undefined || event.messageType === filter.messageType);
}

/** The distinct values a trail actually contains, for the two dropdowns. */
export function producersIn(events: readonly AuditEventRow[]): readonly string[] {
  return [...new Set(events.map((event) => event.producer))].sort();
}

export function messageTypesIn(events: readonly AuditEventRow[]): readonly string[] {
  return [...new Set(events.map((event) => event.messageType))].sort();
}

export interface TrailSummary {
  readonly events: number;
  readonly producers: number;
  /** How many the service could not read. Zero is the expected number. */
  readonly invalid: number;
  /** Milliseconds between the first and last message, or `null` for one row. */
  readonly spanMs: number | null;
}

/**
 * What the header says about a flow before anybody reads a row.
 *
 * `invalid` is here rather than only on the row that carries it, because a
 * single `INVALID` in a trail of nine is exactly the thing somebody scrolls
 * past. It is criterion 3 made visible: a message the audit service could not
 * read is a fact about the system, and a screen that only whispered it would be
 * hiding the one row worth investigating.
 */
export function summariseTrail(events: readonly AuditEventRow[]): TrailSummary {
  const times = events.map((event) => Date.parse(event.occurredAt)).filter(Number.isFinite);

  return {
    events: events.length,
    producers: producersIn(events).length,
    invalid: events.filter((event) => event.processingStatus && event.processingStatus !== 'PROCESSED')
      .length,
    spanMs: times.length < 2 ? null : Math.max(...times) - Math.min(...times),
  };
}

/** A span as somebody reads it. Sub-second flows are the common case. */
export function formatSpan(ms: number): string {
  if (ms < 1_000) {
    return `${String(ms)} ms`;
  }

  const seconds = ms / 1_000;

  return seconds < 60
    ? `${seconds.toFixed(seconds < 10 ? 1 : 0)} s`
    : `${String(Math.round(seconds / 60))} min`;
}

export interface StatusPresentation {
  readonly label: string;
  readonly color: 'success' | 'warning' | 'error' | 'neutral';
  readonly explanation: string;
}

/**
 * The three ways this service can have fared with a message.
 *
 * `INVALID` and `ERROR` are kept apart because they are different incidents and
 * the person reading this screen is the one who has to tell them apart: one is
 * a producer publishing something that does not match its own contract, the
 * other is the audit service failing to write a message down. Only the second
 * is worth waking somebody for.
 */
export const PROCESSING_STATUS_PRESENTATION: Readonly<
  Record<'PROCESSED' | 'INVALID' | 'ERROR', StatusPresentation>
> = {
  PROCESSED: {
    label: 'Registrado',
    color: 'success',
    explanation: 'El mensaje se leyó y quedó registrado con su contrato.',
  },
  INVALID: {
    label: 'Inválido',
    color: 'warning',
    explanation:
      'El mensaje llegó pero su contenido no coincide con el contrato que declara. Quedó ' +
      'registrado igual: el productor no se vio afectado y nadie fue notificado a partir de él.',
  },
  ERROR: {
    label: 'Error',
    color: 'error',
    explanation:
      'El servicio de auditoría falló al registrar este mensaje. No es un problema del ' +
      'productor: el mensaje se publicó bien.',
  },
};

export const NOTIFICATION_STATUS_PRESENTATION: Readonly<
  Record<NotificationStatus, StatusPresentation>
> = {
  PENDING: {
    label: 'Pendiente',
    color: 'warning',
    explanation: 'Se creó y todavía no se ha entregado.',
  },
  SENT: {
    label: 'Enviada',
    color: 'success',
    explanation: 'El canal simulado la dio por entregada.',
  },
  FAILED: {
    label: 'No enviada',
    color: 'error',
    explanation: 'El canal simulado no pudo entregarla. No se reintenta.',
  },
};

/**
 * The status of a notification as the **audit reply** carries it.
 *
 * Two states out of three, and the loss is real: `audit.query.replied.v1` has
 * only `sentAt`, so a delivery that failed is indistinguishable there from one
 * still pending. T-20 chose not to widen a reply T-05 closed, and the console
 * route carries the true status instead — recorded as TD-040. This function is
 * where that limitation lives, so the components do not each invent their own
 * reading of a `null`.
 */
export function notificationStatusFrom(sentAt: string | null): 'PENDING' | 'SENT' {
  return sentAt === null ? 'PENDING' : 'SENT';
}

/**
 * Who may open the Auditoría module.
 *
 * **Convenience, not defence**, exactly like `mayMonitorPayments`. It exists so
 * the interface does not offer a screen that will answer `403`. The prohibition
 * is the Gateway's `@Roles('ADMINISTRADOR')` on `GET /api/audit`, which applies
 * whether or not this function was ever called.
 *
 * This is the one route decision D-06 restricts by **role** outright rather
 * than by scope — "Read the audit record and notifications: ✘ ✘ ✔" — which is
 * why the rule is a single comparison here and a scope check nowhere.
 */
export function mayQueryAudit(role: Role | null): boolean {
  return role === 'ADMINISTRADOR';
}

/**
 * The payload as the detail drawer prints it.
 *
 * Sorted by key so the same message renders the same way twice, and stringified
 * here rather than in the template so that a payload the service redacted into
 * nothing produces `null` — something the drawer can say a sentence about —
 * instead of an empty `{}` a reader would take as "this message carried no
 * data", which is a claim about the producer rather than about this service.
 */
export function formatPayload(payload: Record<string, unknown> | undefined): string | null {
  if (payload === undefined || Object.keys(payload).length === 0) {
    return null;
  }

  const sorted = Object.fromEntries(
    Object.entries(payload).sort(([left], [right]) => left.localeCompare(right)),
  );

  return JSON.stringify(sorted, null, 2);
}

/** The marker the audit service writes where a value used to be. */
export const REDACTION_MARKER = '[redactado]';

/** How many of the shown fields were hidden, for the sentence under the payload. */
export function redactedCount(payload: Record<string, unknown> | undefined): number {
  if (payload === undefined) {
    return 0;
  }

  return JSON.stringify(payload).split(`"${REDACTION_MARKER}"`).length - 1;
}

/**
 * One notification as its own recipient sees it — `N-01`'s row.
 *
 * Mirrors `notification.inbox.replied.v1`, and it is **not** the console's
 * shape: no `recipient`, because a person does not need to be told their own
 * simulated address, and no delivery `status`, because "PENDING" is a fact
 * about the bank's mail plumbing that the person reading the notification right
 * now cannot act on.
 */
export interface InboxNotification {
  readonly notificationId: string;
  readonly type: string;
  readonly subject: string;
  readonly referenceId: string | null;
  readonly correlationId: string;
  readonly createdAt: string;
  readonly readAt: string | null;
}

/**
 * Where a notification's "Ver" link goes, from the event that caused it.
 *
 * The type is named after that event — `transfer.completed`, `account.opened`,
 * `customer.password-changed` — and the reference is whatever that event was
 * about. Mapping the two to a route is presentation, which is why it is a
 * function here rather than a field on the wire: the day a screen moves, one
 * table changes and no message does.
 *
 * `null` when there is nowhere useful to go. A notification that cannot be
 * opened is better than one whose link lands on a 404.
 */
export function notificationLink(notification: InboxNotification): string | null {
  if (notification.referenceId === null) {
    return null;
  }

  if (notification.type.startsWith('transfer.')) {
    return `/transferencias/${notification.referenceId}`;
  }

  if (notification.type.startsWith('account.')) {
    return `/cuentas/${notification.referenceId}`;
  }

  if (notification.type.startsWith('customer.') || notification.type.startsWith('identity.')) {
    return '/perfil';
  }

  return null;
}

/**
 * The words a notification's kind is written in.
 *
 * Falls back to the raw type rather than to "Notificación": a reader who sees
 * an untranslated `payment.settled` learns something, and a reader who sees a
 * generic label learns nothing and cannot report it either.
 */
const NOTIFICATION_LABELS: Readonly<Record<string, string>> = {
  'transfer.completed': 'Transferencia completada',
  'transfer.failed': 'Transferencia fallida',
  'transfer.compensated': 'Transferencia revertida',
  'customer.registered': 'Registro recibido',
  'customer.activation': 'Activación de cuenta',
  'customer.activated': 'Cuenta activada',
  'customer.password-reset': 'Recuperación de contraseña',
  'customer.password-changed': 'Contraseña cambiada',
  'identity.validated': 'Identidad verificada',
  'identity.rejected': 'Identidad rechazada',
  'account.opened': 'Cuenta creada',
  'account.deactivated': 'Cuenta desactivada',
  'account.reactivated': 'Cuenta reactivada',
};

export function notificationLabel(type: string): string {
  return NOTIFICATION_LABELS[type] ?? type;
}
