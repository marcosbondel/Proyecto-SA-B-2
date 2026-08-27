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
    } | null;
    readonly now: Date;
  }): Promise<RecordOutcome & { readonly notificationId?: string }>;

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
    readonly recipient: string | null;
    readonly subject: string;
    readonly correlationId: string;
    /** The path an email would link to. Passed through, never persisted. */
    readonly link?: string;
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
