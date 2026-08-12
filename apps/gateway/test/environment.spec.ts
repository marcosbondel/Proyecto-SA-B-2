import 'reflect-metadata';

import { loadEnvironment } from '../src/infrastructure/config/environment';

const complete: NodeJS.ProcessEnv = {
  NODE_ENV: 'test',
  PORT: '3000',
  RABBITMQ_URL: 'amqp://guest:guest@localhost:5672',
};

describe('gateway environment', () => {
  it('accepts a complete environment and coerces PORT to a number', () => {
    expect(loadEnvironment(complete).PORT).toBe(3000);
  });

  it('names the missing variable instead of failing silently', () => {
    const incomplete: NodeJS.ProcessEnv = { NODE_ENV: 'test', PORT: '3000' };

    expect(() => loadEnvironment(incomplete)).toThrow(/RABBITMQ_URL/);
  });

  it('rejects a PORT that is not an integer', () => {
    const malformed: NodeJS.ProcessEnv = { ...complete, PORT: 'not-a-port' };

    expect(() => loadEnvironment(malformed)).toThrow(/PORT/);
  });
});
