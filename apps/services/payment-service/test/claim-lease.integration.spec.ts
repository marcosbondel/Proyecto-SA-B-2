import { randomUUID } from 'node:crypto';

import { createEnvelope } from '@bank/contracts';
import { Pool } from 'pg';

import type { AttemptResult } from '../src/application/ports';
import { quetzales } from '../src/domain/money';
import type { Payment } from '../src/domain/payment';
import { migrate } from '../src/infrastructure/persistence/migrations';
import { PostgresInterbankRepository } from '../src/infrastructure/persistence/postgres-interbank.repository';
import { PostgresInterbankSendRepository } from '../src/infrastructure/persistence/postgres-interbank-send.repository';
import { PostgresPaymentRepository } from '../src/infrastructure/persistence/postgres-payment.repository';

/**
 * Los reclamos de los barridos son **arrendamientos** (T-60), contra PostgreSQL
 * de verdad.
 *
 * El defecto que esto cierra se vio en producción el 2026-10-19: cada envío
 * interbancario salía ~4 veces al banco pareja. Los reclamos eran un `SELECT …
 * FOR UPDATE SKIP LOCKED` fuera de una transacción, así que el candado se
 * soltaba al volver el `SELECT` y dos réplicas (el HPA escala este servicio) o
 * dos barridos solapados tomaban las mismas filas. Un doble no puede probar
 * nada de esto: lo que se prueba es lo que la base hace con ocho conexiones
 * reales pidiendo a la vez. (La forma de cada sentencia, que es lo que sí se
 * puede probar con un doble, está en `claim-lease.spec.ts`.)
 *
 * Se salta sin `DATABASE_URL`, como las demás suites de integración.
 */

const URL = process.env.DATABASE_URL;
const suite = URL === undefined ? describe.skip : describe;

jest.setTimeout(30_000);

const LEASE_MS = 60_000;
const CLAIMERS = 8;
const now = new Date('2026-10-19T12:00:00.000Z');
const after = (ms: number): Date => new Date(now.getTime() + ms);

/** Ocho reclamos a la vez, cada uno con su propia conexión del pool. */
async function inParallel<T>(claim: () => Promise<readonly T[]>): Promise<T[][]> {
  return await Promise.all(Array.from({ length: CLAIMERS }, async () => [...(await claim())]));
}

/** Aplana los lotes y comprueba que ninguna fila salió en dos de ellos. */
function disjoint(batches: readonly (readonly string[])[]): string[] {
  const all = batches.flat();

  expect(new Set(all).size).toBe(all.length);

  return all;
}

suite('arrendamiento de los reclamos', () => {
  let pool: Pool;
  let sends: PostgresInterbankSendRepository;
  let payments: PostgresPaymentRepository;
  let deposits: PostgresInterbankRepository;

  beforeAll(async () => {
    pool = new Pool({ connectionString: URL, max: 12 });
    await migrate(pool);
    sends = new PostgresInterbankSendRepository(pool, LEASE_MS);
    payments = new PostgresPaymentRepository(pool, LEASE_MS);
    deposits = new PostgresInterbankRepository(pool, LEASE_MS);
  });

  beforeEach(async () => {
    await pool.query(
      'TRUNCATE interbank_sends, interbank_send_history, outbox_messages, payments, payment_attempts, interbank_deposits, interbank_conflicts',
    );
  });

  afterAll(async () => {
    await pool.end();
  });

  async function claimedUntil(table: string, key: string, id: string): Promise<Date | null> {
    const row = await pool.query<{ claimed_until: Date | null }>(
      `SELECT claimed_until FROM ${table} WHERE ${key} = $1`,
      [id],
    );

    return row.rows[0]?.claimed_until ?? null;
  }

  describe('los envíos al banco pareja', () => {
    function origin(): ReturnType<typeof createEnvelope> {
      return createEnvelope(
        {
          paymentId: randomUUID(),
          transactionId: randomUUID(),
          amount: { amountMinor: 12_500, currency: 'GTQ' },
        },
        { messageType: 'payment.requested.v1', producer: 'transaction-service', identity: null },
      );
    }

    /** Un depósito dado de alta; `open` lo deja arrendado a quien lo entrega en línea. */
    async function open(confirmationDueAt = after(180_000)): Promise<string> {
      const id = randomUUID();
      const opened = await sends.open({
        send: {
          interbankTransferId: id,
          paymentId: randomUUID(),
          transactionId: randomUUID(),
          idempotencyKey: randomUUID(),
          destinationBankCode: 'BANK99',
          destinationAccount: 'cuenta-de-alla-1',
          originAccount: '02-000000052',
          customerId: null,
          amount: { amountMinor: 12_500, currency: 'GTQ' },
          correlationId: randomUUID(),
          confirmationDueAt,
          releaseNotBefore: new Date(confirmationDueAt.getTime() + 300_000),
          createdAt: now,
          traceContext: null,
          origin: origin(),
        },
        now,
      });

      expect(opened.kind).toBe('CREATED');

      return id;
    }

    /** La entrega en línea terminó: nadie más tiene la fila. */
    async function release(): Promise<void> {
      await pool.query('UPDATE interbank_sends SET claimed_until = NULL');
    }

    async function toState(id: string, to: 'TIMEOUT' | 'REJECTED'): Promise<void> {
      const moved = await sends.advance({
        interbankTransferId: id,
        from: 'PENDING',
        to,
        reason: to === 'TIMEOUT' ? 'CONFIRMATION_TIMEOUT' : 'ACCOUNT_NOT_FOUND',
        nextAttemptAt: null,
        now,
      });

      expect(moved).toBe(true);
    }

    /** Un reverso pedido: rechazado, con veredicto ya encolado, y `reversal_state = PENDING`. */
    async function withReversal(id: string): Promise<void> {
      await toState(id, 'REJECTED');
      await pool.query(
        'UPDATE interbank_sends SET verdict_enqueued_at = $2 WHERE interbank_transfer_id = $1',
        [id, now],
      );
      await sends.requestReversal({ interbankTransferId: id, reversalId: randomUUID(), now });
    }

    /** Cada reclamo, con la forma de fila que busca y la manera de pedirla. */
    const claims: readonly {
      name: string;
      seed: () => Promise<string>;
      claim: (at: Date, limit: number) => Promise<readonly { interbankTransferId: string }[]>;
    }[] = [
      {
        name: 'claimSendable',
        seed: async () => await open(),
        claim: async (at, limit) => await sends.claimSendable(at, limit),
      },
      {
        name: 'claimExpired',
        seed: async () => await open(after(-1_000)),
        claim: async (at, limit) => await sends.claimExpired(at, limit),
      },
      {
        name: 'claimAwaitingResolution',
        seed: async () => {
          const id = await open();
          await toState(id, 'TIMEOUT');

          return id;
        },
        claim: async (at, limit) => await sends.claimAwaitingResolution(at, limit),
      },
      {
        name: 'claimReversals',
        seed: async () => {
          const id = await open();
          await withReversal(id);

          return id;
        },
        claim: async (at, limit) => await sends.claimReversals(at, limit),
      },
      {
        name: 'claimUnreconciled',
        seed: async () => {
          const id = await open();
          await toState(id, 'REJECTED');

          return id;
        },
        claim: async (at, limit) => await sends.claimUnreconciled(at, limit, at),
      },
    ];

    it.each(claims)(
      '$name: ocho reclamos a la vez reciben filas disjuntas, y lo arrendado no vuelve hasta que caduca',
      async ({ seed, claim }) => {
        const seeded: string[] = [];

        for (let n = 0; n < 24; n += 1) {
          seeded.push(await seed());
        }
        await release();

        // Ningún candado sobrevive a la sentencia, y aun así nada se reparte dos veces.
        const first = await inParallel(async () => await claim(after(1_000), 5));
        const second = await inParallel(async () => await claim(after(1_000), 5));
        const taken = disjoint(
          [...first, ...second].map((batch) => batch.map((s) => s.interbankTransferId)),
        );

        expect([...taken].sort()).toEqual([...seeded].sort());

        // Todo está arrendado: ni ahora ni un instante antes de caducar.
        expect(await claim(after(1_000), 30)).toEqual([]);
        expect(await claim(after(1_000 + LEASE_MS - 1), 30)).toEqual([]);
        // Caducó: el pod que las tenía murió, y otro las recoge.
        expect(await claim(after(1_000 + LEASE_MS), 30)).toHaveLength(24);
      },
    );

    it('un depósito recién dado de alta nace arrendado, y el arrendamiento es de la fila y no del reclamo', async () => {
      const id = await open(after(-1_000));

      // El barrido (cada 500 ms) lo vería `PENDING` y con su hora ya vencida,
      // por `claimSendable` y por `claimExpired`: ninguno lo toca.
      expect(await sends.claimSendable(after(1_000), 10)).toEqual([]);
      expect(await sends.claimExpired(after(1_000), 10)).toEqual([]);
      expect(await claimedUntil('interbank_sends', 'interbank_transfer_id', id)).toEqual(
        after(LEASE_MS),
      );

      // Terminada la entrega en línea, el primero que llega se lo lleva, y el
      // otro tipo de reclamo ya no la ve.
      await release();
      expect(
        (await sends.claimSendable(after(1_000), 10)).map((s) => s.interbankTransferId),
      ).toEqual([id]);
      expect(await sends.claimExpired(after(1_000), 10)).toEqual([]);
    });

    it('el paso que termina suelta el arrendamiento junto con su siguiente hora, y el que pierde la carrera no', async () => {
      const resend = await open();
      const resolving = await open();
      const reversing = await open();
      const verdict = await open();
      await toState(resolving, 'TIMEOUT');
      await withReversal(reversing);
      await toState(verdict, 'REJECTED');
      await release();

      // advance: el reintento programado se respeta al instante.
      await sends.claimSendable(after(1_000), 10);
      await sends.advance({
        interbankTransferId: resend,
        from: 'PENDING',
        to: 'PENDING',
        reason: null,
        nextAttemptAt: after(2_000),
        now: after(1_000),
      });
      expect(await claimedUntil('interbank_sends', 'interbank_transfer_id', resend)).toBeNull();
      expect(await sends.claimSendable(after(1_999), 10)).toEqual([]);
      expect((await sends.claimSendable(after(2_000), 10)).length).toBe(1);

      // recordResolutionStep: el siguiente paso del protocolo de TIMEOUT.
      await sends.claimAwaitingResolution(after(1_000), 10);
      await sends.recordResolutionStep({
        interbankTransferId: resolving,
        probe: { kind: 'UNREACHABLE' },
        resolveNotBefore: after(5_000),
        now: after(1_000),
      });
      expect(await claimedUntil('interbank_sends', 'interbank_transfer_id', resolving)).toBeNull();
      expect(await sends.claimAwaitingResolution(after(4_999), 10)).toEqual([]);
      expect((await sends.claimAwaitingResolution(after(5_000), 10)).length).toBe(1);

      // recordReversalStep: la siguiente consulta del reverso.
      await sends.claimReversals(after(1_000), 10);
      await sends.recordReversalStep({
        interbankTransferId: reversing,
        state: 'PROCESSING',
        refundTransferId: null,
        message: null,
        nextAt: after(3_000),
        now: after(1_000),
      });
      expect(await claimedUntil('interbank_sends', 'interbank_transfer_id', reversing)).toBeNull();
      expect(await sends.claimReversals(after(2_999), 10)).toEqual([]);
      expect((await sends.claimReversals(after(3_000), 10)).length).toBe(1);

      // enqueueVerdict: el veredicto ya está en el outbox, y la fila deja de ser candidata.
      await sends.claimUnreconciled(after(1_000), 10, after(1_000));
      await sends.enqueueVerdict({
        interbankTransferId: verdict,
        outbound: [],
        now: after(1_000),
      });
      expect(await claimedUntil('interbank_sends', 'interbank_transfer_id', verdict)).toBeNull();
      expect(await sends.claimUnreconciled(after(1_000), 10, after(1_000))).toEqual([]);

      // Y un `advance` que pierde la carrera no suelta el arrendamiento de otro.
      const lost = await sends.advance({
        interbankTransferId: resend,
        from: 'SENT',
        to: 'REJECTED',
        reason: 'ACCOUNT_NOT_FOUND',
        nextAttemptAt: null,
        now: after(3_000),
      });
      expect(lost).toBe(false);
      expect(await claimedUntil('interbank_sends', 'interbank_transfer_id', resend)).not.toBeNull();
    });
  });

  describe('los pagos de la escalera de reintentos', () => {
    const payment = (overrides: Partial<Payment> = {}): Payment => ({
      paymentId: randomUUID(),
      transactionId: randomUUID(),
      status: 'PENDING',
      amount: quetzales(15_000),
      attempt: null,
      errorType: null,
      failureReason: null,
      providerReference: null,
      scenario: null,
      originCorrelationId: randomUUID(),
      nextAttemptAt: now,
      createdAt: now,
      updatedAt: now,
      decidedAt: null,
      ...overrides,
    });

    const release = async (): Promise<void> => {
      await pool.query('UPDATE payments SET claimed_until = NULL');
    };

    it('ocho reclamos a la vez reciben filas disjuntas', async () => {
      const seeded: string[] = [];

      for (let n = 0; n < 24; n += 1) {
        const created = await payments.open({ payment: payment() });
        seeded.push(created.payment.paymentId);
      }
      await release();

      const batches = [
        ...(await inParallel(async () => await payments.due(after(1_000), 5))),
        ...(await inParallel(async () => await payments.due(after(1_000), 5))),
      ];
      const taken = disjoint(batches.map((batch) => batch.map((p) => p.paymentId)));

      expect([...taken].sort()).toEqual([...seeded].sort());
    });

    it('un pago recién abierto nace arrendado, y lo arrendado no vuelve hasta que caduca', async () => {
      const created = await payments.open({ payment: payment() });

      // El primer intento en línea no compite con el barrido.
      expect(await payments.due(after(1_000), 10)).toEqual([]);

      await release();
      expect(await payments.due(after(1_000), 10)).toHaveLength(1);
      expect(await payments.due(after(1_000), 10)).toEqual([]);
      expect(await payments.due(after(1_000 + LEASE_MS - 1), 10)).toEqual([]);
      expect(
        (await payments.due(after(1_000 + LEASE_MS), 10)).map((p) => p.paymentId),
      ).toEqual([created.payment.paymentId]);
    });

    it('el intento que termina suelta el arrendamiento y respeta su siguiente hora', async () => {
      const created = await payments.open({ payment: payment() });
      const id = created.payment.paymentId;
      await release();
      await payments.due(after(1_000), 10);
      expect(await claimedUntil('payments', 'payment_id', id)).not.toBeNull();

      const failed: AttemptResult = {
        status: 'PENDING',
        errorType: 'TRANSIENT',
        failureReason: null,
        providerReference: null,
        nextAttemptAt: after(6_000),
        attemptResult: 'FAILED',
        providerResult: 'TIMEOUT',
      };
      const recorded = await payments.attempt({
        paymentId: id,
        expectedAttempt: 1,
        now: after(1_000),
        decide: () => failed,
      });

      expect(recorded.kind).toBe('RECORDED');
      expect(await claimedUntil('payments', 'payment_id', id)).toBeNull();
      expect(await payments.due(after(5_999), 10)).toEqual([]);
      expect((await payments.due(after(6_000), 10)).map((p) => p.paymentId)).toEqual([id]);
    });
  });

  describe('los callbacks que este banco manda', () => {
    function incoming(index: number): ReturnType<typeof createEnvelope> & {
      payload: { depositId: string };
    } {
      return createEnvelope(
        {
          depositId: randomUUID(),
          interbankTransferId: `partner-${String(index)}`,
          idempotencyKey: `partner-${String(index)}`,
          originBankCode: 'BANK99',
          destinationBankCode: 'BANK02',
          accountId: randomUUID(),
          amount: { amountMinor: 12500, currency: 'GTQ' },
          partnerTimestamp: '2026-10-19T11:59:58.000Z',
          requestedAt: now.toISOString(),
        },
        { messageType: 'payment.interbank.receive.v1', producer: 'gateway', identity: null },
      ) as ReturnType<typeof createEnvelope> & { payload: { depositId: string } };
    }

    function rejection(depositId: string): ReturnType<typeof createEnvelope> {
      return createEnvelope(
        { depositId, reason: 'ACCOUNT_NOT_FOUND', decidedAt: now.toISOString() },
        {
          messageType: 'payment.interbank.rejected.v1',
          producer: 'payment-service',
          identity: null,
        },
      );
    }

    async function decidedDeposit(index: number): Promise<string> {
      const origin = incoming(index);
      const opened = await deposits.open({
        origin: origin as never,
        stage: 'REJECTED',
        reason: 'ACCOUNT_NOT_FOUND',
        result: rejection(origin.payload.depositId),
        now,
      });

      expect(opened.kind).toBe('CREATED');

      return origin.payload.depositId;
    }

    async function conflict(index: number): Promise<string> {
      const origin = incoming(index);

      expect(
        await deposits.recordConflict(origin as never, rejection(origin.payload.depositId), now),
      ).toBe(true);

      return origin.messageId;
    }

    it('ocho reclamos a la vez reciben depósitos disjuntos', async () => {
      const seeded: string[] = [];

      for (let n = 0; n < 24; n += 1) {
        seeded.push(await decidedDeposit(n));
      }

      const batches = [
        ...(await inParallel(async () => await deposits.claimCallbacks(now, 5))),
        ...(await inParallel(async () => await deposits.claimCallbacks(now, 5))),
      ];
      const taken = disjoint(batches.map((batch) => batch.map((d) => d.depositId)));

      expect([...taken].sort()).toEqual([...seeded].sort());
    });

    it('mientras se entrega, otra réplica no lo repite aunque su espera creciente ya venza; un intento fallido lo suelta; uno entregado lo cierra', async () => {
      const id = await decidedDeposit(1);

      expect((await deposits.claimCallbacks(now, 10)).map((d) => d.depositId)).toEqual([id]);
      // 2 s después: la espera creciente del primer intento ya venció, pero el
      // lote de la primera réplica puede estar aún en el vuelo HTTP.
      expect(await deposits.claimCallbacks(after(2_000), 10)).toEqual([]);
      expect(await deposits.claimCallbacks(after(LEASE_MS - 1), 10)).toEqual([]);
      // Si su pod murió, caduca y otra réplica lo recoge.
      expect(
        (await deposits.claimCallbacks(after(LEASE_MS), 10)).map((d) => d.depositId),
      ).toEqual([id]);

      // La entrega falló: se suelta y manda la espera creciente (4 s tras el segundo intento).
      await deposits.releaseCallbackClaim(id);
      expect(await claimedUntil('interbank_deposits', 'deposit_id', id)).toBeNull();
      expect(await deposits.claimCallbacks(after(LEASE_MS + 3_999), 10)).toEqual([]);
      expect(await deposits.claimCallbacks(after(LEASE_MS + 4_000), 10)).toHaveLength(1);

      // La entrega salió: se cierra y no vuelve.
      await deposits.markCallbackDelivered(id, after(LEASE_MS + 4_000));
      expect(await claimedUntil('interbank_deposits', 'deposit_id', id)).toBeNull();
      expect(await deposits.claimCallbacks(after(LEASE_MS * 4), 10)).toEqual([]);
    });

    it('los de un conflicto de idempotencia: filas disjuntas, arrendamiento, suelta al fallar y cierre al entregarse', async () => {
      const seeded: string[] = [];

      for (let n = 0; n < 24; n += 1) {
        seeded.push(await conflict(n));
      }

      const batches = [
        ...(await inParallel(async () => await deposits.claimConflictCallbacks(now, 5))),
        ...(await inParallel(async () => await deposits.claimConflictCallbacks(now, 5))),
      ];
      const taken = disjoint(batches.map((batch) => batch.map((c) => c.messageId)));

      expect([...taken].sort()).toEqual([...seeded].sort());

      // Una sola, para ver el ciclo.
      const id = seeded[0]!;
      expect(await deposits.claimConflictCallbacks(after(2_000), 10)).toEqual([]);

      await deposits.releaseConflictCallbackClaim(id);
      expect(
        (await deposits.claimConflictCallbacks(after(2_000), 10)).map((c) => c.messageId),
      ).toEqual([id]);

      await deposits.markConflictCallbackDelivered(id, after(2_000));
      expect(await claimedUntil('interbank_conflicts', 'message_id', id)).toBeNull();
      expect(await deposits.claimConflictCallbacks(after(LEASE_MS * 2), 10)).not.toContainEqual(
        expect.objectContaining({ messageId: id }),
      );
    });
  });
});
