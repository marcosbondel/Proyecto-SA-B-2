import 'reflect-metadata';

import { loadEnvironment } from '../src/infrastructure/config/environment';

const complete: NodeJS.ProcessEnv = {
  NODE_ENV: 'test',
  PORT: '3000',
  RABBITMQ_URL: 'amqp://guest:guest@localhost:5672',
  JWT_SECRET: 'a'.repeat(32),
  OBJECT_STORAGE_ENDPOINT: 'http://localhost:9000',
  OBJECT_STORAGE_ACCESS_KEY: 'minio-app',
  OBJECT_STORAGE_SECRET_KEY: 'minio-app-secret',
  OBJECT_STORAGE_BUCKET: 'customer-identity-documents',
  OBJECT_STORAGE_REGION: 'us-east-1',
};

describe('gateway environment', () => {
  it('accepts a complete environment and coerces PORT to a number', () => {
    expect(loadEnvironment(complete).PORT).toBe(3000);
  });

  it('names the missing variable instead of failing silently', () => {
    const incomplete: NodeJS.ProcessEnv = { ...complete, RABBITMQ_URL: undefined };

    expect(() => loadEnvironment(incomplete)).toThrow(/RABBITMQ_URL/);
  });

  it('rejects a PORT that is not an integer', () => {
    const malformed: NodeJS.ProcessEnv = { ...complete, PORT: 'not-a-port' };

    expect(() => loadEnvironment(malformed)).toThrow(/PORT/);
  });

  /**
   * Every variable the gateway cannot boot without, one per case.
   *
   * The point is not that each one throws — it is that the message *names* the
   * offending variable. An operator staring at "invalid environment" has to
   * guess; one reading "OBJECT_STORAGE_BUCKET" does not.
   */
  it.each([
    'RABBITMQ_URL',
    'JWT_SECRET',
    'OBJECT_STORAGE_ENDPOINT',
    'OBJECT_STORAGE_ACCESS_KEY',
    'OBJECT_STORAGE_SECRET_KEY',
    'OBJECT_STORAGE_BUCKET',
    'OBJECT_STORAGE_REGION',
  ])('fails the boot naming %s when it is absent', (variable) => {
    const incomplete: NodeJS.ProcessEnv = { ...complete, [variable]: undefined };

    expect(() => loadEnvironment(incomplete)).toThrow(new RegExp(variable));
  });

  describe('session tokens', () => {
    it('rejects a signing secret shorter than 32 characters', () => {
      const weak: NodeJS.ProcessEnv = { ...complete, JWT_SECRET: 'too-short' };

      expect(() => loadEnvironment(weak)).toThrow(/JWT_SECRET/);
    });

    it('defaults the lifetime to one hour, as ADR-010 fixed it', () => {
      expect(loadEnvironment(complete).JWT_EXPIRES_IN).toBe(3600);
    });

    it('refuses a lifetime longer than one hour', () => {
      const long: NodeJS.ProcessEnv = { ...complete, JWT_EXPIRES_IN: '86400' };

      expect(() => loadEnvironment(long)).toThrow(/JWT_EXPIRES_IN/);
    });
  });

  describe('reply waiting', () => {
    it('defaults to the five seconds T-05 fixed', () => {
      expect(loadEnvironment(complete).REPLY_TIMEOUT_MS).toBe(5_000);
    });

    it('accepts a shorter ceiling so tests need not wait five real seconds', () => {
      expect(loadEnvironment({ ...complete, REPLY_TIMEOUT_MS: '25' }).REPLY_TIMEOUT_MS).toBe(25);
    });
  });

  describe('reply queue identity', () => {
    /**
     * Two replicas that shared one queue name would have the broker deliver a
     * reply round-robin, so an answer could land on the instance that never
     * asked. Defaulting per process makes that impossible by accident.
     */
    it('generates a distinct identifier per process when none is given', () => {
      const first = loadEnvironment(complete).GATEWAY_INSTANCE_ID;
      const second = loadEnvironment(complete).GATEWAY_INSTANCE_ID;

      expect(first).not.toBe(second);
      expect(first).toHaveLength(36);
    });

    it('keeps an explicit identifier when one is given', () => {
      const pinned: NodeJS.ProcessEnv = { ...complete, GATEWAY_INSTANCE_ID: 'gw-1' };

      expect(loadEnvironment(pinned).GATEWAY_INSTANCE_ID).toBe('gw-1');
    });
  });

  /**
   * The gateway has no database and declares no credentials for one
   * (constitution II and V). Its absence is a deliverable of this ticket, so
   * it is asserted rather than assumed.
   */
  it('declares no database variable, even when the process environment has one', () => {
    const polluted: NodeJS.ProcessEnv = {
      ...complete,
      DATABASE_URL: 'postgres://someone@localhost:5432/bank',
    };

    expect(loadEnvironment(polluted)).not.toHaveProperty('DATABASE_URL');
  });
});
