import { SimulatedNotificationAdapter } from '../src/infrastructure/notification/simulated-notification.adapter';
import { notificationFor } from '../src/domain/notification';

/**
 * The delivery channel, and the one place in this system where a clear
 * activation token is written down.
 *
 * The gate is worth a test of its own because both halves of it are load
 * bearing and they fail in opposite directions: with the link always on, a
 * production log becomes a list of working account-takeover URLs; with it
 * always off, nobody can create an account on their own machine, because this
 * service now drains the queue the token used to be readable from. TD-043.
 */

class Sink {
  public readonly lines: {
    level: 'info' | 'warn';
    message: string;
    fields: Record<string, string | undefined>;
  }[] = [];

  public info(message: string, fields: Record<string, string | undefined>): void {
    this.lines.push({ level: 'info', message, fields });
  }

  public warn(message: string, fields: Record<string, string | undefined>): void {
    this.lines.push({ level: 'warn', message, fields });
  }
}

const delivery = {
  notificationId: '11111111-4d7b-4f0e-9c1e-0242ac120002',
  type: 'customer.activation',
  recipient: 'cliente-3f2a1c04@simulado.bonking.gt',
  subject: 'Activa tu cuenta de bonking',
  correlationId: '7d41e8b2-9a3f-4c15-8ee0-1b2f9a4c7d10',
  severity: 'INFO' as const,
  link: '/activar?token=abcdef0123456789abcdef',
};

describe('the simulated delivery channel', () => {
  it('reports a delivery as sent, and never throws', async () => {
    const sink = new Sink();

    await expect(new SimulatedNotificationAdapter(sink).send(delivery)).resolves.toBe('SENT');
  });

  /**
   * An `ERROR`-severity notification is about a flow that had to be undone —
   * worth an operator's attention in the logs, even though the simulated
   * delivery to the customer succeeds exactly the same way as any other.
   */
  it('logs an ERROR-severity delivery as a warning, not as info', async () => {
    const sink = new Sink();

    await new SimulatedNotificationAdapter(sink).send({ ...delivery, severity: 'ERROR' });

    expect(sink.lines).toHaveLength(1);
    expect(sink.lines[0]?.level).toBe('warn');
    expect(sink.lines[0]?.message).toBe('notification sent (simulated)');
    expect(sink.lines[0]?.fields.severity).toBe('ERROR');
  });

  it('logs an INFO or WARNING delivery as info, not as a warning', async () => {
    const sink = new Sink();

    await new SimulatedNotificationAdapter(sink).send({ ...delivery, severity: 'WARNING' });

    expect(sink.lines[0]?.level).toBe('info');
    expect(sink.lines[0]?.fields.severity).toBe('WARNING');
  });

  /**
   * Nothing was delivered, and a simulation that claimed otherwise would be the
   * one lie in the system the audit trail could not catch.
   */
  it('reports a delivery with no recipient as failed', async () => {
    const sink = new Sink();

    await expect(
      new SimulatedNotificationAdapter(sink).send({ ...delivery, recipient: null }),
    ).resolves.toBe('FAILED');
  });

  it('writes no link when it was not told to reveal one', async () => {
    const sink = new Sink();

    await new SimulatedNotificationAdapter(sink, false).send(delivery);

    expect(sink.lines[0]?.fields.deliveryLink).toBeUndefined();
    expect(JSON.stringify(sink.lines)).not.toContain('abcdef0123456789abcdef');
  });

  it('writes the link when it was, so a developer can finish signing up', async () => {
    const sink = new Sink();

    await new SimulatedNotificationAdapter(sink, true).send(delivery);

    expect(sink.lines[0]?.fields.deliveryLink).toBe('/activar?token=abcdef0123456789abcdef');
  });

  /** Only the activation message carries one; nothing else can leak through. */
  it('has no link to reveal for any other notification', async () => {
    const sink = new Sink();

    await new SimulatedNotificationAdapter(sink, true).send({
      ...delivery,
      type: 'transfer.completed',
      link: undefined,
    });

    expect(sink.lines[0]?.fields.deliveryLink).toBeUndefined();
  });
});

describe('which messages produce a link at all', () => {
  it('builds one only from the activation event', () => {
    const intent = notificationFor('customer.activation.requested.v1', {
      customerId: '3f2a1c04-9c2e-4a71-b8f5-2d6e7c0a1b93',
      activationToken: 'abcdef0123456789abcdef',
    });

    expect(intent?.link).toBe('/activar?token=abcdef0123456789abcdef');
  });

  it('builds none for any other notifying message', () => {
    expect(notificationFor('transaction.completed.v1', { transactionId: 'tx' })?.link).toBe(
      undefined,
    );
  });

  it('builds none when the event carries no token', () => {
    expect(
      notificationFor('customer.activation.requested.v1', { customerId: 'cus-1' })?.link,
    ).toBe(undefined);
  });

  /** A token with URL-unsafe characters must survive the round trip intact. */
  it('escapes the token so the link is usable as written', () => {
    const intent = notificationFor('customer.activation.requested.v1', {
      activationToken: 'a+b/c=d1234567890123',
    });

    expect(intent?.link).toBe('/activar?token=a%2Bb%2Fc%3Dd1234567890123');
  });
});
