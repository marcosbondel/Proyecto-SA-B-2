import type { DeliveryLog, NotificationSender } from '../../application/ports';

/**
 * The delivery channel, simulated — which the assignment asks for outright
 * (§4.1, "notificaciones simuladas").
 *
 * It writes a log line and reports `SENT`. That is the whole adapter, and
 * making it an adapter rather than three lines inside the use case is what
 * keeps the pretence in one file: everything above this line is written as
 * though the delivery were real, so the day a provider arrives, nothing above
 * changes.
 *
 * **It never throws.** A sender that threw would put a failed delivery on the
 * retry ladder, and the redelivery would re-enter `RecordEventUseCase`, be
 * refused as a duplicate, and never retry the send at all — a ladder that
 * cannot climb. A failed delivery is a `FAILED` status on a row somebody can
 * see, which is both true and actionable.
 *
 * A recipient of `null` is reported `FAILED` rather than `SENT`. Nothing was
 * delivered, and a simulation that claimed otherwise would be the one lie in
 * the system that the audit trail could not catch.
 */
export class SimulatedNotificationAdapter implements NotificationSender {
  readonly #logger: DeliveryLog;
  readonly #revealLinks: boolean;

  /**
   * `revealLinks` is the mailcatcher switch, and it is a constructor argument
   * rather than a read of `process.env` so that the environment stays something
   * `main.ts` decides and this class merely obeys — and so a test can assert
   * both halves of the behaviour without setting a global.
   */
  constructor(logger: DeliveryLog, revealLinks = false) {
    this.#logger = logger;
    this.#revealLinks = revealLinks;
  }

  public async send(notification: {
    readonly notificationId: string;
    readonly type: string;
    readonly recipient: string | null;
    readonly subject: string;
    readonly correlationId: string;
    readonly link?: string;
    /** A real channel delivers here; the simulation has no inbox and ignores it. */
    readonly deliveryAddress?: string | null;
  }): Promise<'SENT' | 'FAILED'> {
    if (notification.recipient === null) {
      this.#logger.warn('notification has no recipient', {
        notificationId: notification.notificationId,
        notificationType: notification.type,
        correlationId: notification.correlationId,
        outcome: 'FAILED',
      });

      return await Promise.resolve('FAILED');
    }

    this.#logger.info('notification sent (simulated)', {
      notificationId: notification.notificationId,
      notificationType: notification.type,
      correlationId: notification.correlationId,
      outcome: 'SENT',
      /**
       * The one place a clear activation token is written down, and it is
       * closed in production.
       *
       * `customer.activation.requested.v1` says the token "must never be logged
       * or echoed", and outside a developer's machine this obeys that: the
       * field is absent, the audit trail redacts it, and no row anywhere stores
       * it. What is left in development is the behaviour of every local mail
       * catcher — MailHog, Mailpit, Rails' `letter_opener` — for the same
       * reason they exist: the alternative is that nobody can create an account
       * on their own machine.
       *
       * Before T-20 the token was readable because nothing consumed the audit
       * queue and it sat in RabbitMQ's management UI. Now this service drains
       * that queue, so without this line the local sign-up loop closes
       * completely. Recorded as TD-043.
       */
      ...(this.#revealLinks && notification.link !== undefined
        ? { activationLink: notification.link }
        : {}),
    });

    return await Promise.resolve('SENT');
  }
}
