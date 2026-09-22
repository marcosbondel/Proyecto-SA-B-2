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
    readonly severity: 'INFO' | 'WARNING' | 'ERROR';
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
          html: htmlBody(notification.subject, link, notification.type),
          text: textBody(notification.subject, link, notification.type),
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

function htmlBody(subject: string, link: string | undefined, type?: string): string {
  const safeSubject = escapeHtml(subject);
  let content = '';

  if (type === 'identity.rejected' || type === 'kyc.rejected') {
    content =
      `<div style="display:inline-block;background-color:#FEF2F2;color:#DC2626;border:1px solid #FCA5A5;padding:4px 12px;border-radius:9999px;font-size:12px;font-weight:600;margin-bottom:18px;">` +
      `Verificación de identidad no aprobada` +
      `</div>` +
      `<p style="color:#334155;font-size:15px;line-height:1.6;margin:0 0 16px 0;">` +
      `Estimado cliente, te informamos que la verificación digital de tu documento de identificación no pudo ser aprobada.` +
      `</p>` +
      `<p style="color:#64748B;font-size:14px;line-height:1.5;margin:0 0 20px 0;">` +
      `Para garantizar la seguridad de tu cuenta y en cumplimiento con la normativa bancaria, las funciones de transferencias y pagos se encuentran inhabilitadas de momento.` +
      `</p>` +
      `<div style="background-color:#FFFBEB;border:1px solid #FDE68A;border-radius:10px;padding:16px 20px;margin:20px 0;">` +
      `<p style="margin:0 0 8px 0;font-size:14px;font-weight:700;color:#92400E;">¿Cómo validar tu identidad?</p>` +
      `<p style="margin:0;font-size:13px;color:#78350F;line-height:1.6;">` +
      `Por favor acércate a cualquier agencia bancaria de <strong>Bank USAC</strong> presentando tu <strong>Documento Personal de Identificación (DPI) en físico</strong>. Un cajero receptor o administrador validará tu identidad de inmediato en ventanilla para habilitar todas las operaciones de tu cuenta.` +
      `</p>` +
      `</div>`;
  } else if (link !== undefined) {
    const safeLink = escapeHtml(link);
    content =
      `<p style="color:#334155;font-size:15px;line-height:1.6;margin:0 0 20px 0;">` +
      `¡Bienvenido a <strong>bonking</strong>! Gracias por registrarte en la banca digital de Bank USAC. Para comenzar a utilizar tu cuenta y acceder a la plataforma, pulsa el botón siguiente para confirmar tu correo:` +
      `</p>` +
      `<div style="text-align:center;margin:32px 0;">` +
      `<a href="${safeLink}" target="_blank" style="background-color:#0F172A;color:#FFFFFF !important;font-size:15px;font-weight:600;padding:14px 32px;border-radius:8px;text-decoration:none;display:inline-block;letter-spacing:0.02em;box-shadow:0 2px 4px rgba(15,23,42,0.15);">` +
      `Activar mi cuenta` +
      `</a>` +
      `</div>` +
      `<p style="color:#64748B;font-size:13px;line-height:1.5;margin:24px 0 12px 0;">` +
      `Una vez activada tu cuenta, podrás ingresar al sistema de inmediato. Mientras el personal valida tu documento de identidad, podrás explorar tu cuenta; las transferencias y pagos se habilitarán tan pronto concluya la verificación.` +
      `</p>` +
      `<div style="background-color:#F8FAFC;border:1px solid #E2E8F0;border-radius:8px;padding:12px 16px;margin-top:20px;">` +
      `<p style="margin:0 0 6px 0;font-size:12px;font-weight:600;color:#64748B;">¿El botón no funciona? Copia y pega este enlace en tu navegador:</p>` +
      `<p style="margin:0;font-size:12px;color:#0284C7;word-break:break-all;font-family:ui-monospace,SFMono-Regular,Consolas,monospace;">${safeLink}</p>` +
      `</div>`;
  }

  return (
    `<!DOCTYPE html>` +
    `<html lang="es">` +
    `<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>` +
    `<body style="margin:0;padding:0;background-color:#F1F5F9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased;">` +
    `<div style="width:100%;max-width:560px;margin:32px auto;padding:0 16px;box-sizing:border-box;">` +
    `<div style="background-color:#FFFFFF;border-radius:12px;border:1px solid #E2E8F0;overflow:hidden;box-shadow:0 4px 6px -1px rgba(0,0,0,0.06);">` +
    `<div style="background-color:#0F172A;padding:24px 32px;">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>` +
    `<td>` +
    `<span style="display:inline-block;background-color:#FFFFFF;color:#0F172A;font-weight:800;font-size:12px;padding:3px 8px;border-radius:6px;margin-right:10px;font-family:monospace;">bk</span>` +
    `<span style="color:#FFFFFF;font-weight:700;font-size:18px;letter-spacing:-0.02em;">bonking</span>` +
    `<span style="color:#64748B;font-size:14px;margin-left:8px;">· Bank USAC</span>` +
    `</td>` +
    `</tr></table>` +
    `</div>` +
    `<div style="padding:32px 32px 28px 32px;">` +
    `<h1 style="font-size:20px;font-weight:700;color:#0F172A;margin:0 0 16px 0;line-height:1.3;">${safeSubject}</h1>` +
    content +
    `<hr style="border:none;border-top:1px solid #E2E8F0;margin:28px 0 20px 0;">` +
    `<p style="color:#94A3B8;font-size:12px;line-height:1.5;margin:0;text-align:center;">` +
    `Bank USAC · Proyecto de Software Avanzado<br>` +
    `Este correo fue generado automáticamente. Por favor no respondas a este mensaje.` +
    `</p>` +
    `</div>` +
    `</div>` +
    `</div>` +
    `</body></html>`
  );
}

function textBody(subject: string, link: string | undefined, type?: string): string {
  if (type === 'identity.rejected' || type === 'kyc.rejected') {
    return (
      `${subject}\n\n` +
      `Estimado cliente,\n\n` +
      `Te informamos que la verificación digital de tu documento de identificación no pudo ser aprobada.\n\n` +
      `Por favor acércate a cualquier agencia bancaria de Bank USAC presentando tu Documento Personal de Identificación (DPI) en físico. ` +
      `Un cajero receptor o administrador validará tu identidad de inmediato en ventanilla para habilitar todas las operaciones de tu cuenta (transferencias y pagos).\n\n` +
      `Bank USAC · Proyecto de Software Avanzado`
    );
  }
  if (link !== undefined) {
    return (
      `${subject}\n\n` +
      `¡Bienvenido a bonking! Gracias por registrarte en la banca digital de Bank USAC.\n\n` +
      `Para activar tu cuenta, ingresa al siguiente enlace:\n${link}\n\n` +
      `Una vez activada tu cuenta, podrás ingresar al sistema de inmediato.\n\n` +
      `Bank USAC · Proyecto de Software Avanzado`
    );
  }
  return subject;
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
