import { randomUUID } from 'node:crypto';

import type { Response } from 'supertest';

import {
  ROUTE_REQUESTS,
  ACCOUNT_ID,
  CUSTOMER_ID,
  PAYMENT_ID,
  TRANSACTION_ID,
} from './support/route-fixtures';
import { buildBrokerHarness, closeBrokerHarness, fire } from './support/broker-harness';
import type { BrokerHarness } from './support/broker-harness';
import { ServiceDouble } from './support/service-double';

/**
 * One row per route in `ROUTE_MESSAGES` that waits for an answer — a real
 * downstream service, played by `ServiceDouble`, replies on the real broker
 * and the assertion is the HTTP response the Gateway built **from that
 * reply**. `test/queries-reply.spec.ts` and friends already prove this logic
 * against `ScriptedReplier`; what only the real broker can prove is that the
 * same reply, delivered through `bank.replies` (or, for the two-event routes,
 * `bank.events`) by a process that is not the Gateway itself, is what settles
 * the wait `ReplyQueueAdapter.start()` registered on its **own exclusive
 * queue** — the thing a fake `ReplyWaiterPort` cannot exercise because it has
 * no queue at all.
 *
 * Every case sets its own `X-Correlation-Id` so the request's correlation is
 * known before the response arrives — the double needs it to address the
 * reply, and matching by a freshly minted UUID is immune to whatever else is
 * on this shared broker (see `publish-routing.integration.spec.ts`'s note on
 * the same hazard).
 */
const RABBITMQ_URL = process.env.RABBITMQ_URL;
const describeBroker = RABBITMQ_URL ? describe : describe.skip;

jest.setTimeout(70_000);

interface ReplyCase {
  readonly key: string;
  readonly kind: 'reply' | 'event';
  readonly messageType: string;
  readonly payload: unknown;
  readonly assert: (response: Response) => void;
}

const ISO = '2026-08-19T14:32:08.100Z';

const REPLY_CASES: readonly ReplyCase[] = [
  {
    key: 'POST /api/auth/login',
    kind: 'reply',
    messageType: 'customer.authenticate.replied.v1',
    payload: {
      outcome: 'APPROVED',
      claims: { customerId: randomUUID(), username: 'ana', role: 'CLIENTE' },
      activationPending: false,
    },
    assert: (r) => {
      expect(r.status).toBe(200);
      expect(typeof r.body.token).toBe('string');
      expect(r.body.expiresIn).toBe(3600);
    },
  },
  {
    key: 'POST /api/auth/password-reset/confirm',
    kind: 'event',
    messageType: 'customer.password-reset.completed.v1',
    payload: { customerId: CUSTOMER_ID, changedAt: ISO },
    assert: (r) => {
      expect(r.status).toBe(200);
      expect(r.body.status).toBe('CHANGED');
    },
  },
  {
    key: 'GET /api/customers/verify-email',
    kind: 'event',
    messageType: 'customer.email.verified.v1',
    payload: { customerId: CUSTOMER_ID, emailVerifiedAt: ISO, status: 'ACTIVE' },
    assert: (r) => {
      expect(r.status).toBe(200);
      expect(r.body.status).toBe('ACTIVE');
    },
  },
  {
    key: 'POST /api/customers/{customerId}/password',
    kind: 'event',
    messageType: 'customer.password-changed.v1',
    payload: { customerId: CUSTOMER_ID, changedAt: ISO },
    assert: (r) => {
      expect(r.status).toBe(200);
      expect(r.body.status).toBe('CHANGED');
    },
  },
  {
    key: 'GET /api/customers',
    kind: 'reply',
    messageType: 'customer.list.replied.v1',
    payload: {
      customers: [
        {
          customerId: CUSTOMER_ID,
          fullName: 'María Fernanda López',
          email: 'maria@example.test',
          username: 'maria',
          documentNumber: '1234567890101',
          identityStatus: 'VALIDATED',
          role: 'CLIENTE',
          status: 'ACTIVE',
          registeredAt: ISO,
        },
      ],
      omitted: 0,
    },
    assert: (r) => {
      expect(r.status).toBe(200);
      expect(r.body.customers).toHaveLength(1);
      expect(r.body.customers[0].fullName).toBe('María Fernanda López');
    },
  },
  {
    key: 'GET /api/customers/pending-validation',
    kind: 'reply',
    messageType: 'customer.pending-validation.replied.v1',
    payload: {
      customers: [{ customerId: CUSTOMER_ID, fullName: 'Carlos Pérez', email: 'carlos@example.test', registeredAt: ISO }],
      omitted: 2,
    },
    assert: (r) => {
      expect(r.status).toBe(200);
      expect(r.body.customers).toHaveLength(1);
      expect(r.body.omitted).toBe(2);
    },
  },
  {
    key: 'GET /api/customers/{customerId}/identity-document',
    kind: 'reply',
    messageType: 'customer.identity-document.replied.v1',
    // NOT_FOUND rather than FOUND: the FOUND branch reads real object-storage
    // bytes (`IdentityDocumentUseCase#fetch` calls `storage.get`), which needs
    // a running MinIO this suite does not depend on. The rejection is still a
    // real HTTP response built from a real correlated reply.
    payload: { outcome: 'NOT_FOUND', reason: 'CUSTOMER_NOT_FOUND' },
    assert: (r) => {
      expect(r.status).toBe(404);
      expect(r.body.type).toBe('BUSINESS_REJECTION');
      expect(r.body.failureCode).toBe('CUSTOMER_NOT_FOUND');
    },
  },
  {
    key: 'GET /api/customers/{customerId}',
    kind: 'reply',
    messageType: 'customer.get.replied.v1',
    payload: {
      outcome: 'FOUND',
      customerId: CUSTOMER_ID,
      fullName: 'Ana López',
      identityDocument: '1234567890101',
      email: 'ana@example.test',
      dateOfBirth: '1995-04-12',
      address: 'Zona 1',
      username: 'ana',
      role: 'CLIENTE',
      status: 'ACTIVE',
      identityStatus: 'VALIDATED',
      kycStatus: 'VERIFIED',
    },
    assert: (r) => {
      expect(r.status).toBe(200);
      expect(r.body.fullName).toBe('Ana López');
    },
  },
  {
    key: 'GET /api/accounts/{accountId}/balance',
    kind: 'reply',
    messageType: 'account.balance.replied.v1',
    payload: {
      outcome: 'FOUND',
      accountId: ACCOUNT_ID,
      balance: { amountMinor: 125_000, currency: 'GTQ' },
      status: 'ACTIVE',
      lastActivityAt: ISO,
    },
    assert: (r) => {
      expect(r.status).toBe(200);
      expect(r.body.balance).toEqual({ amountMinor: 125_000, currency: 'GTQ' });
    },
  },
  {
    key: 'GET /api/accounts',
    kind: 'reply',
    messageType: 'account.list.replied.v1',
    // Empty on purpose: a non-empty listing triggers a second, composed
    // question (TD-026) that a dedicated test below answers deliberately.
    payload: { accounts: [] },
    assert: (r) => {
      expect(r.status).toBe(200);
      expect(r.body.accounts).toEqual([]);
    },
  },
  {
    key: 'GET /api/accounts/{accountId}/operations',
    kind: 'reply',
    messageType: 'account.operations.replied.v1',
    payload: {
      outcome: 'FOUND',
      accountId: ACCOUNT_ID,
      operations: [
        {
          operationId: randomUUID(),
          type: 'DEBIT',
          amount: { amountMinor: 25_000, currency: 'GTQ' },
          balanceAfter: { amountMinor: 100_000, currency: 'GTQ' },
          transactionId: TRANSACTION_ID,
          status: 'APPLIED',
          occurredAt: ISO,
        },
      ],
    },
    assert: (r) => {
      expect(r.status).toBe(200);
      expect(r.body.operations).toHaveLength(1);
    },
  },
  {
    key: 'GET /api/accounts/billers',
    kind: 'reply',
    messageType: 'account.billers.replied.v1',
    payload: { billers: [{ code: 'AGUA', name: 'Empresa de Agua', accountId: randomUUID() }] },
    assert: (r) => {
      expect(r.status).toBe(200);
      expect(r.body.billers).toHaveLength(1);
      expect(r.body.billers[0].code).toBe('AGUA');
    },
  },
  {
    key: 'POST /api/accounts/{accountId}/deposit',
    kind: 'event',
    messageType: 'account.deposited.v1',
    payload: {
      depositId: randomUUID(),
      accountId: ACCOUNT_ID,
      operationId: randomUUID(),
      amount: { amountMinor: 10_000, currency: 'GTQ' },
      balanceAfter: { amountMinor: 20_000, currency: 'GTQ' },
      reactivated: false,
      occurredAt: ISO,
    },
    assert: (r) => {
      expect(r.status).toBe(200);
      expect(r.body.balanceAfter).toEqual({ amountMinor: 20_000, currency: 'GTQ' });
    },
  },
  {
    key: 'GET /api/notifications',
    kind: 'reply',
    messageType: 'notification.inbox.replied.v1',
    payload: {
      notifications: [
        {
          notificationId: randomUUID(),
          type: 'transfer.completed',
          subject: 'Tu transferencia se completó',
          referenceId: null,
          correlationId: randomUUID(),
          createdAt: ISO,
          readAt: null,
        },
      ],
      unread: 1,
    },
    assert: (r) => {
      expect(r.status).toBe(200);
      expect(r.body.notifications).toHaveLength(1);
      expect(r.body.unread).toBe(1);
    },
  },
  {
    key: 'POST /api/notifications/read',
    kind: 'reply',
    messageType: 'notification.read.replied.v1',
    payload: { changed: 3, unread: 2 },
    assert: (r) => {
      expect(r.status).toBe(200);
      expect(r.body.changed).toBe(3);
      expect(r.body.unread).toBe(2);
    },
  },
  {
    key: 'GET /api/transfers',
    kind: 'reply',
    messageType: 'transaction.list.replied.v1',
    payload: {
      transactions: [
        {
          transactionId: TRANSACTION_ID,
          sourceAccount: ACCOUNT_ID,
          targetAccount: randomUUID(),
          amount: { amountMinor: 125_000, currency: 'GTQ' },
          status: 'COMPLETED',
          reason: null,
          createdAt: ISO,
          completedAt: ISO,
        },
      ],
      total: 1,
    },
    assert: (r) => {
      expect(r.status).toBe(200);
      expect(r.body.total).toBe(1);
      expect(r.body.transactions).toHaveLength(1);
    },
  },
  {
    key: 'GET /api/transfers/{transactionId}',
    kind: 'reply',
    messageType: 'transaction.status.replied.v1',
    payload: {
      outcome: 'FOUND',
      transactionId: TRANSACTION_ID,
      status: 'COMPLETED',
      amount: { amountMinor: 125_000, currency: 'GTQ' },
      reason: null,
      createdAt: ISO,
      updatedAt: ISO,
    },
    assert: (r) => {
      expect(r.status).toBe(200);
      expect(r.body.status).toBe('COMPLETED');
    },
  },
  {
    key: 'GET /api/payments',
    kind: 'reply',
    messageType: 'payment.list.replied.v1',
    payload: {
      payments: [
        {
          paymentId: PAYMENT_ID,
          transactionId: TRANSACTION_ID,
          status: 'SUCCEEDED',
          amount: { amountMinor: 125_000, currency: 'GTQ' },
          attempt: 1,
          errorType: null,
          failureReason: null,
          providerReference: 'SIM-1',
          scenario: 'APPROVE',
          originCorrelationId: randomUUID(),
          createdAt: ISO,
          updatedAt: ISO,
          decidedAt: ISO,
        },
      ],
    },
    assert: (r) => {
      expect(r.status).toBe(200);
      expect(r.body.payments).toHaveLength(1);
    },
  },
  {
    key: 'GET /api/payments/{paymentId}',
    kind: 'reply',
    messageType: 'payment.status.replied.v1',
    payload: {
      outcome: 'FOUND',
      payment: {
        paymentId: PAYMENT_ID,
        transactionId: TRANSACTION_ID,
        status: 'SUCCEEDED',
        amount: { amountMinor: 125_000, currency: 'GTQ' },
        attempt: 1,
        errorType: null,
        failureReason: null,
        providerReference: 'SIM-1',
        scenario: 'APPROVE',
        originCorrelationId: randomUUID(),
        createdAt: ISO,
        updatedAt: ISO,
        decidedAt: ISO,
      },
      attempts: [],
    },
    assert: (r) => {
      expect(r.status).toBe(200);
      expect(r.body.payment.paymentId).toBe(PAYMENT_ID);
    },
  },
  {
    // T-44: the administrator's read of the provider simulation.
    key: 'GET /api/payments/simulation',
    kind: 'reply',
    messageType: 'payment.simulation.replied.v1',
    payload: {
      failureRatePercent: 30,
      timeoutRatePercent: 10,
      latencyMs: 250,
      source: 'RUNTIME',
      updatedAt: ISO,
    },
    assert: (r) => {
      expect(r.status).toBe(200);
      expect(r.body.failureRatePercent).toBe(30);
      expect(r.body.source).toBe('RUNTIME');
    },
  },
  {
    // T-44: the change, answered with the simulation now in force.
    key: 'PUT /api/payments/simulation',
    kind: 'reply',
    messageType: 'payment.simulation.replied.v1',
    payload: {
      failureRatePercent: 30,
      timeoutRatePercent: 10,
      latencyMs: 250,
      source: 'RUNTIME',
      updatedAt: ISO,
    },
    assert: (r) => {
      expect(r.status).toBe(200);
      expect(r.body.latencyMs).toBe(250);
    },
  },
  {
    key: 'GET /api/audit',
    kind: 'reply',
    messageType: 'audit.query.replied.v1',
    payload: { correlationId: randomUUID(), events: [], notifications: [] },
    assert: (r) => {
      expect(r.status).toBe(200);
      expect(r.body.events).toEqual([]);
      expect(r.body.notifications).toEqual([]);
    },
  },
  {
    key: 'GET /api/audit/recent',
    kind: 'reply',
    messageType: 'audit.events.list.replied.v1',
    payload: {
      events: [
        {
          eventId: randomUUID(),
          messageType: 'transaction.compensated.v1',
          producer: 'transaction-service',
          occurredAt: ISO,
          correlationId: randomUUID(),
          processingStatus: 'PROCESSED',
          consumer: 'audit.transaction',
          payload: {},
          severity: 'ERROR',
        },
      ],
      total: 1,
      page: 1,
      limit: 10,
    },
    assert: (r) => {
      expect(r.status).toBe(200);
      expect(r.body.total).toBe(1);
    },
  },
  {
    key: 'GET /api/audit/notifications',
    kind: 'reply',
    messageType: 'notification.list.replied.v1',
    payload: {
      notifications: [
        {
          notificationId: randomUUID(),
          type: 'transfer.completed',
          channel: 'EMAIL',
          recipient: 'cliente@simulado.bonking.gt',
          referenceId: TRANSACTION_ID,
          subject: 'Tu transferencia se completó',
          status: 'SENT',
          correlationId: randomUUID(),
          createdAt: ISO,
          processedAt: ISO,
        },
      ],
      omitted: 5,
    },
    assert: (r) => {
      expect(r.status).toBe(200);
      expect(r.body.omitted).toBe(5);
    },
  },
];

describeBroker('a real reply settling the Gateway’s own exclusive queue', () => {
  let harness: BrokerHarness;
  let double: ServiceDouble;

  beforeAll(async () => {
    if (!RABBITMQ_URL) {
      console.warn('Skipping reply-correlation.integration.spec.ts: RABBITMQ_URL is not set.');
      return;
    }
    harness = await buildBrokerHarness({ replyTimeoutMs: 4_000 });
    double = await ServiceDouble.connect(RABBITMQ_URL);
    await double.spyOnEverythingPublished();
  });

  afterAll(async () => {
    if (!RABBITMQ_URL) {
      return;
    }
    await double.close();
    await closeBrokerHarness(harness);
  });

  it.each(REPLY_CASES.map((c) => [c.key, c] as const))(
    '%s builds its HTTP response from the correlated reply',
    async (_key, testCase) => {
      const builder = ROUTE_REQUESTS[testCase.key];
      if (builder === undefined) {
        throw new Error(`route-fixtures.ts has no request builder for "${testCase.key}"`);
      }

      const correlationId = randomUUID();
      const pending = fire(builder(harness).set('X-Correlation-Id', correlationId));

      const cause = await double.waitForEnvelope((e) => e.correlationId === correlationId, 5_000);
      if (cause.envelope === undefined) {
        throw new Error('unreachable: waitForEnvelope only resolves with a parsed envelope');
      }

      if (testCase.kind === 'reply') {
        await double.reply(cause.envelope, testCase.messageType, testCase.payload);
      } else {
        await double.event(cause.envelope, testCase.messageType, testCase.payload);
      }

      const response = await pending;
      testCase.assert(response);
      expect(response.headers['x-correlation-id']).toBe(correlationId);
    },
  );

  /*
   * TD-026's composition — two questions, two replies, one merged answer —
   * is deliberately **not** re-proven here with a second scripted reply for
   * `customer.names.query.v1`. On this broker `account-service` and
   * `customer-service` are themselves live and bound to the same patterns
   * (`account.#`, `customer.#`); a two-hop flow gives their genuine consumers
   * a second window to win the correlation race this double is trying to
   * settle, and unlike every single-hop case above — where speeding up the
   * double's reply path (see `ServiceDouble`'s event-driven `waitForEnvelope`
   * and pre-asserted exchanges) makes the outcome reliable — a second hop
   * cannot be made deterministic without silencing those consumers, which is
   * outside this suite's remit. `queries-reply.spec.ts` already proves the
   * composition itself against `ScriptedReplier`; see the QA report for this
   * environmental finding in full.
   */
});
