import { deadLetterHeaders, deadLetterQueueFor } from '../src/dead-letter';
import { ATTEMPT_HEADER, RetryPolicy } from '../src/retry-policy';

describe('RetryPolicy', () => {
  const policy = new RetryPolicy();

  it('allows three retries by default, so four deliveries in total', () => {
    expect(policy.maxRetries).toBe(3);
  });

  it('waits one second, then five, then thirty', () => {
    expect(policy.decide(1)).toEqual({ kind: 'retry', attempt: 1, delayMs: 1_000 });
    expect(policy.decide(2)).toEqual({ kind: 'retry', attempt: 2, delayMs: 5_000 });
    expect(policy.decide(3)).toEqual({ kind: 'retry', attempt: 3, delayMs: 30_000 });
  });

  it('stops after the third retry rather than looping', () => {
    expect(policy.decide(4)).toEqual({ kind: 'dead-letter', attempt: 4 });
  });

  it('treats a delivery with no attempt header as the first attempt', () => {
    expect(policy.attemptOf(undefined)).toBe(1);
    expect(policy.attemptOf({})).toBe(1);
  });

  it('reads the attempt a previous consumer recorded', () => {
    expect(policy.attemptOf({ [ATTEMPT_HEADER]: 3 })).toBe(3);
  });

  it('ignores a nonsense attempt header instead of trusting it', () => {
    expect(policy.attemptOf({ [ATTEMPT_HEADER]: 'many' })).toBe(1);
    expect(policy.attemptOf({ [ATTEMPT_HEADER]: -2 })).toBe(1);
  });

  it('names the waiting queue after the queue that failed', () => {
    expect(policy.retryQueueFor('audit.all', 30_000)).toBe('audit.all.retry.30s');
  });

  it('refuses a zero delay, which would be a tight loop', () => {
    expect(() => new RetryPolicy({ delaysMs: [0] })).toThrow(/tight loop/);
  });

  it('lets the ladder be configured, and the length is the retry count', () => {
    expect(new RetryPolicy({ delaysMs: [100, 200] }).maxRetries).toBe(2);
  });
});

describe('dead-letter headers', () => {
  it('records the cause, the attempt and the original routing key', () => {
    const headers = deadLetterHeaders({
      attempt: 4,
      kind: 'handler-error',
      reason: 'database unavailable',
      routingKey: 'account.debited.v1',
      failedAt: '2026-08-19T14:32:07.482Z',
    });

    expect(headers).toEqual({
      'x-attempt': 4,
      'x-failure-reason': 'handler-error: database unavailable',
      'x-failed-at': '2026-08-19T14:32:07.482Z',
      'x-original-routing-key': 'account.debited.v1',
    });
  });

  it('distinguishes a message that could never have worked from one that failed', () => {
    const invalid = deadLetterHeaders({
      attempt: 1,
      kind: 'invalid',
      reason: 'unknown message type',
      routingKey: 'account.debited.v9',
    });

    expect(invalid['x-failure-reason']).toMatch(/^invalid:/);
  });

  it('truncates the reason so a stack trace cannot ride into the queue', () => {
    const headers = deadLetterHeaders({
      attempt: 1,
      kind: 'handler-error',
      reason: 'x'.repeat(2_000),
      routingKey: 'a.b.v1',
    });

    expect(String(headers['x-failure-reason']).length).toBe(512);
  });

  it('names the terminal queue after the work queue', () => {
    expect(deadLetterQueueFor('transaction.saga')).toBe('transaction.saga.dlq');
  });
});
