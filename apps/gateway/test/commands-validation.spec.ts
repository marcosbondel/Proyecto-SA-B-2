import request from 'supertest';
import type { INestApplication } from '@nestjs/common';

import { AccountsController } from '../src/interfaces/accounts.controller';
import { CustomersController } from '../src/interfaces/customers.controller';
import { TransfersController } from '../src/interfaces/transfers.controller';
import { accountIsVisible } from './support/account-replies';
import { buildHarness } from './support/harness';
import type { Harness } from './support/harness';

const ACTOR = '3f2a1c04-9c2e-4a71-b8f5-2d6e7c0a1b93';
const SOURCE = '8b7e5d21-9c2e-4a71-b8f5-2d6e7c0a1b93';
const TARGET = '1d4c9f60-9c2e-4a71-b8f5-2d6e7c0a1b93';

const VALID_TRANSFER = {
  sourceAccount: SOURCE,
  targetAccount: TARGET,
  amount: { amountMinor: 125_000, currency: 'GTQ' },
};

/**
 * A rejected request must reach the broker exactly never.
 *
 * This is the assertion that carries the most weight in the whole suite. A
 * gateway that answered `400` after publishing would have told the caller
 * nothing happened while something had — and the caller would have no
 * correlation to chase it with, because they were told it was refused.
 */
describe('a request that fails validation', () => {
  let harness: Harness;
  let app: INestApplication;
  let auth: string;

  beforeEach(async () => {
    harness = await buildHarness([CustomersController, AccountsController, TransfersController]);
    app = harness.app;
    auth = `Bearer ${harness.tokens.sign({ customerId: ACTOR, username: 'ana', role: 'CLIENTE' })}`;
    accountIsVisible(harness, SOURCE);
  });

  afterEach(async () => {
    await app.close();
  });

  describe('on a transfer', () => {
    it.each([
      ['no amount at all', { ...VALID_TRANSFER, amount: undefined }],
      ['an amount of zero', { ...VALID_TRANSFER, amount: { amountMinor: 0, currency: 'GTQ' } }],
      [
        'a negative amount',
        { ...VALID_TRANSFER, amount: { amountMinor: -1, currency: 'GTQ' } },
      ],
      [
        'an amount with decimals',
        { ...VALID_TRANSFER, amount: { amountMinor: 12.5, currency: 'GTQ' } },
      ],
      ['a source that is not a UUID', { ...VALID_TRANSFER, sourceAccount: 'nope' }],
      ['the same account twice', { ...VALID_TRANSFER, targetAccount: SOURCE }],
      ['a currency that is not ISO-4217', {
        ...VALID_TRANSFER,
        amount: { amountMinor: 100, currency: 'quetzales' },
      }],
    ])('is refused when it sends %s, and publishes nothing', async (_case, body) => {
      const response = await request(app.getHttpServer())
        .post('/api/transfers')
        .set('Authorization', auth)
        .send(body);

      expect(response.status).toBe(400);
      expect(response.body.type).toBe('VALIDATION_ERROR');
      // No command. A CLIENTE's request may have asked Account whether the
      // source is theirs before the contract rejected the pair (T-60) — a read.
      expect(
        harness.publisher.published.filter((m) => m.messageType === 'transfer.requested.v1'),
      ).toHaveLength(0);
    });

    it('names the field that is wrong, rather than saying the request is', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/transfers')
        .set('Authorization', auth)
        .send({ ...VALID_TRANSFER, sourceAccount: 'nope' });

      expect(response.body.field).toBe('sourceAccount');
    });
  });

  describe('on opening an account', () => {
    it.each([
      ['no account type', {}],
      ['an account type nobody defined', { accountType: 'PLAZO_FIJO' }],
      ['a subject that is not a UUID', { accountType: 'AHORRO', customerId: 'nope' }],
      /**
       * T-27: only the shape of `initialDeposit` is this gateway's to check —
       * whether AHORRO's Q100.00 minimum is met is Account Service's decision
       * (X-7), so a malformed amount is refused here but a *low* one is not.
       */
      [
        'an initial deposit with a negative amount',
        { accountType: 'AHORRO', initialDeposit: { amountMinor: -100, currency: 'GTQ' } },
      ],
      [
        'an initial deposit with no currency',
        { accountType: 'AHORRO', initialDeposit: { amountMinor: 10_000 } },
      ],
    ])('is refused when it sends %s, and publishes nothing', async (_case, body) => {
      const response = await request(app.getHttpServer())
        .post('/api/accounts')
        .set('Authorization', auth)
        .send(body);

      expect(response.status).toBe(400);
      expect(harness.publisher.published).toHaveLength(0);
    });
  });

  describe('on updating a customer', () => {
    /** The contract refuses an update that changes nothing (`customer.update.v1`). */
    it('is refused when it changes nothing at all', async () => {
      const response = await request(app.getHttpServer())
        .patch(`/api/customers/${ACTOR}`)
        .set('Authorization', auth)
        .send({});

      expect(response.status).toBe(400);
      expect(harness.publisher.published).toHaveLength(0);
    });

    it('is refused when the subject in the path is not a UUID', async () => {
      const response = await request(app.getHttpServer())
        .patch('/api/customers/not-a-uuid')
        .set('Authorization', auth)
        .send({ address: 'Zona 10' });

      expect(response.status).toBe(400);
      expect(response.body.field).toBe('customerId');
      expect(harness.publisher.published).toHaveLength(0);
    });
  });

  describe('on registering a customer', () => {
    it.each([
      ['an address that is not an email', 'email', 'not-an-address'],
      ['a birth date that is not a date', 'dateOfBirth', '12/04/1995'],
      ['a role nobody defined', 'role', 'GERENTE'],
    ])('is refused when it sends %s, and publishes nothing', async (_case, field, value) => {
      const response = await request(app.getHttpServer())
        .post('/api/customers')
        .field({
          fullName: 'Ana López',
          identityDocument: '1234567890101',
          email: 'ana@example.com',
          dateOfBirth: '1995-04-12',
          address: 'Zona 1',
          role: 'CLIENTE',
          credential: 'una-contrasena-larga',
          [field]: value,
        });

      expect(response.status).toBe(400);
      expect(harness.publisher.published).toHaveLength(0);
    });

    it('is refused when the password is shorter than the contract allows', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/customers')
        .field({
          fullName: 'Ana López',
          identityDocument: '1234567890101',
          email: 'ana@example.com',
          dateOfBirth: '1995-04-12',
          address: 'Zona 1',
          role: 'CLIENTE',
          credential: 'corta',
        });

      expect(response.status).toBe(400);
      expect(harness.publisher.published).toHaveLength(0);
    });
  });

  /**
   * `whitelist` and `forbidNonWhitelisted` are what stop an undeclared field
   * from riding along to the broker, where some service would eventually be
   * tempted to read it.
   */
  it('is refused when it carries a field nobody declared', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/transfers')
      .set('Authorization', auth)
      .send({ ...VALID_TRANSFER, fee: { amountMinor: 1, currency: 'GTQ' } });

    expect(response.status).toBe(400);
    expect(harness.publisher.published).toHaveLength(0);
  });
});
