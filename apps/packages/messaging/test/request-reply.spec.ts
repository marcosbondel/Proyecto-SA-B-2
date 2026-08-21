import { createEnvelope } from '@bank/contracts';

import { ReplyRegistry, ReplyTimeoutError, replyQueueName } from '../src/request-reply';

const reply = (correlationId: string) =>
  createEnvelope(
    { outcome: 'FOUND' },
    {
      messageType: 'account.balance.replied.v1',
      producer: 'account-service',
      identity: null,
      correlationId,
    },
  );

describe('ReplyRegistry', () => {
  it('hands a reply to the caller that was waiting for it', async () => {
    const registry = new ReplyRegistry();
    const waiting = registry.waitFor('corr-1');

    expect(registry.settle(reply('corr-1'))).toBe(true);
    await expect(waiting).resolves.toMatchObject({ correlationId: 'corr-1' });
  });

  it('matches by correlation id and not by arrival order', async () => {
    const registry = new ReplyRegistry();
    const first = registry.waitFor('corr-1');
    const second = registry.waitFor('corr-2');

    registry.settle(reply('corr-2'));
    registry.settle(reply('corr-1'));

    await expect(second).resolves.toMatchObject({ correlationId: 'corr-2' });
    await expect(first).resolves.toMatchObject({ correlationId: 'corr-1' });
  });

  it('gives up after the timeout instead of waiting forever', async () => {
    const registry = new ReplyRegistry({ timeoutMs: 5 });

    await expect(registry.waitFor('corr-3')).rejects.toBeInstanceOf(ReplyTimeoutError);
  });

  it('says plainly that a timeout cancelled nothing', async () => {
    const registry = new ReplyRegistry({ timeoutMs: 5 });

    await expect(registry.waitFor('corr-4')).rejects.toThrow(/was not cancelled/);
  });

  it('leaves nothing pending after a timeout, so no promise leaks', async () => {
    const registry = new ReplyRegistry({ timeoutMs: 5 });

    await expect(registry.waitFor('corr-5')).rejects.toThrow();
    expect(registry.pendingCount).toBe(0);
  });

  it('leaves nothing pending after a reply', async () => {
    const registry = new ReplyRegistry();
    const waiting = registry.waitFor('corr-6');
    registry.settle(reply('corr-6'));
    await waiting;

    expect(registry.pendingCount).toBe(0);
  });

  it('discards a reply nobody is waiting for rather than failing', () => {
    expect(new ReplyRegistry().settle(reply('corr-unknown'))).toBe(false);
  });

  it('refuses to wait twice on one correlation', async () => {
    const registry = new ReplyRegistry({ timeoutMs: 5 });
    const first = registry.waitFor('corr-7');

    await expect(registry.waitFor('corr-7')).rejects.toThrow(/Already waiting/);
    await expect(first).rejects.toThrow();
  });

  it('fails every outstanding wait on shutdown so nothing hangs', async () => {
    const registry = new ReplyRegistry();
    const waiting = registry.waitFor('corr-8');

    registry.abortAll('shutting down');

    await expect(waiting).rejects.toThrow(/shutting down/);
    expect(registry.pendingCount).toBe(0);
  });
});

describe('reply queue naming', () => {
  it('is private to one instance, never shared between replicas', () => {
    expect(replyQueueName('gateway', 'abc123')).toBe('gateway.replies.abc123');
    expect(replyQueueName('gateway', 'abc123')).not.toBe(replyQueueName('gateway', 'def456'));
  });
});
