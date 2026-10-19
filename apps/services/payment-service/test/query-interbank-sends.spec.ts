import {
  createEnvelope,
  paymentInterbankSendListRepliedV1,
  paymentInterbankSendRepliedV1,
} from '@bank/contracts';
import type { Identity } from '@bank/contracts';

import type {
  InterbankSend,
  InterbankSendRepository,
} from '../src/application/interbank-send.ports';
import type { EventPublisher, OutboundMessage } from '../src/application/ports';
import {
  interbankSendViewOf,
  maskAccount,
  QueryInterbankSendsUseCase,
  traceIdOf,
} from '../src/application/query-interbank-sends.use-case';

/**
 * Consultar los depósitos enviados (T-60, B10): quién ve qué, y qué se enseña.
 */

const ANA = '00000000-0000-4000-8000-0000000000a1';
const BETO = '00000000-0000-4000-8000-0000000000b2';
const AHORA = new Date('2026-10-20T15:00:00.000Z');
const TRACE = '4bf92f3577b34da6a3ce929d0e0e4736';

function deposito(overrides: Partial<InterbankSend> = {}): InterbankSend {
  return {
    interbankTransferId: '8f14e45f-ceea-467a-9b36-4b1c2d6a7e01',
    paymentId: '00000000-0000-4000-8000-00000000aaaa',
    transactionId: '00000000-0000-4000-8000-00000000bbbb',
    idempotencyKey: 'k',
    destinationBankCode: 'BANK99',
    destinationAccount: '99-000004567',
    originAccount: '02-000000052',
    customerId: ANA,
    amount: { amountMinor: 15_000, currency: 'GTQ' },
    correlationId: '00000000-0000-4000-8000-00000000cccc',
    state: 'ACCEPTED',
    reason: null,
    attempts: 2,
    confirmationDueAt: new Date(AHORA.getTime() + 180_000),
    createdAt: AHORA,
    verdictEnqueuedAt: AHORA,
    releaseNotBefore: new Date(AHORA.getTime() + 480_000),
    probe: null,
    cancel: null,
    resolveNotBefore: null,
    probeAttempts: 0,
    cancelAttempts: 0,
    reversal: null,
    decidedAt: new Date(AHORA.getTime() + 4_000),
    sentAt: new Date(AHORA.getTime() + 1_000),
    reversedAt: null,
    traceContext: `00-${TRACE}-00f067aa0ba902b7-01`,
    origin: createEnvelope({}, { messageType: 'payment.requested.v1', producer: 'transaction-service', identity: null }),
    ...overrides,
  };
}

function montar(filas: InterbankSend[]): {
  readonly useCase: QueryInterbankSendsUseCase;
  readonly respuestas: OutboundMessage[];
  readonly listados: { customerId: string | null; state?: string; limit: number }[];
  readonly publisher: EventPublisher;
} {
  const respuestas: OutboundMessage[] = [];
  const listados: { customerId: string | null; state?: string; limit: number }[] = [];
  const repository = {
    find: async (id: string) => filas.find((f) => f.interbankTransferId === id) ?? null,
    history: async () => [
      { state: 'PENDING' as const, reason: null, at: AHORA },
      { state: 'SENT' as const, reason: null, at: new Date(AHORA.getTime() + 1_000) },
    ],
    list: async (input: { customerId: string | null; state?: string; limit: number }) => {
      listados.push(input);

      return filas.filter((f) => input.customerId === null || f.customerId === input.customerId);
    },
  } as unknown as InterbankSendRepository;
  const publisher = {
    reply: async (message: OutboundMessage) => {
      respuestas.push(message);
    },
  } as unknown as EventPublisher;

  return { useCase: new QueryInterbankSendsUseCase({ repository }), respuestas, listados, publisher };
}

const cliente = (customerId: string): Identity => ({ customerId, role: 'CLIENTE' });
const personal = (role: 'CAJERO_RECEPTOR' | 'ADMINISTRADOR'): Identity => ({
  customerId: '00000000-0000-4000-8000-0000000000ff',
  role,
});

describe('un depósito enviado', () => {
  it('su dueño lo ve, con los seis campos que la pantalla necesita y su historial', async () => {
    const m = montar([deposito()]);

    await m.useCase.one('8f14e45f-ceea-467a-9b36-4b1c2d6a7e01', cliente(ANA), m.publisher);

    const payload = m.respuestas[0]?.payload as { outcome: string; send: Record<string, unknown>; history: unknown[] };

    expect(paymentInterbankSendRepliedV1.schema.safeParse(payload).success).toBe(true);
    expect(payload.outcome).toBe('FOUND');
    expect(payload.send).toMatchObject({
      state: 'ACCEPTED',
      destinationBankCode: 'BANK99',
      destinationAccount: '********4567',
      amount: { amountMinor: 15_000, currency: 'GTQ' },
      correlationId: '00000000-0000-4000-8000-00000000cccc',
      traceId: TRACE,
      attempts: 2,
    });
    expect(payload.history).toHaveLength(2);
  });

  it('otro cliente recibe NOT_FOUND, igual que si no existiera', async () => {
    const m = montar([deposito()]);

    await m.useCase.one('8f14e45f-ceea-467a-9b36-4b1c2d6a7e01', cliente(BETO), m.publisher);
    await m.useCase.one('00000000-0000-4000-8000-000000000999', cliente(BETO), m.publisher);

    expect(m.respuestas[0]?.payload).toEqual({ outcome: 'NOT_FOUND' });
    expect(m.respuestas[1]?.payload).toEqual({ outcome: 'NOT_FOUND' });
  });

  it.each(['CAJERO_RECEPTOR', 'ADMINISTRADOR'] as const)('el personal (%s) ve el de cualquiera', async (rol) => {
    const m = montar([deposito()]);

    await m.useCase.one('8f14e45f-ceea-467a-9b36-4b1c2d6a7e01', personal(rol), m.publisher);

    expect((m.respuestas[0]?.payload as { outcome: string }).outcome).toBe('FOUND');
  });

  it('un mensaje sin identidad no ve nada', async () => {
    const m = montar([deposito()]);

    await m.useCase.one('8f14e45f-ceea-467a-9b36-4b1c2d6a7e01', null, m.publisher);

    expect(m.respuestas[0]?.payload).toEqual({ outcome: 'NOT_FOUND' });
  });
});

describe('el listado', () => {
  it('un cliente pregunta por lo suyo', async () => {
    const m = montar([deposito(), deposito({ customerId: BETO })]);

    await m.useCase.list({}, cliente(ANA), m.publisher);

    expect(m.listados[0]).toMatchObject({ customerId: ANA, limit: 50 });
    const payload = m.respuestas[0]?.payload as { sends: unknown[] };
    expect(paymentInterbankSendListRepliedV1.schema.safeParse(payload).success).toBe(true);
    expect(payload.sends).toHaveLength(1);
  });

  it('el personal pregunta por todo, con el filtro y el límite que pida', async () => {
    const m = montar([deposito(), deposito({ customerId: BETO })]);

    await m.useCase.list({ state: 'TIMEOUT', limit: 10 }, personal('ADMINISTRADOR'), m.publisher);

    expect(m.listados[0]).toEqual({ customerId: null, state: 'TIMEOUT', limit: 10 });
    expect((m.respuestas[0]?.payload as { sends: unknown[] }).sends).toHaveLength(2);
  });

  it('sin identidad no pregunta a la base: la lista está vacía', async () => {
    const m = montar([deposito()]);

    await m.useCase.list({}, null, m.publisher);

    expect(m.listados).toEqual([]);
    expect(m.respuestas[0]?.payload).toEqual({ sends: [] });
  });
});

describe('lo que la vista enseña', () => {
  it('enmascara la cuenta del banco pareja salvo los últimos cuatro caracteres', () => {
    expect(maskAccount('99-000004567')).toBe('********4567');
    expect(maskAccount('1234')).toBe('****');
    expect(maskAccount('')).toBe('');
  });

  it('extrae el traceId del traceparent, y nulo si no hay o está mal', () => {
    expect(traceIdOf(`00-${TRACE}-00f067aa0ba902b7-01`)).toBe(TRACE);
    expect(traceIdOf(null)).toBeNull();
    expect(traceIdOf('basura')).toBeNull();
  });

  it('marca la liberación sin verificar, y sólo ésa', () => {
    expect(interbankSendViewOf(deposito({ state: 'REJECTED', reason: 'RELEASED_NO_ANSWER' })).releasedUnverified).toBe(true);
    expect(interbankSendViewOf(deposito({ state: 'REVERSED', reason: 'RELEASED_UNKNOWN_AT_PARTNER' })).releasedUnverified).toBe(true);
    expect(interbankSendViewOf(deposito({ state: 'REJECTED', reason: 'ACCOUNT_NOT_FOUND' })).releasedUnverified).toBe(false);
    expect(interbankSendViewOf(deposito()).releasedUnverified).toBe(false);
  });

  it('expone el reverso pedido por un ACCEPTED tardío', () => {
    const vista = interbankSendViewOf(
      deposito({
        state: 'REJECTED',
        reason: 'RELEASED_NO_ANSWER',
        reversal: {
          reversalId: '00000000-0000-4000-8000-0000000000dd',
          state: 'PROCESSING',
          attempts: 1,
          nextAt: AHORA,
          refundTransferId: null,
          message: null,
        },
      }),
    );

    expect(vista.reversal).toEqual({
      reversalId: '00000000-0000-4000-8000-0000000000dd',
      state: 'PROCESSING',
    });
  });

  it('no filtra el cuerpo del mensaje original ni ningún dato personal', () => {
    const vista = JSON.stringify(interbankSendViewOf(deposito()));

    expect(vista).not.toContain('99-000004567');
    expect(vista).not.toContain('origin_envelope');
    expect(vista).not.toContain('"origin"');
    expect(vista).not.toContain('identity');
  });
});
