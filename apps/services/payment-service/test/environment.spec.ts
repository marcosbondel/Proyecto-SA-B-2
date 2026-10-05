import 'reflect-metadata';

import { loadEnvironment, simulationDefaults } from '../src/infrastructure/config/environment';

const complete: NodeJS.ProcessEnv = {
  NODE_ENV: 'test',
  PORT: '3004',
  DATABASE_URL: 'postgresql://user:password@localhost:5432/bank_payment',
  RABBITMQ_URL: 'amqp://guest:guest@localhost:5672',
};

describe('payment-service environment', () => {
  it('accepts a complete environment and coerces PORT to a number', () => {
    expect(loadEnvironment(complete).PORT).toBe(3004);
  });

  it('names the missing variable instead of failing silently', () => {
    const incomplete: NodeJS.ProcessEnv = { ...complete };
    delete incomplete.DATABASE_URL;

    expect(() => loadEnvironment(incomplete)).toThrow(/DATABASE_URL/);
  });

  it('rejects a PORT that is not an integer', () => {
    const malformed: NodeJS.ProcessEnv = { ...complete, PORT: 'not-a-port' };

    expect(() => loadEnvironment(malformed)).toThrow(/PORT/);
  });

  describe('the simulated provider (T-44)', () => {
    it('defaults to a provider that never fails and never waits, as before', () => {
      expect(simulationDefaults(loadEnvironment(complete))).toEqual({
        failureRatePercent: 0,
        timeoutRatePercent: 0,
        latencyMs: 0,
      });
    });

    it('reads the three numbers from the ConfigMap', () => {
      const configured = loadEnvironment({
        ...complete,
        PAYMENT_SIM_FAILURE_RATE: '12.5',
        PAYMENT_SIM_TIMEOUT_RATE: '5',
        PAYMENT_SIM_LATENCY_MS: '250',
      });

      expect(simulationDefaults(configured)).toEqual({
        failureRatePercent: 12.5,
        timeoutRatePercent: 5,
        latencyMs: 250,
      });
    });

    it.each([
      ['a failure rate over 100', { PAYMENT_SIM_FAILURE_RATE: '101' }, /PAYMENT_SIM_FAILURE_RATE/],
      ['a negative timeout rate', { PAYMENT_SIM_TIMEOUT_RATE: '-1' }, /PAYMENT_SIM_TIMEOUT_RATE/],
      ['a rate that is not a number', { PAYMENT_SIM_FAILURE_RATE: 'lots' }, /PAYMENT_SIM_FAILURE_RATE/],
      ['a latency that is not whole', { PAYMENT_SIM_LATENCY_MS: '1.5' }, /PAYMENT_SIM_LATENCY_MS/],
      ['a latency past the ceiling', { PAYMENT_SIM_LATENCY_MS: '30001' }, /PAYMENT_SIM_LATENCY_MS/],
      [
        'rates that add up to more than every attempt',
        { PAYMENT_SIM_FAILURE_RATE: '70', PAYMENT_SIM_TIMEOUT_RATE: '40' },
        /must not exceed 100/,
      ],
    ])('refuses %s at boot, naming the variable', (_label, extra, message) => {
      expect(() => loadEnvironment({ ...complete, ...extra })).toThrow(message);
    });
  });
});
