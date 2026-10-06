import { auditEventsListRepliedV1 } from '@bank/contracts';
import type { AuditEventsListQueryV1, Identity } from '@bank/contracts';

import type { AuditRepository, ReplyPublisher } from './ports';

export class ListAuditEventsUseCase {
  readonly #repository: AuditRepository;
  readonly #publisher: ReplyPublisher;

  constructor(dependencies: { repository: AuditRepository; publisher: ReplyPublisher }) {
    this.#repository = dependencies.repository;
    this.#publisher = dependencies.publisher;
  }

  public async execute(
    query: AuditEventsListQueryV1,
    identity: Identity | null,
  ): Promise<void> {
    if (identity?.role !== 'ADMINISTRADOR') {
      await this.#publisher.reply({
        messageType: auditEventsListRepliedV1.name,
        payload: { events: [], total: 0, page: 1, limit: 10 },
      });
      return;
    }

    const page = Math.max(1, query.page ?? 1);
    const limit = Math.min(100, Math.max(1, query.limit ?? 10));
    const offset = (page - 1) * limit;

    const result = await this.#repository.listRecentEvents({
      limit,
      offset,
      ...(query.severity === undefined ? {} : { severity: query.severity }),
      ...(query.correlationId === undefined ? {} : { correlationId: query.correlationId }),
      ...(query.traceId === undefined ? {} : { traceId: query.traceId }),
      ...(query.service === undefined ? {} : { service: query.service }),
    });

    const payload: unknown = {
      events: result.events.map((event) => ({
        eventId: event.eventId,
        messageType: event.messageType,
        producer: event.producer,
        occurredAt: event.occurredAt.toISOString(),
        correlationId: event.correlationId,
        ...(event.traceId === null ? {} : { traceId: event.traceId }),
        ...(event.causationId === null ? {} : { causationId: event.causationId }),
        processingStatus: event.processingStatus,
        consumer: event.consumer,
        payload: event.payload as Record<string, unknown>,
        /** `null` for a row recorded before T-30. See `migrations.ts`. */
        ...(event.severity === null ? {} : { severity: event.severity }),
      })),
      total: result.total,
      page,
      limit,
    };

    await this.#publisher.reply({
      messageType: auditEventsListRepliedV1.name,
      payload,
    });
  }
}
