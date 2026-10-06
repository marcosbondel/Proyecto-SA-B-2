import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import {
  accountBalanceQueryV1,
  accountBalanceRepliedV1,
  accountListQueryV1,
  customerNamesQueryV1,
  customerNamesRepliedV1,
  accountListRepliedV1,
  accountOperationsQueryV1,
  accountOperationsRepliedV1,
  auditEventsListQueryV1,
  auditEventsListRepliedV1,
  auditQueryRepliedV1,
  auditQueryRequestedV1,
  notificationListQueryV1,
  notificationListRepliedV1,
  transactionListQueryV1,
  transactionListRepliedV1,
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
const OTHER_ACCOUNT = '9c8f6e32-0d3f-4b82-9a06-3e7f4c9d6b82';
const TRANSACTION = '1d4c9f60-9c2e-4a71-b8f5-2d6e7c0a1b93';
const TRACE = '6f1c8a30-9c2e-4a71-b8f5-2d6e7c0a1b93';

describe('the five queries that wait for an answer', () => {
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

  describe('a list of accounts', () => {
    const row = {
      accountId: ACCOUNT,
      customerId: ACTOR,
      accountType: 'MONETARIA' as const,
      balance: { amountMinor: 125_000, currency: 'GTQ' },
      status: 'ACTIVE' as const,
      lastActivityAt: '2026-08-19T14:32:08.100Z',
      openedAt: '2026-02-01T09:00:00.000Z',
    };

    it('publishes the query and returns the rows Account Service sent', async () => {
      harness.replier.answerWith(accountListRepliedV1.name, { accounts: [row] });

      const response = await request(app.getHttpServer())
        .get('/api/accounts')
        .set('Authorization', client);

      expect(response.status).toBe(200);
      // The *first* question, not the last: this route composes two replies
      // (TD-026), so the last message on the broker is the name lookup.
      expect(harness.publisher.published[0]!.messageType).toBe(accountListQueryV1.name);
      expect(response.body.accounts).toEqual([row]);
      expect(response.body.correlationId).toBeDefined();
    });

    /**
     * TD-026, closed. Account Service holds an opaque `customerId` and may not
     * read Customer Service's database (§8.2, 2.3); Customer Service does not
     * know what an account is. The Gateway is the only component that may hold
     * both replies at once — and holding two replies is aggregation, not domain
     * logic.
     */
    describe('the holder’s name, composed from two services', () => {
      it('asks Customer Service once for the distinct holders and merges the names', async () => {
        const other = { ...row, accountId: OTHER_ACCOUNT };

        harness.replier.answerInOrder([
          { messageType: accountListRepliedV1.name, payload: { accounts: [row, other] } },
          {
            messageType: customerNamesRepliedV1.name,
            payload: { names: [{ customerId: ACTOR, fullName: 'María Fernanda López' }] },
          },
        ]);

        const response = await request(app.getHttpServer())
          .get('/api/accounts')
          .set('Authorization', client);

        expect(harness.publisher.published).toHaveLength(2);
        expect(harness.publisher.published[1]!.messageType).toBe(customerNamesQueryV1.name);
        // Two accounts, one holder, one id asked about.
        expect(harness.publisher.published[1]!.payload).toEqual({ customerIds: [ACTOR] });

        for (const account of response.body.accounts) {
          expect(account.holderName).toBe('María Fernanda López');
        }
      });

      /**
       * A table of accounts with opaque ids is worse than one with names and
       * far better than an error page, so the name lookup can never fail the
       * listing it decorates.
       */
      it('still answers when the name lookup times out', async () => {
        harness.replier.answerInOrder([
          { messageType: accountListRepliedV1.name, payload: { accounts: [row] } },
          // Nothing more scripted: the second wait is rejected.
        ]);

        const response = await request(app.getHttpServer())
          .get('/api/accounts')
          .set('Authorization', client);

        expect(response.status).toBe(200);
        expect(response.body.accounts).toHaveLength(1);
        expect(response.body.accounts[0].holderName).toBeUndefined();
      });

      it('asks nobody anything when the listing is empty', async () => {
        harness.replier.answerWith(accountListRepliedV1.name, { accounts: [] });

        await request(app.getHttpServer()).get('/api/accounts').set('Authorization', client);

        expect(harness.publisher.published).toHaveLength(1);
      });
    });

    it('carries the filters through untouched, because they are a request and not a permission', async () => {
      harness.replier.answerWith(accountListRepliedV1.name, { accounts: [] });

      await request(app.getHttpServer())
        .get('/api/accounts')
        .query({ customerId: ACTOR, status: 'INACTIVE', accountType: 'AHORRO' })
        .set('Authorization', client);

      expect(harness.publisher.published.at(-1)?.payload).toEqual({
        customerId: ACTOR,
        status: 'INACTIVE',
        accountType: 'AHORRO',
      });
    });

    it('refuses a filter outside the closed set, without asking anyone', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/accounts')
        .query({ status: 'CERRADA' })
        .set('Authorization', client);

      expect(response.status).toBe(400);
      expect(harness.publisher.published).toHaveLength(0);
    });

    /**
     * An empty list is a complete answer, not a failure. Turning it into a
     * `404` would tell the caller that nothing exists, which is a different
     * claim from "nothing you may see" and one the gateway cannot make.
     */
    it('returns an empty list as a 200', async () => {
      harness.replier.answerWith(accountListRepliedV1.name, { accounts: [] });

      const response = await request(app.getHttpServer())
        .get('/api/accounts')
        .set('Authorization', client);

      expect(response.status).toBe(200);
      expect(response.body.accounts).toEqual([]);
    });
  });

  describe('the movements of an account', () => {
    it('returns the statement Account Service sent', async () => {
      harness.replier.answerWith(accountOperationsRepliedV1.name, {
        outcome: 'FOUND',
        accountId: ACCOUNT,
        operations: [
          {
            operationId: TRACE,
            type: 'DEBIT',
            amount: { amountMinor: 25_000, currency: 'GTQ' },
            balanceAfter: { amountMinor: 100_000, currency: 'GTQ' },
            transactionId: TRANSACTION,
            status: 'APPLIED',
            occurredAt: '2026-08-19T14:32:08.100Z',
          },
        ],
      });

      const response = await request(app.getHttpServer())
        .get(`/api/accounts/${ACCOUNT}/operations`)
        .set('Authorization', client);

      expect(response.status).toBe(200);
      expect(harness.publisher.lastType).toBe(accountOperationsQueryV1.name);
      expect(response.body.operations).toHaveLength(1);
    });

    it('reports NOT_FOUND as 404, keeping the failure code', async () => {
      harness.replier.answerWith(accountOperationsRepliedV1.name, {
        outcome: 'NOT_FOUND',
        reason: 'ACCOUNT_NOT_FOUND',
      });

      const response = await request(app.getHttpServer())
        .get(`/api/accounts/${ACCOUNT}/operations`)
        .set('Authorization', client);

      expect(response.status).toBe(404);
      expect(response.body.failureCode).toBe('ACCOUNT_NOT_FOUND');
    });

    it('refuses an account id that is not a UUID, without asking anyone', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/accounts/not-a-uuid/operations')
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

    it('passes phaseStatus and the transition history through untouched', async () => {
      harness.replier.answerWith(transactionStatusRepliedV1.name, {
        outcome: 'FOUND',
        transactionId: TRANSACTION,
        status: 'COMPLETED',
        phaseStatus: 'APPROVED',
        amount: { amountMinor: 125_000, currency: 'GTQ' },
        reason: null,
        createdAt: '2026-08-19T14:32:08.100Z',
        updatedAt: '2026-08-19T14:32:09.100Z',
        transitions: [
          { from: null, to: 'PENDING', event: 'transfer.requested.v1', reason: null, occurredAt: '2026-08-19T14:32:08.100Z' },
          { from: 'PENDING', to: 'DEBITING', event: 'transfer.requested.v1', reason: null, occurredAt: '2026-08-19T14:32:08.200Z' },
        ],
      });

      const response = await request(app.getHttpServer())
        .get(`/api/transfers/${TRANSACTION}`)
        .set('Authorization', client);

      expect(response.status).toBe(200);
      expect(response.body.phaseStatus).toBe('APPROVED');
      expect(response.body.transitions).toHaveLength(2);
      expect(response.body.transitions[0]).toEqual({
        from: null,
        to: 'PENDING',
        event: 'transfer.requested.v1',
        reason: null,
        occurredAt: '2026-08-19T14:32:08.100Z',
      });
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

    /**
     * Carries the redacted payload T-20 added to the reply, and does not
     * inspect it. The Gateway parses against the contract and passes what
     * survives; deciding what a payload may show is the owning service's job,
     * and a second opinion here would be a second place to get it wrong.
     */
    it('passes through the processing status and the redacted payload', async () => {
      harness.replier.answerWith(auditQueryRepliedV1.name, {
        correlationId: TRACE,
        events: [
          {
            messageId: TRANSACTION,
            messageType: 'transaction.completed.v1',
            producer: 'transaction-service',
            causationId: null,
            occurredAt: '2026-08-19T14:32:08.100Z',
            processingStatus: 'PROCESSED',
            payload: { transactionId: TRANSACTION, amount: '[redactado]' },
          },
        ],
        notifications: [
          { channel: 'EMAIL', subject: 'Tu transferencia se completó', sentAt: null },
        ],
      });

      const response = await request(app.getHttpServer())
        .get(`/api/audit?correlationId=${TRACE}`)
        .set('Authorization', admin);

      expect(response.status).toBe(200);
      expect(response.body.events[0].processingStatus).toBe('PROCESSED');
      expect(response.body.events[0].payload.amount).toBe('[redactado]');
    });
  });

  describe('recent audit events, optionally by severity (§4.1, T-30)', () => {
    it('passes the severity filter through to the query', async () => {
      harness.replier.answerWith(auditEventsListRepliedV1.name, {
        events: [
          {
            eventId: TRANSACTION,
            messageType: 'transaction.compensated.v1',
            producer: 'transaction-service',
            occurredAt: '2026-08-19T14:32:08.100Z',
            correlationId: TRACE,
            processingStatus: 'PROCESSED',
            consumer: 'audit.transaction',
            payload: {},
            severity: 'ERROR',
          },
        ],
        total: 1,
        page: 1,
        limit: 10,
      });

      const response = await request(app.getHttpServer())
        .get('/api/audit/recent?severity=ERROR')
        .set('Authorization', admin);

      expect(response.status).toBe(200);
      expect(harness.publisher.lastType).toBe(auditEventsListQueryV1.name);
      expect(harness.publisher.published[0]?.payload).toMatchObject({ severity: 'ERROR' });
      expect(response.body.events[0].severity).toBe('ERROR');
    });

    it('refuses a severity outside INFO/WARNING/ERROR, without asking anyone', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/audit/recent?severity=CATASTROPHIC')
        .set('Authorization', admin);

      expect(response.status).toBe(400);
      expect(response.body.field).toBe('severity');
      expect(harness.publisher.published).toHaveLength(0);
    });
  });

  describe('recent audit events, by correlation, trace, service and level (§4.1, T-45)', () => {
    const TRACE_ID = '4bf92f3577b34da6a3ce929d0e0e4736';
    const EMPTY = { events: [], total: 0, page: 1, limit: 10 };

    it('passes all four filters through to the query, combined', async () => {
      harness.replier.answerWith(auditEventsListRepliedV1.name, EMPTY);

      const response = await request(app.getHttpServer())
        .get(
          `/api/audit/recent?severity=ERROR&correlationId=${TRACE}&traceId=${TRACE_ID}&service=payment-service`,
        )
        .set('Authorization', admin);

      expect(response.status).toBe(200);
      expect(harness.publisher.published[0]?.payload).toEqual({
        page: 1,
        limit: 10,
        severity: 'ERROR',
        correlationId: TRACE,
        traceId: TRACE_ID,
        service: 'payment-service',
      });
    });

    it('sends no filter the caller did not ask for', async () => {
      harness.replier.answerWith(auditEventsListRepliedV1.name, EMPTY);

      await request(app.getHttpServer()).get('/api/audit/recent').set('Authorization', admin);

      expect(harness.publisher.published[0]?.payload).toEqual({ page: 1, limit: 10 });
    });

    it('returns the trace id the service recorded with each event', async () => {
      harness.replier.answerWith(auditEventsListRepliedV1.name, {
        events: [
          {
            eventId: TRANSACTION,
            messageType: 'payment.failed.v1',
            producer: 'payment-service',
            occurredAt: '2026-10-05T18:00:00.000Z',
            correlationId: TRACE,
            traceId: TRACE_ID,
            processingStatus: 'PROCESSED',
            consumer: 'audit.payment',
            payload: {},
            severity: 'ERROR',
          },
        ],
        total: 1,
        page: 1,
        limit: 10,
      });

      const response = await request(app.getHttpServer())
        .get(`/api/audit/recent?traceId=${TRACE_ID}`)
        .set('Authorization', admin);

      expect(response.body.events[0].traceId).toBe(TRACE_ID);
    });

    it.each([
      ['correlationId', 'correlationId=not-a-uuid'],
      ['traceId', 'traceId=not-a-trace'],
      ['traceId', `traceId=${'0'.repeat(32)}`],
      ['traceId', `traceId=${TRACE_ID.toUpperCase()}`],
      ['traceId', `traceId=${TRACE_ID}0`],
      ['service', 'service=the-other-bank'],
      ['service', "service=' OR '1'='1"],
    ])('refuses a malformed %s (%s) with 400, without asking anyone', async (field, query) => {
      const response = await request(app.getHttpServer())
        .get(`/api/audit/recent?${query}`)
        .set('Authorization', admin);

      expect(response.status).toBe(400);
      expect(response.body.field).toBe(field);
      expect(harness.publisher.published).toHaveLength(0);
    });

    it('still refuses anybody who is not an administrator, filters or not', async () => {
      const customer = `Bearer ${harness.tokens.sign({
        customerId: '3f2a1c04-9c2e-4a71-b8f5-2d6e7c0a1b93',
        username: 'cliente',
        role: 'CLIENTE',
      })}`;

      const response = await request(app.getHttpServer())
        .get(`/api/audit/recent?traceId=${TRACE_ID}`)
        .set('Authorization', customer);

      expect(response.status).toBe(403);
      expect(harness.publisher.published).toHaveLength(0);
    });
  });

  describe('the notifications console', () => {
    it('returns the page and how much it left out', async () => {
      harness.replier.answerWith(notificationListRepliedV1.name, {
        notifications: [
          {
            notificationId: TRANSACTION,
            type: 'transfer.completed',
            channel: 'EMAIL',
            recipient: 'cliente-3f2a1c04@simulado.bonking.gt',
            referenceId: TRANSACTION,
            subject: 'Tu transferencia se completó',
            status: 'SENT',
            correlationId: TRACE,
            createdAt: '2026-08-19T14:32:08.100Z',
            processedAt: '2026-08-19T14:32:08.140Z',
          },
        ],
        omitted: 17,
      });

      const response = await request(app.getHttpServer())
        .get('/api/audit/notifications?status=SENT')
        .set('Authorization', admin);

      expect(response.status).toBe(200);
      expect(harness.publisher.lastType).toBe(notificationListQueryV1.name);
      expect(response.body.notifications).toHaveLength(1);
      expect(response.body.omitted).toBe(17);
    });

    /** D-06 grants the trail and the notifications together, or neither. */
    it('is refused for a role D-06 does not admit, without asking anyone', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/audit/notifications')
        .set('Authorization', client);

      expect(response.status).toBe(403);
      expect(harness.publisher.published).toHaveLength(0);
    });

    it('refuses a limit above what the contract admits', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/audit/notifications?limit=500')
        .set('Authorization', admin);

      expect(response.status).toBe(400);
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

  /**
   * `T-04`, the listing that closes TD-033. The Gateway forwards the filters
   * untouched and forwards the answer untouched: the scope is applied by
   * Transaction Service against the `customer_id` it records at request time,
   * and a Gateway that filtered here would be a second, coarser copy of a rule
   * the owning service already applies per row.
   */
  describe('a list of transfers', () => {
    const row = {
      transactionId: '7c9f1a30-2b48-4d56-9e01-2f3a4b5c6d70',
      sourceAccount: ACCOUNT,
      targetAccount: OTHER_ACCOUNT,
      amount: { amountMinor: 125_000, currency: 'GTQ' },
      status: 'COMPLETED' as const,
      reason: null,
      createdAt: '2026-08-19T14:32:08.100Z',
      completedAt: '2026-08-19T14:32:11.400Z',
    };

    it('publishes the query and returns the rows Transaction Service sent', async () => {
      harness.replier.answerWith(transactionListRepliedV1.name, {
        transactions: [row],
        total: 1,
      });

      const response = await request(app.getHttpServer())
        .get('/api/transfers')
        .set('Authorization', client);

      expect(response.status).toBe(200);
      expect(harness.publisher.lastType).toBe(transactionListQueryV1.name);
      expect(response.body.transactions).toEqual([row]);
      expect(response.body.total).toBe(1);
    });

    it('carries the filters through untouched, because they are a request and not a permission', async () => {
      harness.replier.answerWith(transactionListRepliedV1.name, { transactions: [], total: 0 });

      await request(app.getHttpServer())
        .get('/api/transfers')
        .query({ accountId: ACCOUNT, status: 'FAILED', limit: 10 })
        .set('Authorization', client);

      expect(harness.publisher.published[0]!.payload).toEqual({
        accountId: ACCOUNT,
        status: 'FAILED',
        limit: 10,
      });
    });

    it('refuses a status the machine does not have, publishing nothing', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/transfers')
        .query({ status: 'INVENTADO' })
        .set('Authorization', client);

      expect(response.status).toBe(400);
      expect(harness.publisher.published).toHaveLength(0);
    });

    it('carries phaseStatus and the date range through, normalised to strict ISO 8601', async () => {
      harness.replier.answerWith(transactionListRepliedV1.name, { transactions: [], total: 0 });

      await request(app.getHttpServer())
        .get('/api/transfers')
        .query({ phaseStatus: 'APPROVED', from: '2026-08-01', to: '2026-08-31' })
        .set('Authorization', client);

      expect(harness.publisher.published[0]!.payload).toEqual({
        phaseStatus: 'APPROVED',
        from: new Date('2026-08-01').toISOString(),
        to: new Date('2026-08-31').toISOString(),
      });
    });

    it('refuses a phaseStatus outside Fase 2’s three names, publishing nothing', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/transfers')
        .query({ phaseStatus: 'DEBITING' })
        .set('Authorization', client);

      expect(response.status).toBe(400);
      expect(harness.publisher.published).toHaveLength(0);
    });

    it('refuses a reversed date range before asking anyone', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/transfers')
        .query({ from: '2026-08-31', to: '2026-08-01' })
        .set('Authorization', client);

      expect(response.status).toBe(400);
      expect(response.body.field).toBe('from');
      expect(harness.publisher.published).toHaveLength(0);
    });
  });
});
