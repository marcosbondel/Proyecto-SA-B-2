import { auditQueryRepliedV1 } from '@bank/contracts';

import { orderTrail } from '../domain/audit-event';
import type { AuditRepository, ReplyPublisher } from './ports';

/**
 * "What happened in this flow?" — answered, or answered emptily.
 *
 * A `correlationId` with no records is **not an error**. It means one of three
 * things this service cannot tell apart and must not guess between: the flow
 * never existed, it existed and this service was down when it passed, or it is
 * still in progress. Two empty lists say all three honestly; a `NOT_FOUND`
 * would assert the first.
 *
 * The trail is ordered here rather than in the SQL because the tie-break that
 * makes the order deterministic is a domain rule (`orderTrail`), and a rule
 * expressed as an `ORDER BY` is a rule no test can reach without a database.
 */
export class QueryAuditUseCase {
  readonly #repository: AuditRepository;
  readonly #publisher: ReplyPublisher;

  constructor(dependencies: { repository: AuditRepository; publisher: ReplyPublisher }) {
    this.#repository = dependencies.repository;
    this.#publisher = dependencies.publisher;
  }

  public async execute(input: { readonly correlationId: string }): Promise<void> {
    const [events, notifications] = await Promise.all([
      this.#repository.trailFor(input.correlationId),
      this.#repository.notificationsFor(input.correlationId),
    ]);

    const payload: unknown = {
      correlationId: input.correlationId,
      events: orderTrail(events).map((event) => ({
        messageId: event.eventId,
        messageType: event.messageType,
        producer: event.producer,
        causationId: event.causationId,
        occurredAt: event.occurredAt.toISOString(),
        processingStatus: event.processingStatus,
        /*
         * Omitted rather than sent empty when redaction left nothing. An empty
         * object on screen reads as "this message carried no data", which is a
         * claim about the producer; absence reads as "there is nothing to show
         * you", which is a claim about this service and is the true one.
         */
        ...(Object.keys(event.payload).length > 0 ? { payload: event.payload } : {}),
      })),
      /**
       * `sentAt` is `null` for a notification that failed as well as for one
       * still pending, because the reply T-05 closed has no third state and
       * T-20 chose not to widen it (TD-040). The console route carries the real
       * status; this reply answers "was the customer told", and for both of
       * those the answer is "not yet".
       */
      notifications: notifications.map((notification) => ({
        channel: notification.channel,
        subject: notification.subject,
        sentAt:
          notification.status === 'SENT' && notification.processedAt !== null
            ? notification.processedAt.toISOString()
            : null,
      })),
    };

    await this.#publisher.reply({
      messageType: auditQueryRepliedV1.name,
      payload,
    });
  }
}
