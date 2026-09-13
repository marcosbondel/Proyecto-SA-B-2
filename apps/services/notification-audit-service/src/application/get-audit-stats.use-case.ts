import { auditStatsRepliedV1 } from '@bank/contracts';
import type { Identity } from '@bank/contracts';

import type { AuditRepository, ReplyPublisher } from './ports';

/**
 * What the trail recorded today — `D-02`'s bottom line.
 *
 * `ADMINISTRADOR` only, matching D-06 for the trail itself: this service hears
 * every event in the bank, and even its volume is a fact about everybody.
 *
 * `invalidToday` is the number worth having and the one a trail that counted
 * only successes would hide. A message this service cannot parse is recorded
 * `INVALID` rather than parked — precisely so somebody can see that it
 * happened — and a dashboard that omitted it would undo that decision.
 *
 * `lastEventType` is a **message name**, never a payload. It says the system is
 * alive and what it was last doing, and carries nothing about anyone.
 */
export class GetAuditStatsUseCase {
  readonly #repository: AuditRepository;
  readonly #publisher: ReplyPublisher;

  constructor(dependencies: {
    readonly repository: AuditRepository;
    readonly publisher: ReplyPublisher;
  }) {
    this.#repository = dependencies.repository;
    this.#publisher = dependencies.publisher;
  }

  public async execute(identity: Identity | null): Promise<void> {
    const stats =
      identity?.role === 'ADMINISTRADOR'
        ? await this.#repository.stats()
        : {
            eventsToday: 0,
            invalidToday: 0,
            notificationsToday: 0,
            lastEventType: null,
            lastEventAt: null,
            infoToday: 0,
            warningToday: 0,
            errorToday: 0,
          };

    await this.#publisher.reply({
      messageType: auditStatsRepliedV1.name,
      payload: stats,
    });
  }
}
