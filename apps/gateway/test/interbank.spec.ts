import type { INestApplication } from '@nestjs/common';
import request from 'supertest';

import { InterbankController } from '../src/interfaces/interbank.controller';
import { TEST_INTERBANK_TOKEN, buildHarness } from './support/harness';
import type { Harness } from './support/harness';

const BODY = {
  interbankTransferId: 'partner-1001',
  idempotencyKey: 'partner-1001',
  originBankCode: 'PARTNER_MOCK',
  destinationBankCode: 'BANK_USAC',
  accountId: '7c9f1a30-2b48-4d56-9e01-2f3a4b5c6d70',
  amount: { amountMinor: 12500, currency: 'GTQ' },
};

describe('partner bank ingress', () => {
  let harness: Harness;
  let app: INestApplication;
  beforeEach(async () => {
    harness = await buildHarness([InterbankController]);
    app = harness.app;
  });
  afterEach(async () => {
    await app.close();
  });

  it('accepts one authenticated command with the request correlation', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/interbank/deposits')
      .set('Authorization', `Bearer ${TEST_INTERBANK_TOKEN}`)
      .set('X-Correlation-Id', '6b63e5e8-13aa-4a3b-a56e-317b286676a0')
      .send(BODY);
    expect(response.status).toBe(202);
    expect(response.body).toMatchObject({
      correlationId: '6b63e5e8-13aa-4a3b-a56e-317b286676a0',
      depositId: expect.any(String),
    });
    expect(harness.publisher.published[0]).toMatchObject({
      messageType: 'payment.interbank.receive.v1',
      correlationId: response.body.correlationId,
      idempotencyKey: BODY.idempotencyKey,
      payload: BODY,
    });
  });

  it('returns the same deposit id when the partner retries the same transfer', async () => {
    const first = await request(app.getHttpServer())
      .post('/api/interbank/deposits')
      .set('Authorization', `Bearer ${TEST_INTERBANK_TOKEN}`)
      .send(BODY);
    const retried = await request(app.getHttpServer())
      .post('/api/interbank/deposits')
      .set('Authorization', `Bearer ${TEST_INTERBANK_TOKEN}`)
      .send(BODY);
    expect(first.status).toBe(202);
    expect(retried.status).toBe(202);
    expect(retried.body.depositId).toBe(first.body.depositId);
  });

  it('refuses missing or wrong tokens without publishing', async () => {
    const missing = await request(app.getHttpServer()).post('/api/interbank/deposits').send(BODY);
    const wrong = await request(app.getHttpServer())
      .post('/api/interbank/deposits')
      .set('Authorization', 'Bearer wrong')
      .send(BODY);
    expect([missing.status, wrong.status]).toEqual([401, 401]);
    expect(harness.publisher.published).toHaveLength(0);
  });

  it('refuses a malformed body without publishing', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/interbank/deposits')
      .set('Authorization', `Bearer ${TEST_INTERBANK_TOKEN}`)
      .send({ ...BODY, amount: { amountMinor: 1.5, currency: 'GTQ' } });
    expect(response.status).toBe(400);
    expect(harness.publisher.published).toHaveLength(0);
  });
});
