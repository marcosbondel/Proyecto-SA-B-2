import { createEnvelope } from '@bank/contracts';

import type {
  InterbankDeposit,
  InterbankMessenger,
  InterbankRepository,
  InterbankTelemetry,
  PartnerCallback,
} from '../src/application/interbank.ports';
import { InterbankUseCase } from '../src/application/interbank.use-case';

/**
 * La vuelta del barrido de los depósitos que este banco RECIBE, con dobles
 * (T-60): dos cosas que el planificador necesita de ella.
 *
 * 1. **Cuánto encontró**, para espaciar la siguiente vuelta cuando no hay nada.
 * 2. **Que suelte el arrendamiento de un callback que no salió.** El reclamo ya
 *    escribió la próxima hora (la espera creciente) y arrendó la fila; si el
 *    intento falla y el arrendamiento no se suelta, el reintento a los 2 s del
 *    primer fallo esperaría a que caduque (60 s), y la escalera de 2, 4, 8 s…
 *    dejaría de ser la escalera.
 */

const now = new Date('2026-10-19T12:00:00.000Z');

function deposit(id: string): InterbankDeposit {
  const origin = createEnvelope(
    { depositId: id },
    { messageType: 'payment.interbank.receive.v1', producer: 'gateway', identity: null },
  );

  return {
    depositId: id,
    stage: 'ACCEPTED',
    reason: null,
    origin,
    correlationId: origin.correlationId,
    externalTransferId: `partner-${id}`,
    originBankCode: 'BANK99',
    accountRef: '02-000000052',
    amount: { amountMinor: 12_500, currency: 'GTQ' },
    callbackAttempts: 1,
    traceContext: null,
    createdAt: now,
    decidedAt: now,
    expiresAt: null,
  };
}

function montar(
  options: {
    actions?: readonly InterbankDeposit[];
    published?: number;
    conflictsPublished?: number;
    callbacks?: readonly InterbankDeposit[];
    conflicts?: readonly { messageId: string; deposit: InterbankDeposit }[];
    abandoned?: readonly InterbankDeposit[];
    failDelivery?: boolean;
    failRelease?: boolean;
    failClaimActions?: boolean;
  } = {},
) {
  const calls: string[] = [];
  const failures: string[] = [];
  const repository = {
    claimActions: async () => {
      calls.push('claimActions');
      if (options.failClaimActions === true) throw new Error('database away');

      return await Promise.resolve(options.actions ?? []);
    },
    publishResults: async () => await Promise.resolve(options.published ?? 0),
    publishConflictResults: async () => await Promise.resolve(options.conflictsPublished ?? 0),
    claimCallbacks: async () => await Promise.resolve(options.callbacks ?? []),
    claimConflictCallbacks: async () => await Promise.resolve(options.conflicts ?? []),
    abandonStaleCallbacks: async () => await Promise.resolve(options.abandoned ?? []),
    markCallbackDelivered: async (id: string) => {
      calls.push(`delivered:${id}`);
      await Promise.resolve();
    },
    markConflictCallbackDelivered: async (id: string) => {
      calls.push(`conflictDelivered:${id}`);
      await Promise.resolve();
    },
    releaseCallbackClaim: async (id: string) => {
      calls.push(`release:${id}`);
      if (options.failRelease === true) throw new Error('database away');
      await Promise.resolve();
    },
    releaseConflictCallbackClaim: async (id: string) => {
      calls.push(`releaseConflict:${id}`);
      await Promise.resolve();
    },
  } as unknown as InterbankRepository;
  const messenger = {
    command: async () => {
      calls.push('command');
      await Promise.resolve();
    },
  } as unknown as InterbankMessenger;
  const callback: PartnerCallback = {
    deliver: async () => {
      if (options.failDelivery === true) throw new Error('partner unreachable');
      await Promise.resolve();
    },
  };
  const telemetry: InterbankTelemetry = {
    stateChanged: () => undefined,
    callbackAttempt: () => undefined,
    illegalTransition: () => undefined,
    sweepFailed: (failure) => failures.push(failure.step),
  };
  const caso = new InterbankUseCase({
    repository,
    messenger,
    callback,
    bankCode: 'BANK02',
    partnerBankCode: 'BANK99',
    maxAmountMinor: 1_000_000,
    clock: { now: () => now },
    telemetry,
    trace: { continue: async (_t, _s, _c, work) => await work() },
  });

  return { caso, calls, failures };
}

describe('la vuelta del barrido de depósitos recibidos', () => {
  it('una vuelta sin nada que hacer devuelve 0, que es lo que deja espaciar la siguiente', async () => {
    const m = montar();

    expect(await m.caso.sweep()).toBe(0);
    expect(m.calls).toEqual(['claimActions']);
  });

  it('devuelve cuántas filas encontró, de todos los tipos, y no cuántas salieron bien', async () => {
    const m = montar({
      actions: [deposit('a1'), deposit('a2')],
      published: 1,
      conflictsPublished: 1,
      callbacks: [deposit('c1')],
      conflicts: [{ messageId: 'm1', deposit: deposit('k1') }],
      abandoned: [deposit('x1')],
      failDelivery: true,
    });

    // 2 acciones + 1 resultado + 1 resultado de conflicto + 1 callback
    // + 1 callback de conflicto + 1 abandonado. Los dos callbacks fallan y cuentan.
    expect(await m.caso.sweep()).toBe(7);
  });

  it('un callback entregado se marca entregado y no suelta nada: ya no vuelve', async () => {
    const m = montar({ callbacks: [deposit('c1')] });

    await m.caso.sweep();

    expect(m.calls).toContain('delivered:c1');
    expect(m.calls).not.toContain('release:c1');
  });

  it('un callback que no salió suelta el arrendamiento, para que mande la espera creciente', async () => {
    const m = montar({ callbacks: [deposit('c1')], failDelivery: true });

    await m.caso.sweep();

    expect(m.calls).toContain('release:c1');
    expect(m.calls).not.toContain('delivered:c1');
  });

  it('lo mismo para el callback de un conflicto de idempotencia, por su messageId', async () => {
    const m = montar({
      conflicts: [{ messageId: 'm1', deposit: deposit('k1') }],
      failDelivery: true,
    });

    await m.caso.sweep();

    expect(m.calls).toContain('releaseConflict:m1');
    expect(m.calls).not.toContain('conflictDelivered:m1');
  });

  it('si soltar el arrendamiento falla, la vuelta sigue: caduca solo y el reintento sólo llega más tarde', async () => {
    const m = montar({
      callbacks: [deposit('c1'), deposit('c2')],
      failDelivery: true,
      failRelease: true,
    });

    await expect(m.caso.sweep()).resolves.toBe(2);
    expect(m.calls).toEqual(expect.arrayContaining(['release:c1', 'release:c2']));
  });

  it('un paso que lanza se registra y no impide los demás: los callbacks salen aunque el reclamo de acciones falle', async () => {
    const m = montar({ callbacks: [deposit('c1')], failClaimActions: true });

    await m.caso.sweep();

    expect(m.failures).toContain('claimActions');
    expect(m.calls).toContain('delivered:c1');
  });
});
