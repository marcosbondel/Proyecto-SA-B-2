import 'reflect-metadata';

import { loadEnvironment } from '../src/infrastructure/config/environment';

const complete: NodeJS.ProcessEnv = {
  NODE_ENV: 'test',
  PORT: '3002',
  DATABASE_URL: 'postgresql://user:password@localhost:5432/bank_account',
  RABBITMQ_URL: 'amqp://guest:guest@localhost:5672',
};

describe('account-service environment', () => {
  it('accepts a complete environment and coerces PORT to a number', () => {
    expect(loadEnvironment(complete).PORT).toBe(3002);
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
});

describe('the high-frequency rule (T-42)', () => {
  it('defaults to the assignment’s ten operations in five minutes', () => {
    const environment = loadEnvironment(complete);

    expect(environment.ANOMALY_MAX_OPERATIONS).toBe(10);
    expect(environment.ANOMALY_WINDOW_MINUTES).toBe(5);
  });

  it('takes N and M from the environment, which is what the ConfigMap sets', () => {
    const environment = loadEnvironment({
      ...complete,
      ANOMALY_MAX_OPERATIONS: '25',
      ANOMALY_WINDOW_MINUTES: '15',
    });

    expect(environment.ANOMALY_MAX_OPERATIONS).toBe(25);
    expect(environment.ANOMALY_WINDOW_MINUTES).toBe(15);
  });

  it.each([
    ['ANOMALY_MAX_OPERATIONS', '0'],
    ['ANOMALY_MAX_OPERATIONS', '-3'],
    ['ANOMALY_MAX_OPERATIONS', 'many'],
    ['ANOMALY_WINDOW_MINUTES', '0'],
    ['ANOMALY_WINDOW_MINUTES', '2.5'],
    ['ANOMALY_WINDOW_MINUTES', '99999'],
  ])('refuses %s = %s, naming the variable', (name, value) => {
    expect(() => loadEnvironment({ ...complete, [name]: value })).toThrow(new RegExp(name));
  });
});
