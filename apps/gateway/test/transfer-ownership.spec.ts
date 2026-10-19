import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import type { Role } from '@bank/contracts';

import { TransfersController } from '../src/interfaces/transfers.controller';
import { accountIsNotVisible, accountIsVisible } from './support/account-replies';
import { buildHarness } from './support/harness';
import type { Harness } from './support/harness';

const CUSTOMER_A = '3f2a1c04-9c2e-4a71-b8f5-2d6e7c0a1b93';
const CUSTOMER_B = '5b8e0f25-7c36-4a94-8d12-9f6b3e8c5a71';
const STAFF = '1e2d3c4b-5a69-4f78-9012-3456789abcde';
const SOURCE = '8b7e5d21-9c2e-4a71-b8f5-2d6e7c0a1b93';
const TARGET = '1d4c9f60-9c2e-4a71-b8f5-2d6e7c0a1b93';

const TRANSFER = {
  sourceAccount: SOURCE,
  targetAccount: TARGET,
  amount: { amountMinor: 125_000, currency: 'GTQ' },
};

/**
 * T-60 — D-06, CDU003.1: "Transferir fondos: Cliente desde cuentas propias |
 * Cajero en ventanilla | Administrador".
 *
 * The Gateway holds no accounts, so it cannot know who owns `SOURCE`. What it
 * can do cheaply is ask the service that does, through that service's own
 * visibility rule, before it starts a Saga for a transfer that cannot succeed.
 * The authority is still Account's debit (`debit-ownership.spec.ts` there); this
 * is the early, non-leaking answer.
 */
describe('POST /api/transfers: whose account may be named as the source (T-60)', () => {
  let harness: Harness;
  let app: INestApplication;

  const as = (role: Role, customerId: string): string =>
    `Bearer ${harness.tokens.sign({ customerId, username: 'quien', role })}`;

  const transfer = (authorization: string, body: object = TRANSFER): request.Test =>
    request(app.getHttpServer())
      .post('/api/transfers')
      .set('Authorization', authorization)
      .send(body);

  const published = (): string[] => harness.publisher.published.map((m) => m.messageType);

  beforeEach(async () => {
    harness = await buildHarness([TransfersController]);
    app = harness.app;
  });

  afterEach(async () => {
    await app.close();
  });

  describe('a CLIENTE', () => {
    it('transfers from an account Account says is theirs, after asking as themselves', async () => {
      accountIsVisible(harness, SOURCE);

      const response = await transfer(as('CLIENTE', CUSTOMER_A));

      expect(response.status).toBe(202);
      expect(published()).toEqual(['account.balance.query.v1', 'transfer.requested.v1']);
      expect(harness.publisher.published[0]!.payload).toEqual({ accountId: SOURCE });
      // The question is asked with the caller's own identity — that is what scopes the answer.
      expect(harness.publisher.published[0]!.identity).toEqual({
        customerId: CUSTOMER_A,
        role: 'CLIENTE',
      });
      expect(harness.publisher.published[1]!.identity).toEqual({
        customerId: CUSTOMER_A,
        role: 'CLIENTE',
      });
    });

    it('is told 404 ACCOUNT_NOT_FOUND for somebody else`s account, and no Saga starts', async () => {
      accountIsNotVisible(harness);

      const response = await transfer(as('CLIENTE', CUSTOMER_A));

      expect(response.status).toBe(404);
      expect(response.body.type).toBe('BUSINESS_REJECTION');
      expect(response.body.failureCode).toBe('ACCOUNT_NOT_FOUND');
      expect(published()).toEqual(['account.balance.query.v1']);
    });

    it('is refused 403 for naming another customer, before anything is asked or published', async () => {
      accountIsVisible(harness, SOURCE);

      const response = await transfer(as('CLIENTE', CUSTOMER_A), {
        ...TRANSFER,
        customerId: CUSTOMER_B,
      });

      expect(response.status).toBe(403);
      expect(response.body.failureCode).toBe('FORBIDDEN_ACCOUNT_ACCESS');
      expect(published()).toEqual([]);
    });

    it('may name themselves', async () => {
      accountIsVisible(harness, SOURCE);

      const response = await transfer(as('CLIENTE', CUSTOMER_A), {
        ...TRANSFER,
        customerId: CUSTOMER_A,
      });

      expect(response.status).toBe(202);
    });

    it('starts nothing when Account does not answer: a read timed out, no data was modified', async () => {
      harness.replier.staySilent();

      const response = await transfer(as('CLIENTE', CUSTOMER_A));

      expect(response.status).toBe(504);
      expect(published()).toEqual(['account.balance.query.v1']);
    });
  });

  describe.each(['CAJERO_RECEPTOR', 'ADMINISTRADOR'] as const)('%s', (role) => {
    it('originates a transfer on behalf of the customer they name, with no ownership read', async () => {
      // No scripted reply at all: asking would fail the request.
      const response = await transfer(as(role, STAFF), { ...TRANSFER, customerId: CUSTOMER_B });

      expect(response.status).toBe(202);
      expect(published()).toEqual(['transfer.requested.v1']);
      expect(harness.publisher.published[0]!.payload).toMatchObject({
        sourceAccount: SOURCE,
        customerId: CUSTOMER_B,
      });
    });

    it('still travels as staff: the envelope never says they are the customer', async () => {
      await transfer(as(role, STAFF), { ...TRANSFER, customerId: CUSTOMER_B });

      expect(harness.publisher.published[0]!.identity).toEqual({ customerId: STAFF, role });
    });
  });

  it('refuses an anonymous caller (401) and publishes nothing', async () => {
    const response = await request(app.getHttpServer()).post('/api/transfers').send(TRANSFER);

    expect(response.status).toBe(401);
    expect(published()).toEqual([]);
  });
});
