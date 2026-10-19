import type { MessageEnvelope, PaymentRequestedV1 } from '@bank/contracts';

import type {
  InterbankSend,
  InterbankSendRepository,
  InterbankSendReversalState,
  PartnerReversal,
} from '../src/application/interbank-send.ports';
import type { OutboxMessage } from '../src/application/ports';
import type { PartnerCancel, PartnerProbe } from '../src/domain/interbank-timeout';
import { SendInterbankDepositUseCase } from '../src/application/send-interbank-deposit.use-case';
import { settlementOf, type InterbankSendState } from '../src/domain/interbank-send';

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
const CLIENTE = '00000000-0000-4000-8000-00000000cccc';
const TRACEPARENT = '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01';

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
    identity: { customerId: CLIENTE, role: 'CLIENTE' },
    payload: {
      paymentId: PAYMENT,
      transactionId: TRANSACTION,
      amount: { amountMinor: 12_500, currency: 'GTQ' },
      interbank: {
        bankCode: 'BANK99',
        account: 'cuenta-de-alla-1',
        interbankTransferId: TRANSFER,
        idempotencyKey: 'clave-interbancaria',
        originAccount: '02-000000052',
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
    send: Omit<
      InterbankSend,
      | 'state'
      | 'reason'
      | 'attempts'
      | 'verdictEnqueuedAt'
      | 'probe'
      | 'cancel'
      | 'resolveNotBefore'
      | 'probeAttempts'
      | 'cancelAttempts'
      | 'reversal'
      | 'decidedAt'
      | 'sentAt'
      | 'reversedAt'
    >;
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
      probe: null,
      cancel: null,
      resolveNotBefore: null,
      probeAttempts: 0,
      cancelAttempts: 0,
      reversal: null,
      decidedAt: null,
      sentAt: null,
      reversedAt: null,
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

    // El mismo predicado que el repositorio de verdad: un `TIMEOUT` no lleva
    // veredicto desde TD-095, aunque sí lleve su evento de auditoría.
    const decidido = ['ACCEPTED', 'REJECTED', 'TIMEOUT', 'REVERSED'].includes(input.to);
    const traeVeredicto =
      settlementOf(input.to) !== null && (input.outbound?.length ?? 0) > 0;

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
    // `nextAttemptAt` no está en la entidad —sólo entra por `advance`— así que
    // aquí el estado es todo lo que se puede filtrar.
    return [...this.filas.values()].filter((f) => f.state === 'PENDING');
  }

  /**
   * Respeta el plazo, como el de verdad.
   *
   * No lo hacía: devolvía todo lo no resuelto sin mirar `confirmationDueAt`, así
   * que **ningún test podía distinguir un plazo de 30 s de uno de 180** — que es
   * precisamente el defecto de TD-095. Un doble más laxo que la base de datos no
   * es un atajo, es un punto ciego.
   */
  public async claimExpired(now: Date): Promise<readonly InterbankSend[]> {
    return [...this.filas.values()].filter(
      (f) => (f.state === 'PENDING' || f.state === 'SENT') && f.confirmationDueAt <= now,
    );
  }

  /** El reloj con que se pidió el último reclamo de la reconciliación (T-60). */
  public relojDelReclamo: Date | null = null;

  public async claimUnreconciled(
    olderThan: Date,
    _limit: number,
    now: Date,
  ): Promise<readonly InterbankSend[]> {
    this.relojDelReclamo = now;

    return [...this.filas.values()].filter(
      (f) =>
        // Sin `TIMEOUT`: desde TD-095 no es un veredicto.
        ['ACCEPTED', 'REJECTED'].includes(f.state) &&
        f.verdictEnqueuedAt === null &&
        f.createdAt <= olderThan,
    );
  }

  public async claimAwaitingResolution(now: Date): Promise<readonly InterbankSend[]> {
    return [...this.filas.values()].filter(
      (f) =>
        f.state === 'TIMEOUT' &&
        (f.resolveNotBefore === null || f.resolveNotBefore <= now),
    );
  }

  public async recordResolutionStep(input: {
    interbankTransferId: string;
    probe?: PartnerProbe;
    cancel?: PartnerCancel;
    resolveNotBefore: Date;
    now: Date;
  }): Promise<void> {
    const fila = this.filas.get(input.interbankTransferId);

    if (fila === undefined) {
      return;
    }

    this.filas.set(input.interbankTransferId, {
      ...fila,
      probe: input.probe ?? fila.probe,
      cancel: input.cancel ?? fila.cancel,
      probeAttempts: fila.probeAttempts + (input.probe === undefined ? 0 : 1),
      cancelAttempts: fila.cancelAttempts + (input.cancel === undefined ? 0 : 1),
      resolveNotBefore: input.resolveNotBefore,
    });
  }

  public async requestReversal(input: {
    interbankTransferId: string;
    reversalId: string;
    now: Date;
  }): Promise<boolean> {
    const fila = this.filas.get(input.interbankTransferId);

    if (fila === undefined || fila.reversal !== null) return false;
    if (fila.state !== 'REJECTED' && fila.state !== 'REVERSED') return false;

    this.filas.set(input.interbankTransferId, {
      ...fila,
      reversal: {
        reversalId: input.reversalId,
        state: 'PENDING',
        attempts: 0,
        nextAt: input.now,
        refundTransferId: null,
        message: null,
      },
    });

    return true;
  }

  public async claimReversals(now: Date): Promise<readonly InterbankSend[]> {
    return [...this.filas.values()].filter(
      (f) =>
        f.reversal !== null &&
        (f.reversal.state === 'PENDING' || f.reversal.state === 'PROCESSING') &&
        f.reversal.nextAt !== null &&
        f.reversal.nextAt <= now,
    );
  }

  public async recordReversalStep(input: {
    interbankTransferId: string;
    state: InterbankSendReversalState;
    refundTransferId: string | null;
    message: string | null;
    nextAt: Date | null;
    now: Date;
  }): Promise<void> {
    const fila = this.filas.get(input.interbankTransferId);

    if (fila?.reversal === null || fila === undefined) return;

    this.filas.set(input.interbankTransferId, {
      ...fila,
      reversal: {
        ...fila.reversal,
        state: input.state,
        attempts: fila.reversal.attempts + 1,
        nextAt: input.nextAt,
        refundTransferId: input.refundTransferId ?? fila.reversal.refundTransferId,
        message: input.message ?? fila.reversal.message,
      },
    });
  }

  public async list(): Promise<readonly InterbankSend[]> {
    return [...this.filas.values()];
  }

  public async history(): Promise<readonly { state: InterbankSendState; reason: string | null; at: Date }[]> {
    return [];
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
  /** Los pasos del protocolo que se pidieron al banco pareja, en orden. */
  readonly pasos: readonly string[];
  /** Qué contesta `GET /transfers/{id}`. */
  contesta: (probe: PartnerProbe) => void;
  /** Qué contesta `POST /transfers/{id}/cancel`. */
  cancelaCon: (cancel: PartnerCancel) => void;
  /** Lo que se registró en `log.error`, que es lo que dispara la alerta. */
  readonly alertas: readonly Record<string, unknown>[];
  /** Los cambios de estado tal como llegaron a la telemetría, con su origen. */
  readonly cambios: readonly { state: InterbankSendState; from: InterbankSendState | null }[];
  /** Las trazas continuadas, por nombre de span y `traceparent`. */
  readonly trazas: readonly { traceparent: string | null; span: string }[];
  /** Lo que contesta el banco pareja a los reversos. */
  reversoCon: (respuesta: PartnerReversal) => void;
  readonly reversos: readonly string[];
}

function montar(): Montado {
  const repositorio = new RepositorioEnMemoria();
  const publicado: { messageType: string; payload: Record<string, unknown> }[] = [];
  const estados: InterbankSendState[] = [];
  const entregas: string[] = [];
  let acuse = true;
  let ahora = new Date('2026-01-01T00:00:00.000Z');
  let respuestaConsulta: PartnerProbe = { kind: 'UNREACHABLE' };
  let respuestaCancelacion: PartnerCancel = { kind: 'UNREACHABLE' };
  const pasos: string[] = [];
  const alertas: Record<string, unknown>[] = [];
  const cambios: { state: InterbankSendState; from: InterbankSendState | null }[] = [];
  const trazas: { traceparent: string | null; span: string }[] = [];
  const reversos: string[] = [];
  let respuestaReverso: PartnerReversal = { kind: 'UNREACHABLE' };

  const caso = new SendInterbankDepositUseCase({
    repository: repositorio,
    partner: {
      send: async (send): Promise<{ acknowledged: boolean; detail: string | null }> => {
        entregas.push(send.interbankTransferId);
        return { acknowledged: acuse, detail: acuse ? null : 'ECONNREFUSED' };
      },
      probe: async (): Promise<PartnerProbe> => {
        pasos.push('probe');
        return respuestaConsulta;
      },
      cancel: async (): Promise<PartnerCancel> => {
        pasos.push('cancel');
        return respuestaCancelacion;
      },
      requestReversal: async (_send, reversalId): Promise<PartnerReversal> => {
        reversos.push(`request:${reversalId}`);
        return respuestaReverso;
      },
      reversalStatus: async (reversalId): Promise<PartnerReversal> => {
        reversos.push(`status:${reversalId}`);
        return respuestaReverso;
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
        cambios.push({ state: cambio.state, from: cambio.from });
      },
    },
    clock: (): Date => ahora,
    transferTtlMs: 180_000,
    releaseMarginMs: 300_000,
    resolveRetryMs: 5_000,
    resendDelaysMs: [1_000, 5_000, 30_000],
    maxAmountMinor: 1_000_000,
    trace: {
      current: (): string | null => TRACEPARENT,
      continue: async (traceparent, span, _correlationId, work) => {
        trazas.push({ traceparent, span });
        return await work();
      },
    },
    log: {
      info: (): void => {},
      warn: (): void => {},
      error: (_m, fields): void => {
        alertas.push(fields);
      },
    },
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
    pasos,
    contesta: (probe): void => {
      respuestaConsulta = probe;
    },
    cancelaCon: (cancel): void => {
      respuestaCancelacion = cancel;
    },
    alertas,
    cambios,
    trazas,
    reversoCon: (respuesta): void => {
      respuestaReverso = respuesta;
    },
    reversos,
  };
}

/** El callback del banco pareja, aceptando o rechazando. */
function callback(tipo: 'CONFIRMED' | 'REFUSED', reason?: string): never {
  return {
    ...comando(),
    messageType: 'payment.interbank.callback.received.v1',
    payload: {
      interbankTransferId: TRANSFER,
      status: tipo === 'CONFIRMED' ? 'ACCEPTED' : 'REJECTED',
      ...(reason === undefined ? {} : { reason }),
      receivedAt: '2026-01-01T00:00:10.000Z',
    },
  } as never;
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

  it('un comando reentregado no vuelve a entregar al banco pareja (T-60)', async () => {
    const m = montar();
    m.responder(false);

    await m.caso.requested(comando());
    await m.caso.requested(comando());
    await m.caso.requested(comando());

    // La fila nace arrendada a quien la entrega; el reintento es del barrido.
    expect(m.entregas).toEqual([TRANSFER]);
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
  it('vence sin cerrar la Saga: el dinero sigue reservado', async () => {
    /*
     * Invertido respecto a como nació (TD-095). Afirmaba que el vencimiento
     * publicaba `payment.failed.v1` y mandaba compensar; ahora afirma que **no**
     * publica ningún final. El depósito pasa a `TIMEOUT` y se queda ahí hasta
     * que el protocolo lo resuelva — consultando al otro banco, que tiene 24
     * horas para contestar.
     */
    const m = montar();
    await m.caso.requested(comando());

    // El plazo del contrato, 180 s, ahora que el doble lo respeta.
    m.avanzar(180_001);
    const barrido = await m.caso.sweep();

    expect(barrido.expired).toBe(1);
    expect(m.repositorio.filas.get(TRANSFER)?.state).toBe('TIMEOUT');
    expect(m.publicado.find((p) => p.messageType === 'payment.failed.v1')).toBeUndefined();
    expect(m.publicado.find((p) => p.messageType === 'payment.succeeded.v1')).toBeUndefined();
  });

  it('la compensación deja constancia en REVERSED, y no antes', async () => {
    const m = montar();
    await m.caso.requested(comando());
    m.avanzar(180_001);
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
    await m.caso.callback(callback('REFUSED', 'ACCOUNT_NOT_FOUND'));

    expect(m.repositorio.filas.get(TRANSFER)?.state).toBe('REJECTED');
    expect(m.repositorio.filas.get(TRANSFER)?.verdictEnqueuedAt).not.toBeNull();
  });

  it('un vencimiento no pone la marca: todavía no hay veredicto', async () => {
    const m = montar();

    await m.caso.requested(comando());
    m.avanzar(180_001);
    await m.caso.sweep();

    /*
     * `TIMEOUT` no es un veredicto desde TD-095, así que no lleva ninguno
     * consigo y la marca sigue nula. Si se pusiera aquí, la reconciliación de
     * TD-093 daría por entregado un final que nunca se escribió.
     */
    expect(m.repositorio.filas.get(TRANSFER)?.state).toBe('TIMEOUT');
    expect(m.repositorio.filas.get(TRANSFER)?.verdictEnqueuedAt).toBeNull();
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
  it('vuelve a encolar el veredicto de un rechazo que nunca se publicó', async () => {
    const m = montar();
    await m.caso.requested(comando());
    await m.caso.callback(callback('REFUSED', 'ACCOUNT_NOT_FOUND'));

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
    await m.caso.callback(callback('REFUSED', 'ACCOUNT_NOT_FOUND'));
    const fila = m.repositorio.filas.get(TRANSFER)!;
    m.repositorio.filas.set(TRANSFER, { ...fila, verdictEnqueuedAt: null });
    m.avanzar(121_000);

    expect(await m.caso.reconcile()).toBe(1);
    expect(await m.caso.reconcile()).toBe(0);
  });

  it('no encuentra nada cuando el camino normal funcionó', async () => {
    const m = montar();
    await m.caso.requested(comando());
    await m.caso.callback(callback('REFUSED', 'ACCOUNT_NOT_FOUND'));

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
    await m.caso.callback(callback('REFUSED', 'ACCOUNT_NOT_FOUND'));
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
    await m.caso.callback(callback('REFUSED', 'ACCOUNT_NOT_FOUND'));
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

/**
 * El protocolo de TIMEOUT, de punta a punta (TD-095).
 *
 * `interbank-timeout.spec.ts` prueba la decisión; esto prueba que el caso de uso
 * **la ejecuta en orden** y que el dinero no se mueve antes de tiempo. Las dos
 * cosas que ninguna otra prueba puede dar por supuestas:
 *
 * 1. Un depósito vencido no cierra la Saga: consulta, cancela, y sólo entonces
 *    decide.
 * 2. Con el banco pareja callado, **no se libera nada** hasta el margen — y
 *    cuando se libera, se registra como no verificado.
 */
describe('el protocolo de TIMEOUT, paso a paso', () => {
  /**
   * Lleva un depósito hasta `TIMEOUT` **y da su primer paso del protocolo**.
   *
   * Las dos cosas en el mismo barrido a propósito, porque es lo que hace el
   * código: `sweep` vence y resuelve en la misma pasada, para que un depósito
   * que acaba de vencer entre en su protocolo sin esperar al barrido siguiente.
   * Por eso las respuestas del banco pareja se configuran ANTES — si se
   * configuran después, el primer paso ya se dio con el silencio por defecto, y
   * la cadencia de cinco segundos tapa el resto.
   */
  async function hastaElVencimiento(
    configurar: (m: Montado) => void = (): void => {},
  ): Promise<Montado> {
    const m = montar();
    configurar(m);
    await m.caso.requested(comando());
    m.avanzar(180_001);
    await m.caso.sweep();

    expect(m.repositorio.filas.get(TRANSFER)?.state).toBe('TIMEOUT');

    return m;
  }

  it('el plazo es el del contrato, no el de la variable de entorno', async () => {
    const m = montar();
    await m.caso.requested(comando());

    // A los 30 s —el viejo plazo— no ha vencido nada.
    m.avanzar(30_001);
    expect((await m.caso.sweep()).expired).toBe(0);
    expect(m.repositorio.filas.get(TRANSFER)?.state).toBe('SENT');

    // A los 180 s del contrato, sí.
    m.avanzar(150_000);
    expect((await m.caso.sweep()).expired).toBe(1);
  });

  it('lo primero que hace al vencer es preguntar', async () => {
    const m = await hastaElVencimiento();

    await m.caso.sweep();

    expect(m.pasos).toEqual(['probe']);
    // Y nada de dinero: ni final para la Saga ni marca de veredicto.
    expect(m.publicado.filter((p) => p.messageType.startsWith('payment.succeeded'))).toEqual([]);
    expect(m.publicado.filter((p) => p.messageType.startsWith('payment.failed'))).toEqual([]);
  });

  it('un ACCEPTED en la consulta cierra la Saga BIEN, no compensando', async () => {
    /*
     * El caso que justifica el ticket. Antes de TD-095 este depósito se habría
     * compensado al vencer: dinero devuelto aquí y entregado allá.
     */
    const m = await hastaElVencimiento((x) =>
      x.contesta({ kind: 'ANSWERED', status: 'ACCEPTED' }),
    );

    const resultado = await m.caso.sweep();

    expect(resultado.resolved).toBe(1);
    expect(m.repositorio.filas.get(TRANSFER)?.state).toBe('ACCEPTED');
    expect(m.publicado.find((p) => p.messageType === 'payment.succeeded.v1')).toBeDefined();
  });

  it('un PROCESSING manda cancelar, y un ALREADY_ACCEPTED cierra bien', async () => {
    const m = await hastaElVencimiento((x) => {
      x.contesta({ kind: 'ANSWERED', status: 'PROCESSING' });
      x.cancelaCon({ kind: 'ANSWERED', result: 'ALREADY_ACCEPTED' });
    });

    /*
     * Tres barridos seguidos y SIN avanzar el reloj: la cadencia sólo frena los
     * pasos que no obtuvieron respuesta. Con una respuesta en mano, el protocolo
     * avanza enseguida — si no, el camino feliz costaría diez segundos de más
     * con el dinero retenido.
     */
    await m.caso.sweep(); // cancela
    await m.caso.sweep(); // decide

    expect(m.pasos).toEqual(['probe', 'cancel']);
    expect(m.repositorio.filas.get(TRANSFER)?.state).toBe('ACCEPTED');
    expect(m.publicado.find((p) => p.messageType === 'payment.succeeded.v1')).toBeDefined();
  });

  it('un 404 no libera: cancela primero', async () => {
    const m = await hastaElVencimiento((x) => {
      x.contesta({ kind: 'UNKNOWN' });
      x.cancelaCon({ kind: 'ANSWERED', result: 'CANCELLED' });
    });

    await m.caso.sweep();
    await m.caso.sweep();

    expect(m.pasos).toEqual(['probe', 'cancel']);
    expect(m.repositorio.filas.get(TRANSFER)?.state).toBe('REJECTED');
    expect(m.repositorio.filas.get(TRANSFER)?.reason).toBe('CANCELLED_AT_PARTNER');
  });

  it('con el banco pareja callado, no libera nada antes del margen', async () => {
    // Las dos llamadas fallan: no sabemos nada. Es el defecto por defecto.
    const m = await hastaElVencimiento();

    /*
     * Cinco minutos de barridos cada cinco segundos. En todo ese tiempo el
     * depósito sigue en `TIMEOUT` y la Saga no oye nada: **el dinero del
     * cliente sigue reservado**. Es el precio elegido del ticket, y es lo que
     * esta prueba fija para que nadie lo "optimice" después.
     */
    for (let i = 0; i < 59; i += 1) {
      await m.caso.sweep();
      m.avanzar(5_001);
    }

    expect(m.repositorio.filas.get(TRANSFER)?.state).toBe('TIMEOUT');
    expect(m.publicado.find((p) => p.messageType === 'payment.failed.v1')).toBeUndefined();
  });

  it('pasado el margen libera, lo registra como no verificado y alerta', async () => {
    const m = await hastaElVencimiento();

    // 300 s desde el vencimiento: el margen del contrato.
    m.avanzar(300_001);
    /*
     * Primero cancela: nunca se libera sin haber intentado cancelar, que es lo
     * que deja la constancia que hace defendible la liberación. Y sólo después,
     * con la cancelación sin respuesta, libera (T-60).
     */
    expect((await m.caso.sweep()).resolved).toBe(0);
    expect(m.pasos).toContain('cancel');
    m.avanzar(5_001);
    const resultado = await m.caso.sweep();

    expect(resultado.resolved).toBe(1);
    expect(m.repositorio.filas.get(TRANSFER)?.state).toBe('REJECTED');
    expect(m.repositorio.filas.get(TRANSFER)?.reason).toBe('RELEASED_NO_ANSWER');

    const fallo = m.publicado.find((p) => p.messageType === 'payment.failed.v1');
    expect(fallo).toBeDefined();

    /*
     * Y la alerta. El contrato la exige en esta rama y sólo en esta: es la única
     * en la que devolvemos dinero sin saber qué hizo el otro banco. Se emite por
     * `log.error` porque es lo que dispara la alerta de T-50 — una liberación a
     * ciegas que nadie mira es exactamente el descuadre que el protocolo evita.
     */
    expect(m.alertas).toHaveLength(1);
    expect(m.alertas[0]?.outcome).toBe('RELEASED_NO_ANSWER');
  });

  it('no vuelve a preguntar dentro de la cadencia', async () => {
    const m = await hastaElVencimiento();

    await m.caso.sweep();
    await m.caso.sweep();

    /*
     * Tres barridos seguidos y una sola consulta: la columna
     * `resolve_not_before` es la que impide el bucle apretado contra un banco
     * que ya va mal. Sin ella, un barrido cada medio segundo serían dos mil
     * peticiones en el margen.
     */
    expect(m.pasos).toEqual(['probe']);
  });
});

describe('un ACCEPTED que llega cuando ya se devolvió el dinero', () => {
  it('no se descarta en silencio: sale como incidente', async () => {
    /*
     * El paso 5 del contrato (TD-095). El otro banco acreditó y su callback
     * llegó después de que liberáramos la reserva: el dinero está entregado allá
     * y devuelto aquí, así que **este banco lo ha perdido** y hace falta un
     * reverso.
     *
     * Antes caía en el `warn` de las transiciones ilegales, junto a los
     * callbacks duplicados que son comportamiento normal — y ahí no lo veía
     * nadie. Lo que esta prueba fija es que se distinga.
     */
    const m = await (async (): Promise<Montado> => {
      const x = montar();
      await x.caso.requested(comando());
      x.avanzar(180_001);
      await x.caso.sweep();
      x.avanzar(300_001);
      await x.caso.sweep();
      x.avanzar(5_001);
      await x.caso.sweep();

      return x;
    })();

    expect(m.repositorio.filas.get(TRANSFER)?.state).toBe('REJECTED');
    const alertasAntes = m.alertas.length;

    await m.caso.callback(callback('CONFIRMED'));

    expect(m.alertas).toHaveLength(alertasAntes + 1);
    expect(m.alertas[alertasAntes]?.outcome).toBe('LATE_ACCEPT_AFTER_RELEASE');
    // Y no se aplica: el depósito sigue liberado, porque el dinero ya volvió.
    expect(m.repositorio.filas.get(TRANSFER)?.state).toBe('REJECTED');
    // Pero desde T-60 SE PIDE EL REVERSO: la reparación ya no es un paso humano.
    expect(m.repositorio.filas.get(TRANSFER)?.reversal?.state).toBe('PENDING');
  });

  it('un callback duplicado normal sigue siendo un warn, no un incidente', async () => {
    const m = montar();
    await m.caso.requested(comando());
    await m.caso.callback(callback('CONFIRMED'));
    const alertasAntes = m.alertas.length;

    await m.caso.callback(callback('CONFIRMED'));

    /*
     * La otra mitad de la distinción. Un `ACCEPTED` repetido sobre un depósito
     * ya aceptado es consecuencia normal de los reintentos del otro banco, y
     * alertar de eso enterraría el incidente de arriba entre ruido.
     */
    expect(m.alertas).toHaveLength(alertasAntes);
  });
});

/** Lleva un depósito liberado sin respuesta del banco pareja: REJECTED, con el dinero devuelto. */
async function liberado(m: Montado): Promise<void> {
  await m.caso.requested(comando());
  m.avanzar(180_001);
  await m.caso.sweep();
  m.avanzar(300_001);
  await m.caso.sweep();
  m.avanzar(5_001);
  await m.caso.sweep();
}

function resultadoV1(
  estado: 'ACCEPTED' | 'REJECTED',
  extra: { reasonCode?: string; llamador?: string; destino?: string } = {},
): never {
  return {
    ...comando(),
    messageType: 'payment.interbank.v1.result.received.v1',
    payload: {
      result: {
        interbankTransferId: TRANSFER,
        destinationBankCode: extra.destino ?? 'BANK99',
        status: estado,
        ...(extra.reasonCode === undefined ? {} : { reasonCode: extra.reasonCode }),
        processedAt: '2026-01-01T00:00:10.000Z',
      },
      callerBankCode: extra.llamador ?? 'BANK99',
      receivedAt: '2026-01-01T00:00:11.000Z',
    },
  } as never;
}

describe('el callback oficial del contrato v1 (B2)', () => {
  it('un ACCEPTED confirma el débito: SENT -> ACCEPTED y la Saga cierra bien', async () => {
    const m = montar();
    await m.caso.requested(comando());

    await m.caso.v1Result(resultadoV1('ACCEPTED'));

    expect(m.repositorio.filas.get(TRANSFER)?.state).toBe('ACCEPTED');
    expect(m.publicado.map((p) => p.messageType)).toContain('payment.succeeded.v1');
    expect(m.publicado.map((p) => p.messageType)).not.toContain('payment.failed.v1');
  });

  it('un REJECTED compensa, con el motivo del contrato', async () => {
    const m = montar();
    await m.caso.requested(comando());

    await m.caso.v1Result(resultadoV1('REJECTED', { reasonCode: 'ACCOUNT_NOT_FOUND' }));

    const fila = m.repositorio.filas.get(TRANSFER);
    expect(fila?.state).toBe('REJECTED');
    expect(fila?.reason).toBe('ACCOUNT_NOT_FOUND');
    expect(m.publicado.find((p) => p.messageType === 'payment.failed.v1')).toBeDefined();
  });

  it('un callback duplicado no mueve el dinero dos veces', async () => {
    const m = montar();
    await m.caso.requested(comando());

    await m.caso.v1Result(resultadoV1('ACCEPTED'));
    await m.caso.v1Result(resultadoV1('ACCEPTED'));

    const finales = m.publicado.filter((p) => p.messageType === 'payment.succeeded.v1');
    expect(finales).toHaveLength(1);
  });

  it('un REJECTED duplicado no compensa dos veces', async () => {
    const m = montar();
    await m.caso.requested(comando());

    await m.caso.v1Result(resultadoV1('REJECTED', { reasonCode: 'ACCOUNT_INACTIVE' }));
    await m.caso.v1Result(resultadoV1('REJECTED', { reasonCode: 'ACCOUNT_INACTIVE' }));

    expect(m.publicado.filter((p) => p.messageType === 'payment.failed.v1')).toHaveLength(1);
  });

  it('reordenado: un REJECTED tras un ACCEPTED no devuelve un dinero ya entregado', async () => {
    const m = montar();
    await m.caso.requested(comando());

    await m.caso.v1Result(resultadoV1('ACCEPTED'));
    await m.caso.v1Result(resultadoV1('REJECTED', { reasonCode: 'ACCOUNT_NOT_FOUND' }));

    expect(m.repositorio.filas.get(TRANSFER)?.state).toBe('ACCEPTED');
    expect(m.publicado.find((p) => p.messageType === 'payment.failed.v1')).toBeUndefined();
    // Se ve: los dos bancos se contradicen.
    expect(m.alertas.some((a) => a.outcome === 'CONTRADICTORY_REFUSAL')).toBe(true);
  });

  it('gana la carrera al acuse: un ACCEPTED con la fila aún PENDING confirma', async () => {
    const m = montar();
    m.responder(false);
    await m.caso.requested(comando());
    expect(m.repositorio.filas.get(TRANSFER)?.state).toBe('PENDING');

    await m.caso.v1Result(resultadoV1('ACCEPTED'));

    expect(m.repositorio.filas.get(TRANSFER)?.state).toBe('ACCEPTED');
  });

  it('descarta el callback de un banco que no participa', async () => {
    const m = montar();
    await m.caso.requested(comando());

    await m.caso.v1Result(resultadoV1('ACCEPTED', { llamador: 'BANK07' }));
    await m.caso.v1Result(resultadoV1('ACCEPTED', { destino: 'BANK07' }));

    expect(m.repositorio.filas.get(TRANSFER)?.state).toBe('SENT');
    expect(m.alertas.filter((a) => a.outcome === 'CALLBACK_FROM_NON_PARTICIPANT')).toHaveLength(2);
  });

  it('ignora el de un depósito que no mandamos', async () => {
    const m = montar();

    await m.caso.v1Result(resultadoV1('ACCEPTED'));

    expect(m.repositorio.filas.size).toBe(0);
    expect(m.publicado).toEqual([]);
  });
});

describe('el callback con el depósito en TIMEOUT (B5)', () => {
  async function vencido(): Promise<Montado> {
    const m = montar();
    await m.caso.requested(comando());
    m.avanzar(180_001);
    await m.caso.sweep();
    expect(m.repositorio.filas.get(TRANSFER)?.state).toBe('TIMEOUT');

    return m;
  }

  it('un ACCEPTED tardío confirma el débito: el dinero NO se devuelve', async () => {
    const m = await vencido();

    await m.caso.callback(callback('CONFIRMED'));

    expect(m.repositorio.filas.get(TRANSFER)?.state).toBe('ACCEPTED');
    expect(m.publicado.find((p) => p.messageType === 'payment.succeeded.v1')).toBeDefined();
    expect(m.publicado.find((p) => p.messageType === 'payment.failed.v1')).toBeUndefined();
  });

  it('un REJECTED tardío compensa', async () => {
    const m = await vencido();

    await m.caso.v1Result(resultadoV1('REJECTED', { reasonCode: 'ACCOUNT_INACTIVE' }));

    expect(m.repositorio.filas.get(TRANSFER)?.state).toBe('REJECTED');
    expect(m.publicado.find((p) => p.messageType === 'payment.failed.v1')).toBeDefined();
  });

  it('el protocolo que corría en paralelo no mueve el dinero otra vez', async () => {
    const m = await vencido();
    m.contesta({ kind: 'ANSWERED', status: 'ACCEPTED' });

    await m.caso.v1Result(resultadoV1('ACCEPTED'));
    await m.caso.sweep();

    expect(m.publicado.filter((p) => p.messageType === 'payment.succeeded.v1')).toHaveLength(1);
  });
});

describe('insistir antes de rendirse (B5)', () => {
  it('reintenta la consulta, luego cancela, y sólo libera pasado el margen', async () => {
    const m = montar();
    await m.caso.requested(comando());
    m.avanzar(180_001);

    const pasos: string[] = [];
    // Barridos cada 61 s (más que el techo de la espera) hasta cruzar el margen.
    for (let i = 0; i < 4; i += 1) {
      await m.caso.sweep();
      pasos.push(...m.pasos.slice(pasos.length));
      m.avanzar(61_000);
    }

    // Nunca soltó antes del margen...
    expect(m.repositorio.filas.get(TRANSFER)?.state).toBe('TIMEOUT');
    // ...y no se limitó a esperar: preguntó varias veces y luego cancela.
    expect(m.pasos.filter((p) => p === 'probe').length).toBeGreaterThan(1);
    expect(m.pasos.filter((p) => p === 'probe').length).toBeLessThanOrEqual(3);
    expect(m.pasos).toContain('cancel');
    expect(m.pasos.indexOf('cancel')).toBeGreaterThan(m.pasos.lastIndexOf('probe') - 1);
  });

  it('si el banco vuelve a mitad del margen y contesta la consulta, se resuelve sin liberar a ciegas', async () => {
    const m = montar();
    await m.caso.requested(comando());
    m.avanzar(180_001);
    await m.caso.sweep(); // consulta sin respuesta
    m.avanzar(10_000);
    m.contesta({ kind: 'ANSWERED', status: 'ACCEPTED' });
    await m.caso.sweep(); // consulta, y esta vez contestan
    await m.caso.sweep(); // decide

    expect(m.repositorio.filas.get(TRANSFER)?.state).toBe('ACCEPTED');
    expect(m.alertas.some((a) => a.outcome === 'RELEASED_NO_ANSWER')).toBe(false);
  });

  it('la liberación sin verificar conserva la línea de error que lee la alerta', async () => {
    const m = montar();
    await liberado(m);

    const alerta = m.alertas.find((a) => a.outcome === 'RELEASED_NO_ANSWER');

    expect(alerta).toMatchObject({
      outcome: 'RELEASED_NO_ANSWER',
      interbankTransferId: TRANSFER,
      transactionId: TRANSACTION,
    });
  });
});

describe('el paso 5: pedir el reverso de un ACCEPTED tardío', () => {
  it('lo pide, lo consulta y lo da por completado', async () => {
    const m = montar();
    await liberado(m);
    m.reversoCon({
      kind: 'ANSWERED',
      status: 'PROCESSING',
      refundTransferId: null,
      reasonMessage: null,
    });
    await m.caso.callback(callback('CONFIRMED'));
    const reversalId = m.repositorio.filas.get(TRANSFER)?.reversal?.reversalId;

    expect(reversalId).toBeDefined();

    await m.caso.sweep();
    expect(m.repositorio.filas.get(TRANSFER)?.reversal?.state).toBe('PROCESSING');
    expect(m.reversos).toEqual([`request:${reversalId}`]);

    m.reversoCon({
      kind: 'ANSWERED',
      status: 'COMPLETED',
      refundTransferId: '00000000-0000-4000-8000-0000000000aa',
      reasonMessage: null,
    });
    m.avanzar(31_000);
    await m.caso.sweep();

    expect(m.reversos).toEqual([`request:${reversalId}`, `status:${reversalId}`]);
    expect(m.repositorio.filas.get(TRANSFER)?.reversal?.state).toBe('COMPLETED');
    expect(m.repositorio.filas.get(TRANSFER)?.reversal?.refundTransferId).toBe(
      '00000000-0000-4000-8000-0000000000aa',
    );
  });

  it('dos ACCEPTED tardíos piden un solo reverso, con el mismo identificador', async () => {
    const m = montar();
    await liberado(m);

    await m.caso.callback(callback('CONFIRMED'));
    const primero = m.repositorio.filas.get(TRANSFER)?.reversal?.reversalId;
    await m.caso.callback(callback('CONFIRMED'));

    expect(m.repositorio.filas.get(TRANSFER)?.reversal?.reversalId).toBe(primero);
  });

  it('el reversalId es siempre el mismo para el mismo depósito', async () => {
    const a = montar();
    const b = montar();
    await liberado(a);
    await liberado(b);
    await a.caso.callback(callback('CONFIRMED'));
    await b.caso.callback(callback('CONFIRMED'));

    expect(a.repositorio.filas.get(TRANSFER)?.reversal?.reversalId).toBe(
      b.repositorio.filas.get(TRANSFER)?.reversal?.reversalId,
    );
  });

  it('si el banco pareja no contesta, reintenta con espera creciente en vez de darlo por pedido', async () => {
    const m = montar();
    await liberado(m);
    await m.caso.callback(callback('CONFIRMED'));

    await m.caso.sweep();
    await m.caso.sweep(); // dentro de la espera: no repite

    expect(m.reversos).toHaveLength(1);
    expect(m.repositorio.filas.get(TRANSFER)?.reversal?.state).toBe('PENDING');

    m.avanzar(6_000);
    await m.caso.sweep();

    expect(m.reversos).toHaveLength(2);
  });

  it('una negativa del banco pareja deja el reverso fallido y lo grita en ERROR', async () => {
    const m = montar();
    await liberado(m);
    await m.caso.callback(callback('CONFIRMED'));
    m.reversoCon({ kind: 'REFUSED', detail: 'HTTP_404' });

    await m.caso.sweep();

    expect(m.repositorio.filas.get(TRANSFER)?.reversal?.state).toBe('FAILED');
    expect(m.alertas.some((a) => String(a.outcome).startsWith('REVERSAL_REFUSED'))).toBe(true);
  });

  it('un ACCEPTED duplicado sobre un depósito aceptado NO pide ningún reverso', async () => {
    const m = montar();
    await m.caso.requested(comando());
    await m.caso.callback(callback('CONFIRMED'));
    await m.caso.callback(callback('CONFIRMED'));

    expect(m.repositorio.filas.get(TRANSFER)?.reversal).toBeNull();
  });
});

describe('la telemetría de vencimientos (B9)', () => {
  it('informa de dónde viene cada cambio, para contar el timeout al entrar', async () => {
    const m = montar();
    await m.caso.requested(comando());
    m.avanzar(180_001);
    await m.caso.sweep();
    m.avanzar(1);
    m.contesta({ kind: 'ANSWERED', status: 'ACCEPTED' });
    await m.caso.sweep();
    m.avanzar(5_001);
    await m.caso.sweep(); // consulta
    await m.caso.sweep(); // decide

    expect(m.cambios).toEqual([
      { state: 'PENDING', from: null },
      { state: 'SENT', from: 'PENDING' },
      { state: 'TIMEOUT', from: 'SENT' },
      { state: 'ACCEPTED', from: 'TIMEOUT' },
    ]);
  });
});

describe('la traza no se corta en el barrido (B9)', () => {
  it('guarda el traceparent al crear el depósito', async () => {
    const m = montar();

    await m.caso.requested(comando());

    expect(m.repositorio.filas.get(TRANSFER)?.traceContext).toBe(TRACEPARENT);
  });

  it('cada paso del barrido continúa la traza guardada', async () => {
    const m = montar();
    m.responder(false);
    await m.caso.requested(comando()); // PENDING: se reenviará
    await m.caso.sweep(); // reenvío
    m.avanzar(180_001);
    await m.caso.sweep(); // vencimiento, y consulta
    m.avanzar(10_000);
    await m.caso.sweep(); // más del protocolo

    const spans = new Set(m.trazas.map((t) => t.span));

    expect(spans).toContain('payment.interbank.resend');
    expect(spans).toContain('payment.interbank.expire');
    expect(spans).toContain('payment.interbank.resolve');
    // Ninguno abre una traza nueva: todos arrancan en la guardada.
    expect(m.trazas.every((t) => t.traceparent === TRACEPARENT)).toBe(true);
  });
});

describe('un paso que falla no detiene el barrido (B3)', () => {
  it('registra el depósito malo y atiende al siguiente', async () => {
    const m = montar();
    const otro = (): MessageEnvelope<PaymentRequestedV1> => {
      const e = comando();
      return {
        ...e,
        payload: {
          ...e.payload,
          paymentId: '00000000-0000-4000-8000-00000000a001',
          transactionId: '00000000-0000-4000-8000-00000000b001',
          interbank: {
            ...e.payload.interbank!,
            interbankTransferId: 'local-demo-2',
            idempotencyKey: 'clave-2',
          },
        },
      };
    };
    m.responder(false);
    await m.caso.requested(comando());
    await m.caso.requested(otro());
    const original = m.repositorio.claimSendable.bind(m.repositorio);
    m.repositorio.claimSendable = async () => {
      const filas = await original();
      return filas.map((f) =>
        f.interbankTransferId === TRANSFER ? ({ ...f, destinationAccount: undefined } as never) : f,
      );
    };
    // El primero lanza al entregar; el segundo debe entregarse igual.
    const entregasAntes = m.entregas.length;
    const lanza = m.caso as unknown as { sweep: () => Promise<unknown> };

    await lanza.sweep();

    expect(m.entregas.length).toBeGreaterThan(entregasAntes);
  });
});

describe('lo que impide hablar el contrato se declina antes de la red (B1, B7)', () => {
  it('un pago sin la cuenta origen no se envía: la Saga lo devuelve', async () => {
    const m = montar();
    const e = comando();
    const interbank = { ...e.payload.interbank! };
    delete (interbank as { originAccount?: string }).originAccount;

    await m.caso.requested({ ...e, payload: { ...e.payload, interbank } });

    expect(m.entregas).toEqual([]);
    expect(m.repositorio.filas.size).toBe(0);
    expect(m.directo.find((p) => p.messageType === 'payment.failed.v1')).toBeDefined();
  });

  it('un monto por encima del límite no se envía', async () => {
    const m = montar();
    const e = comando();

    await m.caso.requested({
      ...e,
      payload: { ...e.payload, amount: { amountMinor: 1_000_001, currency: 'GTQ' } },
    });

    expect(m.entregas).toEqual([]);
    expect(m.directo.find((p) => p.messageType === 'payment.failed.v1')).toBeDefined();
  });

  it('el límite exacto sí se envía', async () => {
    const m = montar();
    const e = comando();

    await m.caso.requested({
      ...e,
      payload: { ...e.payload, amount: { amountMinor: 1_000_000, currency: 'GTQ' } },
    });

    expect(m.entregas).toEqual([TRANSFER]);
  });

  it('otra moneda no se envía', async () => {
    const m = montar();
    const e = comando();

    await m.caso.requested({
      ...e,
      payload: { ...e.payload, amount: { amountMinor: 100, currency: 'USD' } },
    });

    expect(m.entregas).toEqual([]);
  });
});

describe('los reclamos del barrido (T-60)', () => {
  it('un barrido sin nada que hacer no reclama nada, que es lo que deja espaciar el siguiente', async () => {
    const m = montar();

    expect(await m.caso.sweep()).toEqual({ expired: 0, resent: 0, resolved: 0, claimed: 0 });
  });

  it('una entrega que se reintenta cuenta como trabajo aunque vuelva a fallar', async () => {
    const m = montar();
    m.responder(false);
    await m.caso.requested(comando());

    const barrido = await m.caso.sweep();

    expect(barrido.claimed).toBe(1);
    expect(barrido.resent).toBe(1);
    expect(m.repositorio.filas.get(TRANSFER)?.state).toBe('PENDING');
  });

  it('un paso del protocolo de TIMEOUT que pregunta y no cierra nada también cuenta', async () => {
    const m = montar();
    await m.caso.requested(comando());
    m.avanzar(180_001);

    const barrido = await m.caso.sweep();

    // Venció (1) y entró en su protocolo en la misma pasada (1): `resolved` es 0
    // porque preguntar no cierra el depósito, y aun así hubo trabajo.
    expect(barrido.resolved).toBe(0);
    expect(barrido.claimed).toBe(2);
  });

  it('la reconciliación reclama con el reloj del caso de uso y no con el de la base', async () => {
    const m = montar();
    m.avanzar(5_000);

    await m.caso.reconcile();

    expect(m.repositorio.relojDelReclamo).toEqual(new Date('2026-01-01T00:00:05.000Z'));
  });

  it('un comando reentregado no vuelve a anunciar el alta: lo anunció quien la dio', async () => {
    const m = montar();

    await m.caso.requested(comando());
    const anunciados = m.directo.length;
    await m.caso.requested(comando());

    expect(anunciados).toBeGreaterThan(0);
    expect(m.directo).toHaveLength(anunciados);
  });
});
