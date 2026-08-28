import type { DeliveryLog, NotificationSender } from '../../application/ports';

/** The single outbound HTTP dependency, injected so a test decides the response. */
type FetchLike = typeof globalThis.fetch;

export interface ResendConfig {
  /** The Resend API key. Never logged, never stored. */
  readonly apiKey: string;
  /** The verified sender, e.g. `bonking <no-reply@mail.tudominio.com>`. */
  readonly from: string;
  /** The frontend's public origin, prepended to the activation path. */
  readonly appBaseUrl: string;
  /** The Resend emails endpoint. Configurable so a test points it elsewhere. */
  readonly endpoint: string;
}

/**
 * The real delivery channel: an email actually leaves the system, through
 * Resend.
 *
 * This is the one place in the service that reaches the network, and it reaches
 * a **third-party email provider** — not another bank service. The
 * asynchronous-only rule the project enforces is about the five microservices
 * talking to each other; delivering an email to a SaaS is exactly what a
 * notification service is for (§4.1 even anticipates external integration).
 * `test/isolation.spec.ts` pins that boundary: HTTP may originate here and
 * nowhere else.
 *
 * **It never throws**, for the same reason the simulated channel does not: a
 * throw would put a failed delivery on the retry ladder, the redelivery would
 * be refused as a duplicate by `RecordEventUseCase`, and the send would never
 * be retried. A failure is a `FAILED` status on a row somebody can see.
 *
 * **It delivers to a real inbox only when the message carries one.** By design
 * that is the activation email alone (`deliverableEmailFrom`); every other
 * notification has only the simulated address, so this hands those to the
 * simulated `fallback` unchanged. The real address is used to send and never
 * written anywhere — the audit database still stores the simulated recipient.
 */
export class ResendNotificationAdapter implements NotificationSender {
  readonly #config: ResendConfig;
  readonly #logger: DeliveryLog;
  readonly #fallback: NotificationSender;
  readonly #fetch: FetchLike;

  constructor(
    config: ResendConfig,
    logger: DeliveryLog,
    fallback: NotificationSender,
    fetchFn: FetchLike = globalThis.fetch,
  ) {
    this.#config = config;
    this.#logger = logger;
    this.#fallback = fallback;
    this.#fetch = fetchFn;
  }

  public async send(notification: {
    readonly notificationId: string;
    readonly type: string;
    readonly recipient: string | null;
    readonly subject: string;
    readonly correlationId: string;
    readonly link?: string;
    readonly deliveryAddress?: string | null;
  }): Promise<'SENT' | 'FAILED'> {
    // Parity with the simulated channel: no stored recipient means nothing was
    // ever meant to be delivered, and a claim otherwise is the one lie the
    // audit trail could not catch.
    if (notification.recipient === null) {
      this.#logger.warn('notification has no recipient', {
        notificationId: notification.notificationId,
        notificationType: notification.type,
        correlationId: notification.correlationId,
        outcome: 'FAILED',
      });

      return 'FAILED';
    }

    // Only the activation email carries a real inbox. Everything else has no
    // real address by design, so it stays simulated.
    const to = notification.deliveryAddress ?? null;
    if (to === null) {
      return await this.#fallback.send(notification);
    }

    const link =
      notification.link === undefined
        ? undefined
        : `${this.#config.appBaseUrl.replace(/\/+$/, '')}${notification.link}`;

    try {
      const response = await this.#fetch(this.#config.endpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.#config.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: this.#config.from,
          to: [to],
          subject: notification.subject,
          html: htmlBody(notification.subject, link),
          text: textBody(notification.subject, link),
        }),
      });

      if (!response.ok) {
        const detail = await safeBody(response);

        this.#logger.warn('email provider refused the delivery', {
          notificationId: notification.notificationId,
          notificationType: notification.type,
          correlationId: notification.correlationId,
          outcome: 'FAILED',
          providerStatus: String(response.status),
          providerError: detail,
        });

        return 'FAILED';
      }

      // The token lives inside `link`, so the provider's id is logged, never the
      // body. `customer.activation.requested.v1` says the token must not be
      // echoed, and this obeys it in every environment.
      const providerId = await providerMessageId(response);

      this.#logger.info('email sent', {
        notificationId: notification.notificationId,
        notificationType: notification.type,
        correlationId: notification.correlationId,
        outcome: 'SENT',
        ...(providerId === null ? {} : { providerMessageId: providerId }),
      });

      return 'SENT';
    } catch (error) {
      this.#logger.warn('email provider was unreachable', {
        notificationId: notification.notificationId,
        notificationType: notification.type,
        correlationId: notification.correlationId,
        outcome: 'FAILED',
        error: error instanceof Error ? error.message : String(error),
      });

      return 'FAILED';
    }
  }
}

function htmlBody(subject: string, link: string | undefined): string {
  const safeSubject = escapeHtml(subject);
  const action =
    link === undefined
      ? ''
      : `<p style="margin:24px 0"><a href="${escapeHtml(link)}" ` +
        `style="background:#111;color:#fff;padding:12px 20px;border-radius:8px;` +
        `text-decoration:none;display:inline-block">Activar mi cuenta</a></p>` +
        `<p style="color:#5A5B63;font-size:13px">Si el botón no funciona, copia este enlace:<br>` +
        `<span style="word-break:break-all">${escapeHtml(link)}</span></p>`;

  return (
    `<div style="font-family:system-ui,-apple-system,sans-serif;max-width:520px;margin:0 auto">` +
    `<h1 style="font-size:20px">bonking · Bank USAC</h1>` +
    `<h2 style="font-size:16px;font-weight:600">${safeSubject}</h2>` +
    action +
    `<hr style="border:none;border-top:1px solid #eee;margin:24px 0">` +
    `<p style="color:#9095a0;font-size:12px">Este correo se envió de forma automática. ` +
    `Si no reconoces esta solicitud, puedes ignorarlo.</p>` +
    `</div>`
  );
}

function textBody(subject: string, link: string | undefined): string {
  return link === undefined ? subject : `${subject}\n\nActiva tu cuenta: ${link}`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** The provider's message id, or `null` — never the body, which holds the link. */
async function providerMessageId(response: Response): Promise<string | null> {
  try {
    const parsed = (await response.clone().json()) as { id?: unknown };
    return typeof parsed.id === 'string' ? parsed.id : null;
  } catch {
    return null;
  }
}

/** A short error detail for the log, safe to read even on a non-JSON body. */
async function safeBody(response: Response): Promise<string> {
  try {
    return (await response.clone().text()).slice(0, 300);
  } catch {
    return '';
  }
}
