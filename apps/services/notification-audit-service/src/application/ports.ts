import type { AuditEvent, AuditProcessingStatus } from '../domain/audit-event';
import type { Notification, NotificationIntent, NotificationStatus } from '../domain/notification';
import type { RecordOutcome } from '../domain/deduplication';

/**
 * Everything this service needs from the outside, named by what it is for.
 *
 * The application layer may not import `@bank/messaging` or `pg` — `pnpm lint`
 * enforces it — because a use case that knows it publishes over AMQP cannot be
 * tested without AMQP. `@bank/contracts` is fair game: a contract is a shape,
 * not a transport.
 */

/** What the recorder was handed, already validated or already known bad. */
export interface InboundRecord {
  readonly eventId: string;
  readonly messageType: string;
  readonly messageVersion: number;
  readonly producer: string;
  readonly occurredAt: Date;
  readonly correlationId: string;
  readonly causationId: string | null;
  /** The **raw** payload. The repository stores only what redaction leaves. */
  readonly payload: unknown;
  readonly processingStatus: AuditProcessingStatus;
  /** The family queue this arrived on. Half of the deduplication key. */
  readonly consumer: string;
}

/** What a notifications listing may be narrowed by. None of these is a permission. */
export interface NotificationFilter {
  readonly correlationId?: string;
  readonly status?: NotificationStatus;
  readonly type?: string;
  readonly limit?: number;
}

export interface NotificationPage {
  readonly notifications: readonly Notification[];
  /** How many rows matched beyond the ones returned. */
  readonly omitted: number;
}

/**
 * The one door to this service's own database, and to no other's.
 *
 * `record` takes the notification **intent** rather than being called a second
 * time after the audit row lands, and that is the load-bearing choice of this
 * file. Two calls would mean two transactions, and criterion 2 — a duplicate
 * produces neither a second record nor a second notification — would then
 * depend on the second call noticing that the first one lost a race. As one
 * transaction it is a unique constraint doing the work: the redelivery loses
 * the insert, the notification is never created, and no clock or ordering is
 * involved.
 */
export interface AuditRepository {
  /**
   * Writes the trail row and, if the policy asked for one, the notification —
   * in one transaction, deduplicated by (`eventId`, `consumer`) before either.
   *
   * Returns `DUPLICATE` without touching anything when the pair already exists.
   * The notification is created `PENDING`; sending it is the use case's next
   * step, and deliberately outside this transaction (see `RecordEventUseCase`).
   */
  record(input: {
    readonly event: InboundRecord;
    readonly notification: {
      readonly notificationId: string;
      readonly intent: NotificationIntent;
      readonly recipient: string | null;
      /**
       * Whose inbox this belongs in — the subject, not the address.
       *
       * The same value `recipient` is derived from, written down instead of
       * discarded. Without it a notification is a row nobody can claim, which
       * is what made `N-01` impossible (TD-041).
       */
      readonly customerId: string | null;
    } | null;
    readonly now: Date;
  }): Promise<RecordOutcome & { readonly notificationId?: string }>;

  /**
   * One person's notifications, newest first, with the unread count.
   *
   * Scoped by the caller, never by a filter: `customerId` is taken from the
   * envelope identity by the use case. There is no "all inboxes" mode — the
   * staff console is a different query over the same table
   * (`notification.list.query.v1`) and it answers a different question.
   */
  inboxOf(input: { readonly customerId: string; readonly limit: number }): Promise<{
    readonly notifications: readonly InboxNotification[];
    readonly unread: number;
  }>;

  /** The unread count alone, for the answer a write gives back. */
  unreadCountOf(customerId: string): Promise<number>;

  /**
   * Marks a person's notifications read, and says how many changed.
   *
   * All of them, or the ones named. Scoped by `customerId` in the `WHERE`
   * clause rather than checked beforehand: an id belonging to somebody else
   * simply matches no row, so a request to read a stranger's notification is a
   * no-op instead of a refusal that would confirm the id exists.
   */
  markRead(input: {
    readonly customerId: string;
    readonly notificationIds: readonly string[] | null;
    readonly now: Date;
  }): Promise<number>;

  /**
   * The dashboard's counts over the trail.
   *
   * `invalidToday` is the number a trail that counted only successes would
   * hide: a message this service cannot parse is recorded `INVALID` rather than
   * parked, so that somebody can see it happened.
   */
  stats(): Promise<{
    readonly eventsToday: number;
    readonly invalidToday: number;
    readonly notificationsToday: number;
    readonly lastEventType: string | null;
    readonly lastEventAt: string | null;
  }>;

  /** Moves a notification out of `PENDING`. The only update in this service. */
  settleNotification(input: {
    readonly notificationId: string;
    readonly status: Extract<NotificationStatus, 'SENT' | 'FAILED'>;
    readonly processedAt: Date;
  }): Promise<void>;

  /** Every event of one flow, ordered. Empty when the correlation is unknown. */
  trailFor(correlationId: string): Promise<readonly AuditEvent[]>;

  /** The notifications of one flow, oldest first. */
  notificationsFor(correlationId: string): Promise<readonly Notification[]>;

  /** The operational listing, newest first, bounded. */
  listNotifications(filter: NotificationFilter): Promise<NotificationPage>;

  /** Recent audit events across flows, paginated. */
  listRecentEvents(input: { readonly limit: number; readonly offset: number }): Promise<{
    readonly events: readonly AuditEvent[];
    readonly total: number;
  }>;

  /** For the readiness probe: can this service reach its own database? */
  isReachable(): Promise<boolean>;
}

/**
 * The simulated delivery channel.
 *
 * A port with one implementation, because the implementation is the point: the
 * assignment asks for notifications to be *simulated* (§4.1), and a port makes
 * "we did not really send anything" a fact recorded in one adapter rather than
 * a thing every reader has to infer. It also means the day a real provider
 * arrives, nothing above this line changes.
 */
export interface NotificationSender {
  /** Never throws. A delivery that fails is a `FAILED` status, not an exception. */
  send(notification: {
    readonly notificationId: string;
    readonly type: string;
    /** The **simulated** address, and the one the repository stored. */
    readonly recipient: string | null;
    readonly subject: string;
    readonly correlationId: string;
    /** The path an email would link to. Passed through, never persisted. */
    readonly link?: string;
    /**
     * The **real** inbox to deliver to, when the message is one sanctioned to
     * carry it (only the activation event — see `deliverableEmailFrom`).
     *
     * Transient: handed to a real provider to actually send, and never written
     * anywhere. `null`/absent for every other notification, whose only address
     * is the simulated one above — a real channel treats those as simulated.
     */
    readonly deliveryAddress?: string | null;
  }): Promise<Extract<NotificationStatus, 'SENT' | 'FAILED'>>;
}

/** One outbound message, already shaped as a contract payload. */
export interface OutboundMessage {
  readonly messageType: string;
  readonly payload: unknown;
}

/**
 * How this service speaks back to the rest of the system: replies, and nothing
 * else.
 *
 * One method, and that is the whole design. This service consumes events and
 * answers questions; it publishes **no command and no domain event**, because
 * anything it published would be a message the bank's business logic could come
 * to depend on, and criterion 6 is precisely that it emits none. The ticket
 * mentions `audit.recorded` as a possibility "si el contrato los requiere" —
 * the contract does not, and adding it would have this service publishing onto
 * the very exchange its own queues are bound to.
 */
export interface ReplyPublisher {
  reply(message: OutboundMessage): Promise<void>;
}

/**
 * The one thing the notification adapter needs that is not a database.
 *
 * Declared here rather than imported from `interfaces/logging` because
 * dependencies point inward and `pnpm lint` enforces it: an adapter that
 * imported the interface layer would be an adapter reaching outward. The
 * `StructuredLogger` over there satisfies this shape without knowing it does,
 * which is the whole benefit of naming the port by what it is for.
 */
export interface DeliveryLog {
  info(message: string, fields: Record<string, string | undefined>): void;
  warn(message: string, fields: Record<string, string | undefined>): void;
}

/** Injected so a test can decide what "now" is. */
export interface Clock {
  now(): Date;
}

/** Injected so a test can assert on the notification it expected to be created. */
export interface IdGenerator {
  next(): string;
}

/**
 * A notification as **its own recipient** sees it.
 *
 * Mirrors `notification.inbox.replied.v1`, and is not `NotificationView`: that
 * one carries the simulated recipient of every delivery in the system and its
 * delivery status, both of which exist for a console restricted to
 * `ADMINISTRADOR`. One shape serving both audiences would be one shape carrying
 * a field a customer must never see.
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

