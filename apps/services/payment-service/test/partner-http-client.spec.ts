import { createServer } from 'node:http';
import type { IncomingHttpHeaders, Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { createEnvelope, v1TransferRequest } from '@bank/contracts';

import type { InterbankSend } from '../src/application/interbank-send.ports';
import {
  HttpPartnerBankClient,
  newTraceparent,
} from '../src/infrastructure/http/partner-callback';

/**
 * El cliente HTTP del contrato v1, contra un servidor de verdad (T-60, B1).
 *
 * Lo que se comprueba es lo que cruza el cable: método, ruta, `X-Api-Key`,
 * `traceparent` obligatorio, `Idempotency-Key` igual al `interbankTransferId`,
 * y que ya no queda rastro del formato provisional (`Authorization: Bearer`).
 */

const AHORA = new Date('2026-10-20T15:00:00.000Z');
const ID = '8f14e45f-ceea-467a-9b36-4b1c2d6a7e01';
const LLAVE = 'llave-saliente-de-prueba-0123456789abcdef';
const TRACEPARENT = /^00-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$/;

interface Peticion {
  readonly method: string;
  readonly url: string;
  readonly headers: IncomingHttpHeaders;
  readonly body: unknown;
}

function envio(): InterbankSend {
  return {
    interbankTransferId: ID,
    paymentId: '00000000-0000-4000-8000-00000000aaaa',
    transactionId: '00000000-0000-4000-8000-00000000bbbb',
    idempotencyKey: ID,
    destinationBankCode: 'BANK99',
    destinationAccount: '99-000004567',
    originAccount: '02-000000052',
    customerId: null,
    amount: { amountMinor: 15_000, currency: 'GTQ' },
    correlationId: '00000000-0000-4000-8000-00000000cccc',
    state: 'SENT',
    reason: null,
    attempts: 1,
    confirmationDueAt: new Date(AHORA.getTime() + 180_000),
    createdAt: AHORA,
    verdictEnqueuedAt: null,
    releaseNotBefore: new Date(AHORA.getTime() + 480_000),
    probe: null,
    cancel: null,
    resolveNotBefore: null,
    probeAttempts: 0,
    cancelAttempts: 0,
    reversal: null,
    decidedAt: null,
    sentAt: null,
    reversedAt: null,
    traceContext: null,
    origin: createEnvelope({}, { messageType: 'payment.requested.v1', producer: 'transaction-service', identity: null }),
  };
}

describe('el cliente del banco pareja', () => {
  let servidor: Server;
  let base: string;
  const peticiones: Peticion[] = [];
  let respuesta: { status: number; body?: unknown; demora?: number } = { status: 202 };

  beforeAll(async () => {
    servidor = createServer((request, response) => {
      const trozos: Buffer[] = [];
      request.on('data', (t: Buffer) => trozos.push(t));
      request.on('end', () => {
        const texto = Buffer.concat(trozos).toString('utf8');
        peticiones.push({
          method: request.method ?? '',
          url: request.url ?? '',
          headers: request.headers,
          body: texto === '' ? null : JSON.parse(texto),
        });
        const responder = (): void => {
          response.statusCode = respuesta.status;
          response.setHeader('content-type', 'application/json');
          response.end(JSON.stringify(respuesta.body ?? {}));
        };
        if (respuesta.demora === undefined) responder();
        else setTimeout(responder, respuesta.demora);
      });
    });
    await new Promise<void>((resolve) => servidor.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${String((servidor.address() as AddressInfo).port)}/interbank/v1`;
  });

  beforeEach(() => {
    peticiones.length = 0;
    respuesta = { status: 202 };
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => servidor.close(() => resolve()));
  });

  const cliente = (llave = LLAVE, timeout = 2_000): HttpPartnerBankClient =>
    new HttpPartnerBankClient(base, llave, 'BANK02', timeout);

  describe('el envío', () => {
    it('hace POST {base}/transfers con X-Api-Key, Idempotency-Key y traceparent', async () => {
      const resultado = await cliente().send(envio());

      expect(resultado).toEqual({ acknowledged: true, detail: null });
      const peticion = peticiones[0]!;
      expect(peticion.method).toBe('POST');
      expect(peticion.url).toBe('/interbank/v1/transfers');
      expect(peticion.headers['x-api-key']).toBe(LLAVE);
      expect(peticion.headers['idempotency-key']).toBe(ID);
      expect(peticion.headers.traceparent).toMatch(TRACEPARENT);
      expect(peticion.headers['content-type']).toBe('application/json');
    });

    it('ya no manda Authorization: Bearer ni el cuerpo provisional', async () => {
      await cliente().send(envio());

      const peticion = peticiones[0]!;
      expect(peticion.headers.authorization).toBeUndefined();
      expect(v1TransferRequest.safeParse(peticion.body).success).toBe(true);
      expect(peticion.body).not.toHaveProperty('accountId');
      expect(peticion.body).toMatchObject({ originAccount: '02-000000052', amount: '150.00' });
    });

    it('acusa recibo con 202 y con 200 (la solicitud repetida)', async () => {
      respuesta = { status: 200, body: { interbankTransferId: ID, status: 'PROCESSING' } };

      expect((await cliente().send(envio())).acknowledged).toBe(true);
    });

    it.each([400, 401, 409, 422, 500, 503])('no acusa recibo con %i y lo deja anotado', async (status) => {
      respuesta = { status };

      expect(await cliente().send(envio())).toEqual({
        acknowledged: false,
        detail: `HTTP_${String(status)}`,
      });
    });

    it('un tiempo agotado es ausencia de acuse, no un rechazo ni una excepción', async () => {
      respuesta = { status: 202, demora: 400 };

      const resultado = await cliente(LLAVE, 100).send(envio());

      expect(resultado.acknowledged).toBe(false);
    });

    it('sin llave no manda nada sin autenticar', async () => {
      const resultado = await cliente('').send(envio());

      expect(resultado).toEqual({ acknowledged: false, detail: 'PARTNER_API_KEY_NOT_CONFIGURED' });
      expect(peticiones).toEqual([]);
    });

    it('una cuenta origen ausente es un error de programación, no un envío que el banco rechazará', async () => {
      await expect(cliente().send({ ...envio(), originAccount: null })).resolves.toMatchObject({
        acknowledged: false,
      });
      expect(peticiones).toEqual([]);
    });
  });

  describe('la consulta y la cancelación', () => {
    it('GET {base}/transfers/{id}, autenticada y con traceparent', async () => {
      respuesta = {
        status: 200,
        body: { interbankTransferId: ID, status: 'ACCEPTED', updatedAt: AHORA.toISOString() },
      };

      expect(await cliente().probe(envio())).toEqual({ kind: 'ANSWERED', status: 'ACCEPTED' });
      expect(peticiones[0]).toMatchObject({ method: 'GET', url: `/interbank/v1/transfers/${ID}` });
      expect(peticiones[0]?.headers['x-api-key']).toBe(LLAVE);
      expect(peticiones[0]?.headers.traceparent).toMatch(TRACEPARENT);
      expect(peticiones[0]?.headers.authorization).toBeUndefined();
    });

    it('un 404 es UNKNOWN: no lo conocen, que no es lo mismo que un rechazo', async () => {
      respuesta = { status: 404 };

      expect(await cliente().probe(envio())).toEqual({ kind: 'UNKNOWN' });
    });

    it('un cuerpo que no cumple el contrato es tan informativo como el silencio', async () => {
      respuesta = { status: 200, body: { status: 'QUIZAS' } };

      expect(await cliente().probe(envio())).toEqual({ kind: 'UNREACHABLE' });
    });

    it('POST {base}/transfers/{id}/cancel con un CancelRequest válido', async () => {
      respuesta = { status: 200, body: { interbankTransferId: ID, result: 'ALREADY_ACCEPTED' } };

      expect(await cliente().cancel(envio())).toEqual({
        kind: 'ANSWERED',
        result: 'ALREADY_ACCEPTED',
      });
      expect(peticiones[0]).toMatchObject({
        method: 'POST',
        url: `/interbank/v1/transfers/${ID}/cancel`,
        body: { originBankCode: 'BANK02', reason: 'TIMEOUT' },
      });
      expect(peticiones[0]?.headers['x-api-key']).toBe(LLAVE);
    });

    it('un 404 en la cancelación NO es una cancelación conseguida', async () => {
      respuesta = { status: 404 };

      expect(await cliente().cancel(envio())).toEqual({ kind: 'UNREACHABLE' });
    });
  });

  describe('el reverso', () => {
    const REVERSAL = '00000000-0000-4000-8000-0000000000dd';

    it('POST {base}/reversals con un ReversalRequest válido', async () => {
      respuesta = { status: 202, body: { reversalId: REVERSAL, status: 'PROCESSING' } };

      expect(await cliente().requestReversal(envio(), REVERSAL)).toEqual({
        kind: 'ANSWERED',
        status: 'PROCESSING',
        refundTransferId: null,
        reasonMessage: null,
      });
      expect(peticiones[0]).toMatchObject({
        method: 'POST',
        url: '/interbank/v1/reversals',
        body: {
          reversalId: REVERSAL,
          originalTransferId: ID,
          originBankCode: 'BANK02',
          amount: '150.00',
          currency: 'GTQ',
        },
      });
    });

    it('GET {base}/reversals/{id} devuelve el depósito de devolución cuando está completado', async () => {
      respuesta = {
        status: 200,
        body: {
          reversalId: REVERSAL,
          status: 'COMPLETED',
          refundTransferId: '00000000-0000-4000-8000-0000000000ee',
        },
      };

      expect(await cliente().reversalStatus(REVERSAL)).toMatchObject({
        kind: 'ANSWERED',
        status: 'COMPLETED',
        refundTransferId: '00000000-0000-4000-8000-0000000000ee',
      });
      expect(peticiones[0]?.url).toBe(`/interbank/v1/reversals/${REVERSAL}`);
    });

    it.each([400, 404])('un %i es una negativa que no se reintenta', async (status) => {
      respuesta = { status };

      expect(await cliente().requestReversal(envio(), REVERSAL)).toEqual({
        kind: 'REFUSED',
        detail: `HTTP_${String(status)}`,
      });
    });

    it('un 503 es «no se sabe» y se reintenta', async () => {
      respuesta = { status: 503 };

      expect(await cliente().requestReversal(envio(), REVERSAL)).toEqual({ kind: 'UNREACHABLE' });
    });
  });

  it('nunca sigue una redirección: el destino es el configurado y no otro', async () => {
    respuesta = { status: 302 };

    expect((await cliente().send(envio())).acknowledged).toBe(false);
  });

  it('genera un traceparent válido cuando no hay span activo', () => {
    expect(newTraceparent()).toMatch(TRACEPARENT);
    expect(newTraceparent()).not.toBe(newTraceparent());
  });
});
