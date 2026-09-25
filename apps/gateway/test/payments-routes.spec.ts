import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import type { Role } from '@bank/contracts';
import {
  paymentListQueryV1,
  paymentListRepliedV1,
  paymentStatusQueryV1,
  paymentStatusRepliedV1,
} from '@bank/contracts';

import { PaymentsController } from '../src/interfaces/payments.controller';
import { buildHarness } from './support/harness';
import type { Harness } from './support/harness';

const CUSTOMER_ID = '3f2a1c04-9c2e-4a71-b8f5-2d6e7c0a1b93';
const PAYMENT_ID = '6f1c8a30-9c2e-4a71-b8f5-2d6e7c0a1b93';
const TRANSACTION_ID = '9b2d4e70-1c3a-4f52-8d61-0a7b3c9e5d24';

const PAYMENT = {
  paymentId: PAYMENT_ID,
  transactionId: TRANSACTION_ID,
  status: 'FAILED' as const,
  amount: { amountMinor: 125_000, currency: 'GTQ' },
  attempt: 4,
  errorType: 'TRANSIENT' as const,
  failureReason: 'PAYMENT_RETRIES_EXHAUSTED' as const,
  providerReference: 'SIM-2D60B8F3',
  scenario: 'TRANSIENT_FAILURE' as const,
  originCorrelationId: '622e1c22-fb7a-41f2-bbde-1e500a6ea944',
  createdAt: '2026-08-19T14:32:08.100Z',
  updatedAt: '2026-08-19T14:32:45.900Z',
  decidedAt: '2026-08-19T14:32:45.900Z',
};

/**
 * The two read routes T-19 added, and the one thing about them that is not
 * obvious: the listing is restricted by **role**, which no other listing in the
 * gateway is.
 *
 * That is not a stricter reading of D-06. It is the only defence available:
 * Account Service narrows its listing to what the asker owns, and Payment
 * Service cannot, because a payment row holds a `transactionId` and no customer
 * reference at all. An unrestricted listing would therefore hand every
 * authenticated `CLIENTE` every payment in the bank. These tests exist so that
 * relaxing the restriction is a decision somebody has to take deliberately.
 */
describe('the payment routes', () => {
  let harness: Harness;
  let app: INestApplication;

  beforeEach(async () => {
    harness = await buildHarness([PaymentsController]);
    app = harness.app;
  });

  afterEach(async () => {
    await app.close();
  });

  function tokenFor(role: Role): string {
    return harness.tokens.sign({ customerId: CUSTOMER_ID, username: 'ana.lopez', role });
  }

  describe('the monitoring listing', () => {
    it.each<Role>(['CAJERO_RECEPTOR', 'ADMINISTRADOR'])('admits %s', async (role) => {
      harness.replier.answerWith(paymentListRepliedV1.name, { payments: [PAYMENT] });

      const response = await request(app.getHttpServer())
        .get('/api/payments')
        .set('Authorization', `Bearer ${tokenFor(role)}`);

      expect(response.status).toBe(200);
      expect(response.body.payments).toHaveLength(1);
      expect(harness.publisher.lastType).toBe(paymentListQueryV1.name);
    });

    /**
     * The assertion that matters is not the `403` — it is that nothing was
     * published. A refusal that still put the question on the broker would let
     * a `CLIENTE` cause work in a service they may not read.
     */
    it('refuses CLIENTE without asking the broker anything', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/payments')
        .set('Authorization', `Bearer ${tokenFor('CLIENTE')}`);

      expect(response.status).toBe(403);
      expect(response.body.type).toBe('FORBIDDEN');
      expect(harness.publisher.published).toHaveLength(0);
    });

    it('separates "sign in again" from "not for you"', async () => {
      const anonymous = await request(app.getHttpServer()).get('/api/payments');

      expect(anonymous.status).toBe(401);
    });

    it('carries the filters through as a request, not as a permission', async () => {
      harness.replier.answerWith(paymentListRepliedV1.name, { payments: [] });

      const response = await request(app.getHttpServer())
        .get('/api/payments')
        .query({ status: 'FAILED', errorType: 'PERMANENT' })
        .set('Authorization', `Bearer ${tokenFor('ADMINISTRADOR')}`);

      expect(response.status).toBe(200);
      expect(harness.publisher.published[0]?.payload).toEqual({
        status: 'FAILED',
        errorType: 'PERMANENT',
      });
    });

    it('refuses a filter value outside the enum, before publishing', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/payments')
        .query({ status: 'APPROVED' })
        .set('Authorization', `Bearer ${tokenFor('ADMINISTRADOR')}`);

      expect(response.status).toBe(400);
      expect(harness.publisher.published).toHaveLength(0);
    });
  });

  describe('one payment', () => {
    it('answers every role, like the transfer status it mirrors', async () => {
      harness.replier.answerWith(paymentStatusRepliedV1.name, {
        outcome: 'FOUND',
        payment: PAYMENT,
        attempts: [
          {
            attemptNumber: 1,
            result: 'FAILED',
            errorType: 'TRANSIENT',
            failureReason: null,
            providerResult: 'TIMEOUT',
            occurredAt: '2026-08-19T14:32:09.100Z',
          },
        ],
      });

      const response = await request(app.getHttpServer())
        .get(`/api/payments/${PAYMENT_ID}`)
        .set('Authorization', `Bearer ${tokenFor('CLIENTE')}`);

      expect(response.status).toBe(200);
      expect(response.body.payment.paymentId).toBe(PAYMENT_ID);
      expect(response.body.attempts).toHaveLength(1);
      expect(harness.publisher.lastType).toBe(paymentStatusQueryV1.name);
    });

    it('refuses an identifier that is not a UUID v4 without publishing', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/payments/not-a-uuid')
        .set('Authorization', `Bearer ${tokenFor('ADMINISTRADOR')}`);

      expect(response.status).toBe(400);
      expect(harness.publisher.published).toHaveLength(0);
    });

    it('renders an absent payment as a business rejection, not as an error', async () => {
      harness.replier.answerWith(paymentStatusRepliedV1.name, { outcome: 'NOT_FOUND' });

      const response = await request(app.getHttpServer())
        .get(`/api/payments/${PAYMENT_ID}`)
        .set('Authorization', `Bearer ${tokenFor('ADMINISTRADOR')}`);

      expect(response.status).toBe(409);
      expect(response.body.type).toBe('BUSINESS_REJECTION');
    });

    /**
     * A payment that never answers is not a payment that failed. The gateway
     * stopped waiting; Payment Service is still climbing its retry ladder, and
     * a screen that read `504` as "rejected" would announce a compensation that
     * never happened.
     */
    it('answers 504 when nobody replies, and says nothing about the outcome', async () => {
      harness.replier.staySilent();

      const response = await request(app.getHttpServer())
        .get(`/api/payments/${PAYMENT_ID}`)
        .set('Authorization', `Bearer ${tokenFor('ADMINISTRADOR')}`);

      expect(response.status).toBe(504);
      expect(response.body.type).toBe('REPLY_TIMEOUT');
    });

    /**
     * A reply that does not match the contract is an internal error, never
     * something forwarded to a browser. Payment Service is written by another
     * ticket against the same contract; this is what stops a drift in it from
     * reaching a customer as a half-parsed object.
     */
    it('refuses to forward a reply that does not match the contract', async () => {
      harness.replier.answerWith(paymentStatusRepliedV1.name, {
        outcome: 'FOUND',
        payment: { ...PAYMENT, status: 'APPROVED' },
        attempts: [],
      });

      const response = await request(app.getHttpServer())
        .get(`/api/payments/${PAYMENT_ID}`)
        .set('Authorization', `Bearer ${tokenFor('ADMINISTRADOR')}`);

      expect(response.status).toBe(500);
    });
  });
});
