import type { MessageBroker } from '@bank/messaging';

import type { OutboxMessage, TransactionRepository } from '../src/application/ports';
import { OutboxRelay } from '../src/infrastructure/scheduler/outbox.scheduler';
import type { OutboxLog } from '../src/infrastructure/scheduler/outbox.scheduler';

/**
 * `OutboxRelay` in isolation, with a fake repository and a fake broker.
 *
 * Nothing here needs PostgreSQL or RabbitMQ: the relay's own job is the
 * orchestration around `TransactionRepository#dispatchPendingOutbox` — never
 * overlap itself, mark what actually published, leave the rest for the next
 * sweep, get out of the way on `stop()` — and every one of those is a property
 * of the scheduler, not of the database it will eventually run against.
 */

function outboxMessage(routingKey: string): OutboxMessage {
  return {
    exchange: 'bank.events',
    routingKey,
    envelope: {
      messageId: `msg-${routingKey}`,
      messageType: routingKey,
      messageVersion: 1,
      producer: 'transaction-service',
      correlationId: 'correlation-1',
      causationId: null,
      idempotencyKey: `idem-${routingKey}`,
      occurredAt: '2026-09-25T09:00:00.000Z',
      identity: null,
      payload: {},
    },
  };
}

/**
 * A minimal `TransactionRepository`. Only `dispatchPendingOutbox` is real;
 * every other member throws if the scheduler ever reached for it, which would
 * itself be worth knowing.
 */
class FakeOutboxRepository implements Partial<TransactionRepository> {
  readonly #rows: { readonly message: OutboxMessage; dispatched: boolean }[] = [];
  /** Every message `deliver` was actually called with, in call order. */
  public readonly delivered: OutboxMessage[] = [];
  public callCount = 0;
  /** Set to delay each call, so a test can hold a sweep open. */
  public delayMs = 0;
  /** When set, `deliver` for this exact routing key rejects. */
  public failRoutingKey: string | null = null;

  public enqueue(message: OutboxMessage): void {
    this.#rows.push({ message, dispatched: false });
  }

  public get pendingCount(): number {
    return this.#rows.filter((row) => !row.dispatched).length;
  }

  public dispatched(routingKey: string): boolean {
    return this.#rows.some(
      (row) => row.message.routingKey === routingKey && row.dispatched,
    );
  }

  public async dispatchPendingOutbox(
    deliver: (message: OutboxMessage) => Promise<void>,
    limit: number,
  ): Promise<number> {
    this.callCount += 1;

    if (this.delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.delayMs));
    }

    const batch = this.#rows.filter((row) => !row.dispatched).slice(0, limit);
    const succeeded: typeof batch = [];

    for (const row of batch) {
      if (this.failRoutingKey !== null && row.message.routingKey === this.failRoutingKey) {
        /**
         * Mirrors the real repository's own transaction: a failure mid-batch
         * throws the whole batch back to PENDING (`outbox.scheduler.ts`'s own
         * docstring), not only the row that failed. Nothing already delivered
         * in this call is marked either.
         */
        throw new Error(`delivery refused for ${row.message.routingKey}`);
      }

      await deliver(row.message);
      this.delivered.push(row.message);
      succeeded.push(row);
    }

    for (const row of succeeded) {
      row.dispatched = true;
    }

    return succeeded.length;
  }
}

/** A broker double that records what it was asked to publish. */
function fakeBroker(): { broker: MessageBroker; publish: jest.Mock } {
  const publish = jest.fn(async () => {
    await Promise.resolve();
  });

  return { broker: { publish } as unknown as MessageBroker, publish };
}

function fakeLogger(): OutboxLog & { readonly lines: { level: string; message: string }[] } {
  const lines: { level: string; message: string }[] = [];

  return {
    lines,
    info: (message) => lines.push({ level: 'info', message }),
    error: (message) => lines.push({ level: 'error', message }),
  };
}

describe('OutboxRelay', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('dispatches pending rows to the broker in the order they were enqueued', async () => {
    const repository = new FakeOutboxRepository();
    repository.enqueue(outboxMessage('transaction.initiated.v1'));
    repository.enqueue(outboxMessage('customer.kyc.check.requested.v1'));
    repository.enqueue(outboxMessage('account.debit.requested.v1'));
    const { broker, publish } = fakeBroker();
    const relay = new OutboxRelay({
      repository: repository as unknown as TransactionRepository,
      broker,
      intervalMs: 1_000,
      logger: fakeLogger(),
    });

    await relay.runOnce();

    expect(repository.delivered.map((message) => message.routingKey)).toEqual([
      'transaction.initiated.v1',
      'customer.kyc.check.requested.v1',
      'account.debit.requested.v1',
    ]);
    expect(publish).toHaveBeenCalledTimes(3);
    expect(publish.mock.calls[0]).toEqual([
      'bank.events',
      'transaction.initiated.v1',
      repository.delivered[0]?.envelope,
    ]);
  });

  it('marks a row dispatched after a successful publish, and never republishes it on later sweeps', async () => {
    const repository = new FakeOutboxRepository();
    repository.enqueue(outboxMessage('transaction.completed.v1'));
    const { broker, publish } = fakeBroker();
    const relay = new OutboxRelay({
      repository: repository as unknown as TransactionRepository,
      broker,
      intervalMs: 1_000,
      logger: fakeLogger(),
    });

    await relay.runOnce();
    // Two further sweeps: the row is still physically present in the fake's
    // storage (dispatched rows are not deleted, only flagged), so this proves
    // the exclusion is by state and not by the row having merely vanished.
    await relay.runOnce();
    await relay.runOnce();

    expect(repository.dispatched('transaction.completed.v1')).toBe(true);
    expect(repository.delivered).toHaveLength(1);
    expect(repository.pendingCount).toBe(0);
    expect(publish).toHaveBeenCalledTimes(1);
  });

  it('leaves the batch PENDING and logs, rather than dropping it, when the broker refuses', async () => {
    const repository = new FakeOutboxRepository();
    repository.enqueue(outboxMessage('payment.requested.v1'));
    repository.failRoutingKey = 'payment.requested.v1';
    const { broker } = fakeBroker();
    const logger = fakeLogger();
    const relay = new OutboxRelay({
      repository: repository as unknown as TransactionRepository,
      broker,
      intervalMs: 1_000,
      logger,
    });

    await relay.runOnce();

    expect(repository.dispatched('payment.requested.v1')).toBe(false);
    expect(repository.pendingCount).toBe(1);
    expect(logger.lines.some((line) => line.level === 'error')).toBe(true);
  });

  it('a sweep that outruns its interval is not joined by a second: no overlap', async () => {
    const repository = new FakeOutboxRepository();
    repository.enqueue(outboxMessage('account.credit.requested.v1'));
    repository.delayMs = 50;
    const { broker } = fakeBroker();
    const relay = new OutboxRelay({
      repository: repository as unknown as TransactionRepository,
      broker,
      intervalMs: 1_000,
      logger: fakeLogger(),
    });

    const first = relay.runOnce();
    // Fired while the first sweep is still inside its artificial delay.
    await relay.runOnce();

    expect(repository.callCount).toBe(1);

    await first;

    expect(repository.callCount).toBe(1);
    expect(repository.delivered).toHaveLength(1);
  });

  it('stop() clears the timer: no further ticks fire once it has been called', async () => {
    jest.useFakeTimers();
    const repository = new FakeOutboxRepository();
    const { broker } = fakeBroker();
    const relay = new OutboxRelay({
      repository: repository as unknown as TransactionRepository,
      broker,
      intervalMs: 100,
      logger: fakeLogger(),
    });

    relay.start();
    await jest.advanceTimersByTimeAsync(350);
    const callsBeforeStop = repository.callCount;
    expect(callsBeforeStop).toBeGreaterThan(0);

    relay.stop();
    await jest.advanceTimersByTimeAsync(1_000);

    expect(repository.callCount).toBe(callsBeforeStop);
  });

  it('polls an empty outbox less and less often, and wake() brings it back to the floor (T-60)', async () => {
    jest.useFakeTimers();
    const repository = new FakeOutboxRepository();
    const { broker } = fakeBroker();
    const relay = new OutboxRelay({
      repository: repository as unknown as TransactionRepository,
      broker,
      intervalMs: 200,
      idleMaxMs: 2_000,
      logger: fakeLogger(),
    });

    relay.start();
    await jest.advanceTimersByTimeAsync(3_000);
    // 200, 600, 1_400, 3_000: four sweeps in three seconds instead of fifteen.
    expect(repository.callCount).toBe(4);

    // A handler wrote a command and woke the relay: it leaves within the floor
    // instead of waiting out the 2 s ceiling.
    repository.enqueue(outboxMessage('payment.requested.v1'));
    relay.wake();
    await jest.advanceTimersByTimeAsync(200);

    expect(repository.dispatched('payment.requested.v1')).toBe(true);
    relay.stop();
  });

  it('stop() before start() is a harmless no-op', () => {
    const repository = new FakeOutboxRepository();
    const { broker } = fakeBroker();
    const relay = new OutboxRelay({
      repository: repository as unknown as TransactionRepository,
      broker,
      intervalMs: 100,
      logger: fakeLogger(),
    });

    expect(() => {
      relay.stop();
    }).not.toThrow();
  });
});
