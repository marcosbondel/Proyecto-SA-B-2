import { randomUUID } from 'node:crypto';

import request from 'supertest';
import type { MessageEnvelope } from '@bank/contracts';

import {
  TEST_INTERBANK_API_KEY,
  bearerFor,
  buildBrokerHarness,
  closeBrokerHarness,
  fire,
} from './support/broker-harness';
import type { BrokerHarness } from './support/broker-harness';
import { ServiceDouble } from './support/service-double';

/**
 * El envío interbancario y su consulta, contra un RabbitMQ de verdad (T-60).
 *
 * Lo que sólo el broker real demuestra: que la pregunta a Account por el número
 * de cuenta origen llega por `bank.commands` y su respuesta, por `bank.replies`,
 * desbloquea la petición HTTP; que la Saga que se publica lleva `originAccount`;
 * y que las consultas de depósitos enviados viajan con la identidad de quien
 * pregunta, que es con lo que Payment decide qué puede ver.
 */

const RABBITMQ_URL = process.env.RABBITMQ_URL;
const describeBroker = RABBITMQ_URL ? describe : describe.skip;

jest.setTimeout(70_000);

describeBroker('enviar y consultar depósitos interbancarios, por el broker real', () => {
  let harness: BrokerHarness;
  let double: ServiceDouble;

  beforeAll(async () => {
    if (!RABBITMQ_URL) return;
    harness = await buildBrokerHarness({ replyTimeoutMs: 3_000 });
    double = await ServiceDouble.connect(RABBITMQ_URL);
    await double.spyOnEverythingPublished();
  });
  afterAll(async () => {
    if (!RABBITMQ_URL) return;
    await double.close();
    await closeBrokerHarness(harness);
  });

  const VISTA = {
    interbankTransferId: randomUUID(),
    paymentId: randomUUID(),
    transactionId: randomUUID(),
    state: 'SENT',
    reason: null,
    destinationBankCode: 'BANK99',
    destinationAccount: '********4567',
    originAccount: '02-000000052',
    amount: { amountMinor: 15_000, currency: 'GTQ' },
    correlationId: randomUUID(),
    traceId: null,
    createdAt: '2026-10-20T15:00:00.000Z',
    expiresAt: '2026-10-20T15:03:00.000Z',
    sentAt: '2026-10-20T15:00:01.000Z',
    decidedAt: null,
    reversedAt: null,
    attempts: 1,
    releasedUnverified: false,
    reversal: null,
  };

  /** Espera la primera pregunta de `messageType` con esta correlación. */
  async function pregunta(correlationId: string, messageType: string): Promise<MessageEnvelope<unknown>> {
    const captured = await double.waitForEnvelope(
      (e) => e.correlationId === correlationId && e.messageType === messageType,
      5_000,
    );

    return captured.envelope!;
  }

  const enviar = (correlationId: string, customerId: string, sourceAccount: string, amountMinor = 15_000) =>
    fire(
      request(harness.app.getHttpServer())
        .post('/api/interbank/transfers')
        .set('Authorization', bearerFor(harness, 'CLIENTE', customerId))
        .set('X-Correlation-Id', correlationId)
        .send({
          sourceAccount,
          destinationBankCode: 'BANK99',
          destinationAccount: '99-000004567',
          amount: { amountMinor, currency: 'GTQ' },
        }),
    );

  it('pregunta a Account el número de la cuenta origen y publica la Saga con originAccount', async () => {
    const correlationId = randomUUID();
    const customerId = randomUUID();
    const source = randomUUID();
    const pending = enviar(correlationId, customerId, source);

    const consulta = await pregunta(correlationId, 'account.balance.query.v1');
    expect(consulta.payload).toEqual({ accountId: source });
    expect(consulta.identity?.customerId).toBe(customerId);
    await double.reply(
      consulta,
      'account.balance.replied.v1',
      {
        outcome: 'FOUND',
        accountId: source,
        accountNumber: '02-000000052',
        balance: { amountMinor: 5_000_000, currency: 'GTQ' },
        status: 'ACTIVE',
        lastActivityAt: null,
      },
      { producer: 'account-service' },
    );

    const response = await pending;
    const saga = await pregunta(correlationId, 'transfer.requested.v1');

    expect(response.status).toBe(202);
    expect(saga.payload).toMatchObject({
      sourceAccount: source,
      interbank: { bankCode: 'BANK99', account: '99-000004567', originAccount: '02-000000052' },
    });
  });

  it('si Account no ve la cuenta, no se publica ninguna Saga', async () => {
    const correlationId = randomUUID();
    const source = randomUUID();
    const pending = enviar(correlationId, randomUUID(), source);

    const consulta = await pregunta(correlationId, 'account.balance.query.v1');
    await double.reply(
      consulta,
      'account.balance.replied.v1',
      { outcome: 'NOT_FOUND', reason: 'ACCOUNT_NOT_FOUND' },
      { producer: 'account-service' },
    );
    const response = await pending;
    await new Promise((resolve) => setTimeout(resolve, 300));

    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(
      double.captured.some(
        (m) => m.envelope?.correlationId === correlationId && m.envelope.messageType === 'transfer.requested.v1',
      ),
    ).toBe(false);
  });

  it('un monto por encima del límite se rechaza sin tocar el broker', async () => {
    const correlationId = randomUUID();

    const response = await enviar(correlationId, randomUUID(), randomUUID(), 1_000_001);
    await new Promise((resolve) => setTimeout(resolve, 300));

    expect(response.status).toBe(400);
    expect(double.captured.some((m) => m.envelope?.correlationId === correlationId)).toBe(false);
  });

  it('GET /api/interbank/transfers lleva la identidad al broker y devuelve lo que Payment contesta', async () => {
    const correlationId = randomUUID();
    const customerId = randomUUID();
    const pending = fire(
      request(harness.app.getHttpServer())
        .get('/api/interbank/transfers?state=SENT&limit=5')
        .set('Authorization', bearerFor(harness, 'CLIENTE', customerId))
        .set('X-Correlation-Id', correlationId),
    );

    const consulta = await pregunta(correlationId, 'payment.interbank.send.list.query.v1');
    expect(consulta.payload).toEqual({ state: 'SENT', limit: 5 });
    expect(consulta.identity).toMatchObject({ customerId, role: 'CLIENTE' });
    await double.reply(consulta, 'payment.interbank.send.list.replied.v1', { sends: [VISTA] }, { producer: 'payment-service' });
    const response = await pending;

    expect(response.status).toBe(200);
    expect(response.body.sends).toHaveLength(1);
    expect(response.body.sends[0].state).toBe('SENT');
  });

  it('GET /api/interbank/transfers/{id} devuelve el depósito con su historial', async () => {
    const correlationId = randomUUID();
    const id = randomUUID();
    const pending = fire(
      request(harness.app.getHttpServer())
        .get(`/api/interbank/transfers/${id}`)
        .set('Authorization', bearerFor(harness, 'ADMINISTRADOR'))
        .set('X-Correlation-Id', correlationId),
    );

    const consulta = await pregunta(correlationId, 'payment.interbank.send.query.v1');
    expect(consulta.payload).toEqual({ interbankTransferId: id });
    await double.reply(
      consulta,
      'payment.interbank.send.replied.v1',
      {
        outcome: 'FOUND',
        send: { ...VISTA, interbankTransferId: id },
        history: [
          { state: 'PENDING', reason: null, at: '2026-10-20T15:00:00.000Z' },
          { state: 'SENT', reason: null, at: '2026-10-20T15:00:01.000Z' },
        ],
      },
      { producer: 'payment-service' },
    );
    const response = await pending;

    expect(response.status).toBe(200);
    expect(response.body.history.map((h: { state: string }) => h.state)).toEqual(['PENDING', 'SENT']);
  });

  it('un depósito ajeno o inexistente es un 404', async () => {
    const correlationId = randomUUID();
    const pending = fire(
      request(harness.app.getHttpServer())
        .get(`/api/interbank/transfers/${randomUUID()}`)
        .set('Authorization', bearerFor(harness, 'CLIENTE'))
        .set('X-Correlation-Id', correlationId),
    );

    const consulta = await pregunta(correlationId, 'payment.interbank.send.query.v1');
    await double.reply(consulta, 'payment.interbank.send.replied.v1', { outcome: 'NOT_FOUND' }, { producer: 'payment-service' });

    expect((await pending).status).toBe(404);
  });

  it('la cancelación con el crédito ya ordenado se contesta 503 al banco pareja', async () => {
    const correlationId = randomUUID();
    const id = randomUUID();
    const pending = fire(
      request(harness.app.getHttpServer())
        .post(`/interbank/v1/transfers/${id}/cancel`)
        .set('X-Api-Key', TEST_INTERBANK_API_KEY)
        .set('X-Correlation-Id', correlationId)
        .send({ originBankCode: 'BANK99', reason: 'TIMEOUT' }),
    );

    const consulta = await pregunta(correlationId, 'payment.interbank.v1.cancel.query.v1');
    await double.reply(
      consulta,
      'payment.interbank.v1.cancel.replied.v1',
      { interbankTransferId: id, result: 'IN_PROGRESS' },
      { producer: 'payment-service' },
    );
    const response = await pending;

    expect(response.status).toBe(503);
    expect(response.body.code).toBe('SERVICE_UNAVAILABLE');
  });

  it('la cancelación de un depósito ya acreditado se contesta ALREADY_ACCEPTED', async () => {
    const correlationId = randomUUID();
    const id = randomUUID();
    const pending = fire(
      request(harness.app.getHttpServer())
        .post(`/interbank/v1/transfers/${id}/cancel`)
        .set('X-Api-Key', TEST_INTERBANK_API_KEY)
        .set('X-Correlation-Id', correlationId)
        .send({ originBankCode: 'BANK99', reason: 'TIMEOUT' }),
    );

    const consulta = await pregunta(correlationId, 'payment.interbank.v1.cancel.query.v1');
    await double.reply(
      consulta,
      'payment.interbank.v1.cancel.replied.v1',
      { interbankTransferId: id, result: 'ALREADY_ACCEPTED' },
      { producer: 'payment-service' },
    );
    const response = await pending;

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ interbankTransferId: id, result: 'ALREADY_ACCEPTED' });
  });
});
