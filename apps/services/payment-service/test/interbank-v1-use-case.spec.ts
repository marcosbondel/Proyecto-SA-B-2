import { v1ExpiresAt } from '@bank/contracts';
import type { V1TransferRequest } from '@bank/contracts';

import { InterbankV1UseCase } from '../src/application/interbank-v1.use-case';
import type {
  InterbankV1Repository,
  V1DepositRow,
  V1Reversal,
} from '../src/application/interbank-v1.ports';

/**
 * Las decisiones del contrato oficial, con la persistencia doblada (T-56).
 *
 * Lo que importa aquí son las **tres respuestas de la cancelación**, que no son
 * matices: `CANCELLED` le dice al emisor que libere la reserva,
 * `ALREADY_ACCEPTED` que **confirme el débito**, y `ALREADY_REJECTED` que
 * libere. Contestar la equivocada le hace perder dinero o duplicarlo.
 */

const AHORA = new Date('2026-10-20T15:00:00.000Z');
const ID = '8f14e45f-ceea-467a-9b36-4b1c2d6a7e01';

function deposito(overrides: Partial<V1TransferRequest> = {}): V1TransferRequest {
  return {
    interbankTransferId: ID,
    originBankCode: 'BANK99',
    destinationBankCode: 'BANK02',
    originAccount: '99-000000123',
    destinationAccount: '02-000000052',
    amount: '150.00',
    currency: 'GTQ',
    createdAt: AHORA.toISOString(),
    expiresAt: v1ExpiresAt(AHORA).toISOString(),
    ...overrides,
  };
}

function fila(overrides: Partial<V1DepositRow> = {}): V1DepositRow {
  return {
    interbankTransferId: ID,
    originBankCode: 'BANK99',
    status: 'PROCESSING',
    reasonCode: null,
    amountMinor: 15_000,
    updatedAt: AHORA,
    createdAt: AHORA,
    expiresAt: v1ExpiresAt(AHORA),
    ...overrides,
  };
}

class RepositorioDoble implements InterbankV1Repository {
  public filas = new Map<string, V1DepositRow>();
  public reversos = new Map<string, V1Reversal>();
  public cancelados: string[] = [];
  public vencidos: string[] = [];
  public constanciasDeDesconocido: string[] = [];
  public admision: 'ACCEPTED_FOR_PROCESSING' | 'DUPLICATE' | 'CONFLICT' = 'ACCEPTED_FOR_PROCESSING';
  public cancelaGana = true;

  async admit(input: {
    transfer: V1TransferRequest;
    callerBankCode: string;
    now: Date;
  }): Promise<
    | { admission: 'ACCEPTED_FOR_PROCESSING'; depositId: string }
    | { admission: 'DUPLICATE'; row: V1DepositRow }
    | { admission: 'CONFLICT' }
  > {
    if (this.admision === 'DUPLICATE') {
      return {
        admission: 'DUPLICATE',
        row: this.filas.get(input.transfer.interbankTransferId) ?? fila(),
      };
    }
    if (this.admision === 'CONFLICT') return { admission: 'CONFLICT' };

    return { admission: 'ACCEPTED_FOR_PROCESSING', depositId: 'un-deposito' };
  }

  async findForBank(id: string, bank: string): Promise<V1DepositRow | null> {
    const encontrada = this.filas.get(id);

    return encontrada !== undefined && encontrada.originBankCode === bank ? encontrada : null;
  }

  async cancel(input: { interbankTransferId: string; now: Date }): Promise<boolean> {
    this.cancelados.push(input.interbankTransferId);
    if (!this.cancelaGana) return false;
    const previa = this.filas.get(input.interbankTransferId);
    if (previa !== undefined) {
      this.filas.set(input.interbankTransferId, {
        ...previa,
        status: 'CANCELLED',
        reasonCode: 'CANCELLED',
      });
    }
    return true;
  }

  async admitCancellationOfUnknown(input: { interbankTransferId: string }): Promise<void> {
    this.constanciasDeDesconocido.push(input.interbankTransferId);
  }

  /* La firma completa del puerto: una prueba la sustituye para ver el límite. */
  async claimExpired(_now: Date, _limit: number): Promise<readonly V1DepositRow[]> {
    return [...this.filas.values()].filter((f) => f.status === 'PROCESSING');
  }

  async expire(input: { interbankTransferId: string }): Promise<boolean> {
    this.vencidos.push(input.interbankTransferId);
    return true;
  }

  async reconcile(input: {
    callerBankCode: string;
    date: string;
    page: number;
    pageSize: number;
  }): Promise<{ totalItems: number; items: readonly V1DepositRow[] }> {
    const propias = [...this.filas.values()].filter(
      (f) => f.originBankCode === input.callerBankCode,
    );

    return { totalItems: propias.length, items: propias };
  }

  async openReversal(input: {
    reversalId: string;
    originalTransferId: string;
    requesterBankCode: string;
    amountMinor: number;
  }): Promise<{ created: boolean; reversal: V1Reversal }> {
    const reversal: V1Reversal = {
      reversalId: input.reversalId,
      originalTransferId: input.originalTransferId,
      requesterBankCode: input.requesterBankCode,
      amountMinor: input.amountMinor,
      status: 'PROCESSING',
      refundTransferId: null,
      reasonMessage: null,
    };
    this.reversos.set(input.reversalId, reversal);

    return { created: true, reversal };
  }

  async findReversal(reversalId: string, bank: string): Promise<V1Reversal | null> {
    const encontrado = this.reversos.get(reversalId);

    return encontrado !== undefined && encontrado.requesterBankCode === bank ? encontrado : null;
  }
}

function construir(repository: RepositorioDoble): {
  readonly useCase: InterbankV1UseCase;
  readonly respuestas: { messageType: string; payload: unknown }[];
  readonly registro: { nivel: string; mensaje: string }[];
} {
  const respuestas: { messageType: string; payload: unknown }[] = [];
  const registro: { nivel: string; mensaje: string }[] = [];
  const anotar =
    (nivel: string) =>
    (mensaje: string): void => {
      registro.push({ nivel, mensaje });
    };

  const useCase = new InterbankV1UseCase({
    repository,
    reply: async (messageType, payload) => {
      respuestas.push({ messageType, payload });
    },
    bankCode: 'BANK02',
    clock: () => AHORA,
    log: { info: anotar('info'), warn: anotar('warn'), error: anotar('error') },
  });

  return { useCase, respuestas, registro };
}

describe('la admisión de un depósito', () => {
  it('contesta ACCEPTED_FOR_PROCESSING sin estado, porque todavía no hay veredicto', async () => {
    const repository = new RepositorioDoble();
    const { useCase, respuestas } = construir(repository);

    await useCase.transfer({
      transfer: deposito(),
      callerBankCode: 'BANK99',
      receivedAt: AHORA.toISOString(),
    });

    expect(respuestas[0]?.payload).toMatchObject({
      admission: 'ACCEPTED_FOR_PROCESSING',
      status: null,
    });
  });

  it('contesta el duplicado con el estado que ya tenía', async () => {
    const repository = new RepositorioDoble();
    repository.admision = 'DUPLICATE';
    repository.filas.set(ID, fila({ status: 'REJECTED', reasonCode: 'ACCOUNT_NOT_FOUND' }));
    const { useCase, respuestas } = construir(repository);

    await useCase.transfer({
      transfer: deposito(),
      callerBankCode: 'BANK99',
      receivedAt: AHORA.toISOString(),
    });

    expect(respuestas[0]?.payload).toMatchObject({
      admission: 'DUPLICATE',
      status: 'REJECTED',
      reasonCode: 'ACCOUNT_NOT_FOUND',
    });
  });
});

describe('las tres respuestas de la cancelación', () => {
  it('CANCELLED cuando todavía no se había decidido', async () => {
    const repository = new RepositorioDoble();
    repository.filas.set(ID, fila());
    const { useCase, respuestas } = construir(repository);

    await useCase.cancel({
      interbankTransferId: ID,
      callerBankCode: 'BANK99',
      reason: 'TIMEOUT',
      requestedAt: AHORA.toISOString(),
    });

    expect(respuestas[0]?.payload).toMatchObject({ result: 'CANCELLED' });
    expect(repository.cancelados).toEqual([ID]);
  });

  it('ALREADY_ACCEPTED cuando ya se acreditó, para que el emisor confirme el débito', async () => {
    const repository = new RepositorioDoble();
    repository.filas.set(ID, fila({ status: 'ACCEPTED' }));
    const { useCase, respuestas } = construir(repository);

    await useCase.cancel({
      interbankTransferId: ID,
      callerBankCode: 'BANK99',
      reason: 'TIMEOUT',
      requestedAt: AHORA.toISOString(),
    });

    expect(respuestas[0]?.payload).toMatchObject({ result: 'ALREADY_ACCEPTED' });
    // Y no se intenta cancelar: el dinero ya se movió.
    expect(repository.cancelados).toEqual([]);
  });

  it('ALREADY_REJECTED cuando ya se había rechazado', async () => {
    const repository = new RepositorioDoble();
    repository.filas.set(ID, fila({ status: 'REJECTED', reasonCode: 'ACCOUNT_INACTIVE' }));
    const { useCase, respuestas } = construir(repository);

    await useCase.cancel({
      interbankTransferId: ID,
      callerBankCode: 'BANK99',
      reason: 'TIMEOUT',
      requestedAt: AHORA.toISOString(),
    });

    expect(respuestas[0]?.payload).toMatchObject({ result: 'ALREADY_REJECTED' });
  });

  it('CANCELLED y deja constancia cuando el depósito nunca llegó', async () => {
    // El contrato: «guarda el id y rechaza cualquier llegada posterior del
    // mensaje original». Sin la constancia, llegaría tarde y se acreditaría.
    const repository = new RepositorioDoble();
    const { useCase, respuestas } = construir(repository);

    await useCase.cancel({
      interbankTransferId: ID,
      callerBankCode: 'BANK99',
      reason: 'TIMEOUT',
      requestedAt: AHORA.toISOString(),
    });

    expect(respuestas[0]?.payload).toMatchObject({ result: 'CANCELLED' });
    expect(repository.constanciasDeDesconocido).toEqual([ID]);
  });

  it('contesta lo que de verdad quedó si alguien decidió entre la lectura y la escritura', async () => {
    const repository = new RepositorioDoble();
    repository.filas.set(ID, fila());
    // La carrera: la cancelación no gana y la fila acabó acreditada.
    repository.cancelaGana = false;
    const { useCase, respuestas } = construir(repository);
    const original = repository.findForBank.bind(repository);
    let llamadas = 0;
    repository.findForBank = async (id, bank): Promise<V1DepositRow | null> => {
      llamadas += 1;
      return llamadas === 1 ? await original(id, bank) : fila({ status: 'ACCEPTED' });
    };

    await useCase.cancel({
      interbankTransferId: ID,
      callerBankCode: 'BANK99',
      reason: 'TIMEOUT',
      requestedAt: AHORA.toISOString(),
    });

    // Nunca lo que se intentó: lo que quedó.
    expect(respuestas[0]?.payload).toMatchObject({ result: 'ALREADY_ACCEPTED' });
  });

  it('no deja cancelar a un banco que no participa', async () => {
    const repository = new RepositorioDoble();
    repository.filas.set(ID, fila({ originBankCode: 'BANK99' }));
    const { useCase, respuestas } = construir(repository);

    await useCase.cancel({
      interbankTransferId: ID,
      callerBankCode: 'BANK07',
      reason: 'TIMEOUT',
      requestedAt: AHORA.toISOString(),
    });

    // Para BANK07 el depósito no existe, así que se le contesta CANCELLED y se
    // guarda SU constancia — nunca se toca la fila de BANK99.
    expect(respuestas[0]?.payload).toMatchObject({ result: 'CANCELLED' });
    expect(repository.cancelados).toEqual([]);
    expect(repository.filas.get(ID)?.status).toBe('PROCESSING');
  });
});

describe('la política de admisión del contrato', () => {
  const { useCase } = construir(new RepositorioDoble());

  it('acepta lo que cumple', () => {
    expect(useCase.rejectionFor(deposito())).toBeNull();
  });

  it('rechaza un depósito que no era para nosotros', () => {
    expect(useCase.rejectionFor(deposito({ destinationBankCode: 'BANK07' }))).toBe(
      'WRONG_DESTINATION_BANK',
    );
  });

  it('rechaza por encima del máximo del contrato', () => {
    expect(useCase.rejectionFor(deposito({ amount: '10000.01' }))).toBe('AMOUNT_EXCEEDS_LIMIT');
    expect(useCase.rejectionFor(deposito({ amount: '10000.00' }))).toBeNull();
  });

  it('rechaza un monto de cero, que el patrón admite y el negocio no', () => {
    expect(useCase.rejectionFor(deposito({ amount: '0.00' }))).toBe('INVALID_REQUEST');
    expect(useCase.rejectionFor(deposito({ amount: '0.01' }))).toBeNull();
  });
});

describe('el vencimiento', () => {
  it('cierra los que pasaron de plazo y lo registra como aviso', async () => {
    const repository = new RepositorioDoble();
    repository.filas.set(ID, fila());
    const { useCase, registro } = construir(repository);

    const cerrados = await useCase.sweepExpired();

    expect(cerrados).toBe(1);
    expect(repository.vencidos).toEqual([ID]);
    expect(registro.some((r) => r.nivel === 'warn')).toBe(true);
  });
});

describe('los reversos', () => {
  it('registra el caso excepcional en nivel ERROR', async () => {
    // Un reverso significa que un callback nuestro llegó tan tarde que el otro
    // banco ya liberó su reserva. No es un error de este mensaje, es la
    // consecuencia de uno anterior, y es lo que alguien querría ver al
    // reconciliar.
    const repository = new RepositorioDoble();
    repository.filas.set('00000000-0000-4000-8000-000000000001', fila());
    const { useCase, registro, respuestas } = construir(repository);

    await useCase.requestReversal({
      reversalId: ID,
      originalTransferId: '00000000-0000-4000-8000-000000000001',
      callerBankCode: 'BANK99',
      amount: '150.00',
      requestedAt: AHORA.toISOString(),
    });

    expect(registro.some((r) => r.nivel === 'error')).toBe(true);
    expect(respuestas[0]?.payload).toMatchObject({ found: true, status: 'PROCESSING' });
  });

  it('dice que no hay nada cuando el depósito original no es de ese banco', async () => {
    const repository = new RepositorioDoble();
    const { useCase, respuestas } = construir(repository);

    await useCase.requestReversal({
      reversalId: ID,
      originalTransferId: '00000000-0000-4000-8000-000000000001',
      callerBankCode: 'BANK99',
      amount: '150.00',
      requestedAt: AHORA.toISOString(),
    });

    expect(respuestas[0]?.payload).toMatchObject({ found: false });
  });
});

describe('la conciliación', () => {
  it('formatea el monto como texto del contrato', async () => {
    const repository = new RepositorioDoble();
    repository.filas.set(ID, fila({ amountMinor: 115 }));
    const { useCase, respuestas } = construir(repository);

    await useCase.reconciliation({
      callerBankCode: 'BANK99',
      date: '2026-10-20',
      page: 1,
      pageSize: 100,
    });

    expect(respuestas[0]?.payload).toMatchObject({
      totalItems: 1,
      items: [{ amount: '1.15', currency: 'GTQ', status: 'PROCESSING' }],
    });
  });
});

describe('la consulta de estado', () => {
  it('dice que no hay nada cuando el depósito no es de ese banco', async () => {
    const repository = new RepositorioDoble();
    repository.filas.set(ID, fila({ originBankCode: 'BANK99' }));
    const { useCase, respuestas } = construir(repository);

    await useCase.status({ interbankTransferId: ID, callerBankCode: 'BANK07' });

    expect(respuestas[0]?.payload).toMatchObject({
      found: false,
      status: null,
      reasonCode: null,
      updatedAt: null,
    });
  });

  it('devuelve el motivo cuando hay uno, y nulo cuando no', async () => {
    const repository = new RepositorioDoble();
    repository.filas.set(ID, fila({ status: 'REJECTED', reasonCode: 'EXPIRED' }));
    const { useCase, respuestas } = construir(repository);

    await useCase.status({ interbankTransferId: ID, callerBankCode: 'BANK99' });

    expect(respuestas[0]?.payload).toMatchObject({
      found: true,
      status: 'REJECTED',
      reasonCode: 'EXPIRED',
    });
  });

  it('devuelve PROCESSING sin motivo mientras se decide', async () => {
    const repository = new RepositorioDoble();
    repository.filas.set(ID, fila());
    const { useCase, respuestas } = construir(repository);

    await useCase.status({ interbankTransferId: ID, callerBankCode: 'BANK99' });

    expect(respuestas[0]?.payload).toMatchObject({ status: 'PROCESSING', reasonCode: null });
  });
});

describe('la conciliación, en detalle', () => {
  it('devuelve la página y el tamaño que se pidieron, no los que encontró', async () => {
    // El contrato pide que la respuesta repita la paginación de la petición:
    // un cliente que pide la página 3 y recibe «página 1» no sabe si se quedó
    // sin páginas o si el servidor la ignoró.
    const repository = new RepositorioDoble();
    const { useCase, respuestas } = construir(repository);

    await useCase.reconciliation({
      callerBankCode: 'BANK99',
      date: '2026-10-20',
      page: 3,
      pageSize: 25,
    });

    expect(respuestas[0]?.payload).toMatchObject({
      date: '2026-10-20',
      page: 3,
      pageSize: 25,
      totalItems: 0,
      items: [],
    });
  });

  it('no mezcla los depósitos de otro banco', async () => {
    const repository = new RepositorioDoble();
    repository.filas.set(ID, fila({ originBankCode: 'BANK99' }));
    repository.filas.set('otro', fila({ originBankCode: 'BANK07' }));
    const { useCase, respuestas } = construir(repository);

    await useCase.reconciliation({
      callerBankCode: 'BANK99',
      date: '2026-10-20',
      page: 1,
      pageSize: 100,
    });

    expect(respuestas[0]?.payload).toMatchObject({ totalItems: 1 });
  });

  it('formatea el mínimo y el máximo sin perder un centavo', async () => {
    const repository = new RepositorioDoble();
    repository.filas.set('a', fila({ amountMinor: 1 }));
    repository.filas.set('b', fila({ amountMinor: 1_000_000 }));
    const { useCase, respuestas } = construir(repository);

    await useCase.reconciliation({
      callerBankCode: 'BANK99',
      date: '2026-10-20',
      page: 1,
      pageSize: 100,
    });

    const payload = respuestas[0]?.payload as { items: { amount: string }[] };

    expect(payload.items.map((i) => i.amount)).toEqual(['0.01', '10000.00']);
  });
});

describe('el reverso, en detalle', () => {
  it('rechaza un monto que no es el texto del contrato', async () => {
    // Llega validado por el esquema, así que esto sólo pasaría con un mensaje
    // construido a mano — y la respuesta correcta es «no hay nada», no un
    // reverso con un monto inventado.
    const repository = new RepositorioDoble();
    repository.filas.set('00000000-0000-4000-8000-000000000001', fila());
    const { useCase, respuestas } = construir(repository);

    await useCase.requestReversal({
      reversalId: ID,
      originalTransferId: '00000000-0000-4000-8000-000000000001',
      callerBankCode: 'BANK99',
      amount: '150',
      requestedAt: AHORA.toISOString(),
    });

    expect(respuestas[0]?.payload).toMatchObject({ found: false });
  });

  it('no deja consultar el reverso de otro banco', async () => {
    const repository = new RepositorioDoble();
    repository.reversos.set(ID, {
      reversalId: ID,
      originalTransferId: '00000000-0000-4000-8000-000000000001',
      requesterBankCode: 'BANK99',
      amountMinor: 15_000,
      status: 'COMPLETED',
      refundTransferId: '00000000-0000-4000-8000-000000000009',
      reasonMessage: null,
    });
    const { useCase, respuestas } = construir(repository);

    await useCase.reversalStatus({ reversalId: ID, callerBankCode: 'BANK07' });

    expect(respuestas[0]?.payload).toMatchObject({ found: false });
  });

  it('devuelve el depósito de devolución cuando está completado', async () => {
    const repository = new RepositorioDoble();
    repository.reversos.set(ID, {
      reversalId: ID,
      originalTransferId: '00000000-0000-4000-8000-000000000001',
      requesterBankCode: 'BANK99',
      amountMinor: 15_000,
      status: 'COMPLETED',
      refundTransferId: '00000000-0000-4000-8000-000000000009',
      reasonMessage: null,
    });
    const { useCase, respuestas } = construir(repository);

    await useCase.reversalStatus({ reversalId: ID, callerBankCode: 'BANK99' });

    // `COMPLETED` sin el identificador sería decir que devolvimos el dinero sin
    // poder señalar por dónde salió.
    expect(respuestas[0]?.payload).toMatchObject({
      found: true,
      status: 'COMPLETED',
      refundTransferId: '00000000-0000-4000-8000-000000000009',
    });
  });
});

describe('el barrido, en detalle', () => {
  it('no cuenta los que ya estaban decididos', async () => {
    const repository = new RepositorioDoble();
    repository.filas.set('a', fila({ status: 'ACCEPTED' }));
    repository.filas.set('b', fila({ status: 'CANCELLED' }));
    const { useCase } = construir(repository);

    expect(await useCase.sweepExpired()).toBe(0);
    expect(repository.vencidos).toEqual([]);
  });

  it('respeta el límite del lote', async () => {
    const repository = new RepositorioDoble();
    const { useCase } = construir(repository);
    const pedidos: number[] = [];
    repository.claimExpired = async (_now, limit): Promise<readonly V1DepositRow[]> => {
      pedidos.push(limit);
      return [];
    };

    await useCase.sweepExpired(5);

    expect(pedidos).toEqual([5]);
  });

  it('no cuenta un vencimiento que perdió la carrera', async () => {
    // `expire` devuelve `false` cuando alguien decidió el depósito entre la
    // lectura y la escritura: el guardia del `WHERE` hizo su trabajo.
    const repository = new RepositorioDoble();
    repository.filas.set(ID, fila());
    repository.expire = async (): Promise<boolean> => false;
    const { useCase } = construir(repository);

    expect(await useCase.sweepExpired()).toBe(0);
  });
});
