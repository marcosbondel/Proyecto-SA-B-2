import type { Pool } from 'pg';

import {
  CALLBACK_LEASE_MS,
  PAYMENT_LEASE_MS,
  SEND_LEASE_MS,
} from '../src/infrastructure/persistence/claim-lease';
import {
  PARTNER_CALLBACK_TIMEOUT_MS,
  PARTNER_SEND_TIMEOUT_MS,
} from '../src/infrastructure/http/partner-callback';
import { PostgresInterbankRepository } from '../src/infrastructure/persistence/postgres-interbank.repository';
import { PostgresInterbankSendRepository } from '../src/infrastructure/persistence/postgres-interbank-send.repository';
import { PostgresPaymentRepository } from '../src/infrastructure/persistence/postgres-payment.repository';

/**
 * La **forma** de cada reclamo y de cada suelta del arrendamiento (T-60), contra
 * un doble del pool.
 *
 * Lo que esto atrapa y la suite de integración no: un reclamo que vuelve a ser
 * dos sentencias, o que pasa por `connect()` y `BEGIN`, o que pierde el
 * `claimed_until IS NULL OR claimed_until <= now`, sigue dando filas disjuntas
 * *cuando las pruebas corren una detrás de otra*. El defecto de producción era
 * exactamente un `SELECT … FOR UPDATE SKIP LOCKED` suelto que se veía bien. Lo
 * que la suite de integración (`claim-lease.integration.spec.ts`) prueba es lo
 * contrario: lo que la base hace con ocho conexiones reales a la vez.
 */

const NOW = new Date('2026-10-19T12:00:00.000Z');
const LEASE_MS = 12_345;

interface Recorded {
  readonly text: string;
  readonly values: readonly unknown[];
}

function fakePool(): { pool: Pool; queries: Recorded[]; connects: () => number } {
  const queries: Recorded[] = [];
  let connects = 0;
  const run = async (text: string, values: readonly unknown[] = []) => {
    queries.push({ text, values });

    return await Promise.resolve({ rows: [], rowCount: 1 });
  };
  const client = { query: run, release: (): void => undefined };

  return {
    pool: {
      query: run,
      connect: async () => {
        connects += 1;

        return await Promise.resolve(client);
      },
    } as unknown as Pool,
    queries,
    connects: () => connects,
  };
}

function setup() {
  const double = fakePool();

  return {
    ...double,
    sends: new PostgresInterbankSendRepository(double.pool, LEASE_MS),
    payments: new PostgresPaymentRepository(double.pool, LEASE_MS),
    deposits: new PostgresInterbankRepository(double.pool, LEASE_MS),
  };
}

type Setup = ReturnType<typeof setup>;

describe('cada reclamo es una sola sentencia que arrienda lo que devuelve', () => {
  const claims: readonly [string, (s: Setup) => Promise<unknown>][] = [
    ['claimSendable', async (s) => await s.sends.claimSendable(NOW, 7)],
    ['claimExpired', async (s) => await s.sends.claimExpired(NOW, 7)],
    ['claimAwaitingResolution', async (s) => await s.sends.claimAwaitingResolution(NOW, 7)],
    ['claimUnreconciled', async (s) => await s.sends.claimUnreconciled(NOW, 7, NOW)],
    ['claimReversals', async (s) => await s.sends.claimReversals(NOW, 7)],
    ['payments.due', async (s) => await s.payments.due(NOW, 7)],
    ['claimCallbacks', async (s) => await s.deposits.claimCallbacks(NOW, 7)],
    ['claimConflictCallbacks', async (s) => await s.deposits.claimConflictCallbacks(NOW, 7)],
  ];

  it.each(claims)('%s', async (_name, claim) => {
    const s = setup();

    await claim(s);

    // Una sola sentencia y ninguna transacción: es lo que impide que el candado
    // dure menos que el arrendamiento.
    expect(s.queries).toHaveLength(1);
    expect(s.connects()).toBe(0);

    const { text, values } = s.queries[0]!;

    expect(text).toMatch(/UPDATE/);
    expect(text).toMatch(/claimed_until\s*=\s*\$\d+::timestamptz\s*\+/);
    expect(text).toMatch(/claimed_until IS NULL OR claimed_until <= \$\d+/);
    expect(text).toMatch(/FOR UPDATE SKIP LOCKED/);
    // El reloj inyectado y la duración configurada, no `now()` ni una constante.
    expect(values).toEqual(expect.arrayContaining([NOW, LEASE_MS]));
  });
});

describe('el paso que termina suelta el arrendamiento en el mismo UPDATE que programa el siguiente', () => {
  const textOf = (s: Setup, table: string): string =>
    s.queries.find((q) => q.text.includes(`UPDATE ${table}`))?.text ?? '';

  it('advance', async () => {
    const s = setup();

    await s.sends.advance({
      interbankTransferId: 'id',
      from: 'PENDING',
      to: 'SENT',
      reason: null,
      nextAttemptAt: null,
      now: NOW,
    });

    expect(textOf(s, 'interbank_sends')).toMatch(/claimed_until = NULL/);
  });

  it('recordResolutionStep', async () => {
    const s = setup();

    await s.sends.recordResolutionStep({
      interbankTransferId: 'id',
      probe: { kind: 'UNREACHABLE' },
      resolveNotBefore: NOW,
      now: NOW,
    });

    expect(textOf(s, 'interbank_sends')).toMatch(/claimed_until = NULL/);
  });

  it('recordReversalStep', async () => {
    const s = setup();

    await s.sends.recordReversalStep({
      interbankTransferId: 'id',
      state: 'PROCESSING',
      refundTransferId: null,
      message: null,
      nextAt: NOW,
      now: NOW,
    });

    expect(textOf(s, 'interbank_sends')).toMatch(/claimed_until = NULL/);
  });

  it('enqueueVerdict', async () => {
    const s = setup();

    await s.sends.enqueueVerdict({ interbankTransferId: 'id', outbound: [], now: NOW });

    expect(textOf(s, 'interbank_sends')).toMatch(/claimed_until = NULL/);
  });

  it('markCallbackDelivered y markConflictCallbackDelivered', async () => {
    const s = setup();

    await s.deposits.markCallbackDelivered('id', NOW);
    await s.deposits.markConflictCallbackDelivered('id', NOW);

    expect(textOf(s, 'interbank_deposits')).toMatch(/claimed_until = NULL/);
    expect(textOf(s, 'interbank_conflicts')).toMatch(/claimed_until = NULL/);
  });

  it('releaseCallbackClaim y releaseConflictCallbackClaim sólo sueltan: no marcan entregado', async () => {
    const s = setup();

    await s.deposits.releaseCallbackClaim('id');
    await s.deposits.releaseConflictCallbackClaim('id');

    for (const query of s.queries) {
      expect(query.text).toMatch(/claimed_until = NULL/);
      expect(query.text).not.toMatch(/callback_delivered_at/);
    }
    expect(s.queries).toHaveLength(2);
  });
});

describe('las filas que se entregan en línea nacen arrendadas', () => {
  it('un depósito enviado: `open` escribe claimed_until = ahora + arrendamiento', async () => {
    const s = setup();

    // El doble no devuelve filas: `open` acaba lanzando al no encontrar la suya,
    // y lo que importa es la sentencia que escribió antes.
    await s.sends
      .open({
        send: {
          interbankTransferId: 'id',
          confirmationDueAt: NOW,
          releaseNotBefore: NOW,
          createdAt: NOW,
          amount: { amountMinor: 1, currency: 'GTQ' },
          origin: {},
        } as never,
        now: NOW,
      })
      .catch(() => undefined);

    const insert = s.queries.find((q) => q.text.includes('INSERT INTO interbank_sends'));

    expect(insert?.text).toMatch(/claimed_until/);
    expect(insert?.values.at(-1)).toEqual(new Date(NOW.getTime() + LEASE_MS));
  });

  it('un pago: `open` escribe claimed_until = creación + arrendamiento', async () => {
    const s = setup();

    await s.payments
      .open({
        payment: {
          paymentId: 'p',
          transactionId: 't',
          amount: { amountMinor: 1, currency: 'GTQ' },
          scenario: null,
          originCorrelationId: 'c',
          nextAttemptAt: NOW,
          createdAt: NOW,
        } as never,
      })
      .catch(() => undefined);

    const insert = s.queries.find((q) => q.text.includes('INSERT INTO payments'));

    expect(insert?.text).toMatch(/claimed_until/);
    expect(insert?.values.at(-1)).toEqual(new Date(NOW.getTime() + LEASE_MS));
  });
});

describe('la duración del arrendamiento', () => {
  /** El lote que procesa cada barrido, en serie (`SWEEP_BATCH` de `main.ts`). */
  const BATCH = 20;

  it('los envíos: un lote entero con el banco pareja caído del todo cabe dentro', () => {
    expect(SEND_LEASE_MS).toBeGreaterThan(BATCH * PARTNER_SEND_TIMEOUT_MS);
  });

  it('los callbacks: igual, con su propio tiempo límite', () => {
    expect(CALLBACK_LEASE_MS).toBeGreaterThan(BATCH * PARTNER_CALLBACK_TIMEOUT_MS);
  });

  it('sin segundo argumento, cada repositorio usa la suya', async () => {
    const double = fakePool();

    expect(new PostgresInterbankSendRepository(double.pool).leaseMs).toBe(SEND_LEASE_MS);
    expect(new PostgresInterbankRepository(double.pool).leaseMs).toBe(CALLBACK_LEASE_MS);

    await new PostgresPaymentRepository(double.pool).due(NOW, 1);

    expect(double.queries[0]?.values).toContain(PAYMENT_LEASE_MS);
  });
});
