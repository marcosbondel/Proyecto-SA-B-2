import type { MessageBroker } from '@bank/messaging';

import type { PaymentRepository } from '../src/application/ports';
import { OutboxRelay } from '../src/infrastructure/scheduler/outbox.scheduler';
import { RetryScheduler } from '../src/infrastructure/scheduler/retry.scheduler';

/**
 * The sweepers stop polling at full speed when there is nothing to do (T-60).
 *
 * An idle payment-service replica ran the retry sweep every 500 ms, the interbank
 * sweep every 500 ms and the outbox relay every 200 ms -- ~25 database
 * transactions a second for nothing, enough on a 50 m CPU request to hold the
 * autoscaler at its maximum with no load. What is under test here is the
 * wiring: that the schedulers use the adaptive loop, that an idle one backs off,
 * that work and `wake()` bring it back, and that configuring no ceiling keeps the
 * old fixed interval.
 */

const logger = { info: jest.fn(), error: jest.fn() };

describe('RetryScheduler idle backoff', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  function scheduler(options: { idleMaxMs?: number; found?: () => number } = {}) {
    const runs: number[] = [];
    const t0 = Date.now();
    const instance = new RetryScheduler({
      job: {
        execute: async () => {
          runs.push(Date.now() - t0);

          return await Promise.resolve(options.found?.() ?? 0);
        },
      },
      intervalMs: 500,
      ...(options.idleMaxMs === undefined ? {} : { idleMaxMs: options.idleMaxMs }),
      logger,
    });

    return { instance, runs };
  }

  it('polls at the floor, then doubles up to the ceiling while nothing is due', async () => {
    const { instance, runs } = scheduler({ idleMaxMs: 2_000 });

    instance.start();
    await jest.advanceTimersByTimeAsync(10_000);
    instance.stop();

    // 500, +1000, +2000, then every 2 s: 4x fewer sweeps than a fixed 500 ms.
    expect(runs.slice(0, 5)).toEqual([500, 1_500, 3_500, 5_500, 7_500]);
    expect(runs.length).toBeLessThan(10);
  });

  it('without a ceiling it keeps the fixed interval it always had', async () => {
    const { instance, runs } = scheduler();

    instance.start();
    await jest.advanceTimersByTimeAsync(2_000);
    instance.stop();

    expect(runs).toEqual([500, 1_000, 1_500, 2_000]);
  });

  it('a sweep that finds work stays at the floor', async () => {
    const { instance, runs } = scheduler({ idleMaxMs: 2_000, found: () => 3 });

    instance.start();
    await jest.advanceTimersByTimeAsync(2_000);
    instance.stop();

    expect(runs).toEqual([500, 1_000, 1_500, 2_000]);
  });

  it('wake() after a quiet spell brings the next sweep back to the floor', async () => {
    const { instance, runs } = scheduler({ idleMaxMs: 2_000 });

    instance.start();
    await jest.advanceTimersByTimeAsync(3_500); // 500, 1500, 3500; next at 5_500
    instance.wake();
    await jest.advanceTimersByTimeAsync(500);
    instance.stop();

    expect(runs.at(-1)).toBe(4_000);
  });

  it('runOnce() reports how much work it found, and 0 when the job throws', async () => {
    const found = jest.fn<Promise<number>, []>().mockResolvedValueOnce(4);
    const instance = new RetryScheduler({
      job: { execute: found },
      intervalMs: 500,
      logger,
    });

    expect(await instance.runOnce()).toBe(4);

    found.mockRejectedValueOnce(new Error('database away'));
    expect(await instance.runOnce()).toBe(0);
  });
});

describe('OutboxRelay idle backoff', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  function relay(options: { idleMaxMs?: number }) {
    const calls: number[] = [];
    const t0 = Date.now();
    let pending = 0;
    const repository = {
      dispatchPendingOutbox: async () => {
        calls.push(Date.now() - t0);
        const sent = pending;
        pending = 0;

        return await Promise.resolve(sent);
      },
    } as unknown as PaymentRepository;
    const instance = new OutboxRelay({
      repository,
      broker: { publish: jest.fn() } as unknown as MessageBroker,
      intervalMs: 200,
      ...(options.idleMaxMs === undefined ? {} : { idleMaxMs: options.idleMaxMs }),
      logger,
    });

    return {
      instance,
      calls,
      write: (rows: number): void => {
        pending = rows;
      },
    };
  }

  it('an empty outbox is polled less and less often, down to the ceiling', async () => {
    const { instance, calls } = relay({ idleMaxMs: 2_000 });

    instance.start();
    await jest.advanceTimersByTimeAsync(10_000);
    instance.stop();

    expect(calls.slice(0, 6)).toEqual([200, 600, 1_400, 3_000, 5_000, 7_000]);
  });

  it('a row written by this process is published within the floor, not the ceiling', async () => {
    const { instance, calls, write } = relay({ idleMaxMs: 2_000 });

    instance.start();
    await jest.advanceTimersByTimeAsync(3_000); // idle: the next sweep is at 5_000
    write(1);
    instance.wake(); // the handler that wrote it calls this as it returns
    await jest.advanceTimersByTimeAsync(200);
    instance.stop();

    expect(calls.at(-1)).toBe(3_200);
  });
});
