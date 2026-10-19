import { QUEUES, catalogByName, destinationFor, routingKeyFor } from '../../src';
import {
  MAX_SIMULATED_LATENCY_MS,
  paymentSimulationQueryV1,
  paymentSimulationRepliedV1,
  paymentSimulationUpdateV1,
} from '../../src';

/**
 * T-44's contracts, written first. What matters is what an administrator can
 * ask for and what can never be asked: a rate outside 0–100 %, a pair of rates
 * that add up to more than every attempt, a latency long enough to wedge the
 * retry ladder, or a half-specified update.
 */

const VALID = { failureRatePercent: 30, timeoutRatePercent: 10, latencyMs: 250 } as const;

describe('payment.simulation.*', () => {
  describe('what they are', () => {
    it('are two Gateway commands Payment Service handles, and the reply it gives', () => {
      for (const contract of [paymentSimulationUpdateV1, paymentSimulationQueryV1]) {
        expect(contract.category).toBe('command');
        expect(contract.producer).toBe('gateway');
        expect(contract.consumers).toEqual(['payment-service']);
      }

      expect(paymentSimulationRepliedV1.category).toBe('reply');
      expect(paymentSimulationRepliedV1.producer).toBe('payment-service');
      expect(paymentSimulationRepliedV1.consumers).toEqual(['gateway']);
    });

    it('are in the catalogue under the names the repository gives every message', () => {
      expect(catalogByName.get('payment.simulation.update.v1')).toBe(paymentSimulationUpdateV1);
      expect(catalogByName.get('payment.simulation.query.v1')).toBe(paymentSimulationQueryV1);
      expect(catalogByName.get('payment.simulation.replied.v1')).toBe(paymentSimulationRepliedV1);
    });

    it('reach payment.commands without a new binding', () => {
      expect(routingKeyFor('payment.simulation.update.v1')).toBe('payment.simulation.update.v1');
      expect(destinationFor(paymentSimulationUpdateV1).exchange).toBe('bank.commands');

      const queue = QUEUES.find((candidate) => candidate.name === 'payment.commands');
      expect(queue?.bindings.map((binding) => binding.pattern)).toContain('payment.#');
    });
  });

  describe('the update accepts', () => {
    it('all three parameters', () => {
      expect(paymentSimulationUpdateV1.schema.safeParse(VALID).success).toBe(true);
    });

    it('the extremes: nothing wrong, and every attempt wrong', () => {
      for (const value of [
        { failureRatePercent: 0, timeoutRatePercent: 0, latencyMs: 0 },
        { failureRatePercent: 100, timeoutRatePercent: 0, latencyMs: MAX_SIMULATED_LATENCY_MS },
        { failureRatePercent: 0, timeoutRatePercent: 100, latencyMs: 0 },
        { failureRatePercent: 60, timeoutRatePercent: 40, latencyMs: 0 },
      ]) {
        expect(paymentSimulationUpdateV1.schema.safeParse(value).success).toBe(true);
      }
    });

    it('a reset on its own', () => {
      expect(paymentSimulationUpdateV1.schema.safeParse({ reset: true }).success).toBe(true);
    });
  });

  describe('the update refuses', () => {
    const refused: readonly (readonly [string, unknown])[] = [
      ['a negative failure rate', { ...VALID, failureRatePercent: -1 }],
      ['a failure rate over 100', { ...VALID, failureRatePercent: 100.5 }],
      ['a timeout rate over 100', { ...VALID, timeoutRatePercent: 101 }],
      ['rates that add up to more than every attempt', { ...VALID, failureRatePercent: 70, timeoutRatePercent: 40 }],
      ['a negative latency', { ...VALID, latencyMs: -1 }],
      ['a fractional latency', { ...VALID, latencyMs: 10.5 }],
      ['a latency past the ceiling', { ...VALID, latencyMs: MAX_SIMULATED_LATENCY_MS + 1 }],
      ['a partial set', { failureRatePercent: 10 }],
      ['nothing at all', {}],
      ['a reset that is false', { reset: false }],
      ['a reset mixed with parameters', { ...VALID, reset: true }],
      ['a parameter nobody defined', { ...VALID, jitterMs: 5 }],
      ['rates as text', { ...VALID, failureRatePercent: '30' }],
    ];

    it.each(refused)('%s', (_label, payload) => {
      expect(paymentSimulationUpdateV1.schema.safeParse(payload).success).toBe(false);
    });
  });

  describe('the reply', () => {
    const reply = { ...VALID, source: 'RUNTIME', updatedAt: '2026-10-05T10:00:00.000Z' };

    it('says where the values came from and when they were set', () => {
      expect(paymentSimulationRepliedV1.schema.safeParse(reply).success).toBe(true);
      expect(
        paymentSimulationRepliedV1.schema.safeParse({ ...reply, source: 'DEFAULTS', updatedAt: null })
          .success,
      ).toBe(true);
    });

    it('refuses a source that does not exist', () => {
      expect(
        paymentSimulationRepliedV1.schema.safeParse({ ...reply, source: 'MANUAL' }).success,
      ).toBe(false);
    });
  });

  it('takes an empty query', () => {
    expect(paymentSimulationQueryV1.schema.safeParse({}).success).toBe(true);
  });
});
