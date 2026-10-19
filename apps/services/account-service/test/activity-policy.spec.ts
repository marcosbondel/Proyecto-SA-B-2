import {
  COUNTED_OPERATION_TYPES,
  DEFAULT_ACTIVITY_RULE,
  exceedsLimit,
  isCoolingDown,
  windowStart,
} from '../src/domain/activity-policy';

/**
 * The high-frequency rule, one boundary at a time.
 *
 * Every boundary in "más de N operaciones en una ventana de M minutos" is a
 * decision the assignment leaves to the team, so each one is pinned here: a
 * future change to any of them is a change to what the bank calls an anomaly.
 */

const NOW = new Date('2026-10-04T16:00:00.000Z');

describe('the default rule', () => {
  it('is the assignment’s suggestion: ten operations in five minutes', () => {
    expect(DEFAULT_ACTIVITY_RULE).toEqual({ maxOperations: 10, windowMinutes: 5 });
  });
});

describe('exceedsLimit', () => {
  const rule = { maxOperations: 10, windowMinutes: 5 };

  it('allows exactly N operations', () => {
    expect(exceedsLimit(10, rule)).toBe(false);
  });

  it('flags the N + 1st', () => {
    expect(exceedsLimit(11, rule)).toBe(true);
  });

  it('flags nothing below N, including an account that has done nothing', () => {
    expect(exceedsLimit(0, rule)).toBe(false);
    expect(exceedsLimit(9, rule)).toBe(false);
  });

  it('follows N when N is configured differently', () => {
    expect(exceedsLimit(3, { maxOperations: 2, windowMinutes: 5 })).toBe(true);
    expect(exceedsLimit(3, { maxOperations: 3, windowMinutes: 5 })).toBe(false);
  });
});

describe('windowStart', () => {
  it('is M minutes before now', () => {
    expect(windowStart(NOW, { maxOperations: 10, windowMinutes: 5 }).toISOString()).toBe(
      '2026-10-04T15:55:00.000Z',
    );
  });

  it('follows M when M is configured differently', () => {
    expect(windowStart(NOW, { maxOperations: 10, windowMinutes: 60 }).toISOString()).toBe(
      '2026-10-04T15:00:00.000Z',
    );
  });
});

describe('isCoolingDown', () => {
  const rule = { maxOperations: 10, windowMinutes: 5 };
  const minutesAgo = (minutes: number): Date => new Date(NOW.getTime() - minutes * 60_000);

  it('is quiet while the anomaly is still inside the window', () => {
    expect(isCoolingDown(minutesAgo(0), NOW, rule)).toBe(true);
    expect(isCoolingDown(minutesAgo(4.99), NOW, rule)).toBe(true);
  });

  it('is eligible again exactly M minutes later', () => {
    expect(isCoolingDown(minutesAgo(5), NOW, rule)).toBe(false);
    expect(isCoolingDown(minutesAgo(30), NOW, rule)).toBe(false);
  });

  it('follows M when M is configured differently', () => {
    expect(isCoolingDown(minutesAgo(5), NOW, { maxOperations: 10, windowMinutes: 10 })).toBe(true);
  });
});

describe('what counts', () => {
  it('is debits and credits, and nothing the bank or the system did on its own', () => {
    expect([...COUNTED_OPERATION_TYPES]).toEqual(['DEBIT', 'CREDIT']);
  });
});
