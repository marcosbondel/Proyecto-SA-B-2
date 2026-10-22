import {
  paymentInterbankV1CancelRepliedV1,
  paymentInterbankV1ReconciliationRepliedV1,
  paymentInterbankV1ReversalRepliedV1,
  paymentInterbankV1StatusRepliedV1,
  paymentInterbankV1TransferRepliedV1,
  v1ExpiresAt,
} from '@bank/contracts';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';

import { InterbankV1Controller } from '../src/interfaces/interbank-v1.controller';
import {
  TEST_INTERBANK_API_KEY,
  TEST_OWN_BANK_CODE,
  TEST_SECOND_INTERBANK_API_KEY,
  buildHarness,
} from './support/harness';
import type { Harness } from './support/harness';

/**
 * Las siete operaciones del contrato interbancario oficial, en el borde
 * (T-56).
 *
 * Lo que se comprueba aquí es la **traducción**: que el Gateway valide contra
 * el contrato, lleve la identidad del banco que la API key dice —y no la que
 * diga el cuerpo—, y convierta lo que Payment contesta en el código HTTP que el
 * contrato manda. Lo que no se comprueba aquí es ninguna decisión de negocio,
 * porque el Gateway no toma ninguna.
 */

const ID = '8f14e45f-ceea-467a-9b36-4b1c2d6a7e01';
const AHORA = new Date();

const DEPOSITO = {
  interbankTransferId: ID,
  originBankCode: 'BANK99',
  destinationBankCode: 'BANK02',
  originAccount: '99-000000123',
  destinationAccount: '02-000000052',
  amount: '150.00',
  currency: 'GTQ' as const,
  createdAt: AHORA.toISOString(),
  expiresAt: v1ExpiresAt(AHORA).toISOString(),
};

describe('el contrato interbancario oficial', () => {
  let harness: Harness;
  let app: INestApplication;

  beforeEach(async () => {
    harness = await buildHarness([InterbankV1Controller]);
    app = harness.app;
  });
  afterEach(async () => {
    await app.close();
  });

  const conClave = (): request.Test =>
    request(app.getHttpServer()).post('/interbank/v1/transfers') as request.Test;

  describe('GET /health', () => {
    it('contesta sin autenticación, porque el contrato dice `security: []`', async () => {
      // El banco pareja necesita saber si estamos en pie **antes** de tener una
      // clave válida, y el día de la integración es la primera llamada.
      const response = await request(app.getHttpServer()).get('/interbank/v1/health');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ status: 'UP', bankCode: TEST_OWN_BANK_CODE });
    });
  });

  describe('la API key', () => {
    it('cierra las otras seis operaciones sin ella', async () => {
      const rutas: readonly [string, string][] = [
        ['post', '/interbank/v1/transfers'],
        ['get', `/interbank/v1/transfers/${ID}`],
        ['post', `/interbank/v1/transfers/${ID}/cancel`],
        ['post', `/interbank/v1/transfers/${ID}/result`],
        ['post', '/interbank/v1/reversals'],
        ['get', `/interbank/v1/reversals/${ID}`],
        ['get', '/interbank/v1/reconciliation?date=2026-10-20'],
      ];

      for (const [metodo, ruta] of rutas) {
        const response = await (metodo === 'get'
          ? request(app.getHttpServer()).get(ruta)
          : request(app.getHttpServer()).post(ruta).send({}));

        expect(response.status).toBe(401);
        // El cuerpo de error es el del contrato, no el nuestro.
        expect(response.body).toMatchObject({
          code: 'UNAUTHORIZED',
          message: expect.any(String),
          timestamp: expect.any(String),
        });
        expect(response.body).not.toHaveProperty('type');
      }
    });

    it('rechaza una clave que no es la acordada', async () => {
      const response = await conClave()
        .set('X-Api-Key', 'otra-clave-cualquiera-de-32-caracteres!')
        .set('Idempotency-Key', ID)
        .send(DEPOSITO);

      expect(response.status).toBe(401);
    });
  });

  describe('POST /transfers', () => {
    it('acepta un depósito nuevo con 202 y el cuerpo del contrato', async () => {
      harness.replier.answerWith(paymentInterbankV1TransferRepliedV1.name, {
        interbankTransferId: ID,
        admission: 'ACCEPTED_FOR_PROCESSING',
        status: null,
        reasonCode: null,
        updatedAt: AHORA.toISOString(),
      });

      const response = await conClave()
        .set('X-Api-Key', TEST_INTERBANK_API_KEY)
        .set('Idempotency-Key', ID)
        .send(DEPOSITO);

      expect(response.status).toBe(202);
      expect(response.body).toEqual({
        interbankTransferId: ID,
        status: 'PROCESSING',
        receivedAt: expect.any(String),
      });
    });

    it('lleva a Payment el banco de la API key, no el del cuerpo', async () => {
      harness.replier.answerWith(paymentInterbankV1TransferRepliedV1.name, {
        interbankTransferId: ID,
        admission: 'ACCEPTED_FOR_PROCESSING',
        status: null,
        reasonCode: null,
        updatedAt: AHORA.toISOString(),
      });

      // Un cuerpo que miente sobre quién lo manda.
      await conClave()
        .set('X-Api-Key', TEST_INTERBANK_API_KEY)
        .set('Idempotency-Key', ID)
        .send({ ...DEPOSITO, originBankCode: 'BANK07' });

      expect(harness.publisher.published[0]?.payload).toMatchObject({
        callerBankCode: 'BANK99',
        transfer: { originBankCode: 'BANK07' },
      });
    });

    it('identifica a cada banco del registro por su propia clave (T-60)', async () => {
      harness.replier.answerWith(paymentInterbankV1TransferRepliedV1.name, {
        interbankTransferId: ID,
        admission: 'ACCEPTED_FOR_PROCESSING',
        status: null,
        reasonCode: null,
        updatedAt: AHORA.toISOString(),
      });

      const response = await conClave()
        .set('X-Api-Key', TEST_SECOND_INTERBANK_API_KEY)
        .set('Idempotency-Key', ID)
        .send({ ...DEPOSITO, originBankCode: 'BANK16' });

      expect(response.status).toBe(202);
      expect(harness.publisher.published[0]?.payload).toMatchObject({
        callerBankCode: 'BANK16',
        transfer: { originBankCode: 'BANK16' },
      });
    });

    it('devuelve 200 con el estado actual cuando es la misma solicitud otra vez', async () => {
      harness.replier.answerWith(paymentInterbankV1TransferRepliedV1.name, {
        interbankTransferId: ID,
        admission: 'DUPLICATE',
        status: 'ACCEPTED',
        reasonCode: null,
        updatedAt: AHORA.toISOString(),
      });

      const response = await conClave()
        .set('X-Api-Key', TEST_INTERBANK_API_KEY)
        .set('Idempotency-Key', ID)
        .send(DEPOSITO);

      // 200 y no 202: «ya lo tenía, aquí está en qué quedó».
      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        interbankTransferId: ID,
        status: 'ACCEPTED',
        updatedAt: expect.any(String),
      });
    });

    it('devuelve 409 cuando el mismo id trae otro contenido', async () => {
      harness.replier.answerWith(paymentInterbankV1TransferRepliedV1.name, {
        interbankTransferId: ID,
        admission: 'CONFLICT',
        status: null,
        reasonCode: null,
        updatedAt: AHORA.toISOString(),
      });

      const response = await conClave()
        .set('X-Api-Key', TEST_INTERBANK_API_KEY)
        .set('Idempotency-Key', ID)
        .send(DEPOSITO);

      expect(response.status).toBe(409);
      expect(response.body.code).toBe('IDEMPOTENCY_CONFLICT');
    });

    it('devuelve 422 si ya venció, y no pregunta a nadie', async () => {
      const vencido = new Date(Date.now() - 200_000);

      const response = await conClave()
        .set('X-Api-Key', TEST_INTERBANK_API_KEY)
        .set('Idempotency-Key', ID)
        .send({
          ...DEPOSITO,
          createdAt: vencido.toISOString(),
          expiresAt: v1ExpiresAt(vencido).toISOString(),
        });

      expect(response.status).toBe(422);
      expect(response.body.code).toBe('EXPIRED');
      // Un depósito que el contrato dice no procesar no entra en la máquina.
      expect(harness.publisher.published).toHaveLength(0);
    });

    it('exige que Idempotency-Key sea igual a interbankTransferId', async () => {
      const response = await conClave()
        .set('X-Api-Key', TEST_INTERBANK_API_KEY)
        .set('Idempotency-Key', '00000000-0000-4000-8000-000000000000')
        .send(DEPOSITO);

      expect(response.status).toBe(400);
      expect(response.body.code).toBe('VALIDATION_ERROR');
      expect(harness.publisher.published).toHaveLength(0);
    });

    it('rechaza el cuerpo que no es del contrato', async () => {
      for (const roto of [
        { ...DEPOSITO, amount: '150' },
        { ...DEPOSITO, amount: 150 },
        { ...DEPOSITO, originBankCode: 'BANK_USAC' },
        { ...DEPOSITO, destinationAccount: '8f14e45f-ceea-467a-9b36-4b1c2d6a7e01' },
        { ...DEPOSITO, currency: 'USD' },
        { ...DEPOSITO, extra: true },
      ]) {
        const response = await conClave()
          .set('X-Api-Key', TEST_INTERBANK_API_KEY)
          .set('Idempotency-Key', ID)
          .send(roto);

        expect(response.status).toBe(400);
      }
      expect(harness.publisher.published).toHaveLength(0);
    });
  });

  describe('GET /transfers/{id}', () => {
    it('devuelve el estado que Payment reporta', async () => {
      harness.replier.answerWith(paymentInterbankV1StatusRepliedV1.name, {
        interbankTransferId: ID,
        found: true,
        status: 'REJECTED',
        reasonCode: 'ACCOUNT_NOT_FOUND',
        updatedAt: AHORA.toISOString(),
      });

      const response = await request(app.getHttpServer())
        .get(`/interbank/v1/transfers/${ID}`)
        .set('X-Api-Key', TEST_INTERBANK_API_KEY);

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        interbankTransferId: ID,
        status: 'REJECTED',
        reasonCode: 'ACCOUNT_NOT_FOUND',
        updatedAt: expect.any(String),
      });
    });

    it('devuelve 404 cuando no hay registro, que para el emisor es información', async () => {
      // El contrato le da un significado: «nunca lo recibí», y es lo que hace
      // al emisor pasar de consultar a cancelar.
      harness.replier.answerWith(paymentInterbankV1StatusRepliedV1.name, {
        interbankTransferId: ID,
        found: false,
        status: null,
        reasonCode: null,
        updatedAt: null,
      });

      const response = await request(app.getHttpServer())
        .get(`/interbank/v1/transfers/${ID}`)
        .set('X-Api-Key', TEST_INTERBANK_API_KEY);

      expect(response.status).toBe(404);
      expect(response.body.code).toBe('NOT_FOUND');
    });

    it('rechaza un identificador que no es UUID sin preguntar', async () => {
      const response = await request(app.getHttpServer())
        .get('/interbank/v1/transfers/no-es-un-uuid')
        .set('X-Api-Key', TEST_INTERBANK_API_KEY);

      expect(response.status).toBe(400);
      expect(harness.publisher.published).toHaveLength(0);
    });
  });

  describe('POST /transfers/{id}/cancel', () => {
    it.each(['CANCELLED', 'ALREADY_ACCEPTED', 'ALREADY_REJECTED'] as const)(
      'devuelve %s tal como Payment lo decidió',
      async (result) => {
        harness.replier.answerWith(paymentInterbankV1CancelRepliedV1.name, {
          interbankTransferId: ID,
          result,
        });

        const response = await request(app.getHttpServer())
          .post(`/interbank/v1/transfers/${ID}/cancel`)
          .set('X-Api-Key', TEST_INTERBANK_API_KEY)
          .send({ originBankCode: 'BANK99', reason: 'TIMEOUT' });

        expect(response.status).toBe(200);
        expect(response.body).toEqual({ interbankTransferId: ID, result });
      },
    );

    it('exige un motivo del conjunto del contrato', async () => {
      const response = await request(app.getHttpServer())
        .post(`/interbank/v1/transfers/${ID}/cancel`)
        .set('X-Api-Key', TEST_INTERBANK_API_KEY)
        .send({ originBankCode: 'BANK99', reason: 'PORQUE_SI' });

      expect(response.status).toBe(400);
    });
  });

  describe('POST /transfers/{id}/result', () => {
    it('acepta el callback, publica y contesta 200', async () => {
      const response = await request(app.getHttpServer())
        .post(`/interbank/v1/transfers/${ID}/result`)
        .set('X-Api-Key', TEST_INTERBANK_API_KEY)
        .send({
          interbankTransferId: ID,
          destinationBankCode: 'BANK99',
          status: 'ACCEPTED',
          processedAt: AHORA.toISOString(),
        });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ interbankTransferId: ID, received: true });
      expect(harness.publisher.published[0]?.messageType).toBe(
        'payment.interbank.v1.result.received.v1',
      );
    });

    it('rechaza un cuerpo cuyo id no es el de la ruta', async () => {
      const response = await request(app.getHttpServer())
        .post(`/interbank/v1/transfers/${ID}/result`)
        .set('X-Api-Key', TEST_INTERBANK_API_KEY)
        .send({
          interbankTransferId: '00000000-0000-4000-8000-000000000000',
          destinationBankCode: 'BANK99',
          status: 'ACCEPTED',
          processedAt: AHORA.toISOString(),
        });

      expect(response.status).toBe(400);
      expect(harness.publisher.published).toHaveLength(0);
    });
  });

  describe('los reversos', () => {
    it('acepta la solicitud con 202', async () => {
      harness.replier.answerWith(paymentInterbankV1ReversalRepliedV1.name, {
        reversalId: ID,
        found: true,
        status: 'PROCESSING',
        refundTransferId: null,
        reasonMessage: null,
      });

      const response = await request(app.getHttpServer())
        .post('/interbank/v1/reversals')
        .set('X-Api-Key', TEST_INTERBANK_API_KEY)
        .send({
          reversalId: ID,
          originalTransferId: '00000000-0000-4000-8000-000000000001',
          originBankCode: 'BANK99',
          amount: '150.00',
          currency: 'GTQ',
        });

      expect(response.status).toBe(202);
      expect(response.body).toEqual({ reversalId: ID, status: 'PROCESSING' });
    });

    it('devuelve el reverso completado con el depósito de devolución', async () => {
      harness.replier.answerWith(paymentInterbankV1ReversalRepliedV1.name, {
        reversalId: ID,
        found: true,
        status: 'COMPLETED',
        refundTransferId: '00000000-0000-4000-8000-000000000009',
        reasonMessage: null,
      });

      const response = await request(app.getHttpServer())
        .get(`/interbank/v1/reversals/${ID}`)
        .set('X-Api-Key', TEST_INTERBANK_API_KEY);

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        reversalId: ID,
        status: 'COMPLETED',
        refundTransferId: '00000000-0000-4000-8000-000000000009',
      });
    });

    it('devuelve 404 cuando el depósito que se pide devolver no existe', async () => {
      harness.replier.answerWith(paymentInterbankV1ReversalRepliedV1.name, {
        reversalId: ID,
        found: false,
        status: null,
        refundTransferId: null,
        reasonMessage: null,
      });

      const response = await request(app.getHttpServer())
        .get(`/interbank/v1/reversals/${ID}`)
        .set('X-Api-Key', TEST_INTERBANK_API_KEY);

      expect(response.status).toBe(404);
    });
  });

  describe('GET /reconciliation', () => {
    it('pasa la fecha y la paginación, con el banco de la API key', async () => {
      harness.replier.answerWith(paymentInterbankV1ReconciliationRepliedV1.name, {
        date: '2026-10-20',
        page: 2,
        pageSize: 50,
        totalItems: 73,
        items: [],
      });

      const response = await request(app.getHttpServer())
        .get('/interbank/v1/reconciliation?date=2026-10-20&page=2&pageSize=50')
        .set('X-Api-Key', TEST_INTERBANK_API_KEY);

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({ date: '2026-10-20', page: 2, totalItems: 73 });
      expect(harness.publisher.published[0]?.payload).toMatchObject({
        callerBankCode: 'BANK99',
        date: '2026-10-20',
        page: 2,
        pageSize: 50,
      });
    });

    it('usa los valores por defecto del contrato cuando no se dan', async () => {
      harness.replier.answerWith(paymentInterbankV1ReconciliationRepliedV1.name, {
        date: '2026-10-20',
        page: 1,
        pageSize: 100,
        totalItems: 0,
        items: [],
      });

      await request(app.getHttpServer())
        .get('/interbank/v1/reconciliation?date=2026-10-20')
        .set('X-Api-Key', TEST_INTERBANK_API_KEY);

      expect(harness.publisher.published[0]?.payload).toMatchObject({ page: 1, pageSize: 100 });
    });

    it('exige la fecha y respeta el máximo de pageSize', async () => {
      const sinFecha = await request(app.getHttpServer())
        .get('/interbank/v1/reconciliation')
        .set('X-Api-Key', TEST_INTERBANK_API_KEY);
      const demasiado = await request(app.getHttpServer())
        .get('/interbank/v1/reconciliation?date=2026-10-20&pageSize=501')
        .set('X-Api-Key', TEST_INTERBANK_API_KEY);

      expect(sinFecha.status).toBe(400);
      expect(demasiado.status).toBe(400);
      expect(harness.publisher.published).toHaveLength(0);
    });
  });
});
