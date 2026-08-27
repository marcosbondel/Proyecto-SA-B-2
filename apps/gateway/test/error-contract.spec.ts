import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { accountBalanceRepliedV1 } from '@bank/contracts';

import { GatewayError } from '../src/application/errors/gateway-error';
import { AccountsController } from '../src/interfaces/accounts.controller';
import { AuthController } from '../src/interfaces/auth.controller';
import { CustomersController } from '../src/interfaces/customers.controller';
import { TransfersController } from '../src/interfaces/transfers.controller';
import { buildHarness } from './support/harness';
import type { Harness } from './support/harness';

const ACTOR = '3f2a1c04-9c2e-4a71-b8f5-2d6e7c0a1b93';
const ACCOUNT = '8b7e5d21-9c2e-4a71-b8f5-2d6e7c0a1b93';

/** Anything that would tell a stranger how this system is put together. */
const LEAKS = [
  /at [A-Za-z].*\(.*:\d+:\d+\)/, // a stack frame
  /amqp:\/\//i,
  /postgres:\/\//i,
  /customer-identity-documents/i,
  /minio/i,
  /localhost:\d+/,
  /node_modules/,
  /(customer|account|transaction|payment|notification)-service/i,
];

describe('the error contract', () => {
  let harness: Harness;
  let app: INestApplication;
  let auth: string;

  beforeEach(async () => {
    harness = await buildHarness([
      AuthController,
      CustomersController,
      AccountsController,
      TransfersController,
    ]);
    app = harness.app;
    auth = `Bearer ${harness.tokens.sign({ customerId: ACTOR, username: 'ana', role: 'CLIENTE' })}`;
  });

  afterEach(async () => {
    await app.close();
  });

  /** One provoker per failure type, so all five can be compared side by side. */
  const provoke = {
    VALIDATION_ERROR: () =>
      request(app.getHttpServer())
        .post('/api/transfers')
        .set('Authorization', auth)
        .send({ sourceAccount: 'nope' }),

    BUSINESS_REJECTION: () => {
      harness.replier.answerWith(accountBalanceRepliedV1.name, {
        outcome: 'NOT_FOUND',
        reason: 'ACCOUNT_NOT_FOUND',
      });
      return request(app.getHttpServer())
        .get(`/api/accounts/${ACCOUNT}/balance`)
        .set('Authorization', auth);
    },

    REPLY_TIMEOUT: () => {
      harness.replier.staySilent();
      return request(app.getHttpServer())
        .get(`/api/accounts/${ACCOUNT}/balance`)
        .set('Authorization', auth);
    },

    BROKER_UNAVAILABLE: () => {
      harness.publisher.failWith = GatewayError.brokerUnavailable();
      return request(app.getHttpServer())
        .post('/api/accounts')
        .set('Authorization', auth)
        .send({ accountType: 'MONETARIA' });
    },

    INTERNAL_ERROR: () => {
      harness.storage.fail = true;
      return request(app.getHttpServer())
        .post('/api/customers')
        .field({
          fullName: 'Ana López',
          identityDocument: '1234567890101',
          email: 'ana@example.com',
          dateOfBirth: '1995-04-12',
          address: 'Zona 1',
          role: 'CLIENTE',
          credential: 'una-contrasena-larga',
        })
        .attach('photo', Buffer.from([0xff, 0xd8, 0xff, 0xd9]), {
          filename: 'dpi.jpg',
          contentType: 'image/jpeg',
        });
    },
  } as const;

  const types = Object.keys(provoke) as (keyof typeof provoke)[];

  it.each(types)('reports %s with that exact type', async (type) => {
    const response = await provoke[type]();

    expect(response.body.type).toBe(type);
  });

  it('gives all five a common shape', async () => {
    for (const type of types) {
      const response = await provoke[type]();

      expect(typeof response.body.type).toBe('string');
      expect(typeof response.body.message).toBe('string');
      expect(response.body.message.length).toBeGreaterThan(0);
    }
  });

  /**
   * An error is exactly when a caller most needs the identifier that lets them
   * ask the audit record what actually happened. Omitting it there is how a
   * system becomes undiagnosable precisely when it breaks.
   */
  it('carries a correlation identifier on every one of them', async () => {
    for (const type of types) {
      const mine = '6f1c8a30-9c2e-4a71-b8f5-2d6e7c0a1b93';
      const response = await provoke[type]().set('X-Correlation-Id', mine);

      expect(response.body.correlationId).toBe(mine);
      expect(response.headers['x-correlation-id']).toBe(mine);
    }
  });

  it('never leaks anything about the inside', async () => {
    for (const type of types) {
      const response = await provoke[type]();
      const serialised = JSON.stringify(response.body);

      for (const leak of LEAKS) {
        expect(serialised).not.toMatch(leak);
      }
    }
  });

  it('gives the five distinct status codes a client can branch on', async () => {
    const statuses = new Map<string, number>();

    for (const type of types) {
      statuses.set(type, (await provoke[type]()).status);
    }

    expect(statuses.get('VALIDATION_ERROR')).toBe(400);
    expect(statuses.get('BUSINESS_REJECTION')).toBe(404);
    expect(statuses.get('REPLY_TIMEOUT')).toBe(504);
    expect(statuses.get('BROKER_UNAVAILABLE')).toBe(503);
    expect(statuses.get('INTERNAL_ERROR')).toBe(500);
  });

  describe('what each type does and does not carry', () => {
    it('puts the catalogue code on a business rejection, untouched', async () => {
      const response = await provoke.BUSINESS_REJECTION();

      expect(response.body.failureCode).toBe('ACCOUNT_NOT_FOUND');
    });

    it('puts no failure code on anything else', async () => {
      for (const type of types.filter((each) => each !== 'BUSINESS_REJECTION')) {
        const response = await provoke[type]();

        expect(response.body).not.toHaveProperty('failureCode');
      }
    });

    it('names the offending field only on a validation error', async () => {
      expect((await provoke.VALIDATION_ERROR()).body.field).toBeDefined();
      expect((await provoke.REPLY_TIMEOUT()).body).not.toHaveProperty('field');
    });
  });

  /**
   * These two are the pair a caller is most likely to confuse, and confusing
   * them costs money: one means "it is still running", the other means "nothing
   * happened".
   */
  it('keeps timeout and broker-unavailable saying opposite things', async () => {
    const timedOut = await provoke.REPLY_TIMEOUT();
    const unavailable = await provoke.BROKER_UNAVAILABLE();

    expect(timedOut.body.message).toMatch(/NO fue cancelada/);
    expect(unavailable.body.message).toMatch(/No se realizó ningún cambio/);
  });
});
