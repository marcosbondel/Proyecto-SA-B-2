import {
  auditQueryRequestedV1,
  contractFor,
  notificationListQueryV1,
} from '@bank/contracts';
import type { MessageEnvelope } from '@bank/contracts';

import type { ListNotificationsUseCase } from '../application/list-notifications.use-case';
import type { QueryAuditUseCase } from '../application/query-audit.use-case';
import type { RecordEventUseCase } from '../application/record-event.use-case';
import type { InboundMessageHandler } from './inbound-message.handler';
import type { StructuredLogger } from './logging';

/**
 * The one handler for events, and the two for questions.
 *
 * One and not forty-four, because this service does the *same thing* with every
 * event: write it down, and notify if the policy says to. A handler per message
 * type would be forty-four places to forget the deduplication, and the part
 * that genuinely differs between them — which events are worth telling somebody
 * about — lives in `domain/notification.ts` as a table anybody can read.
 */

/**
 * Every event, recorded — valid or not.
 *
 * **This handler validates the payload itself instead of letting the broker do
 * it**, and that inversion is the whole of criterion 3. `@bank/messaging` takes
 * an optional validator and parks anything that fails it straight onto the
 * error exchange; for the four other services that is exactly right, because a
 * message they cannot read is a message they cannot act on. For this one it
 * would mean the malformed message never reaches the service whose job is to
 * record that it arrived — the audit trail would be silent about precisely the
 * events somebody is investigating.
 *
 * So `main.ts` subscribes with no validator, and the verdict is computed here
 * and written down as `PROCESSED` or `INVALID`. The producer is told nothing
 * either way. That is criterion 3's second half and the reason this service
 * exists at the end of a queue rather than in anybody's request path.
 *
 * It is deliberately **not** an `InboundMessageHandler`: the router in that
 * file dispatches by `messageType`, and this handler claims every type there
 * is. Giving it a wildcard entry in the map would make the map lie about what
 * routing means. The four family queues call it directly; only the query queue,
 * which really does have two named handlers, goes through the router.
 */
export class RecordEventHandler {
  readonly #useCase: RecordEventUseCase;
  readonly #consumer: string;
  readonly #logger: StructuredLogger;

  constructor(useCase: RecordEventUseCase, consumer: string, logger: StructuredLogger) {
    this.#useCase = useCase;
    this.#consumer = consumer;
    this.#logger = logger;
  }

  public async handle(envelope: MessageEnvelope<unknown>): Promise<void> {
    const contract = contractFor(envelope.messageType);
    const parsed = contract?.schema.safeParse(envelope.payload);

    /*
     * Three situations collapse into one status, on purpose. An unknown name,
     * a version this build does not carry and a payload that fails its schema
     * are all "this consumer cannot read it", and none becomes readable by
     * waiting. The reason string keeps them distinguishable in the log without
     * needing a second column in the table.
     */
    const invalidReason =
      contract === undefined
        ? `no contract named "${envelope.messageType}"`
        : parsed?.success === false
          ? (parsed.error.issues[0]?.message ?? 'payload does not satisfy its contract')
          : null;

    const outcome = await this.#useCase.execute({
      event: {
        eventId: envelope.messageId,
        messageType: envelope.messageType,
        messageVersion: envelope.messageVersion,
        producer: envelope.producer,
        occurredAt: new Date(envelope.occurredAt),
        correlationId: envelope.correlationId,
        causationId: envelope.causationId,
        payload: envelope.payload,
        processingStatus: invalidReason === null ? 'PROCESSED' : 'INVALID',
        consumer: this.#consumer,
      },
      customerId: envelope.identity?.customerId ?? null,
    });

    this.#logger.info('event recorded', {
      eventId: envelope.messageId,
      messageType: envelope.messageType,
      producer: envelope.producer,
      consumer: this.#consumer,
      correlationId: envelope.correlationId,
      causationId: envelope.causationId,
      outcome: outcome.kind,
      ...(invalidReason === null ? {} : { reason: invalidReason }),
    });
  }
}

/** "What happened in this flow?" */
export class AuditQueryHandler implements InboundMessageHandler {
  public readonly messageType = auditQueryRequestedV1.name;
  readonly #useCase: QueryAuditUseCase;

  constructor(useCase: QueryAuditUseCase) {
    this.#useCase = useCase;
  }

  public async handle(envelope: MessageEnvelope<unknown>): Promise<void> {
    const query = auditQueryRequestedV1.schema.parse(envelope.payload);

    await this.#useCase.execute({ correlationId: query.correlationId });
  }
}

/** "What has the bank told people?" */
export class NotificationListHandler implements InboundMessageHandler {
  public readonly messageType = notificationListQueryV1.name;
  readonly #useCase: ListNotificationsUseCase;

  constructor(useCase: ListNotificationsUseCase) {
    this.#useCase = useCase;
  }

  public async handle(envelope: MessageEnvelope<unknown>): Promise<void> {
    const query = notificationListQueryV1.schema.parse(envelope.payload);

    await this.#useCase.execute(query);
  }
}
