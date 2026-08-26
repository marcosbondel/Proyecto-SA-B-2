import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import {
  accountBalanceQueryV1,
  accountBalanceRepliedV1,
  auditQueryRepliedV1,
  auditQueryRequestedV1,
  transactionStatusRepliedV1,
  transactionStatusRequestedV1,
} from '@bank/contracts';

import { AccountsController } from '../src/interfaces/accounts.controller';
import { AuditController } from '../src/interfaces/audit.controller';
import { TransfersController } from '../src/interfaces/transfers.controller';
import { buildHarness } from './support/harness';
import type { Harness } from './support/harness';

const ACTOR = '3f2a1c04-9c2e-4a71-b8f5-2d6e7c0a1b93';
const ACCOUNT = '8b7e5d21-9c2e-4a71-b8f5-2d6e7c0a1b93';
const TRANSACTION = '1d4c9f60-9c2e-4a71-b8f5-2d6e7c0a1b93';
const TRACE = '6f1c8a30-9c2e-4a71-b8f5-2d6e7c0a1b93';

describe('the three queries that wait for an answer', () => {
  let harness: Harness;
  let app: INestApplication;
  let client: string;
  let admin: string;

  beforeEach(async () => {
    harness = await buildHarness([AccountsController, TransfersController, AuditController]);
    app = harness.app;
    client = `Bearer ${harness.tokens.sign({ customerId: ACTOR, username: 'ana', role: 'CLIENTE' })}`;
    admin = `Bearer ${harness.tokens.sign({ customerId: ACTOR, username: 'ana', role: 'ADMINISTRADOR' })}`;
  });

  afterEach(async () => {
    await app.close();
  });

  describe('a balance', () => {
    it('publishes the query and returns what Account Service said', async () => {
      harness.replier.answerWith(accountBalanceRepliedV1.name, {
        outcome: 'FOUND',
        accountId: ACCOUNT,
        balance: { amountMinor: 125_000, currency: 'GTQ' },
        status: 'ACTIVE',
        lastActivityAt: '2026-08-19T14:32:08.100Z',
      });

      const response = await request(app.getHttpServer())
        .get(`/api/accounts/${ACCOUNT}/balance`)
        .set('Authorization', client);

      expect(response.status).toBe(200);
      expect(harness.publisher.lastType).toBe(accountBalanceQueryV1.name);
      expect(response.body.balance).toEqual({ amountMinor: 125_000, currency: 'GTQ' });
      expect(response.body.correlationId).toBeDefined();
    });

    /**
     * The service's own code reaches the caller untouched. Softening
     * `ACCOUNT_NOT_FOUND` into a friendlier message would make the gateway an
     * author of the verdict rather than its courier.
     */
    it('reports NOT_FOUND as 404, keeping the failure code', async () => {
      harness.replier.answerWith(accountBalanceRepliedV1.name, {
        outcome: 'NOT_FOUND',
        reason: 'ACCOUNT_NOT_FOUND',
      });

      const response = await request(app.getHttpServer())
        .get(`/api/accounts/${ACCOUNT}/balance`)
        .set('Authorization', client);

      expect(response.status).toBe(404);
      expect(response.body.type).toBe('BUSINESS_REJECTION');
      expect(response.body.failureCode).toBe('ACCOUNT_NOT_FOUND');
    });

    it('refuses an account id that is not a UUID, without asking anyone', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/accounts/not-a-uuid/balance')
        .set('Authorization', client);

      expect(response.status).toBe(400);
      expect(harness.publisher.published).toHaveLength(0);
    });
  });

  describe('a transaction status', () => {
    it('returns what Transaction Service said', async () => {
      harness.replier.answerWith(transactionStatusRepliedV1.name, {
        outcome: 'FOUND',
        transactionId: TRANSACTION,
        status: 'COMPLETED',
        amount: { amountMinor: 125_000, currency: 'GTQ' },
        reason: null,
        createdAt: '2026-08-19T14:32:08.100Z',
        updatedAt: '2026-08-19T14:32:09.100Z',
      });

      const response = await request(app.getHttpServer())
        .get(`/api/transfers/${TRANSACTION}`)
        .set('Authorization', client);

      expect(response.status).toBe(200);
      expect(harness.publisher.lastType).toBe(transactionStatusRequestedV1.name);
      expect(response.body.status).toBe('COMPLETED');
    });

    it('reports an unknown transaction as 409 rather than inventing a 404 body', async () => {
      harness.replier.answerWith(transactionStatusRepliedV1.name, { outcome: 'NOT_FOUND' });

      const response = await request(app.getHttpServer())
        .get(`/api/transfers/${TRANSACTION}`)
        .set('Authorization', client);

      expect(response.status).toBe(409);
      expect(response.body.type).toBe('BUSINESS_REJECTION');
    });
  });

  describe('the audit trail', () => {
    it('returns the events and notifications for a correlation', async () => {
      harness.replier.answerWith(auditQueryRepliedV1.name, {
        correlationId: TRACE,
        events: [
          {
            messageId: TRANSACTION,
            messageType: 'transfer.requested.v1',
            producer: 'gateway',
            causationId: null,
            occurredAt: '2026-08-19T14:32:08.100Z',
          },
        ],
        notifications: [],
      });

      const response = await request(app.getHttpServer())
        .get(`/api/audit?correlationId=${TRACE}`)
        .set('Authorization', admin);

      expect(response.status).toBe(200);
      expect(harness.publisher.lastType).toBe(auditQueryRequestedV1.name);
      expect(response.body.events).toHaveLength(1);
    });

    it('is refused for a role D-06 does not admit, without asking anyone', async () => {
      const response = await request(app.getHttpServer())
        .get(`/api/audit?correlationId=${TRACE}`)
        .set('Authorization', client);

      expect(response.status).toBe(403);
      expect(harness.publisher.published).toHaveLength(0);
    });

    it('refuses a missing correlation identifier', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/audit')
        .set('Authorization', admin);

      expect(response.status).toBe(400);
      expect(response.body.field).toBe('correlationId');
      expect(harness.publisher.published).toHaveLength(0);
    });
  });

  /**
   * A reply this system does not define must not reach a browser as if it were
   * an answer.
   */
  it('refuses to pass through a reply it cannot parse', async () => {
    harness.replier.answerWith(accountBalanceRepliedV1.name, { outcome: 'PERHAPS' });

    const response = await request(app.getHttpServer())
      .get(`/api/accounts/${ACCOUNT}/balance`)
      .set('Authorization', client);

    expect(response.status).toBe(500);
    expect(response.body.type).toBe('INTERNAL_ERROR');
  });
});
