import 'reflect-metadata';

import { loadEnvironment } from '../src/infrastructure/config/environment';

const complete: NodeJS.ProcessEnv = {
  NODE_ENV: 'test',
  PORT: '3005',
  DATABASE_URL: 'postgresql://user:password@localhost:5432/bank_notification_audit',
  RABBITMQ_URL: 'amqp://guest:guest@localhost:5672',
};

describe('notification-audit-service environment', () => {
  it('accepts a complete environment and coerces PORT to a number', () => {
    expect(loadEnvironment(complete).PORT).toBe(3005);
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

describe('the activation-link flag', () => {
  const base = {
    NODE_ENV: 'production',
    PORT: '3005',
    DATABASE_URL: 'postgresql://user:pass@localhost:5432/bank_notification_audit',
    RABBITMQ_URL: 'amqp://user:pass@localhost:5672',
  };

  /**
   * The default that matters. These are the production images, and a
   * demonstration that wants working activation URLs in a log has to ask for
   * them by name rather than get them by accident.
   */
  it('is closed in production unless somebody asks', () => {
    expect(loadEnvironment(base).REVEAL_ACTIVATION_LINKS).toBe(false);
  });

  /**
   * And open outside it, because otherwise nobody can create an account on
   * their own machine: the token is redacted in the audit trail and hashed in
   * the customer's table, so the log is the only place it exists (TD-043).
   */
  it('is open outside production unless somebody closes it', () => {
    expect(loadEnvironment({ ...base, NODE_ENV: 'development' }).REVEAL_ACTIVATION_LINKS).toBe(
      true,
    );
  });

  it.each([
    ['true', true],
    ['false', false],
  ])('is overridable in either direction: %s', (raw, expected) => {
    expect(loadEnvironment({ ...base, REVEAL_ACTIVATION_LINKS: raw }).REVEAL_ACTIVATION_LINKS).toBe(
      expected,
    );
  });

  /**
   * A typo must not quietly mean `false`. That would be a deployment where
   * nobody can sign up and nothing says why — the exact failure TD-044
   * describes, reintroduced by a stray character.
   */
  it('refuses a value that is neither, naming the variable', () => {
    expect(() => loadEnvironment({ ...base, REVEAL_ACTIVATION_LINKS: 'yes' })).toThrow(
      /REVEAL_ACTIVATION_LINKS/,
    );
  });
});
