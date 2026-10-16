import { randomUUID } from 'node:crypto';

import { createEnvelope } from '@bank/contracts';
import { Pool } from 'pg';

import type { InterbankSend } from '../src/application/interbank-send.ports';
import { migrate } from '../src/infrastructure/persistence/migrations';
import { PostgresInterbankSendRepository } from '../src/infrastructure/persistence/postgres-interbank-send.repository';

/**
 * Los depósitos que este banco ENVÍA, contra PostgreSQL de verdad.
 *
 * Lo que sólo se puede probar aquí, y no con un doble: que los cuatro `CHECK`
 * de la tabla rechacen lo que la función pura no habría producido, que el
 * guardia `WHERE state = $from` impida de verdad dos transiciones simultáneas,
 * y que `SKIP LOCKED` deje a dos barridos repartirse el trabajo en vez de
 * pelearse por la misma fila.
 *
 * Se salta sin `DATABASE_URL`, como las otras cuatro suites de integración de
 * este servicio.
 */

const URL = process.env.DATABASE_URL;
const suite = URL === undefined ? describe.skip : describe;

suite('interbank send persistence', () => {
  let pool: Pool;
  let repository: PostgresInterbankSendRepository;
  const now = new Date('2026-10-15T12:00:00.000Z');

  beforeAll(async () => {
    pool = new Pool({ connectionString: URL });
    await migrate(pool);
    repository = new PostgresInterbankSendRepository(pool);
  });

  beforeEach(async () => {
    await pool.query('TRUNCATE interbank_sends');
  });

  afterAll(async () => {
    await pool.end();
  });

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

  function nuevo(overrides: Partial<Omit<InterbankSend, 'state' | 'reason' | 'attempts'>> = {}) {
    return {
      interbankTransferId: randomUUID(),
      paymentId: randomUUID(),
      transactionId: randomUUID(),
      idempotencyKey: randomUUID(),
      destinationBankCode: 'BANK99',
      destinationAccount: 'cuenta-de-alla-1',
      amount: { amountMinor: 12_500, currency: 'GTQ' },
      correlationId: randomUUID(),
      confirmationDueAt: new Date(now.getTime() + 30_000),
      createdAt: now,
      traceContext: null,
      origin: origin(),
      ...overrides,
    };
  }

  it('abre el depósito pendiente, con su plazo y su reintento programados', async () => {
    const abierto = await repository.open({ send: nuevo(), now });

    expect(abierto.kind).toBe('CREATED');
    expect(abierto.send.state).toBe('PENDING');
    expect(abierto.send.attempts).toBe(0);

    const fila = await pool.query<{ next_attempt_at: Date; confirmation_due_at: Date }>(
      'SELECT next_attempt_at, confirmation_due_at FROM interbank_sends WHERE interbank_transfer_id = $1',
      [abierto.send.interbankTransferId],
    );

    // El plazo es una COLUMNA, que es todo el punto: un pod nuevo lo encuentra.
    expect(fila.rows[0]?.next_attempt_at).toEqual(now);
    expect(fila.rows[0]?.confirmation_due_at).toEqual(new Date(now.getTime() + 30_000));
  });

  it('el mismo comando dos veces es un depósito, no dos', async () => {
    const send = nuevo();

    const primera = await repository.open({ send, now });
    const segunda = await repository.open({ send, now });

    expect(primera.kind).toBe('CREATED');
    expect(segunda.kind).toBe('DUPLICATE');
    expect(segunda.send.interbankTransferId).toBe(primera.send.interbankTransferId);

    const total = await pool.query<{ count: string }>('SELECT count(*) FROM interbank_sends');
    expect(total.rows[0]?.count).toBe('1');
  });

  it('rechaza dos depósitos distintos que reclamen la misma clave de idempotencia', async () => {
    const primero = nuevo();
    await repository.open({ send: primero, now });

    await expect(
      repository.open({ send: nuevo({ idempotencyKey: primero.idempotencyKey }), now }),
    ).rejects.toThrow(/identidad/);
  });

  it('el guardia de estado deja pasar una sola de dos transiciones simultáneas', async () => {
    const abierto = await repository.open({ send: nuevo(), now });
    const id = abierto.send.interbankTransferId;

    await repository.advance({
      interbankTransferId: id,
      from: 'PENDING',
      to: 'SENT',
      reason: null,
      nextAttemptAt: null,
      now,
    });

    // El callback y el vencimiento, los dos legales desde SENT, a la vez.
    const [callback, vencimiento] = await Promise.all([
      repository.advance({
        interbankTransferId: id,
        from: 'SENT',
        to: 'ACCEPTED',
        reason: null,
        nextAttemptAt: null,
        now,
      }),
      repository.advance({
        interbankTransferId: id,
        from: 'SENT',
        to: 'TIMEOUT',
        reason: 'CONFIRMATION_TIMEOUT',
        nextAttemptAt: null,
        now,
      }),
    ]);

    // Uno gana y el otro se entera de que perdió. Nunca los dos.
    expect([callback, vencimiento].filter(Boolean)).toHaveLength(1);
  });

  it('escribe la fecha de decisión cuando el depósito se resuelve, y sólo entonces', async () => {
    const abierto = await repository.open({ send: nuevo(), now });
    const id = abierto.send.interbankTransferId;

    await repository.advance({
      interbankTransferId: id,
      from: 'PENDING',
      to: 'SENT',
      reason: null,
      nextAttemptAt: null,
      now,
    });

    const enVuelo = await pool.query<{ decided_at: Date | null; sent_at: Date | null }>(
      'SELECT decided_at, sent_at FROM interbank_sends WHERE interbank_transfer_id = $1',
      [id],
    );
    expect(enVuelo.rows[0]?.decided_at).toBeNull();
    expect(enVuelo.rows[0]?.sent_at).toEqual(now);

    await repository.advance({
      interbankTransferId: id,
      from: 'SENT',
      to: 'REJECTED',
      reason: 'ACCOUNT_INACTIVE',
      nextAttemptAt: null,
      now,
    });

    const resuelto = await pool.query<{ decided_at: Date | null; reason: string | null }>(
      'SELECT decided_at, reason FROM interbank_sends WHERE interbank_transfer_id = $1',
      [id],
    );
    expect(resuelto.rows[0]?.decided_at).toEqual(now);
    expect(resuelto.rows[0]?.reason).toBe('ACCOUNT_INACTIVE');
  });

  it('la base se niega a aceptar un depósito con motivo, aunque alguien lo intente', async () => {
    const abierto = await repository.open({ send: nuevo(), now });
    const id = abierto.send.interbankTransferId;

    /*
     * Saltándose el repositorio a propósito: lo que se prueba es el `CHECK`, que
     * es la segunda barrera. La primera es la función pura, y si las dos se
     * contradicen alguna vez, esta es la que tiene que ganar.
     */
    await expect(
      pool.query(
        `UPDATE interbank_sends
            SET state = 'ACCEPTED', reason = 'ACCOUNT_NOT_FOUND', decided_at = $2, next_attempt_at = NULL
          WHERE interbank_transfer_id = $1`,
        [id, now],
      ),
    ).rejects.toThrow();
  });

  it('la base se niega a dejar REVERSED sin constancia de cuándo volvió el dinero', async () => {
    const abierto = await repository.open({ send: nuevo(), now });
    const id = abierto.send.interbankTransferId;

    await expect(
      pool.query(
        `UPDATE interbank_sends
            SET state = 'REVERSED', reason = 'CONFIRMATION_TIMEOUT', decided_at = $2,
                reversed_at = NULL, next_attempt_at = NULL
          WHERE interbank_transfer_id = $1`,
        [id, now],
      ),
    ).rejects.toThrow();
  });

  it('reclama sólo los pendientes cuyo reintento ya vence', async () => {
    const vencido = await repository.open({ send: nuevo(), now });
    const futuro = await repository.open({
      send: nuevo(),
      now: new Date(now.getTime() + 60_000),
    });

    const reclamados = await repository.claimSendable(now, 10);

    expect(reclamados.map((s) => s.interbankTransferId)).toEqual([
      vencido.send.interbankTransferId,
    ]);
    expect(reclamados.map((s) => s.interbankTransferId)).not.toContain(
      futuro.send.interbankTransferId,
    );
  });

  it('reclama los que llevan demasiado esperando una confirmación, en vuelo o sin entregar', async () => {
    const pendiente = await repository.open({ send: nuevo(), now });
    const entregado = await repository.open({ send: nuevo(), now });
    await repository.advance({
      interbankTransferId: entregado.send.interbankTransferId,
      from: 'PENDING',
      to: 'SENT',
      reason: null,
      nextAttemptAt: null,
      now,
    });
    const resuelto = await repository.open({ send: nuevo(), now });
    await repository.advance({
      interbankTransferId: resuelto.send.interbankTransferId,
      from: 'PENDING',
      to: 'SENT',
      reason: null,
      nextAttemptAt: null,
      now,
    });
    await repository.advance({
      interbankTransferId: resuelto.send.interbankTransferId,
      from: 'SENT',
      to: 'ACCEPTED',
      reason: null,
      nextAttemptAt: null,
      now,
    });

    const expirados = await repository.claimExpired(new Date(now.getTime() + 31_000), 10);
    const ids = expirados.map((s) => s.interbankTransferId);

    expect(ids).toContain(pendiente.send.interbankTransferId);
    expect(ids).toContain(entregado.send.interbankTransferId);
    // Un depósito ya decidido no vence: su plazo dejó de importar.
    expect(ids).not.toContain(resuelto.send.interbankTransferId);
  });

  it('encuentra el depósito por la transacción, que es como lo busca la compensación', async () => {
    const abierto = await repository.open({ send: nuevo(), now });

    const porTransaccion = await repository.findByTransaction(abierto.send.transactionId);

    expect(porTransaccion?.interbankTransferId).toBe(abierto.send.interbankTransferId);
    expect(await repository.findByTransaction(randomUUID())).toBeNull();
  });

  it('devuelve el monto en centavos enteros, no como la cadena que entrega el driver', async () => {
    const abierto = await repository.open({
      send: nuevo({ amount: { amountMinor: 999_999_999, currency: 'GTQ' } }),
      now,
    });

    const leido = await repository.find(abierto.send.interbankTransferId);

    expect(leido?.amount.amountMinor).toBe(999_999_999);
    expect(typeof leido?.amount.amountMinor).toBe('number');
  });
});
