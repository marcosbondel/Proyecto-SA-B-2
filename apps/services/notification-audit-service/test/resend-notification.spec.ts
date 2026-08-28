import { ResendNotificationAdapter } from '../src/infrastructure/notification/resend-notification.adapter';
import type { ResendConfig } from '../src/infrastructure/notification/resend-notification.adapter';
import type { NotificationSender } from '../src/application/ports';

/**
 * The real delivery channel.
 *
 * The assertions that carry weight are the ones about what it does NOT do:
 * it never throws, it delivers to a real inbox only when the message carries
 * one, and it hands everything else to the simulated fallback. The token lives
 * in the link, so the test also checks the link is absolute and the address is
 * the real one — never the simulated recipient stored in the trail.
 */

class Sink {
  public readonly lines: { message: string; fields: Record<string, string | undefined> }[] = [];
  public info(message: string, fields: Record<string, string | undefined>): void {
    this.lines.push({ message, fields });
  }
  public warn(message: string, fields: Record<string, string | undefined>): void {
    this.lines.push({ message, fields });
  }
}

class RecordingFallback implements NotificationSender {
  public calls = 0;
  public async send(): Promise<'SENT' | 'FAILED'> {
    this.calls += 1;
    return 'SENT';
  }
}

const CONFIG: ResendConfig = {
  apiKey: 're_test_key',
  from: 'bonking <no-reply@mail.example.com>',
  appBaseUrl: 'https://app.example.com',
  endpoint: 'https://api.resend.com/emails',
};

const ACTIVATION = {
  notificationId: '11111111-4d7b-4f0e-9c1e-0242ac120002',
  type: 'customer.activation',
  recipient: 'cliente-3f2a1c04@simulado.bonking.gt',
  subject: 'Activa tu cuenta de bonking',
  correlationId: '7d41e8b2-9a3f-4c15-8ee0-1b2f9a4c7d10',
  link: '/activar?token=abcdef0123456789abcdef',
  deliveryAddress: 'ricardo@correo-real.com',
};

/** A fetch double that records the request and returns a chosen response. */
function fetchReturning(status: number, body: unknown): { fn: typeof fetch; calls: RequestInit[] } {
  const calls: RequestInit[] = [];
  const fn = (async (_url: string | URL | Request, init?: RequestInit) => {
    calls.push(init ?? {});
    return new Response(JSON.stringify(body), { status });
  }) as unknown as typeof fetch;
  return { fn, calls };
}

describe('the Resend delivery channel', () => {
  it('sends a real email to the real address and reports SENT', async () => {
    const sink = new Sink();
    const fallback = new RecordingFallback();
    const { fn, calls } = fetchReturning(200, { id: 'resend-abc-123' });

    const status = await new ResendNotificationAdapter(CONFIG, sink, fallback, fn).send(ACTIVATION);

    expect(status).toBe('SENT');
    expect(fallback.calls).toBe(0);
    expect(calls).toHaveLength(1);

    const body = JSON.parse(String(calls[0]?.body)) as {
      from: string;
      to: string[];
      subject: string;
      html: string;
      text: string;
    };
    expect(body.to).toEqual(['ricardo@correo-real.com']);
    expect(body.from).toBe('bonking <no-reply@mail.example.com>');
    // The link is made absolute against the frontend origin.
    expect(body.text).toContain('https://app.example.com/activar?token=abcdef0123456789abcdef');
    expect(body.html).toContain('https://app.example.com/activar?token=abcdef0123456789abcdef');
    // The provider id is logged; the token is not.
    expect(sink.lines[0]?.fields.providerMessageId).toBe('resend-abc-123');
    expect(JSON.stringify(sink.lines)).not.toContain('abcdef0123456789abcdef');
  });

  it('delegates to the simulated fallback when there is no real address', async () => {
    const sink = new Sink();
    const fallback = new RecordingFallback();
    const { fn, calls } = fetchReturning(200, { id: 'unused' });

    const status = await new ResendNotificationAdapter(CONFIG, sink, fallback, fn).send({
      notificationId: '22222222-4d7b-4f0e-9c1e-0242ac120002',
      type: 'transfer.completed',
      recipient: 'cliente-3f2a1c04@simulado.bonking.gt',
      subject: 'Tu transferencia se completó',
      correlationId: ACTIVATION.correlationId,
    });

    expect(status).toBe('SENT');
    expect(fallback.calls).toBe(1);
    expect(calls).toHaveLength(0);
  });

  it('reports FAILED with no recipient, and calls neither provider nor fallback', async () => {
    const sink = new Sink();
    const fallback = new RecordingFallback();
    const { fn, calls } = fetchReturning(200, {});

    const status = await new ResendNotificationAdapter(CONFIG, sink, fallback, fn).send({
      ...ACTIVATION,
      recipient: null,
    });

    expect(status).toBe('FAILED');
    expect(fallback.calls).toBe(0);
    expect(calls).toHaveLength(0);
  });

  it('reports FAILED when the provider refuses, and never throws', async () => {
    const sink = new Sink();
    const { fn } = fetchReturning(422, { message: 'domain not verified' });

    const status = await new ResendNotificationAdapter(
      CONFIG,
      sink,
      new RecordingFallback(),
      fn,
    ).send(ACTIVATION);

    expect(status).toBe('FAILED');
    expect(sink.lines[0]?.fields.outcome).toBe('FAILED');
  });

  it('reports FAILED when the provider is unreachable, and never throws', async () => {
    const sink = new Sink();
    const fn = (async () => {
      throw new Error('ECONNREFUSED');
    }) as unknown as typeof fetch;

    const status = await new ResendNotificationAdapter(
      CONFIG,
      sink,
      new RecordingFallback(),
      fn,
    ).send(ACTIVATION);

    expect(status).toBe('FAILED');
  });
});
