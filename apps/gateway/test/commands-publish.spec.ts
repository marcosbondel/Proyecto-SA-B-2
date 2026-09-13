import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import {
  accountCreateV1,
  accountSetStatusV1,
  customerRegisterV1,
  customerSetKycStatusV1,
  customerUpdateV1,
  transferRequestedV1,
  validateMessage,
} from '@bank/contracts';

import { AccountsController } from '../src/interfaces/accounts.controller';
import { CustomersController } from '../src/interfaces/customers.controller';
import { TransfersController } from '../src/interfaces/transfers.controller';
import { buildHarness } from './support/harness';
import type { Harness } from './support/harness';

const ACTOR = '3f2a1c04-9c2e-4a71-b8f5-2d6e7c0a1b93';
const SOURCE = '8b7e5d21-9c2e-4a71-b8f5-2d6e7c0a1b93';
const TARGET = '1d4c9f60-9c2e-4a71-b8f5-2d6e7c0a1b93';

const VALID_REGISTRATION = {
  fullName: 'Ana López',
  identityDocument: '1234567890101',
  email: 'ana@example.com',
  dateOfBirth: '1995-04-12',
  address: 'Zona 1, Guatemala',
  role: 'CLIENTE',
  credential: 'una-contrasena-larga',
};

describe('the five asynchronous commands', () => {
  let harness: Harness;
  let app: INestApplication;
  let auth: string;
  let admin: string;

  beforeEach(async () => {
    harness = await buildHarness([CustomersController, AccountsController, TransfersController]);
    app = harness.app;
    auth = `Bearer ${harness.tokens.sign({ customerId: ACTOR, username: 'ana', role: 'CLIENTE' })}`;
    admin = `Bearer ${harness.tokens.sign({ customerId: ACTOR, username: 'ana', role: 'ADMINISTRADOR' })}`;
  });

  afterEach(async () => {
    await app.close();
  });

  describe('each one publishes the contract that belongs to it', () => {
    it('registers a customer', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/customers')
        .field(VALID_REGISTRATION);

      expect(response.status).toBe(202);
      expect(response.body.customerId).toBeDefined();
      expect(response.body.correlationId).toBeDefined();
      expect(harness.publisher.lastType).toBe(customerRegisterV1.name);
    });

    it('updates a customer', async () => {
      const response = await request(app.getHttpServer())
        .patch(`/api/customers/${ACTOR}`)
        .set('Authorization', auth)
        .send({ address: 'Zona 10, Guatemala' });

      expect(response.status).toBe(202);
      expect(harness.publisher.lastType).toBe(customerUpdateV1.name);
    });

    it('opens an account', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/accounts')
        .set('Authorization', auth)
        .send({ accountType: 'AHORRO' });

      expect(response.status).toBe(202);
      expect(response.body.accountId).toBeDefined();
      expect(harness.publisher.lastType).toBe(accountCreateV1.name);
    });

    /**
     * T-27: the gateway forwards `initialDeposit` as given — it does not
     * decide whether AHORRO's minimum is met (X-7), only that the request is
     * shaped like an amount.
     */
    it('carries the initial deposit through to account.create.v1, when one is given', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/accounts')
        .set('Authorization', auth)
        .send({ accountType: 'AHORRO', initialDeposit: { amountMinor: 10_000, currency: 'GTQ' } });

      expect(response.status).toBe(202);
      expect(harness.publisher.lastType).toBe(accountCreateV1.name);
      expect(harness.publisher.published.at(-1)?.payload).toMatchObject({
        initialDeposit: { amountMinor: 10_000, currency: 'GTQ' },
      });
    });

    it('leaves initialDeposit out of account.create.v1 when none is given', async () => {
      await request(app.getHttpServer())
        .post('/api/accounts')
        .set('Authorization', auth)
        .send({ accountType: 'MONETARIA' });

      const payload = harness.publisher.published.at(-1)?.payload as Record<string, unknown>;

      expect(payload).not.toHaveProperty('initialDeposit');
    });

    it('requests a transfer', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/transfers')
        .set('Authorization', auth)
        .send({
          sourceAccount: SOURCE,
          targetAccount: TARGET,
          amount: { amountMinor: 125_000, currency: 'GTQ' },
        });

      expect(response.status).toBe(202);
      expect(response.body.transactionId).toBeDefined();
      expect(harness.publisher.lastType).toBe(transferRequestedV1.name);
    });
  });

  /**
   * Publishing something the catalogue would refuse is worse than refusing the
   * request: the message dies in a consumer, far from the caller who caused it.
   * `validateMessage` is the same check the consumers run.
   */
  it('publishes only envelopes the catalogue itself accepts', async () => {
    await request(app.getHttpServer()).post('/api/customers').field(VALID_REGISTRATION);
    await request(app.getHttpServer())
      .post('/api/accounts')
      .set('Authorization', auth)
      .send({ accountType: 'MONETARIA' });
    await request(app.getHttpServer())
      .post('/api/transfers')
      .set('Authorization', auth)
      .send({
        sourceAccount: SOURCE,
        targetAccount: TARGET,
        amount: { amountMinor: 500, currency: 'GTQ' },
      });

    expect(harness.publisher.published).toHaveLength(3);

    for (const envelope of harness.publisher.published) {
      expect(validateMessage(envelope).ok).toBe(true);
    }
  });

  it('answers 202 rather than 201, because nothing has been created yet', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/accounts')
      .set('Authorization', auth)
      .send({ accountType: 'MONETARIA' });

    // A `201 Created` with a location would be a lie with a URL attached.
    expect(response.status).toBe(202);
    expect(response.headers.location).toBeUndefined();
  });

  /**
   * The one account route decision D-06 restricts by role rather than by scope.
   * The guard is asserted here as well as in `roles-guard.spec.ts` because the
   * fixture there proves the mechanism; this proves it is actually wired to
   * this route.
   */
  describe('activating or deactivating an account by hand', () => {
    const STATUS_CHANGE = { status: 'INACTIVE', reason: 'Solicitud del titular' };

    it('publishes account.set-status.v1 for an administrator, and answers 202', async () => {
      const response = await request(app.getHttpServer())
        .post(`/api/accounts/${SOURCE}/status`)
        .set('Authorization', admin)
        .send(STATUS_CHANGE);

      expect(response.status).toBe(202);
      expect(harness.publisher.lastType).toBe(accountSetStatusV1.name);
      expect(harness.publisher.published.at(-1)?.payload).toEqual({
        accountId: SOURCE,
        ...STATUS_CHANGE,
      });
    });

    it.each(['CLIENTE', 'CAJERO_RECEPTOR'] as const)('refuses %s with 403 and publishes nothing', async (role) => {
      const token = harness.tokens.sign({ customerId: ACTOR, username: 'ana', role });

      const response = await request(app.getHttpServer())
        .post(`/api/accounts/${SOURCE}/status`)
        .set('Authorization', `Bearer ${token}`)
        .send(STATUS_CHANGE);

      expect(response.status).toBe(403);
      expect(harness.publisher.published).toHaveLength(0);
    });

    /**
     * The reason is the only record of *why* a manual deactivation happened —
     * there is no automatic trigger behind it to infer it from.
     */
    it('refuses a change with no reason, before publishing anything', async () => {
      const response = await request(app.getHttpServer())
        .post(`/api/accounts/${SOURCE}/status`)
        .set('Authorization', admin)
        .send({ status: 'INACTIVE' });

      expect(response.status).toBe(400);
      expect(harness.publisher.published).toHaveLength(0);
    });

    it('refuses a status outside the closed set', async () => {
      const response = await request(app.getHttpServer())
        .post(`/api/accounts/${SOURCE}/status`)
        .set('Authorization', admin)
        .send({ status: 'CERRADA', reason: 'lo que sea' });

      expect(response.status).toBe(400);
      expect(harness.publisher.published).toHaveLength(0);
    });
  });

  /**
   * T-31's KYC gate needs a way for staff to actually set the verdict the
   * Saga later reads. `setIdentityVerdict` (Fase 1's document review) already
   * has this shape; this is its Fase 2 sibling.
   */
  describe('a teller registers a KYC verdict', () => {
    const CUSTOMER = '5c7e2d10-9c2e-4a71-b8f5-2d6e7c0a1b93';

    it('publishes customer.set-kyc-status.v1 for staff, and answers 202', async () => {
      const response = await request(app.getHttpServer())
        .post(`/api/customers/${CUSTOMER}/kyc-status`)
        .set('Authorization', admin)
        .send({ status: 'VERIFIED' });

      expect(response.status).toBe(202);
      expect(harness.publisher.lastType).toBe(customerSetKycStatusV1.name);
      expect(harness.publisher.published.at(-1)?.payload).toEqual({
        customerId: CUSTOMER,
        status: 'VERIFIED',
      });
    });

    it('refuses a CLIENTE with 403 and publishes nothing', async () => {
      const response = await request(app.getHttpServer())
        .post(`/api/customers/${CUSTOMER}/kyc-status`)
        .set('Authorization', auth)
        .send({ status: 'VERIFIED' });

      expect(response.status).toBe(403);
      expect(harness.publisher.published).toHaveLength(0);
    });

    it('refuses a status outside VERIFIED/REJECTED, before publishing anything', async () => {
      const response = await request(app.getHttpServer())
        .post(`/api/customers/${CUSTOMER}/kyc-status`)
        .set('Authorization', admin)
        .send({ status: 'PENDING' });

      expect(response.status).toBe(400);
      expect(harness.publisher.published).toHaveLength(0);
    });

    it('refuses a malformed customerId, before publishing anything', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/customers/not-a-uuid/kyc-status')
        .set('Authorization', admin)
        .send({ status: 'VERIFIED' });

      expect(response.status).toBe(400);
      expect(harness.publisher.published).toHaveLength(0);
    });
  });

  it('returns no business outcome, only an identifier to ask with', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/transfers')
      .set('Authorization', auth)
      .send({
        sourceAccount: SOURCE,
        targetAccount: TARGET,
        amount: { amountMinor: 100, currency: 'GTQ' },
      });

    expect(Object.keys(response.body).sort()).toEqual(['correlationId', 'transactionId']);
  });
});
