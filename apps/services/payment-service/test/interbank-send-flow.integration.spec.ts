import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { catalogByName, createEnvelope, followUpEnvelope } from '@bank/contracts';
import type { Identity, MessageEnvelope, PaymentRequestedV1 } from '@bank/contracts';
import { Pool } from 'pg';

import type { InterbankSendMessenger } from '../src/application/interbank-send.ports';
import type { OutboxMessage } from '../src/application/ports';
import { QueryInterbankSendsUseCase } from '../src/application/query-interbank-sends.use-case';
import { SendInterbankDepositUseCase } from '../src/application/send-interbank-deposit.use-case';
import { HttpPartnerBankClient } from '../src/infrastructure/http/partner-callback';
import { migrate } from '../src/infrastructure/persistence/migrations';
import { PostgresInterbankSendRepository } from '../src/infrastructure/persistence/postgres-interbank-send.repository';

/**
 * El envío de un depósito de punta a punta en este servicio: el caso de uso, el
 * cliente HTTP del contrato y la persistencia **reales**, con un servidor HTTP
 * que hace de banco pareja (T-60).
 *
 * Es la prueba que habría atrapado dos defectos que los dobles en memoria no
 * podían ver, porque el `CHECK` de la tabla es lo único que los delata:
 *
 * - un reintento de entrega escribía el motivo del fallo en una fila `PENDING`,
 *   y la base lo rechazaba;
 * - la compensación escribía `REVERSED` sin motivo, y la base lo rechazaba, así
 *   que `REVERSED` era inalcanzable.
 *
 * Y comprueba lo que importa del dinero: que cada recorrido acabe con **un solo
 * final** para la Saga —un `payment.succeeded.v1` o un `payment.failed.v1`, y
 * nunca los dos ni dos veces el mismo— mirando el outbox, que es lo que el relay
 * publica.
 */

const URL = process.env.DATABASE_URL;
const suite = URL === undefined ? describe.skip : describe;

jest.setTimeout(30_000);

const CLIENTE: Identity = { customerId: '00000000-0000-4000-8000-0000000000a1', role: 'CLIENTE' };
const OTRO: Identity = { customerId: '00000000-0000-4000-8000-0000000000b2', role: 'CLIENTE' };
const PERSONAL: Identity = { customerId: '00000000-0000-4000-8000-0000000000ff', role: 'ADMINISTRADOR' };
const TRACEPARENT = '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01';

interface Peticion {
  readonly method: string;
  readonly url: string;
  readonly body: unknown;
}

suite('el envío interbancario, con la base de verdad', () => {
  let pool: Pool;
  let repo: PostgresInterbankSendRepository;
  let servidor: Server;
  let base: string;
  let ahora: Date;
  const peticiones: Peticion[] = [];
  const alertas: Record<string, unknown>[] = [];
  const directos: { messageType: string; payload: unknown }[] = [];
  const trazas: (string | null)[] = [];
  /** Cómo contesta el banco pareja, por ruta. `undefined` = 503. */
  let plan: (req: Peticion) => { status: number; body?: unknown };

  beforeAll(async () => {
    servidor = createServer((request, response) => {
      const trozos: Buffer[] = [];
      request.on('data', (t: Buffer) => trozos.push(t));
      request.on('end', () => {
        const texto = Buffer.concat(trozos).toString('utf8');
        const peticion = {
          method: request.method ?? '',
          url: (request.url ?? '').replace('/interbank/v1', ''),
          body: texto === '' ? null : (JSON.parse(texto) as unknown),
        };
        peticiones.push(peticion);
        const { status, body } = plan(peticion);
        response.statusCode = status;
        response.setHeader('content-type', 'application/json');
        response.end(JSON.stringify(body ?? {}));
      });
    });
    await new Promise<void>((resolve) => servidor.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${String((servidor.address() as AddressInfo).port)}/interbank/v1`;

    pool = new Pool({ connectionString: URL });
    await migrate(pool);
    repo = new PostgresInterbankSendRepository(pool);
  });

  beforeEach(async () => {
    await pool.query('TRUNCATE interbank_sends, interbank_send_history, outbox_messages');
    ahora = new Date('2026-10-20T15:00:00.000Z');
    peticiones.length = 0;
    alertas.length = 0;
    directos.length = 0;
    trazas.length = 0;
    plan = () => ({ status: 202 });
  });

  afterAll(async () => {
    await pool.end();
    await new Promise<void>((resolve) => servidor.close(() => resolve()));
  });

  /** El constructor de eventos real: valida el contrato, como `BrokerInterbankMessenger`. */
  const messenger: InterbankSendMessenger = {
    event: async (_cause, messageType, payload) => {
      directos.push({ messageType, payload });
    },
    envelopeFor: (cause, messageType, payload): OutboxMessage => {
      const contract = catalogByName.get(messageType);
      const parsed = contract?.schema.parse(payload);

      return {
        exchange: 'bank.events',
        routingKey: messageType,
        envelope: followUpEnvelope(cause, parsed, {
          messageType,
          producer: 'payment-service',
          idempotencyKey: cause.idempotencyKey,
        }),
      };
    },
  };

  function caso(): SendInterbankDepositUseCase {
    return new SendInterbankDepositUseCase({
      repository: repo,
      partner: new HttpPartnerBankClient(base, 'llave-saliente-de-prueba-0123456789', 'BANK02', 2_000),
      messenger,
      telemetry: { stateChanged: () => undefined },
      clock: () => ahora,
      transferTtlMs: 180_000,
      releaseMarginMs: 300_000,
      resolveRetryMs: 5_000,
      resendDelaysMs: [1_000, 5_000, 30_000],
      maxAmountMinor: 1_000_000,
      trace: {
        current: () => TRACEPARENT,
        continue: async (traceparent, _span, _correlation, work) => {
          trazas.push(traceparent);

          return await work();
        },
      },
      log: {
        info: () => undefined,
        warn: () => undefined,
        error: (_mensaje, campos) => {
          alertas.push(campos);
        },
      },
    });
  }

  function orden(
    identity: Identity | null = CLIENTE,
    overrides: { originAccount?: string | undefined } = {},
  ): { id: string; transactionId: string; envelope: MessageEnvelope<PaymentRequestedV1> } {
    const id = randomUUID();
    const transactionId = randomUUID();
    const envelope = createEnvelope(
      {
        paymentId: randomUUID(),
        transactionId,
        amount: { amountMinor: 15_000, currency: 'GTQ' },
        interbank: {
          bankCode: 'BANK99',
          account: '99-000004567',
          interbankTransferId: id,
          idempotencyKey: id,
          ...('originAccount' in overrides
            ? overrides.originAccount === undefined
              ? {}
              : { originAccount: overrides.originAccount }
            : { originAccount: '02-000000052' }),
        },
      },
      { messageType: 'payment.requested.v1', producer: 'transaction-service', identity },
    ) as MessageEnvelope<PaymentRequestedV1>;

    return { id, transactionId, envelope };
  }

  function resultado(id: string, status: 'ACCEPTED' | 'REJECTED', reasonCode?: string): MessageEnvelope<never> {
    return createEnvelope(
      {
        result: {
          interbankTransferId: id,
          destinationBankCode: 'BANK99',
          status,
          ...(reasonCode === undefined ? {} : { reasonCode }),
          processedAt: ahora.toISOString(),
        },
        callerBankCode: 'BANK99',
        receivedAt: ahora.toISOString(),
      },
      { messageType: 'payment.interbank.v1.result.received.v1', producer: 'gateway', identity: null },
    ) as MessageEnvelope<never>;
  }

  /** Los mensajes que el relay publicará, por tipo, para una transferencia. */
  async function outbox(transactionId: string): Promise<string[]> {
    const { rows } = await pool.query<{ envelope: MessageEnvelope<{ transactionId?: string }> }>(
      'SELECT envelope FROM outbox_messages ORDER BY id',
    );

    return rows
      .filter((r) => r.envelope.payload.transactionId === transactionId)
      .map((r) => r.envelope.messageType);
  }
  const finales = (tipos: string[]): string[] =>
    tipos.filter((t) => t === 'payment.succeeded.v1' || t === 'payment.failed.v1');
  const fila = async (id: string) => (await repo.find(id))!;
  const avanzar = (ms: number): void => {
    ahora = new Date(ahora.getTime() + ms);
  };

  async function vencido(c: SendInterbankDepositUseCase, identity: Identity | null = CLIENTE) {
    plan = () => ({ status: 202 });
    const o = orden(identity);
    await c.requested(o.envelope);
    avanzar(180_001);
    plan = () => ({ status: 503 });
    await c.sweep();
    expect((await fila(o.id)).state).toBe('TIMEOUT');

    return o;
  }

  it('el alta entrega, deja la traza y el historial PENDING -> SENT', async () => {
    const c = caso();
    const o = orden();

    await c.requested(o.envelope);

    const f = await fila(o.id);
    expect(f.state).toBe('SENT');
    expect(f.traceContext).toBe(TRACEPARENT);
    expect(f.customerId).toBe(CLIENTE.customerId);
    expect((await repo.history(o.id)).map((h) => h.state)).toEqual(['PENDING', 'SENT']);
    expect(peticiones).toHaveLength(1);
    expect(peticiones[0]).toMatchObject({ method: 'POST', url: '/transfers' });
  });

  it('una entrega sin acuse queda PENDING, se reintenta con la escalera y acaba en SENT', async () => {
    /*
     * El defecto que sólo la base veía: el reintento escribía el detalle del fallo
     * como `reason` de una fila PENDING y el CHECK lo rechazaba, así que el
     * reintento reventaba en cada vuelta en lugar de esperar su escalera.
     */
    const c = caso();
    plan = () => ({ status: 503 });
    const o = orden();

    await c.requested(o.envelope);
    const f = await fila(o.id);
    expect(f.state).toBe('PENDING');
    expect(f.reason).toBeNull();
    expect(f.attempts).toBe(1);

    // Dentro de la espera de 1 s no se reintenta.
    await c.sweep();
    expect(peticiones).toHaveLength(1);

    plan = () => ({ status: 202 });
    avanzar(1_001);
    await c.sweep();
    expect((await fila(o.id)).state).toBe('SENT');
    expect(peticiones).toHaveLength(2);
    // El reenvío dice exactamente lo mismo que el primer envío.
    expect(peticiones[1]?.body).toEqual(peticiones[0]?.body);
  });

  it('el callback ACCEPTED confirma una vez; uno repetido no mueve nada', async () => {
    const c = caso();
    const o = orden();
    await c.requested(o.envelope);

    await c.v1Result(resultado(o.id, 'ACCEPTED'));
    await c.v1Result(resultado(o.id, 'ACCEPTED'));

    expect((await fila(o.id)).state).toBe('ACCEPTED');
    expect(finales(await outbox(o.transactionId))).toEqual(['payment.succeeded.v1']);
  });

  it('el callback REJECTED compensa una vez y la constancia REVERSED es alcanzable', async () => {
    const c = caso();
    const o = orden();
    await c.requested(o.envelope);

    await c.v1Result(resultado(o.id, 'REJECTED', 'ACCOUNT_NOT_FOUND'));
    await c.v1Result(resultado(o.id, 'REJECTED', 'ACCOUNT_NOT_FOUND'));
    expect(finales(await outbox(o.transactionId))).toEqual(['payment.failed.v1']);
    expect((await fila(o.id)).reason).toBe('ACCOUNT_NOT_FOUND');

    await c.compensated(o.transactionId);
    await c.compensated(o.transactionId);

    const f = await fila(o.id);
    expect(f.state).toBe('REVERSED');
    expect(f.reason).toBe('ACCOUNT_NOT_FOUND');
    expect(f.reversedAt).not.toBeNull();
    expect((await repo.history(o.id)).map((h) => h.state)).toEqual([
      'PENDING',
      'SENT',
      'REJECTED',
      'REVERSED',
    ]);
  });

  it('un callback que gana la carrera al acuse confirma, y el acuse retrasado no lo mueve', async () => {
    const c = caso();
    plan = () => ({ status: 503 });
    const o = orden();
    await c.requested(o.envelope);
    expect((await fila(o.id)).state).toBe('PENDING');

    await c.v1Result(resultado(o.id, 'ACCEPTED'));

    expect((await fila(o.id)).state).toBe('ACCEPTED');
    expect(finales(await outbox(o.transactionId))).toEqual(['payment.succeeded.v1']);
  });

  it('un ACCEPTED y un REJECTED a la vez dejan UN solo final para la Saga', async () => {
    const c = caso();
    const o = orden();
    await c.requested(o.envelope);

    await Promise.all([
      c.v1Result(resultado(o.id, 'ACCEPTED')),
      c.v1Result(resultado(o.id, 'REJECTED', 'ACCOUNT_INACTIVE')),
    ]);

    expect(finales(await outbox(o.transactionId))).toHaveLength(1);
  });

  it('vencer no suelta el dinero: TIMEOUT sin final para la Saga', async () => {
    const c = caso();
    const o = await vencido(c);

    expect(finales(await outbox(o.transactionId))).toEqual([]);
    expect((await fila(o.id)).reason).toBe('CONFIRMATION_TIMEOUT');
  });

  it('TIMEOUT y la consulta dice ACCEPTED: se confirma, no se compensa', async () => {
    const c = caso();
    const o = await vencido(c);
    plan = (req) =>
      req.method === 'GET'
        ? { status: 200, body: { interbankTransferId: o.id, status: 'ACCEPTED', updatedAt: ahora.toISOString() } }
        : { status: 503 };

    avanzar(5_001);
    await c.sweep();
    await c.sweep();

    expect((await fila(o.id)).state).toBe('ACCEPTED');
    expect(finales(await outbox(o.transactionId))).toEqual(['payment.succeeded.v1']);
  });

  it('TIMEOUT y un callback ACCEPTED tardío: se confirma, y el protocolo no lo vuelve a decidir', async () => {
    const c = caso();
    const o = await vencido(c);

    await c.v1Result(resultado(o.id, 'ACCEPTED'));
    avanzar(60_000);
    await c.sweep();

    expect((await fila(o.id)).state).toBe('ACCEPTED');
    expect(finales(await outbox(o.transactionId))).toEqual(['payment.succeeded.v1']);
  });

  it('TIMEOUT, 404 y cancelación CANCELLED: se libera con su motivo y se compensa', async () => {
    const c = caso();
    const o = await vencido(c);
    plan = (req) =>
      req.method === 'GET'
        ? { status: 404 }
        : { status: 200, body: { interbankTransferId: o.id, result: 'CANCELLED' } };

    avanzar(5_001);
    await c.sweep(); // consulta: 404
    await c.sweep(); // cancela
    await c.sweep(); // decide

    const f = await fila(o.id);
    expect(f.state).toBe('REJECTED');
    expect(f.reason).toBe('CANCELLED_AT_PARTNER');
    expect(finales(await outbox(o.transactionId))).toEqual(['payment.failed.v1']);
    expect(alertas).toEqual([]);
  });

  it('el banco pareja caído: insiste con la consulta y la cancelación, y no libera antes del margen', async () => {
    const c = caso();
    const o = await vencido(c);
    const antes = peticiones.length;

    for (let i = 0; i < 20; i += 1) {
      avanzar(14_000);
      await c.sweep();
    }

    const intentos = peticiones.slice(antes).map((p) => `${p.method} ${p.url.replace(o.id, '{id}')}`);
    expect(intentos.filter((i) => i === 'GET /transfers/{id}').length).toBeGreaterThan(1);
    expect(intentos).toContain('POST /transfers/{id}/cancel');
    // 20 × 14 s = 280 s desde el vencimiento: dentro del margen de 300 s.
    expect((await fila(o.id)).state).toBe('TIMEOUT');
    expect(finales(await outbox(o.transactionId))).toEqual([]);
  });

  it('pasado el margen libera sin verificar, con la línea de error que lee la alerta', async () => {
    const c = caso();
    const o = await vencido(c);

    avanzar(300_001);
    await c.sweep(); // cancela, que nunca se salta
    avanzar(5_001);
    await c.sweep(); // libera

    const f = await fila(o.id);
    expect(f.state).toBe('REJECTED');
    expect(f.reason).toBe('RELEASED_NO_ANSWER');
    expect(finales(await outbox(o.transactionId))).toEqual(['payment.failed.v1']);
    expect(alertas.filter((a) => a.outcome === 'RELEASED_NO_ANSWER')).toHaveLength(1);
  });

  it('dos barridos a la vez no liberan dos veces', async () => {
    const c = caso();
    const o = await vencido(c);
    avanzar(300_001);
    await c.sweep();
    avanzar(5_001);

    await Promise.all([c.sweep(), caso().sweep()]);

    expect(finales(await outbox(o.transactionId))).toEqual(['payment.failed.v1']);
  });

  describe('un ACCEPTED tardío sobre un depósito ya liberado (paso 5)', () => {
    async function liberado(c: SendInterbankDepositUseCase) {
      const o = await vencido(c);
      avanzar(300_001);
      await c.sweep();
      avanzar(5_001);
      await c.sweep();
      expect((await fila(o.id)).state).toBe('REJECTED');

      return o;
    }

    it('pide el reverso una sola vez, lo sigue hasta COMPLETED y no mueve el depósito', async () => {
      const c = caso();
      const o = await liberado(c);
      const refund = randomUUID();
      plan = (req) =>
        req.method === 'POST' && req.url === '/reversals'
          ? { status: 202, body: { reversalId: (req.body as { reversalId: string }).reversalId, status: 'PROCESSING' } }
          : { status: 200, body: { reversalId: req.url.split('/').pop(), status: 'COMPLETED', refundTransferId: refund } };

      await c.v1Result(resultado(o.id, 'ACCEPTED'));
      await c.v1Result(resultado(o.id, 'ACCEPTED'));
      const pedido = (await fila(o.id)).reversal;
      expect(pedido?.state).toBe('PENDING');
      expect(alertas.some((a) => a.outcome === 'LATE_ACCEPT_AFTER_RELEASE')).toBe(true);

      await c.sweep();
      avanzar(31_000);
      await c.sweep();

      const f = await fila(o.id);
      expect(f.reversal).toMatchObject({ state: 'COMPLETED', refundTransferId: refund });
      expect(f.state).toBe('REJECTED');
      const reversos = peticiones.filter((p) => p.url === '/reversals');
      expect(reversos).toHaveLength(1);
      expect(reversos[0]?.body).toMatchObject({
        reversalId: pedido?.reversalId,
        originalTransferId: o.id,
        originBankCode: 'BANK02',
        amount: '150.00',
        currency: 'GTQ',
      });
      // El dinero ya se devolvió y no se vuelve a mover: un solo final.
      expect(finales(await outbox(o.transactionId))).toEqual(['payment.failed.v1']);
    });

    it('si el banco pareja se niega, queda FAILED y a la vista', async () => {
      const c = caso();
      const o = await liberado(c);
      plan = () => ({ status: 404 });

      await c.v1Result(resultado(o.id, 'ACCEPTED'));
      await c.sweep();

      expect((await fila(o.id)).reversal?.state).toBe('FAILED');
      expect(alertas.some((a) => String(a.outcome).startsWith('REVERSAL_REFUSED'))).toBe(true);
    });

    it('también si ya se compensó y el depósito está REVERSED', async () => {
      const c = caso();
      const o = await liberado(c);
      await c.compensated(o.transactionId);
      expect((await fila(o.id)).state).toBe('REVERSED');

      await c.v1Result(resultado(o.id, 'ACCEPTED'));

      expect((await fila(o.id)).reversal?.state).toBe('PENDING');
    });
  });

  it('un pago sin cuenta origen se declina antes de la red y no deja fila', async () => {
    const c = caso();
    const o = orden(CLIENTE, { originAccount: undefined });

    await c.requested(o.envelope);

    expect(peticiones).toEqual([]);
    expect(await repo.find(o.id)).toBeNull();
    expect(directos.map((d) => d.messageType)).toEqual(['payment.failed.v1']);
  });

  it('cada paso del barrido continúa la traza guardada al crear el depósito', async () => {
    const c = caso();
    const o = await vencido(c);
    avanzar(5_001);
    await c.sweep();

    expect(trazas.length).toBeGreaterThan(0);
    expect(trazas.every((t) => t === TRACEPARENT)).toBe(true);
    expect((await fila(o.id)).traceContext).toBe(TRACEPARENT);
  });

  describe('quién ve qué', () => {
    it('un cliente ve sus depósitos y no los de otro; el personal ve todos', async () => {
      const c = caso();
      const suyo = orden(CLIENTE);
      const ajeno = orden(OTRO);
      await c.requested(suyo.envelope);
      await c.requested(ajeno.envelope);
      const consultas = new QueryInterbankSendsUseCase({ repository: repo });
      const respuestas: { messageType: string; payload: Record<string, unknown> }[] = [];
      const publisher = {
        reply: async (m: { messageType: string; payload: unknown }) => {
          respuestas.push({ messageType: m.messageType, payload: m.payload as Record<string, unknown> });
        },
      } as never;

      await consultas.list({}, CLIENTE, publisher);
      await consultas.list({}, PERSONAL, publisher);
      await consultas.one(ajeno.id, CLIENTE, publisher);
      await consultas.one(suyo.id, CLIENTE, publisher);

      expect((respuestas[0]?.payload.sends as unknown[]).length).toBe(1);
      expect((respuestas[1]?.payload.sends as unknown[]).length).toBe(2);
      expect(respuestas[2]?.payload).toEqual({ outcome: 'NOT_FOUND' });
      expect(respuestas[3]?.payload).toMatchObject({
        outcome: 'FOUND',
        send: { state: 'SENT', traceId: '4bf92f3577b34da6a3ce929d0e0e4736' },
        history: [{ state: 'PENDING' }, { state: 'SENT' }],
      });
    });
  });
});
