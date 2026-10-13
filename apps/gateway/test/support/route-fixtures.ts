import { randomUUID } from 'node:crypto';

import request from 'supertest';
import type { Role } from '@bank/contracts';

import {
  TEST_ALERT_WEBHOOK_TOKEN,
  TEST_INTERBANK_PARTNER_TOKEN,
  bearerFor,
} from './broker-harness';
import type { BrokerHarness } from './broker-harness';

/**
 * One valid HTTP request per entry of `ROUTE_MESSAGES`
 * (`apps/gateway/src/openapi/route-messages.ts`), shared by every suite in
 * this directory that needs to drive every path against a real
 * broker.
 *
 * Kept in one place because `publish-routing.integration.spec.ts` and
 * `reply-correlation.integration.spec.ts` both need to build a request per
 * route, and a valid body for `TransferDto` or `RegisterCustomerDto` is not
 * something either file should decide twice — a DTO that grows a required
 * field would then need two fixes to keep both suites green.
 *
 * Every key here **must** match a key of `ROUTE_MESSAGES` exactly; the suites
 * assert that with `it.each(Object.keys(ROUTE_MESSAGES))` and fail loudly on a
 * route this table has not caught up with.
 */

export const CUSTOMER_ID = randomUUID();
export const OTHER_CUSTOMER_ID = randomUUID();
export const ACCOUNT_ID = randomUUID();
export const SOURCE_ACCOUNT = randomUUID();
export const TARGET_ACCOUNT = randomUUID();
export const TRANSACTION_ID = randomUUID();
export const PAYMENT_ID = randomUUID();

function randomDigits(length: number): string {
  let out = '';
  for (let i = 0; i < length; i += 1) {
    out += String(Math.floor(Math.random() * 10));
  }
  return out;
}

function registrationBody(): Record<string, string> {
  return {
    fullName: 'Ana López',
    identityDocument: randomDigits(13),
    email: `ana-${randomUUID()}@example.test`,
    dateOfBirth: '1995-04-12',
    address: 'Zona 1, Guatemala',
    role: 'CLIENTE',
    credential: 'una-contrasena-larga',
  };
}

export type RouteRequestBuilder = (harness: BrokerHarness) => request.Test;

function auth(harness: BrokerHarness, role: Role, customerId?: string): string {
  return bearerFor(harness, role, customerId);
}

/**
 * `ROUTE_MESSAGES`' own keys, mapped to a request that exercises exactly that
 * route. Every request is one the DTOs accept — none of these are meant to
 * fail validation.
 */
export const ROUTE_REQUESTS: Readonly<Record<string, RouteRequestBuilder>> = {
  'GET /api/dashboard': (h) =>
    request(h.app.getHttpServer()).get('/api/dashboard').set('Authorization', auth(h, 'CLIENTE')),

  'POST /api/auth/login': (h) =>
    request(h.app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: 'ana@example.com', credential: 'una-contrasena-larga' }),

  'POST /api/auth/password-reset': (h) =>
    request(h.app.getHttpServer())
      .post('/api/auth/password-reset')
      .send({ email: 'ana@example.com' }),

  'POST /api/auth/password-reset/confirm': (h) =>
    request(h.app.getHttpServer())
      .post('/api/auth/password-reset/confirm')
      .send({ resetToken: 'b'.repeat(64), credential: 'una-clave-nueva-larga' }),

  'POST /api/customers': (h) =>
    request(h.app.getHttpServer()).post('/api/customers').field(registrationBody()),

  'GET /api/customers/verify-email': (h) =>
    request(h.app.getHttpServer()).get(`/api/customers/verify-email?token=${'a'.repeat(64)}`),

  'PATCH /api/customers/{customerId}': (h) =>
    request(h.app.getHttpServer())
      .patch(`/api/customers/${CUSTOMER_ID}`)
      .set('Authorization', auth(h, 'CLIENTE', CUSTOMER_ID))
      .send({ address: 'Zona 10, Guatemala' }),

  'POST /api/customers/{customerId}/password': (h) =>
    request(h.app.getHttpServer())
      .post(`/api/customers/${CUSTOMER_ID}/password`)
      .set('Authorization', auth(h, 'CLIENTE', CUSTOMER_ID))
      .send({ currentCredential: 'la-clave-de-ahora', newCredential: 'la-clave-siguiente' }),

  'GET /api/customers': (h) =>
    request(h.app.getHttpServer())
      .get('/api/customers')
      .set('Authorization', auth(h, 'ADMINISTRADOR')),

  'GET /api/customers/pending-validation': (h) =>
    request(h.app.getHttpServer())
      .get('/api/customers/pending-validation')
      .set('Authorization', auth(h, 'ADMINISTRADOR')),

  'POST /api/customers/{customerId}/identity-verdict': (h) =>
    request(h.app.getHttpServer())
      .post(`/api/customers/${CUSTOMER_ID}/identity-verdict`)
      .set('Authorization', auth(h, 'ADMINISTRADOR'))
      .send({ verdict: 'VALIDATED' }),

  'POST /api/customers/{customerId}/kyc-status': (h) =>
    request(h.app.getHttpServer())
      .post(`/api/customers/${CUSTOMER_ID}/kyc-status`)
      .set('Authorization', auth(h, 'ADMINISTRADOR'))
      .send({ status: 'VERIFIED' }),

  'GET /api/customers/{customerId}/identity-document': (h) =>
    request(h.app.getHttpServer())
      .get(`/api/customers/${CUSTOMER_ID}/identity-document`)
      .set('Authorization', auth(h, 'ADMINISTRADOR')),

  'GET /api/customers/{customerId}': (h) =>
    request(h.app.getHttpServer())
      .get(`/api/customers/${CUSTOMER_ID}`)
      .set('Authorization', auth(h, 'ADMINISTRADOR')),

  'POST /api/accounts': (h) =>
    request(h.app.getHttpServer())
      .post('/api/accounts')
      .set('Authorization', auth(h, 'CLIENTE'))
      .send({ accountType: 'MONETARIA' }),

  'GET /api/accounts/{accountId}/balance': (h) =>
    request(h.app.getHttpServer())
      .get(`/api/accounts/${ACCOUNT_ID}/balance`)
      .set('Authorization', auth(h, 'CLIENTE')),

  'GET /api/accounts': (h) =>
    request(h.app.getHttpServer()).get('/api/accounts').set('Authorization', auth(h, 'CLIENTE')),

  'GET /api/accounts/{accountId}/operations': (h) =>
    request(h.app.getHttpServer())
      .get(`/api/accounts/${ACCOUNT_ID}/operations`)
      .set('Authorization', auth(h, 'CLIENTE')),

  'GET /api/accounts/billers': (h) =>
    request(h.app.getHttpServer())
      .get('/api/accounts/billers')
      .set('Authorization', auth(h, 'CLIENTE')),

  'POST /api/accounts/{accountId}/deposit': (h) =>
    request(h.app.getHttpServer())
      .post(`/api/accounts/${ACCOUNT_ID}/deposit`)
      .set('Authorization', auth(h, 'CAJERO_RECEPTOR'))
      .send({ amount: { amountMinor: 10_000, currency: 'GTQ' }, description: 'Depósito en ventanilla' }),

  'POST /api/accounts/{accountId}/status': (h) =>
    request(h.app.getHttpServer())
      .post(`/api/accounts/${ACCOUNT_ID}/status`)
      .set('Authorization', auth(h, 'ADMINISTRADOR'))
      .send({ status: 'INACTIVE', reason: 'Solicitud del titular' }),

  'POST /api/interbank/deposits': (h) => {
    const interbankTransferId = randomUUID();
    return request(h.app.getHttpServer())
      .post('/api/interbank/deposits')
      .set('Authorization', `Bearer ${TEST_INTERBANK_PARTNER_TOKEN}`)
      .send({
        interbankTransferId,
        idempotencyKey: interbankTransferId,
        originBankCode: 'PARTNER_MOCK',
        destinationBankCode: 'BANK_USAC',
        accountId: ACCOUNT_ID,
        amount: { amountMinor: 10_000, currency: 'GTQ' },
      });
  },

  'GET /api/notifications': (h) =>
    request(h.app.getHttpServer())
      .get('/api/notifications')
      .set('Authorization', auth(h, 'CLIENTE')),

  'POST /api/notifications/read': (h) =>
    request(h.app.getHttpServer())
      .post('/api/notifications/read')
      .set('Authorization', auth(h, 'CLIENTE'))
      .send({}),

  'GET /api/transfers': (h) =>
    request(h.app.getHttpServer()).get('/api/transfers').set('Authorization', auth(h, 'CLIENTE')),

  'POST /api/transfers': (h) =>
    request(h.app.getHttpServer())
      .post('/api/transfers')
      .set('Authorization', auth(h, 'CLIENTE'))
      .send({
        sourceAccount: SOURCE_ACCOUNT,
        targetAccount: TARGET_ACCOUNT,
        amount: { amountMinor: 125_000, currency: 'GTQ' },
      }),

  'GET /api/transfers/{transactionId}': (h) =>
    request(h.app.getHttpServer())
      .get(`/api/transfers/${TRANSACTION_ID}`)
      .set('Authorization', auth(h, 'CLIENTE')),

  'GET /api/payments': (h) =>
    request(h.app.getHttpServer())
      .get('/api/payments')
      .set('Authorization', auth(h, 'ADMINISTRADOR')),

  'GET /api/payments/simulation': (h) =>
    request(h.app.getHttpServer())
      .get('/api/payments/simulation')
      .set('Authorization', auth(h, 'ADMINISTRADOR')),

  // A reset, and not a set of rates. The integration suites that use this table
  // publish the request to a REAL broker, and on a machine where the stack is
  // running (or starts later, because `payment.commands` is durable) the real
  // Payment Service applies it. A reset only returns the simulation to the
  // ConfigMap's values, so the worst a stray run can do is clear an override;
  // 30 % of failures left behind silently turns every later transfer flaky.
  'PUT /api/payments/simulation': (h) =>
    request(h.app.getHttpServer())
      .put('/api/payments/simulation')
      .set('Authorization', auth(h, 'ADMINISTRADOR'))
      .send({ reset: true }),

  'GET /api/payments/{paymentId}': (h) =>
    request(h.app.getHttpServer())
      .get(`/api/payments/${PAYMENT_ID}`)
      .set('Authorization', auth(h, 'ADMINISTRADOR')),

  'GET /api/audit': (h) =>
    request(h.app.getHttpServer())
      .get(`/api/audit?correlationId=${randomUUID()}`)
      .set('Authorization', auth(h, 'ADMINISTRADOR')),

  /*
   * Published for real, and the Notification & Audit Service of a live stack
   * records it: a *resolved, informational* alert, so what it leaves in the
   * operators' console is a line that says nothing is wrong.
   */
  'POST /api/alerts/slo': (h) =>
    request(h.app.getHttpServer())
      .post('/api/alerts/slo')
      .set('Authorization', `Bearer ${TEST_ALERT_WEBHOOK_TOKEN}`)
      .send({
        status: 'resolved',
        alerts: [
          {
            status: 'resolved',
            labels: { alertname: 'RouteFixtureProbe', severity: 'info' },
            annotations: { summary: 'Sonda de las pruebas de rutas: no es una alerta real.' },
            startsAt: '2026-10-05T18:00:00Z',
          },
        ],
      }),

  'GET /api/audit/recent': (h) =>
    request(h.app.getHttpServer())
      .get('/api/audit/recent')
      .set('Authorization', auth(h, 'ADMINISTRADOR')),

  'GET /api/audit/notifications': (h) =>
    request(h.app.getHttpServer())
      .get('/api/audit/notifications')
      .set('Authorization', auth(h, 'ADMINISTRADOR')),
};
