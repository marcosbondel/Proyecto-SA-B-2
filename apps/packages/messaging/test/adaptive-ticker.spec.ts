import { AdaptiveTicker } from '../src/adaptive-ticker';

/**
 * The idle backoff of the sweepers and outbox relays (T-60), with fake timers
 * and no I/O: what is under test is purely when the next tick happens.
 */
describe('AdaptiveTicker', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  /** A tick that finds whatever `work` currently says, and records when it ran. */
  function harness(options: { minMs?: number; maxMs?: number } = {}) {
    const state = { work: 0, ticks: [] as number[] };
    const t0 = Date.now();
    const ticker = new AdaptiveTicker({
      minMs: options.minMs ?? 100,
      maxMs: options.maxMs ?? 800,
      tick: async () => {
        state.ticks.push(Date.now() - t0);

        return await Promise.resolve(state.work);
      },
    });

    return { state, ticker };
  }

  it('backs off while idle, doubling up to the ceiling and no further', async () => {
    const { state, ticker } = harness();

    ticker.start();
    await jest.advanceTimersByTimeAsync(5_000);
    ticker.stop();

    // 100, then +200, +400, +800 and +800 for ever after.
    expect(state.ticks.slice(0, 6)).toEqual([100, 300, 700, 1_500, 2_300, 3_100]);
  });

  it('a tick that finds work brings the next one back to the floor, and it stays there while there is work', async () => {
    const { state, ticker } = harness();

    ticker.start();
    await jest.advanceTimersByTimeAsync(700); // 100, 300, 700: delay is now 800
    expect(ticker.delayMs).toBe(800);

    state.work = 3;
    await jest.advanceTimersByTimeAsync(800); // tick at 1_500 finds work
    expect(ticker.delayMs).toBe(100);

    // As the interval it replaces did: every 100 ms for as long as there is work.
    await jest.advanceTimersByTimeAsync(300);
    expect(state.ticks.slice(-3)).toEqual([1_600, 1_700, 1_800]);
    ticker.stop();
  });

  it('wake() brings a distant tick forward to the floor and restarts the backoff, but never postpones a nearer one', async () => {
    const { state, ticker } = harness();

    ticker.start();
    await jest.advanceTimersByTimeAsync(700); // next tick would be at 1_500

    ticker.wake();
    expect(ticker.delayMs).toBe(100);
    await jest.advanceTimersByTimeAsync(100);
    expect(state.ticks.at(-1)).toBe(800);
    // ... and the backoff started over: +200, not +800.
    await jest.advanceTimersByTimeAsync(200);
    expect(state.ticks.at(-1)).toBe(1_000);

    // 50 ms before the next tick (due at 1_400): a wake must not push it to 1_450.
    await jest.advanceTimersByTimeAsync(350);
    ticker.wake();
    await jest.advanceTimersByTimeAsync(50);
    expect(state.ticks.at(-1)).toBe(1_400);
    ticker.stop();
  });

  it('wake() during a tick makes the tick follow itself up at the floor', async () => {
    let release: () => void = () => undefined;
    const ticks: number[] = [];
    const t0 = Date.now();
    const ticker = new AdaptiveTicker({
      minMs: 100,
      maxMs: 800,
      tick: async () => {
        ticks.push(Date.now() - t0);
        await new Promise<void>((resolve) => {
          release = resolve;
        });

        return 0;
      },
    });

    ticker.start();
    await jest.advanceTimersByTimeAsync(100); // the tick is now in flight
    ticker.wake();
    release();
    await jest.advanceTimersByTimeAsync(100);
    release();

    // Idle, but woken: the follow-up is 100 ms away rather than 200.
    expect(ticks).toEqual([100, 200]);
    ticker.stop();
  });

  it('never overlaps itself, even when a tick outlasts its delay', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const ticker = new AdaptiveTicker({
      minMs: 10,
      maxMs: 10,
      tick: async () => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 50));
        inFlight -= 1;

        return 1;
      },
    });

    ticker.start();
    await jest.advanceTimersByTimeAsync(500);
    ticker.stop();

    expect(maxInFlight).toBe(1);
  });

  it('a tick that throws is reported, counts as idle, and does not stop the schedule', async () => {
    const errors: string[] = [];
    let calls = 0;
    const ticker = new AdaptiveTicker({
      minMs: 100,
      maxMs: 400,
      tick: async () => {
        calls += 1;

        if (calls === 1) {
          throw new Error('database away');
        }

        return await Promise.resolve(0);
      },
      onError: (error) => errors.push((error as Error).message),
    });

    ticker.start();
    await jest.advanceTimersByTimeAsync(100); // the failing tick
    expect(errors).toEqual(['database away']);
    // Gentle on a dependency that is down: the next one waits 200, not 100.
    expect(ticker.delayMs).toBe(200);

    await jest.advanceTimersByTimeAsync(200);
    expect(calls).toBe(2);
    ticker.stop();
  });

  it('stop() ends the schedule, and wake() after it does nothing', async () => {
    const { state, ticker } = harness();

    ticker.start();
    await jest.advanceTimersByTimeAsync(100);
    ticker.stop();
    ticker.wake();
    await jest.advanceTimersByTimeAsync(5_000);

    expect(state.ticks).toEqual([100]);
  });

  it('a ceiling below the floor is raised to it, so it never ticks faster than asked', async () => {
    const { state, ticker } = harness({ minMs: 200, maxMs: 50 });

    ticker.start();
    await jest.advanceTimersByTimeAsync(1_000);
    ticker.stop();

    expect(state.ticks).toEqual([200, 400, 600, 800, 1_000]);
  });
});
