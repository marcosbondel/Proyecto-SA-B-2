import type { INestApplication } from '@nestjs/common';
import request from 'supertest';

import { InterbankController } from '../src/interfaces/interbank.controller';
import { TEST_INTERBANK_TOKEN, buildHarness } from './support/harness';
import type { Harness } from './support/harness';

const BODY = {
  interbankTransferId: 'partner-1001',
  idempotencyKey: 'partner-1001',
  originBankCode: 'BANK99',
  destinationBankCode: 'BANK02',
  accountId: '7c9f1a30-2b48-4d56-9e01-2f3a4b5c6d70',
  amount: { amountMinor: 12500, currency: 'GTQ' },
  // Obligatorio desde T-56: §4.1 lo pide entre los datos mínimos, y hasta
  // entonces el borde era `.strict()` sin él — un banco que lo mandaba bien
  // recibía un 400 por mandarlo.
  timestamp: '2026-10-15T12:00:00.000Z',
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
    const { timestamp, ...sinSello } = BODY;

    expect(harness.publisher.published[0]).toMatchObject({
      messageType: 'payment.interbank.receive.v1',
      correlationId: response.body.correlationId,
      idempotencyKey: BODY.idempotencyKey,
      payload: {
        ...sinSello,
        /*
         * El sello del otro banco se renombra al cruzar el borde, y los dos
         * sobreviven: `timestamp` es cuándo dice ÉL que lo originó,
         * `requestedAt` cuándo lo recibimos NOSOTROS. Con uno solo no se puede
         * distinguir un reloj desfasado de un depósito que tardó en llegar.
         */
        partnerTimestamp: timestamp,
        requestedAt: expect.any(String),
      },
    });
    expect(harness.publisher.published[0]?.payload).not.toHaveProperty('timestamp');
  });

  it('acepta el monto decimal y lo convierte a centavos sin que un float lo toque', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/interbank/deposits')
      .set('Authorization', `Bearer ${TEST_INTERBANK_TOKEN}`)
      .send({ ...BODY, amount: { value: '1.15', currency: 'GTQ' } });

    expect(response.status).toBe(202);
    // `Math.round(1.15 * 100)` da 114. Esto da 115.
    expect(harness.publisher.published[0]?.payload).toMatchObject({
      amount: { amountMinor: 115, currency: 'GTQ' },
    });
  });

  it('acepta una cuenta que no es UUID, para poder rechazarla con motivo y callback', async () => {
    // Antes de T-56 esto era un 400 sin fila y sin callback: el otro banco se
    // quedaba esperando hasta que venciera su propio plazo, sin saber por qué.
    const response = await request(app.getHttpServer())
      .post('/api/interbank/deposits')
      .set('Authorization', `Bearer ${TEST_INTERBANK_TOKEN}`)
      .send({ ...BODY, accountId: '001-2345-6' });

    expect(response.status).toBe(202);
    expect(harness.publisher.published[0]?.payload).toMatchObject({ accountId: '001-2345-6' });
  });

  it('rechaza un cuerpo sin timestamp, que §4.1 exige', async () => {
    const { timestamp: _, ...sinSello } = BODY;

    const response = await request(app.getHttpServer())
      .post('/api/interbank/deposits')
      .set('Authorization', `Bearer ${TEST_INTERBANK_TOKEN}`)
      .send(sinSello);

    expect(response.status).toBe(400);
    expect(harness.publisher.published).toHaveLength(0);
  });

  it('rechaza un decimal con más de dos cifras en vez de redondearlo', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/interbank/deposits')
      .set('Authorization', `Bearer ${TEST_INTERBANK_TOKEN}`)
      .send({ ...BODY, amount: { value: '1.456', currency: 'GTQ' } });

    expect(response.status).toBe(400);
    expect(harness.publisher.published).toHaveLength(0);
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
