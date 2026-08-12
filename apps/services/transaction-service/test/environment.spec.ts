import 'reflect-metadata';

import { loadEnvironment } from '../src/infrastructure/config/environment';

const complete: NodeJS.ProcessEnv = {
  NODE_ENV: 'test',
  PORT: '3003',
  DATABASE_URL: 'postgresql://user:password@localhost:5432/bank_transaction',
  RABBITMQ_URL: 'amqp://guest:guest@localhost:5672',
};

describe('transaction-service environment', () => {
  it('accepts a complete environment and coerces PORT to a number', () => {
    expect(loadEnvironment(complete).PORT).toBe(3003);
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
