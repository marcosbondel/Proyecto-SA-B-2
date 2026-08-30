import { redactPayload } from '../../src/domain/redaction';
import { deduplicationKeyOf } from '../../src/domain/deduplication';
import type { InboxNotification } from '../../src/application/ports';
import type { RecordOutcome } from '../../src/domain/deduplication';
import type { AuditEvent } from '../../src/domain/audit-event';
import type { Notification, NotificationIntent } from '../../src/domain/notification';
import type {
  AuditRepository,
  InboundRecord,
  NotificationFilter,
  NotificationPage,
  NotificationSender,
  OutboundMessage,
  ReplyPublisher,
} from '../../src/application/ports';

/**
 * The repository as a `Map`, with the one behaviour that actually matters kept
 * honest: the deduplication is a key collision, checked **before** anything
 * else is written, exactly as `ON CONFLICT DO NOTHING` behaves.
 *
 * A double that deduplicated some other way — by scanning, by comparing
 * timestamps — would let the use-case tests pass against a repository that
 * cannot hold under two replicas. The integration test against a real
 * PostgreSQL is what proves the SQL matches this; this is what makes the
 * use-case tests fast and honest at the same time.
 */
export class InMemoryAuditRepository implements AuditRepository {
  public readonly events: AuditEvent[] = [];
  public readonly notifications: Notification[] = [];
  public readonly deliveries = new Map<string, number>();

  public async record(input: {
    readonly event: InboundRecord;
    readonly notification: {
      readonly notificationId: string;
      readonly intent: NotificationIntent;
      readonly recipient: string | null;
      readonly customerId: string | null;
    } | null;
    readonly now: Date;
  }): Promise<RecordOutcome & { readonly notificationId?: string }> {
    const { event, notification, now } = input;
    const key = deduplicationKeyOf({ eventId: event.eventId, consumer: event.consumer });

    this.deliveries.set(key, (this.deliveries.get(key) ?? 0) + 1);

    if (this.events.some((stored) => keyOf(stored) === key)) {
      return await Promise.resolve({ kind: 'DUPLICATE' });
    }

    this.events.push({
      eventId: event.eventId,
      messageType: event.messageType,
      messageVersion: event.messageVersion,
      producer: event.producer,
      occurredAt: event.occurredAt,
      receivedAt: now,
      correlationId: event.correlationId,
      causationId: event.causationId,
      payload: redactPayload(event.payload),
      processingStatus: event.processingStatus,
      consumer: event.consumer,
    });

    if (notification !== null) {
      this.notifications.push({
        notificationId: notification.notificationId,
        type: notification.intent.type,
        channel: 'EMAIL',
        recipient: notification.recipient,
        referenceId: notification.intent.referenceId,
        subject: notification.intent.subject,
        status: 'PENDING',
        correlationId: event.correlationId,
        createdAt: now,
        processedAt: null,
        customerId: notification.customerId,
        readAt: null,
      });
    }

    return await Promise.resolve({
      kind: 'RECORDED',
      notified: notification !== null,
      ...(notification === null ? {} : { notificationId: notification.notificationId }),
    });
  }

  public async inboxOf(input: {
    readonly customerId: string;
    readonly limit: number;
  }): Promise<{ readonly notifications: readonly InboxNotification[]; readonly unread: number }> {
    const mine = this.notifications
      .filter((notification) => notification.customerId === input.customerId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

    return await Promise.resolve({
      notifications: mine.slice(0, input.limit).map((notification) => ({
        notificationId: notification.notificationId,
        type: notification.type,
        subject: notification.subject,
        referenceId: notification.referenceId,
        correlationId: notification.correlationId,
        createdAt: notification.createdAt.toISOString(),
        readAt: notification.readAt?.toISOString() ?? null,
      })),
      unread: mine.filter((notification) => notification.readAt === null).length,
    });
  }

  public async unreadCountOf(customerId: string): Promise<number> {
    return await Promise.resolve(
      this.notifications.filter(
        (notification) => notification.customerId === customerId && notification.readAt === null,
      ).length,
    );
  }

  public async markRead(input: {
    readonly customerId: string;
    readonly notificationIds: readonly string[] | null;
    readonly now: Date;
  }): Promise<number> {
    let changed = 0;

    for (const [index, notification] of this.notifications.entries()) {
      const mine = notification.customerId === input.customerId;
      const named =
        input.notificationIds === null ||
        input.notificationIds.includes(notification.notificationId);

      if (mine && named && notification.readAt === null) {
        this.notifications[index] = { ...notification, readAt: input.now };
        changed += 1;
      }
    }

    return await Promise.resolve(changed);
  }

  public async stats(): Promise<{
    readonly eventsToday: number;
    readonly invalidToday: number;
    readonly notificationsToday: number;
    readonly lastEventType: string | null;
    readonly lastEventAt: string | null;
  }> {
    const newest = this.events.at(-1);

    return await Promise.resolve({
      eventsToday: this.events.length,
      invalidToday: this.events.filter((event) => event.processingStatus === 'INVALID').length,
      notificationsToday: this.notifications.length,
      lastEventType: newest?.messageType ?? null,
      lastEventAt: newest?.occurredAt.toISOString() ?? null,
    });
  }

  public async settleNotification(input: {
    readonly notificationId: string;
    readonly status: 'SENT' | 'FAILED';
    readonly processedAt: Date;
  }): Promise<void> {
    const index = this.notifications.findIndex(
      (candidate) => candidate.notificationId === input.notificationId,
    );

    if (index >= 0) {
      this.notifications[index] = {
        ...this.notifications[index]!,
        status: input.status,
        processedAt: input.processedAt,
      };
    }

    await Promise.resolve();
  }

  public async trailFor(correlationId: string): Promise<readonly AuditEvent[]> {
    return await Promise.resolve(
      this.events.filter((event) => event.correlationId === correlationId),
    );
  }

  public async notificationsFor(correlationId: string): Promise<readonly Notification[]> {
    return await Promise.resolve(
      this.notifications.filter((notification) => notification.correlationId === correlationId),
    );
  }

  public async listNotifications(filter: NotificationFilter): Promise<NotificationPage> {
    const matched = this.notifications
      .filter((n) => filter.correlationId === undefined || n.correlationId === filter.correlationId)
      .filter((n) => filter.status === undefined || n.status === filter.status)
      .filter((n) => filter.type === undefined || n.type === filter.type)
      .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime());

    const page = matched.slice(0, filter.limit ?? 50);

    return await Promise.resolve({ notifications: page, omitted: matched.length - page.length });
  }

  public async isReachable(): Promise<boolean> {
    return await Promise.resolve(true);
  }
}

/** A sender that records what it was asked to deliver, and can be told to fail. */
export class RecordingSender implements NotificationSender {
  public readonly sent: { readonly notificationId: string; readonly type: string }[] = [];
  #verdict: 'SENT' | 'FAILED' = 'SENT';

  public failNext(): void {
    this.#verdict = 'FAILED';
  }

  public async send(notification: {
    readonly notificationId: string;
    readonly type: string;
  }): Promise<'SENT' | 'FAILED'> {
    this.sent.push({ notificationId: notification.notificationId, type: notification.type });
    const verdict = this.#verdict;
    this.#verdict = 'SENT';

    return await Promise.resolve(verdict);
  }
}

/** A publisher that keeps what it was handed, so a reply can be asserted on. */
export class RecordingPublisher implements ReplyPublisher {
  public readonly replies: OutboundMessage[] = [];

  public async reply(message: OutboundMessage): Promise<void> {
    this.replies.push(message);

    await Promise.resolve();
  }

  public get last(): OutboundMessage | undefined {
    return this.replies.at(-1);
  }
}

/** A clock that does not move unless a test moves it. */
export class FixedClock {
  #at: Date;

  constructor(at = new Date('2026-08-27T15:00:00.000Z')) {
    this.#at = at;
  }

  public now(): Date {
    return this.#at;
  }

  public advance(milliseconds: number): void {
    this.#at = new Date(this.#at.getTime() + milliseconds);
  }
}

/** Identifiers a test can predict, so it can assert on the row it expected. */
export class CountingIds {
  #next = 0;

  public next(): string {
    this.#next += 1;

    return `00000000-0000-4000-8000-${String(this.#next).padStart(12, '0')}`;
  }
}

function keyOf(event: AuditEvent): string {
  return deduplicationKeyOf({ eventId: event.eventId, consumer: event.consumer });
}
