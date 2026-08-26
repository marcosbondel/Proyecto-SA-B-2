import 'reflect-metadata';

import { loadEnvironment } from '../src/infrastructure/config/environment';

const complete: NodeJS.ProcessEnv = {
  NODE_ENV: 'test',
  PORT: '3001',
  DATABASE_URL: 'postgresql://user:password@localhost:5432/bank_customer',
  RABBITMQ_URL: 'amqp://guest:guest@localhost:5672',
  OBJECT_STORAGE_ENDPOINT: 'http://localhost:9002',
  OBJECT_STORAGE_ACCESS_KEY: 'bank_app',
  OBJECT_STORAGE_SECRET_KEY: 'not-a-real-secret',
  OBJECT_STORAGE_BUCKET: 'customer-identity-documents',
  OBJECT_STORAGE_REGION: 'us-east-1',
};

describe('customer-service environment', () => {
  it('accepts a complete environment and coerces PORT to a number', () => {
    expect(loadEnvironment(complete).PORT).toBe(3001);
  });

  it('names the missing variable instead of failing silently', () => {
    const incomplete: NodeJS.ProcessEnv = { ...complete };
    delete incomplete.DATABASE_URL;

    expect(() => loadEnvironment(incomplete)).toThrow(/DATABASE_URL/);
  });

  it('names the object storage it cannot read the document photo without', () => {
    // Added by T-16: the identity photo travels through MinIO, never through
    // the broker, so a service without these cannot validate an identity at
    // all — and finding that out at boot beats finding it out per message.
    const incomplete: NodeJS.ProcessEnv = { ...complete };
    delete incomplete.OBJECT_STORAGE_BUCKET;

    expect(() => loadEnvironment(incomplete)).toThrow(/OBJECT_STORAGE_BUCKET/);
  });

  it('rejects a PORT that is not an integer', () => {
    const malformed: NodeJS.ProcessEnv = { ...complete, PORT: 'not-a-port' };

    expect(() => loadEnvironment(malformed)).toThrow(/PORT/);
  });
});
