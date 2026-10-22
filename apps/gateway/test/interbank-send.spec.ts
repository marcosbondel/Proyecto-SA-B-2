import type { INestApplication } from '@nestjs/common';
import {
  accountBalanceRepliedV1,
  paymentInterbankSendListRepliedV1,
  paymentInterbankSendRepliedV1,
  paymentInterbankV1CancelRepliedV1,
} from '@bank/contracts';
import type { Role } from '@bank/contracts';
import request from 'supertest';

import { InterbankController } from '../src/interfaces/interbank.controller';
import { InterbankV1Controller } from '../src/interfaces/interbank-v1.controller';
import { TEST_INTERBANK_API_KEY, buildHarness } from './support/harness';
import type { Harness } from './support/harness';

/**
 * Enviar un depósito al banco pareja y consultarlo (T-60, B1/B7/B10).
 */

const CUSTOMER_ID = '3f2a1c04-9c2e-4a71-b8f5-2d6e7c0a1b93';
const SOURCE = '6f1c8a30-9c2e-4a71-b8f5-2d6e7c0a1b93';
const ID = '8f14e45f-ceea-467a-9b36-4b1c2d6a7e01';

const BODY = {
  sourceAccount: SOURCE,
  destinationBankCode: 'BANK99',
  destinationAccount: '99-000004567',
  amount: { amountMinor: 15_000, currency: 'GTQ' },
};

const SALDO = {
  outcome: 'FOUND' as const,
  accountId: SOURCE,
  accountNumber: '02-000000052',
  balance: { amountMinor: 500_000, currency: 'GTQ' },
  status: 'ACTIVE' as const,
  lastActivityAt: null,
};

const VISTA = {
  interbankTransferId: ID,
  paymentId: '00000000-0000-4000-8000-00000000aaaa',
  transactionId: '00000000-0000-4000-8000-00000000bbbb',
  state: 'TIMEOUT' as const,
  reason: 'CONFIRMATION_TIMEOUT',
  destinationBankCode: 'BANK99',
  destinationAccount: '********4567',
  originAccount: '02-000000052',
  amount: { amountMinor: 15_000, currency: 'GTQ' },
  correlationId: '00000000-0000-4000-8000-00000000cccc',
  traceId: '4bf92f3577b34da6a3ce929d0e0e4736',
  createdAt: '2026-10-20T15:00:00.000Z',
  expiresAt: '2026-10-20T15:03:00.000Z',
  sentAt: '2026-10-20T15:00:01.000Z',
  decidedAt: '2026-10-20T15:03:00.000Z',
  reversedAt: null,
  attempts: 1,
  releasedUnverified: false,
  reversal: null,
};

describe('enviar un depósito al banco pareja', () => {
  let harness: Harness;
  let app: INestApplication;

  beforeEach(async () => {
    harness = await buildHarness([InterbankController, InterbankV1Controller]);
    app = harness.app;
  });
  afterEach(async () => {
    await app.close();
  });

  const auth = (role: Role = 'CLIENTE'): string =>
    `Bearer ${harness.tokens.sign({ customerId: CUSTOMER_ID, username: 'ana', role })}`;
  const enviar = (body: unknown = BODY): request.Test =>
    request(app.getHttpServer())
      .post('/api/interbank/transfers')
      .set('Authorization', auth())
      .send(body as object);

  it('pregunta a Account el número de la cuenta origen y lo lleva en la Saga (B1)', async () => {
    harness.replier.answerWith(accountBalanceRepliedV1.name, SALDO);

    const response = await enviar();

    expect(response.status).toBe(202);
    expect(harness.publisher.published.map((e) => e.messageType)).toEqual([
      'account.balance.query.v1',
      'transfer.requested.v1',
    ]);
    const saga = harness.publisher.published[1]!;
    expect(saga.payload).toMatchObject({
      sourceAccount: SOURCE,
      interbank: {
        bankCode: 'BANK99',
        account: '99-000004567',
        originAccount: '02-000000052',
      },
    });
    // Un solo identificador, y es un UUID: el contrato exige Idempotency-Key == interbankTransferId.
    const interbank = (saga.payload as { interbank: Record<string, string> }).interbank;
    expect(interbank.interbankTransferId).toMatch(/^[0-9a-f-]{36}$/);
    expect(interbank.idempotencyKey).toBe(interbank.interbankTransferId);
    expect(response.body.interbankTransferId).toBe(interbank.interbankTransferId);
  });

  describe('quién puede originar un envío (D7a)', () => {
    const como = (role: Role): request.Test =>
      request(app.getHttpServer())
        .post('/api/interbank/transfers')
        .set('Authorization', auth(role))
        .send(BODY);

    it.each(['CAJERO_RECEPTOR', 'ADMINISTRADOR'] as const)(
      'un %s recibe 403 y no se publica nada, ni siquiera la pregunta a Account',
      async (role) => {
        harness.replier.answerWith(accountBalanceRepliedV1.name, SALDO);

        const response = await como(role);

        expect(response.status).toBe(403);
        expect(response.body.type).toBe('FORBIDDEN');
        expect(harness.publisher.published).toEqual([]);
      },
    );

    it('un CLIENTE sí puede, y la Saga lleva su identidad', async () => {
      harness.replier.answerWith(accountBalanceRepliedV1.name, SALDO);

      const response = await como('CLIENTE');

      expect(response.status).toBe(202);
      const saga = harness.publisher.published[1]!;
      expect(saga.identity).toEqual({ customerId: CUSTOMER_ID, role: 'CLIENTE' });
    });

    it('un CLIENTE con la cuenta de otro recibe NOT_FOUND de Account y no se envía nada', async () => {
      harness.replier.answerWith(accountBalanceRepliedV1.name, {
        outcome: 'NOT_FOUND',
        reason: 'ACCOUNT_NOT_FOUND',
      });

      const response = await como('CLIENTE');

      expect(response.status).toBeGreaterThanOrEqual(400);
      expect(harness.publisher.published.map((e) => e.messageType)).toEqual([
        'account.balance.query.v1',
      ]);
    });

    it('sin sesión, 401', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/interbank/transfers')
        .send(BODY);

      expect(response.status).toBe(401);
      expect(harness.publisher.published).toEqual([]);
    });
  });

  describe('reintentar con la misma Idempotency-Key (D7b)', () => {
    const conClave = (key: string, customerId: string = CUSTOMER_ID): request.Test =>
      request(app.getHttpServer())
        .post('/api/interbank/transfers')
        .set(
          'Authorization',
          `Bearer ${harness.tokens.sign({ customerId, username: 'ana', role: 'CLIENTE' })}`,
        )
        .set('Idempotency-Key', key)
        .send(BODY);

    it('devuelve el mismo interbankTransferId y el mismo transactionId que el original', async () => {
      harness.replier.answerWith(accountBalanceRepliedV1.name, SALDO);

      const first = await conClave('retry-key-1');
      const second = await conClave('retry-key-1');

      expect(first.status).toBe(202);
      expect(second.status).toBe(202);
      expect(second.body.interbankTransferId).toBe(first.body.interbankTransferId);
      expect(second.body.transactionId).toBe(first.body.transactionId);
      // Y el id devuelto es el que viaja en la Saga, el que Payment guarda y
      // el que `GET /api/interbank/transfers/{id}` sabrá encontrar.
      const sagas = harness.publisher.published.filter(
        (e) => e.messageType === 'transfer.requested.v1',
      );
      expect(sagas).toHaveLength(2);
      for (const saga of sagas) {
        const payload = saga.payload as {
          transactionId: string;
          interbank: { interbankTransferId: string };
        };
        expect(payload.transactionId).toBe(first.body.transactionId);
        expect(payload.interbank.interbankTransferId).toBe(first.body.interbankTransferId);
      }
    });

    it('el identificador es un UUID v4, que es lo que valida la consulta', async () => {
      harness.replier.answerWith(accountBalanceRepliedV1.name, SALDO);

      const response = await conClave('retry-key-2');

      expect(response.body.interbankTransferId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      );
    });

    it('otra clave, u otro cliente con la misma clave, da identificadores distintos', async () => {
      harness.replier.answerWith(accountBalanceRepliedV1.name, SALDO);

      const base = await conClave('retry-key-3');
      const otherKey = await conClave('retry-key-4');
      const otherCustomer = await conClave('retry-key-3', '7a2d9c10-9c2e-4a71-b8f5-2d6e7c0a1b93');

      expect(otherKey.body.interbankTransferId).not.toBe(base.body.interbankTransferId);
      expect(otherCustomer.body.interbankTransferId).not.toBe(base.body.interbankTransferId);
      expect(otherCustomer.body.transactionId).not.toBe(base.body.transactionId);
    });

    it('sin cabecera cada petición es independiente', async () => {
      harness.replier.answerWith(accountBalanceRepliedV1.name, SALDO);

      const first = await enviar();
      const second = await enviar();

      expect(second.body.interbankTransferId).not.toBe(first.body.interbankTransferId);
    });
  });

  it('envía a cualquier banco del registro, no sólo al primero (T-60)', async () => {
    harness.replier.answerWith(accountBalanceRepliedV1.name, SALDO);

    const response = await enviar({
      ...BODY,
      destinationBankCode: 'BANK16',
      destinationAccount: '8a7d5a9894e94aed8b21b94054ffc1ea',
    });

    expect(response.status).toBe(202);
    expect(harness.publisher.published[1]!.payload).toMatchObject({
      interbank: { bankCode: 'BANK16', account: '8a7d5a9894e94aed8b21b94054ffc1ea' },
    });
  });

  it('si Account no ve la cuenta, no se envía nada', async () => {
    harness.replier.answerWith(accountBalanceRepliedV1.name, {
      outcome: 'NOT_FOUND',
      reason: 'ACCOUNT_NOT_FOUND',
    });

    const response = await enviar();

    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(harness.publisher.published.map((e) => e.messageType)).toEqual([
      'account.balance.query.v1',
    ]);
  });

  it('sin número de cuenta (un Account anterior) no hay depósito que enviar', async () => {
    const { accountNumber: _omitido, ...sinNumero } = SALDO;
    harness.replier.answerWith(accountBalanceRepliedV1.name, sinNumero);

    const response = await enviar();

    expect(response.status).toBe(500);
    expect(harness.publisher.published.map((e) => e.messageType)).not.toContain(
      'transfer.requested.v1',
    );
  });

  describe('lo que se rechaza en el borde, antes de debitar nada (B7)', () => {
    it('un monto por encima del límite del contrato', async () => {
      const response = await enviar({
        ...BODY,
        amount: { amountMinor: 1_000_001, currency: 'GTQ' },
      });

      expect(response.status).toBe(400);
      expect(response.body.message ?? response.body.error?.message).toContain('10000.00');
      expect(harness.publisher.published).toEqual([]);
    });

    it('el límite exacto sí pasa', async () => {
      harness.replier.answerWith(accountBalanceRepliedV1.name, SALDO);

      const response = await enviar({
        ...BODY,
        amount: { amountMinor: 1_000_000, currency: 'GTQ' },
      });

      expect(response.status).toBe(202);
    });

    it('una moneda que no es GTQ', async () => {
      const response = await enviar({ ...BODY, amount: { amountMinor: 100, currency: 'USD' } });

      expect(response.status).toBe(400);
      expect(harness.publisher.published).toEqual([]);
    });

    it('el propio banco como destino', async () => {
      const response = await enviar({ ...BODY, destinationBankCode: 'BANK02' });

      expect(response.status).toBe(400);
      expect(harness.publisher.published).toEqual([]);
    });

    it('un banco que no está en el registro', async () => {
      const response = await enviar({ ...BODY, destinationBankCode: 'BANK07' });

      expect(response.status).toBe(400);
      expect(harness.publisher.published).toEqual([]);
    });

    it.each([
      ['un código de banco fuera del patrón del contrato', { destinationBankCode: 'BANK_99' }],
      [
        'un número de cuenta con caracteres que el contrato no admite',
        { destinationAccount: 'cuenta con espacios' },
      ],
      ['un número de cuenta de más de 34 caracteres', { destinationAccount: 'a'.repeat(35) }],
      ['una cuenta origen que no es un UUID', { sourceAccount: '02-000000052' }],
    ])('%s', async (_nombre, cambio) => {
      const response = await enviar({ ...BODY, ...cambio });

      expect(response.status).toBe(400);
      expect(harness.publisher.published).toEqual([]);
    });
  });

  describe('consultar los depósitos enviados (B10)', () => {
    it('GET /api/interbank/transfers/{id} devuelve el depósito y su historial', async () => {
      harness.replier.answerWith(paymentInterbankSendRepliedV1.name, {
        outcome: 'FOUND',
        send: VISTA,
        history: [
          { state: 'PENDING', reason: null, at: '2026-10-20T15:00:00.000Z' },
          { state: 'SENT', reason: null, at: '2026-10-20T15:00:01.000Z' },
          { state: 'TIMEOUT', reason: 'CONFIRMATION_TIMEOUT', at: '2026-10-20T15:03:00.000Z' },
        ],
      });

      const response = await request(app.getHttpServer())
        .get(`/api/interbank/transfers/${ID}`)
        .set('Authorization', auth());

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        send: { state: 'TIMEOUT', destinationBankCode: 'BANK99', traceId: VISTA.traceId },
        correlationId: expect.any(String),
      });
      expect(response.body.history).toHaveLength(3);
      // La identidad viaja en el sobre: es lo que Payment usa para acotar.
      expect(harness.publisher.published[0]).toMatchObject({
        messageType: 'payment.interbank.send.query.v1',
        payload: { interbankTransferId: ID },
        identity: { customerId: CUSTOMER_ID, role: 'CLIENTE' },
      });
    });

    it('un depósito ajeno o inexistente es un 404', async () => {
      harness.replier.answerWith(paymentInterbankSendRepliedV1.name, { outcome: 'NOT_FOUND' });

      const response = await request(app.getHttpServer())
        .get(`/api/interbank/transfers/${ID}`)
        .set('Authorization', auth());

      expect(response.status).toBe(404);
    });

    it('un identificador que no es UUID es un 400 sin preguntar a nadie', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/interbank/transfers/no-es-un-uuid')
        .set('Authorization', auth());

      expect(response.status).toBe(400);
      expect(harness.publisher.published).toEqual([]);
    });

    it('GET /api/interbank/transfers lista, con filtro de estado y límite', async () => {
      harness.replier.answerWith(paymentInterbankSendListRepliedV1.name, { sends: [VISTA] });

      const response = await request(app.getHttpServer())
        .get('/api/interbank/transfers?state=TIMEOUT&limit=10')
        .set('Authorization', auth('ADMINISTRADOR'));

      expect(response.status).toBe(200);
      expect(response.body.sends).toHaveLength(1);
      expect(harness.publisher.published[0]).toMatchObject({
        messageType: 'payment.interbank.send.list.query.v1',
        payload: { state: 'TIMEOUT', limit: 10 },
        identity: { role: 'ADMINISTRADOR' },
      });
    });

    it.each(['CLIENTE', 'CAJERO_RECEPTOR', 'ADMINISTRADOR'] as const)(
      'el rol %s puede preguntar: el alcance lo decide Payment',
      async (rol) => {
        harness.replier.answerWith(paymentInterbankSendListRepliedV1.name, { sends: [] });

        const response = await request(app.getHttpServer())
          .get('/api/interbank/transfers')
          .set('Authorization', auth(rol));

        expect(response.status).toBe(200);
      },
    );

    it('exige sesión', async () => {
      const response = await request(app.getHttpServer()).get('/api/interbank/transfers');

      expect(response.status).toBe(401);
      expect(harness.publisher.published).toEqual([]);
    });

    it.each([
      ['state=ENVIADO', 'un estado que no es de los seis'],
      ['limit=0', 'un límite de cero'],
      ['limit=201', 'un límite por encima del techo'],
    ])('rechaza %s (%s)', async (query) => {
      const response = await request(app.getHttpServer())
        .get(`/api/interbank/transfers?${query}`)
        .set('Authorization', auth());

      expect(response.status).toBe(400);
    });
  });

  describe('la cancelación del emisor con el crédito ya ordenado (B4)', () => {
    it('contesta 503, el «vuelve a preguntar» del contrato, y no CANCELLED', async () => {
      harness.replier.answerWith(paymentInterbankV1CancelRepliedV1.name, {
        interbankTransferId: ID,
        result: 'IN_PROGRESS',
      });

      const response = await request(app.getHttpServer())
        .post(`/interbank/v1/transfers/${ID}/cancel`)
        .set('X-Api-Key', TEST_INTERBANK_API_KEY)
        .send({ originBankCode: 'BANK99', reason: 'TIMEOUT' });

      expect(response.status).toBe(503);
      expect(response.body).toMatchObject({ code: 'SERVICE_UNAVAILABLE' });
    });
  });
});
