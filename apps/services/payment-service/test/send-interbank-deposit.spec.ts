import type { MessageEnvelope, PaymentRequestedV1 } from '@bank/contracts';

import type {
  InterbankSend,
  InterbankSendRepository,
} from '../src/application/interbank-send.ports';
import { SendInterbankDepositUseCase } from '../src/application/send-interbank-deposit.use-case';
import type { InterbankSendState } from '../src/domain/interbank-send';

/**
 * El envío de un depósito al banco pareja, con dobles.
 *
 * Lo que se prueba es la orquestación, no las transiciones —esas ya las cubre
 * `interbank-send.spec.ts` sobre la función pura—: que la fila se escriba
 * **antes** de intentar entregar, que un comando reentregado no cree un segundo
 * depósito, que la Saga se cierre con los mensajes que ya entiende, y que el
 * que pierde una carrera no publique nada.
 */

const TRANSFER = 'local-demo-1';
const PAYMENT = '00000000-0000-4000-8000-00000000aaaa';
const TRANSACTION = '00000000-0000-4000-8000-00000000bbbb';

function comando(): MessageEnvelope<PaymentRequestedV1> {
  return {
    messageId: '00000000-0000-4000-8000-000000000000',
    messageType: 'payment.requested.v1',
    messageVersion: 1,
    producer: 'transaction-service',
    correlationId: '00000000-0000-4000-8000-000000000001',
    causationId: null,
    idempotencyKey: 'clave-del-cliente',
    occurredAt: '2026-01-01T00:00:00.000Z',
    identity: null,
    payload: {
      paymentId: PAYMENT,
      transactionId: TRANSACTION,
      amount: { amountMinor: 12_500, currency: 'GTQ' },
      interbank: {
        bankCode: 'PARTNER_MOCK',
        account: 'cuenta-de-alla-1',
        interbankTransferId: TRANSFER,
        idempotencyKey: 'clave-interbancaria',
      },
    },
  } as MessageEnvelope<PaymentRequestedV1>;
}

/** Un repositorio en memoria con el mismo guardia de estado que el de verdad. */
class RepositorioEnMemoria implements InterbankSendRepository {
  public readonly filas = new Map<string, InterbankSend>();
  public readonly transiciones: { from: InterbankSendState; to: InterbankSendState }[] = [];
  /** Hace que el próximo `advance` diga que otro llegó primero. */
  public perderCarrera = false;

  public async open(input: {
    send: Omit<InterbankSend, 'state' | 'reason' | 'attempts'>;
    now: Date;
  }): Promise<{ kind: 'CREATED' | 'DUPLICATE'; send: InterbankSend }> {
    const existente = this.filas.get(input.send.interbankTransferId);

    if (existente !== undefined) {
      return { kind: 'DUPLICATE', send: existente };
    }

    const fila: InterbankSend = { ...input.send, state: 'PENDING', reason: null, attempts: 0 };
    this.filas.set(fila.interbankTransferId, fila);

    return { kind: 'CREATED', send: fila };
  }

  public async find(id: string): Promise<InterbankSend | null> {
    return this.filas.get(id) ?? null;
  }

  public async findByTransaction(transactionId: string): Promise<InterbankSend | null> {
    return [...this.filas.values()].find((f) => f.transactionId === transactionId) ?? null;
  }

  public async advance(input: {
    interbankTransferId: string;
    from: InterbankSendState;
    to: InterbankSendState;
    reason: string | null;
    nextAttemptAt: Date | null;
    now: Date;
  }): Promise<boolean> {
    if (this.perderCarrera) {
      this.perderCarrera = false;
      return false;
    }

    const fila = this.filas.get(input.interbankTransferId);

    if (fila === undefined || fila.state !== input.from) {
      return false;
    }

    this.filas.set(input.interbankTransferId, {
      ...fila,
      state: input.to,
      reason: input.reason,
      attempts: fila.attempts + 1,
    });
    this.transiciones.push({ from: input.from, to: input.to });

    return true;
  }

  public async claimSendable(): Promise<readonly InterbankSend[]> {
    return [...this.filas.values()].filter((f) => f.state === 'PENDING');
  }

  public async claimExpired(): Promise<readonly InterbankSend[]> {
    return [...this.filas.values()].filter((f) => f.state === 'PENDING' || f.state === 'SENT');
  }
}

interface Montado {
  readonly caso: SendInterbankDepositUseCase;
  readonly repositorio: RepositorioEnMemoria;
  readonly publicado: { messageType: string; payload: Record<string, unknown> }[];
  readonly estados: InterbankSendState[];
  readonly entregas: string[];
  responder: (acknowledged: boolean) => void;
}

function montar(): Montado {
  const repositorio = new RepositorioEnMemoria();
  const publicado: { messageType: string; payload: Record<string, unknown> }[] = [];
  const estados: InterbankSendState[] = [];
  const entregas: string[] = [];
  let acuse = true;

  const caso = new SendInterbankDepositUseCase({
    repository: repositorio,
    partner: {
      send: async (send): Promise<{ acknowledged: boolean; detail: string | null }> => {
        entregas.push(send.interbankTransferId);
        return { acknowledged: acuse, detail: acuse ? null : 'ECONNREFUSED' };
      },
    },
    messenger: {
      event: async (_cause, messageType, payload): Promise<void> => {
        publicado.push({ messageType, payload: payload as Record<string, unknown> });
      },
    },
    telemetry: {
      stateChanged: (cambio): void => {
        estados.push(cambio.state);
      },
    },
    clock: (): Date => new Date('2026-01-01T00:00:00.000Z'),
    confirmationTimeoutMs: 30_000,
    resendDelaysMs: [1_000, 5_000, 30_000],
    log: { info: (): void => {}, warn: (): void => {} },
  });

  return {
    caso,
    repositorio,
    publicado,
    estados,
    entregas,
    responder: (acknowledged): void => {
      acuse = acknowledged;
    },
  };
}

describe('pedir el depósito', () => {
  it('escribe la fila antes de intentar entregarla', async () => {
    const m = montar();

    await m.caso.requested(comando());

    expect(m.repositorio.filas.get(TRANSFER)).toBeDefined();
    expect(m.entregas).toEqual([TRANSFER]);
    expect(m.repositorio.filas.get(TRANSFER)?.state).toBe('SENT');
  });

  it('un comando reentregado no crea un segundo depósito', async () => {
    const m = montar();

    await m.caso.requested(comando());
    await m.caso.requested(comando());

    expect(m.repositorio.filas.size).toBe(1);
  });

  it('ignora un pago que no es interbancario', async () => {
    const m = montar();
    const interno = comando();
    const payload = { ...interno.payload } as Record<string, unknown>;
    delete payload['interbank'];

    await m.caso.requested({ ...interno, payload } as MessageEnvelope<PaymentRequestedV1>);

    expect(m.repositorio.filas.size).toBe(0);
    expect(m.entregas).toEqual([]);
  });

  it('un fallo de entrega lo deja pendiente, sin cerrar la Saga', async () => {
    const m = montar();
    m.responder(false);

    await m.caso.requested(comando());

    expect(m.repositorio.filas.get(TRANSFER)?.state).toBe('PENDING');
    expect(m.publicado.map((p) => p.messageType)).not.toContain('payment.failed.v1');
  });
});

describe('la decisión del banco pareja', () => {
  it('un ACCEPTED cierra el pago como exitoso', async () => {
    const m = montar();
    await m.caso.requested(comando());

    await m.caso.callback({
      ...comando(),
      messageType: 'payment.interbank.callback.received.v1',
      payload: {
        interbankTransferId: TRANSFER,
        status: 'ACCEPTED',
        receivedAt: '2026-01-01T00:00:10.000Z',
      },
    } as never);

    expect(m.repositorio.filas.get(TRANSFER)?.state).toBe('ACCEPTED');
    expect(m.publicado.map((p) => p.messageType)).toContain('payment.succeeded.v1');
  });

  it('un REJECTED cierra el pago como fallido, con el motivo del otro banco', async () => {
    const m = montar();
    await m.caso.requested(comando());

    await m.caso.callback({
      ...comando(),
      messageType: 'payment.interbank.callback.received.v1',
      payload: {
        interbankTransferId: TRANSFER,
        status: 'REJECTED',
        reason: 'ACCOUNT_INACTIVE',
        receivedAt: '2026-01-01T00:00:10.000Z',
      },
    } as never);

    const fila = m.repositorio.filas.get(TRANSFER);
    expect(fila?.state).toBe('REJECTED');
    expect(fila?.reason).toBe('ACCOUNT_INACTIVE');

    const fallo = m.publicado.find((p) => p.messageType === 'payment.failed.v1');
    expect(fallo?.payload['failureReason']).toBe('PAYMENT_DECLINED');
  });

  it('un callback repetido no cuenta la decisión dos veces', async () => {
    const m = montar();
    await m.caso.requested(comando());
    const callback = {
      ...comando(),
      messageType: 'payment.interbank.callback.received.v1',
      payload: {
        interbankTransferId: TRANSFER,
        status: 'ACCEPTED',
        receivedAt: '2026-01-01T00:00:10.000Z',
      },
    } as never;

    await m.caso.callback(callback);
    await m.caso.callback(callback);

    expect(m.publicado.filter((p) => p.messageType === 'payment.succeeded.v1')).toHaveLength(1);
  });

  it('un callback de un depósito que no mandamos no mueve nada', async () => {
    const m = montar();

    await m.caso.callback({
      ...comando(),
      messageType: 'payment.interbank.callback.received.v1',
      payload: {
        interbankTransferId: 'de-otro-banco',
        status: 'ACCEPTED',
        receivedAt: '2026-01-01T00:00:10.000Z',
      },
    } as never);

    expect(m.publicado).toEqual([]);
  });
});

describe('el vencimiento', () => {
  it('rinde el depósito y manda compensar, distinguiéndolo de un rechazo', async () => {
    const m = montar();
    await m.caso.requested(comando());

    const barrido = await m.caso.sweep();

    expect(barrido.expired).toBe(1);
    expect(m.repositorio.filas.get(TRANSFER)?.state).toBe('TIMEOUT');

    const fallo = m.publicado.find((p) => p.messageType === 'payment.failed.v1');
    expect(fallo?.payload['failureReason']).toBe('PAYMENT_RETRIES_EXHAUSTED');
  });

  it('la compensación deja constancia en REVERSED, y no antes', async () => {
    const m = montar();
    await m.caso.requested(comando());
    await m.caso.sweep();

    expect(m.repositorio.filas.get(TRANSFER)?.state).toBe('TIMEOUT');

    await m.caso.compensated(TRANSACTION);

    expect(m.repositorio.filas.get(TRANSFER)?.state).toBe('REVERSED');
  });
});

describe('la carrera entre el callback y el barrido', () => {
  it('el que pierde no publica nada', async () => {
    const m = montar();
    await m.caso.requested(comando());
    const publicadosAntes = m.publicado.length;

    m.repositorio.perderCarrera = true;
    await m.caso.callback({
      ...comando(),
      messageType: 'payment.interbank.callback.received.v1',
      payload: {
        interbankTransferId: TRANSFER,
        status: 'ACCEPTED',
        receivedAt: '2026-01-01T00:00:10.000Z',
      },
    } as never);

    expect(m.publicado).toHaveLength(publicadosAntes);
    expect(m.repositorio.filas.get(TRANSFER)?.state).toBe('SENT');
  });
});
