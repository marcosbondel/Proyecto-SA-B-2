import type { MessageEnvelope, PaymentRequestedV1 } from '@bank/contracts';

import type {
  InterbankSend,
  InterbankSendRepository,
} from '../src/application/interbank-send.ports';
import type { OutboxMessage } from '../src/application/ports';
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
        bankCode: 'BANK99',
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
  /** Lo que se escribió en el outbox, que es lo que el relay publicará. */
  public readonly outbox: OutboxMessage[] = [];
  /** Hace que el próximo `advance` diga que otro llegó primero. */
  public perderCarrera = false;

  public async open(input: {
    send: Omit<InterbankSend, 'state' | 'reason' | 'attempts' | 'verdictEnqueuedAt'>;
    now: Date;
  }): Promise<{ kind: 'CREATED' | 'DUPLICATE'; send: InterbankSend }> {
    const existente = this.filas.get(input.send.interbankTransferId);

    if (existente !== undefined) {
      return { kind: 'DUPLICATE', send: existente };
    }

    const fila: InterbankSend = {
      ...input.send,
      state: 'PENDING',
      reason: null,
      attempts: 0,
      verdictEnqueuedAt: null,
    };
    this.filas.set(fila.interbankTransferId, fila);

    return { kind: 'CREATED', send: fila };
  }

  public async find(id: string): Promise<InterbankSend | null> {
    return this.filas.get(id) ?? null;
  }

  public async findByTransaction(transactionId: string): Promise<InterbankSend | null> {
    return [...this.filas.values()].find((f) => f.transactionId === transactionId) ?? null;
  }

  /**
   * El mismo guardia de estado que el de verdad, y la misma atomicidad: los
   * mensajes entran en `outbox` **sólo si** la fila se movió (TD-093). Un doble
   * que los aceptara siempre no podría distinguir el arreglo del defecto.
   */
  public async advance(input: {
    interbankTransferId: string;
    from: InterbankSendState;
    to: InterbankSendState;
    reason: string | null;
    nextAttemptAt: Date | null;
    now: Date;
    outbound?: readonly OutboxMessage[];
  }): Promise<boolean> {
    if (this.perderCarrera) {
      this.perderCarrera = false;
      return false;
    }

    const fila = this.filas.get(input.interbankTransferId);

    if (fila === undefined || fila.state !== input.from) {
      return false;
    }

    const decidido = ['ACCEPTED', 'REJECTED', 'TIMEOUT', 'REVERSED'].includes(input.to);
    const traeVeredicto = (input.outbound?.length ?? 0) > 0;

    this.filas.set(input.interbankTransferId, {
      ...fila,
      state: input.to,
      reason: input.reason,
      attempts: fila.attempts + 1,
      verdictEnqueuedAt:
        decidido && traeVeredicto ? (fila.verdictEnqueuedAt ?? input.now) : fila.verdictEnqueuedAt,
    });
    this.transiciones.push({ from: input.from, to: input.to });
    this.outbox.push(...(input.outbound ?? []));

    return true;
  }

  public async claimSendable(): Promise<readonly InterbankSend[]> {
    return [...this.filas.values()].filter((f) => f.state === 'PENDING');
  }

  public async claimExpired(): Promise<readonly InterbankSend[]> {
    return [...this.filas.values()].filter((f) => f.state === 'PENDING' || f.state === 'SENT');
  }

  public async claimUnreconciled(olderThan: Date): Promise<readonly InterbankSend[]> {
    return [...this.filas.values()].filter(
      (f) =>
        ['ACCEPTED', 'REJECTED', 'TIMEOUT'].includes(f.state) &&
        f.verdictEnqueuedAt === null &&
        f.createdAt <= olderThan,
    );
  }

  public async enqueueVerdict(input: {
    interbankTransferId: string;
    outbound: readonly OutboxMessage[];
    now: Date;
  }): Promise<boolean> {
    const fila = this.filas.get(input.interbankTransferId);

    if (fila === undefined || fila.verdictEnqueuedAt !== null) {
      return false;
    }

    this.filas.set(input.interbankTransferId, { ...fila, verdictEnqueuedAt: input.now });
    this.outbox.push(...input.outbound);

    return true;
  }
}

interface Montado {
  readonly caso: SendInterbankDepositUseCase;
  readonly repositorio: RepositorioEnMemoria;
  readonly publicado: readonly { messageType: string; payload: Record<string, unknown> }[];
  /**
   * Sólo lo que salió por `messenger.event` — el camino directo al broker, que
   * es el que el defecto de TD-093 usaba para el veredicto.
   */
  readonly directo: readonly { messageType: string; payload: Record<string, unknown> }[];
  readonly estados: InterbankSendState[];
  readonly entregas: string[];
  responder: (acknowledged: boolean) => void;
  /** Mueve el reloj, para pasar del margen de la reconciliación. */
  avanzar: (ms: number) => void;
}

function montar(): Montado {
  const repositorio = new RepositorioEnMemoria();
  const publicado: { messageType: string; payload: Record<string, unknown> }[] = [];
  const estados: InterbankSendState[] = [];
  const entregas: string[] = [];
  let acuse = true;
  let ahora = new Date('2026-01-01T00:00:00.000Z');

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
      /*
       * Construye y no publica, como el de verdad. Lo que llega a la Saga desde
       * aquí lo decide `advance`, que es el punto del arreglo: el mensaje y la
       * fila comitan juntos o no comitan (TD-093).
       */
      envelopeFor: (_cause, messageType, payload): OutboxMessage => ({
        exchange: 'bank.events',
        routingKey: messageType,
        envelope: { messageType, payload } as unknown as MessageEnvelope<unknown>,
      }),
    },
    telemetry: {
      stateChanged: (cambio): void => {
        estados.push(cambio.state);
      },
    },
    clock: (): Date => ahora,
    confirmationTimeoutMs: 30_000,
    resendDelaysMs: [1_000, 5_000, 30_000],
    log: { info: (): void => {}, warn: (): void => {} },
  });

  return {
    caso,
    repositorio,
    /*
     * Todo lo que la Saga acaba oyendo: lo publicado directamente más lo que
     * quedó en el outbox para el relay. Las aserciones que ya existían siguen
     * preguntando lo mismo —«¿se cerró la Saga con el mensaje correcto?»— sin
     * que les importe por qué camino salió, que es lo que debe cambiar y lo que
     * no.
     */
    directo: publicado,
    get publicado() {
      return [
        ...publicado,
        ...repositorio.outbox.map((m) => ({
          messageType: m.envelope.messageType,
          payload: (m.envelope as unknown as { payload: Record<string, unknown> }).payload,
        })),
      ];
    },
    estados,
    entregas,
    responder: (acknowledged): void => {
      acuse = acknowledged;
    },
    avanzar: (ms): void => {
      ahora = new Date(ahora.getTime() + ms);
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

/**
 * El veredicto y su transición comitan juntos (TD-093).
 *
 * El defecto que esto cubre costó Q1.00 el 2026-10-15: el caso de uso movía la
 * fila y **después** publicaba, el proceso murió en medio, y la fila —ya
 * decidida— quedó fuera del alcance de los dos barridos para siempre.
 *
 * Lo que se afirma aquí no es «se publicó el mensaje correcto» —eso ya lo
 * afirmaban los tests de arriba y seguía siendo verdad con el defecto puesto—
 * sino **por dónde sale**: el veredicto va al outbox, en la misma llamada que
 * mueve la fila, y no hay ninguna publicación directa que pueda perderse.
 */
describe('el veredicto no se publica fuera de su transacción', () => {
  it('el final de la Saga sale por el outbox y no por el broker', async () => {
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

    // El veredicto está en el outbox...
    expect(m.repositorio.outbox.map((o) => o.envelope.messageType)).toContain(
      'payment.succeeded.v1',
    );
    // ...y NO se publicó directamente. `directo` sólo recoge `messenger.event`,
    // que es el camino que el defecto usaba.
    expect(m.directo.map((p) => p.messageType)).not.toContain('payment.succeeded.v1');
  });

  it('la fila queda marcada: su veredicto ya se encoló', async () => {
    const m = montar();

    await m.caso.requested(comando());
    await m.caso.sweep();

    expect(m.repositorio.filas.get(TRANSFER)?.state).toBe('TIMEOUT');
    expect(m.repositorio.filas.get(TRANSFER)?.verdictEnqueuedAt).not.toBeNull();
  });

  it('el que pierde la carrera no deja nada en el outbox', async () => {
    const m = montar();
    await m.caso.requested(comando());
    const enOutbox = m.repositorio.outbox.length;

    m.repositorio.perderCarrera = true;
    await m.caso.callback({
      ...comando(),
      messageType: 'payment.interbank.callback.received.v1',
      payload: {
        interbankTransferId: TRANSFER,
        status: 'REFUSED',
        reason: 'ACCOUNT_NOT_FOUND',
        receivedAt: '2026-01-01T00:00:10.000Z',
      },
    } as never);

    /*
     * Lo importante de este caso: el `ROLLBACK`. Si el outbox creciera aquí, la
     * Saga recibiría el veredicto del que perdió la carrera además del del que
     * la ganó — dos finales para una transferencia.
     */
    expect(m.repositorio.outbox).toHaveLength(enOutbox);
  });
});

/**
 * La reconciliación recupera lo que el defecto ya se llevó (TD-093, pieza b).
 *
 * El escenario es exactamente el del Q1.00: una fila decidida, sin veredicto
 * encolado, porque la versión del código que la decidió publicaba fuera de la
 * transacción. Ninguna fila nueva puede llegar a este estado — y eso también se
 * afirma aquí.
 */
describe('la reconciliación de un veredicto perdido', () => {
  it('vuelve a encolar el veredicto de un TIMEOUT que nunca se publicó', async () => {
    const m = montar();
    await m.caso.requested(comando());
    await m.caso.sweep();

    // Se simula el defecto: la fila quedó decidida y su veredicto se perdió.
    const fila = m.repositorio.filas.get(TRANSFER)!;
    m.repositorio.filas.set(TRANSFER, { ...fila, verdictEnqueuedAt: null });
    m.repositorio.outbox.length = 0;

    // Pasado el margen de dos minutos: antes de eso la reconciliación no toca
    // nada, porque una fila recién decidida puede tener su veredicto en una
    // transacción que aún no comitó.
    m.avanzar(121_000);

    const recuperados = await m.caso.reconcile();

    expect(recuperados).toBe(1);
    expect(m.repositorio.outbox.map((o) => o.envelope.messageType)).toEqual([
      'payment.interbank.sent.v1',
      'payment.failed.v1',
    ]);
    expect(m.repositorio.filas.get(TRANSFER)?.verdictEnqueuedAt).not.toBeNull();
  });

  it('es de una sola vez: la segunda pasada no recupera nada', async () => {
    const m = montar();
    await m.caso.requested(comando());
    await m.caso.sweep();
    const fila = m.repositorio.filas.get(TRANSFER)!;
    m.repositorio.filas.set(TRANSFER, { ...fila, verdictEnqueuedAt: null });
    m.avanzar(121_000);

    expect(await m.caso.reconcile()).toBe(1);
    expect(await m.caso.reconcile()).toBe(0);
  });

  it('no encuentra nada cuando el camino normal funcionó', async () => {
    const m = montar();
    await m.caso.requested(comando());
    await m.caso.sweep();

    /*
     * La afirmación que convierte esto en una prueba de la pieza (a): tras un
     * ciclo normal, la red de seguridad está vacía. Si esto devolviera 1, el
     * veredicto no se habría encolado con su transición.
     */
    m.avanzar(121_000);
    expect(await m.caso.reconcile()).toBe(0);
  });

  it('no toca un depósito que todavía espera respuesta', async () => {
    const m = montar();
    await m.caso.requested(comando());

    expect(m.repositorio.filas.get(TRANSFER)?.state).toBe('SENT');
    m.avanzar(121_000);
    expect(await m.caso.reconcile()).toBe(0);
  });

  it('no reclama un depósito ya compensado, ni sin la marca', async () => {
    const m = montar();
    await m.caso.requested(comando());
    await m.caso.sweep();
    await m.caso.compensated(TRANSACTION);

    const fila = m.repositorio.filas.get(TRANSFER)!;
    expect(fila.state).toBe('REVERSED');
    m.avanzar(121_000);

    /*
     * Incluso borrando la marca: `REVERSED` significa que la compensación ya
     * ocurrió, así que su veredicto se entregó. Reemitirlo sería pedirle a la
     * Saga un segundo final.
     *
     * Esto comprueba el **filtro del barrido**, no `settlementOf` — una fila
     * `REVERSED` no se reclama, así que la función pura no llega a consultarse.
     * La segunda defensa, la de `settlementOf`, se prueba donde vive: en
     * `interbank-send.spec.ts`. Lo descubrí mutando `settlementOf` y viendo que
     * este test seguía pasando.
     */
    m.repositorio.filas.set(TRANSFER, { ...fila, verdictEnqueuedAt: null });

    expect(await m.caso.reconcile()).toBe(0);
  });
});

describe('el margen de la reconciliación', () => {
  it('no toca un veredicto recién decidido, aunque le falte la marca', async () => {
    const m = montar();
    await m.caso.requested(comando());
    await m.caso.sweep();
    const fila = m.repositorio.filas.get(TRANSFER)!;
    m.repositorio.filas.set(TRANSFER, { ...fila, verdictEnqueuedAt: null });

    /*
     * Sin avanzar el reloj. Una fila decidida hace un segundo puede tener su
     * veredicto escrito en una transacción que todavía no ha comitado, y
     * reconciliarla publicaría el mismo final dos veces con dos `messageId`
     * distintos — que es precisamente lo que la deduplicación de Transaction no
     * podría atrapar.
     */
    expect(await m.caso.reconcile()).toBe(0);

    m.avanzar(119_000);
    expect(await m.caso.reconcile()).toBe(0);

    m.avanzar(2_000);
    expect(await m.caso.reconcile()).toBe(1);
  });
});
