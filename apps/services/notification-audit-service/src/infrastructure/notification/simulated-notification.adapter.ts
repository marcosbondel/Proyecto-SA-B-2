import { maskQueryParams } from '@bank/observability';

import type { DeliveryLog, NotificationSender } from '../../application/ports';

/** What replaces the token in a link logged with revealing off. */
const MASKED_VALUE = '***';

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
    readonly severity: 'INFO' | 'WARNING' | 'ERROR';
    readonly link?: string;
    /** A real channel delivers here; the simulation has no inbox and ignores it. */
    readonly deliveryAddress?: string | null;
  }): Promise<'SENT' | 'FAILED'> {
    if (notification.recipient === null) {
      this.#logger.warn('notification has no recipient', {
        notificationId: notification.notificationId,
        notificationType: notification.type,
        correlationId: notification.correlationId,
        severity: notification.severity,
        outcome: 'FAILED',
      });

      return await Promise.resolve('FAILED');
    }

    /**
     * `ERROR` gets a `warn` log line rather than `info`, on the same basis the
     * severity itself is decided: this is a notification about a flow that had
     * to be undone, worth an operator's attention in the logs even though the
     * simulated delivery to the customer succeeds exactly the same way.
     */
    const fields = {
      notificationId: notification.notificationId,
      notificationType: notification.type,
      correlationId: notification.correlationId,
      severity: notification.severity,
      outcome: 'SENT' as const,
      /**
       * The one place a clear token — an activation link or a password-reset
       * one — can be written down, and it is closed unless asked for.
       *
       * `customer.activation.requested.v1` says the token "must never be logged
       * or echoed". With `revealLinks` off — the chart's default, and the only
       * value that is acceptable anywhere a stranger can read the log (Loki is
       * one) — the line still names the link, so an operator can see *that* an
       * activation was sent and to which screen, but the token is masked:
       * `/activar?token=***`. Dropping the field instead would have made the
       * line useless for the support question "did the email go out?".
       *
       * With it on, outside production, the full link is written: the
       * behaviour of every local mail catcher — MailHog, Mailpit, Rails'
       * `letter_opener` — for the same reason they exist: the alternative is
       * that nobody can create an account on their own machine. Recorded as
       * TD-043. T-60 reverted the chart's default to off (§8.3, "Datos
       * sensibles expuestos"); the kind values file turns it back on.
       */
      ...(notification.link === undefined
        ? {}
        : {
            deliveryLink: this.#revealLinks
              ? notification.link
              : maskQueryParams(notification.link, MASKED_VALUE),
          }),
    };

    if (notification.severity === 'ERROR') {
      this.#logger.warn('notification sent (simulated)', fields);
    } else {
      this.#logger.info('notification sent (simulated)', fields);
    }

    return await Promise.resolve('SENT');
  }
}
