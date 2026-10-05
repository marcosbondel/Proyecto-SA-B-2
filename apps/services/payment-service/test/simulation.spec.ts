import { MAX_SIMULATED_LATENCY_MS } from '@bank/contracts';

import { decideAttempt } from '../src/domain/payment';
import { callProvider, providerLatencyMs } from '../src/domain/provider';
import {
  MAX_LATENCY_MS,
  NO_SIMULATION,
  answerFor,
  isValidSettings,
} from '../src/domain/simulation';
import type { SimulationSettings } from '../src/domain/simulation';

/**
 * T-44, the pure half: what the dice make the provider do.
 *
 * Nothing here has a clock, a database or `Math.random`. Every case hands the
 * function the roll it wants — which is the entire reason the provider takes the
 * dice as a parameter, and what makes "30 % fails" assertable as "0.29 fails and
 * 0.31 does not" instead of as a statistical tolerance over a thousand draws.
 */

const settings = (
  failureRatePercent: number,
  timeoutRatePercent = 0,
  latencyMs = 0,
): SimulationSettings => ({ failureRatePercent, timeoutRatePercent, latencyMs });

describe('answerFor', () => {
  it('succeeds on every roll when nothing is simulated', () => {
    for (const roll of [0, 0.25, 0.5, 0.999999]) {
      expect(answerFor(NO_SIMULATION, roll)).toBe('SUCCESS');
    }
  });

  it('fails the share of rolls the failure rate names, and no others', () => {
    expect(answerFor(settings(30), 0)).toBe('FAILURE');
    expect(answerFor(settings(30), 0.29)).toBe('FAILURE');
    // The upper edge is exclusive: exactly 30 % of the interval has failed.
    expect(answerFor(settings(30), 0.3)).toBe('SUCCESS');
    expect(answerFor(settings(30), 0.31)).toBe('SUCCESS');
  });

  it('fails always at 100 % and never at 0 %, whatever the roll', () => {
    for (const roll of [0, 0.5, 0.999999999]) {
      expect(answerFor(settings(100), roll)).toBe('FAILURE');
      expect(answerFor(settings(0), roll)).toBe('SUCCESS');
    }
  });

  it('carves a timeout and a failure out of the same interval, timeout first', () => {
    const mixed = settings(30, 10);

    expect(answerFor(mixed, 0.05)).toBe('TIMEOUT');
    expect(answerFor(mixed, 0.1)).toBe('FAILURE');
    expect(answerFor(mixed, 0.39)).toBe('FAILURE');
    expect(answerFor(mixed, 0.4)).toBe('SUCCESS');
  });

  it('times out always at 100 %', () => {
    expect(answerFor(settings(0, 100), 0.999999)).toBe('TIMEOUT');
  });

  it('draws once, so the effective rate is the one that was typed', () => {
    // 30 % + 10 % is 40 % of attempts going wrong. Two independent draws would
    // make it 1 - 0.7 * 0.9 = 37 %, which is not a number anyone asked for.
    let wrong = 0;
    const draws = 10_000;

    for (let index = 0; index < draws; index += 1) {
      if (answerFor(settings(30, 10), index / draws) !== 'SUCCESS') {
        wrong += 1;
      }
    }

    expect(wrong / draws).toBe(0.4);
  });
});

describe('isValidSettings', () => {
  it.each([
    ['nothing simulated', settings(0)],
    ['every attempt failing', settings(100)],
    ['a failure and a timeout that use every attempt', settings(60, 40)],
    ['a fractional rate', settings(12.5, 0.5)],
    ['the longest latency', settings(0, 0, MAX_LATENCY_MS)],
  ])('accepts %s', (_label, value) => {
    expect(isValidSettings(value)).toBe(true);
  });

  it.each([
    ['a negative rate', settings(-1)],
    ['a rate over 100', settings(101)],
    ['rates that add up to more than every attempt', settings(70, 40)],
    ['a rate that is not a number', settings(Number.NaN)],
    ['an infinite rate', settings(Number.POSITIVE_INFINITY)],
    ['a negative latency', settings(0, 0, -1)],
    ['a fractional latency', settings(0, 0, 1.5)],
    ['a latency past the ceiling', settings(0, 0, MAX_LATENCY_MS + 1)],
  ])('refuses %s', (_label, value) => {
    expect(isValidSettings(value)).toBe(false);
  });

  it('shares its ceiling with the contract, which the domain cannot import', () => {
    expect(MAX_LATENCY_MS).toBe(MAX_SIMULATED_LATENCY_MS);
  });
});

describe('callProvider with a simulation', () => {
  const reference = 'ref-1';

  it('answers an unscripted transfer by the dice', () => {
    expect(callProvider({ scenario: null, reference, simulation: { settings: settings(30), roll: 0.1 } })).toEqual({
      result: 'FAILURE',
      errorType: 'TRANSIENT',
    });
    expect(callProvider({ scenario: null, reference, simulation: { settings: settings(30), roll: 0.9 } })).toEqual({
      result: 'SUCCESS',
      providerReference: reference,
    });
    expect(callProvider({ scenario: null, reference, simulation: { settings: settings(0, 50), roll: 0.1 } })).toEqual({
      result: 'TIMEOUT',
    });
  });

  it('makes an intermittent failure the retryable kind, never a permanent refusal', () => {
    const response = callProvider({
      scenario: null,
      reference,
      simulation: { settings: settings(100), roll: 0.5 },
    });

    expect(response).toEqual({ result: 'FAILURE', errorType: 'TRANSIENT' });
  });

  it('leaves a scripted transfer exactly as it was, whatever the rates', () => {
    const everythingFails = { settings: settings(100), roll: 0 };

    expect(callProvider({ scenario: 'APPROVE', reference, simulation: everythingFails })).toEqual({
      result: 'SUCCESS',
      providerReference: reference,
    });
    expect(callProvider({ scenario: 'REJECT', reference, simulation: everythingFails })).toEqual({
      result: 'FAILURE',
      errorType: 'PERMANENT',
    });
    expect(callProvider({ scenario: 'TIMEOUT', reference, simulation: { settings: NO_SIMULATION, roll: 0.5 } })).toEqual({
      result: 'TIMEOUT',
    });
  });

  it('is the old provider when there is no simulation at all', () => {
    expect(callProvider({ scenario: null, reference })).toEqual({
      result: 'SUCCESS',
      providerReference: reference,
    });
    expect(callProvider({ scenario: null, reference, simulation: null })).toEqual({
      result: 'SUCCESS',
      providerReference: reference,
    });
  });

  it('gives the same answer for the same roll, every time', () => {
    const input = { scenario: null, reference, simulation: { settings: settings(30, 10), roll: 0.25 } } as const;

    expect(callProvider(input)).toEqual(callProvider(input));
  });
});

describe('providerLatencyMs', () => {
  it('is the configured latency for an unscripted attempt the provider answers', () => {
    expect(providerLatencyMs({ scenario: null, simulation: { settings: settings(0, 0, 750), roll: 0.5 } })).toBe(750);
    // A failure is an answer too, and a slow one.
    expect(providerLatencyMs({ scenario: null, simulation: { settings: settings(100, 0, 750), roll: 0.5 } })).toBe(750);
  });

  it('is zero for a timeout, which is the absence of an answer and is returned at once', () => {
    expect(providerLatencyMs({ scenario: null, simulation: { settings: settings(0, 100, 750), roll: 0.5 } })).toBe(0);
  });

  it('is zero for a scripted transfer, so a rehearsal is as fast as it ever was', () => {
    expect(providerLatencyMs({ scenario: 'APPROVE', simulation: { settings: settings(0, 0, 750), roll: 0.5 } })).toBe(0);
  });

  it('is zero with no simulation', () => {
    expect(providerLatencyMs({ scenario: null })).toBe(0);
  });
});

describe('the retry ladder under a simulation', () => {
  const delays = [1_000, 5_000, 30_000] as const;
  const fails = { settings: settings(100), roll: 0.5 };

  it('retries an intermittent failure on the same schedule as any transient one', () => {
    const outcome = decideAttempt({ scenario: null, attempt: 1, delays, reference: 'r', simulation: fails });

    expect(outcome).toMatchObject({ kind: 'RETRY', providerResult: 'FAILURE', errorType: 'TRANSIENT', delayMs: 1_000 });
  });

  it('exhausts at 100 % failure, which is what makes the Saga compensate', () => {
    const outcomes = [1, 2, 3, 4].map((attempt) =>
      decideAttempt({ scenario: null, attempt, delays, reference: 'r', simulation: fails }),
    );

    expect(outcomes.map((outcome) => outcome.kind)).toEqual(['RETRY', 'RETRY', 'RETRY', 'EXHAUSTED']);
    expect(outcomes[3]).toMatchObject({ failureReason: 'PAYMENT_RETRIES_EXHAUSTED' });
  });

  it('can succeed on a later rung when the dice change', () => {
    const first = decideAttempt({ scenario: null, attempt: 1, delays, reference: 'r', simulation: fails });
    const second = decideAttempt({
      scenario: null,
      attempt: 2,
      delays,
      reference: 'r2',
      simulation: { settings: settings(100), roll: 0.5 },
    });
    const lucky = decideAttempt({
      scenario: null,
      attempt: 2,
      delays,
      reference: 'r3',
      simulation: { settings: settings(30), roll: 0.9 },
    });

    expect(first.kind).toBe('RETRY');
    expect(second.kind).toBe('RETRY');
    expect(lucky).toMatchObject({ kind: 'SUCCEEDED', providerReference: 'r3' });
  });
});
