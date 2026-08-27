import {
  notificationFor,
  simulatedRecipientFor,
  subjectCustomerIdFrom,
} from '../domain/notification';
import type { RecordOutcome } from '../domain/deduplication';
import type {
  AuditRepository,
  Clock,
  IdGenerator,
  InboundRecord,
  NotificationSender,
} from './ports';

/**
 * Write down what happened, and tell whoever it happened to.
 *
 * The order is the guarantee, and it is not the obvious one. The trail row and
 * the notification row are written in **one transaction**, deduplicated before
 * either — so a redelivery produces neither a second record nor a second
 * notification, and that is a unique constraint rather than a check. The
 * *sending* happens afterwards, outside the transaction, on purpose:
 *
 * - A send inside the transaction would hold a database lock open for the
 *   length of a delivery, and a real provider one day makes that seconds.
 * - A crash between the commit and the send leaves a `PENDING` row, which is
 *   the honest state and a recoverable one. A crash between a send and a commit
 *   would leave a notification delivered and unrecorded, which is neither.
 *
 * Nothing here throws for a business outcome. A duplicate and an invalid
 * payload are both normal in a system with retries, and throwing would send
 * them down the retry ladder to produce the identical answer three more times
 * before landing in a dead-letter queue where somebody would investigate
 * correct behaviour. What does throw is a failure of *this* service —
 * a database that will not answer — because that one genuinely is worth
 * retrying.
 */
export class RecordEventUseCase {
  readonly #repository: AuditRepository;
  readonly #sender: NotificationSender;
  readonly #clock: Clock;
  readonly #ids: IdGenerator;

  constructor(dependencies: {
    repository: AuditRepository;
    sender: NotificationSender;
    clock: Clock;
    ids: IdGenerator;
  }) {
    this.#repository = dependencies.repository;
    this.#sender = dependencies.sender;
    this.#clock = dependencies.clock;
    this.#ids = dependencies.ids;
  }

  public async execute(input: {
    readonly event: InboundRecord;
    /** Whoever the flow is acting for, for the simulated address. */
    readonly customerId: string | null;
  }): Promise<RecordOutcome> {
    const now = this.#clock.now();

    /**
     * A message this service could not read is recorded and never notified.
     * Notifying on a payload that failed its own contract would mean telling
     * somebody their transfer completed on the strength of a message whose
     * `transactionId` might not be a `transactionId` at all.
     */
    const intent =
      input.event.processingStatus === 'PROCESSED'
        ? notificationFor(input.event.messageType, input.event.payload)
        : null;

    /*
     * Everything the notification needs, decided in one place so nothing below
     * has to ask whether there is one. The id is minted before the write so the
     * row and the delivery name the same notification without a read between.
     */
    const planned =
      intent === null
        ? null
        : {
            notificationId: this.#ids.next(),
            intent,
            /**
             * The envelope's identity first, and the payload's subject when it
             * is absent. Public registration is the one flow with no session,
             * and it is the one that most needs to be told anything — see
             * `subjectCustomerIdFrom`.
             */
            recipient: simulatedRecipientFor(
              input.customerId ??
                subjectCustomerIdFrom(input.event.messageType, input.event.payload),
            ),
          };

    const outcome = await this.#repository.record({
      event: input.event,
      notification: planned,
      now,
    });

    if (outcome.kind !== 'RECORDED' || planned === null) {
      return outcome;
    }

    const status = await this.#sender.send({
      notificationId: planned.notificationId,
      type: planned.intent.type,
      recipient: planned.recipient,
      subject: planned.intent.subject,
      correlationId: input.event.correlationId,
      ...(planned.intent.link === undefined ? {} : { link: planned.intent.link }),
    });

    await this.#repository.settleNotification({
      notificationId: planned.notificationId,
      status,
      processedAt: this.#clock.now(),
    });

    return { kind: 'RECORDED', notified: true };
  }
}
