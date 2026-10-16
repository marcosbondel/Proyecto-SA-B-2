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
    await pool.query('TRUNCATE outbox_messages');
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

  function nuevo(
    overrides: Partial<
      Omit<InterbankSend, 'state' | 'reason' | 'attempts' | 'verdictEnqueuedAt'>
    > = {},
  ) {
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

  /** Un mensaje listo para el outbox, como lo construye el caso de uso. */
  function mensaje(tipo: string) {
    return {
      exchange: 'bank.events',
      routingKey: tipo,
      envelope: createEnvelope(
        { transactionId: randomUUID() },
        { messageType: tipo, producer: 'payment-service', identity: null },
      ),
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

  /**
   * El veredicto viaja con su transición (TD-093).
   *
   * Esto es lo que ningún doble puede probar: que `outbox_messages` **acepte**
   * una fila sin `payment_id`. Un depósito interbancario no crea fila en
   * `payments`, así que la clave ajena de la migración 003 la habría rechazado
   * — y el error habría aparecido en producción, dentro de la transacción que
   * decide un veredicto, con el veredicto perdido otra vez y por un motivo
   * nuevo. La migración 014 quita ese `NOT NULL` precisamente aquí.
   */
  describe('el outbox del veredicto', () => {
    it('escribe el evento sin payment_id, que es lo que la FK habría rechazado', async () => {
      const abierto = await repository.open({ send: nuevo(), now });

      const movido = await repository.advance({
        interbankTransferId: abierto.send.interbankTransferId,
        from: 'PENDING',
        to: 'TIMEOUT',
        reason: 'CONFIRMATION_TIMEOUT',
        nextAttemptAt: null,
        now,
        outbound: [mensaje('payment.failed.v1')],
      });

      expect(movido).toBe(true);

      const encolado = await pool.query(
        'SELECT payment_id, routing_key, dispatch_status FROM outbox_messages',
      );
      expect(encolado.rowCount).toBe(1);
      expect(encolado.rows[0].payment_id).toBeNull();
      expect(encolado.rows[0].dispatch_status).toBe('PENDING');

      const fila = await repository.find(abierto.send.interbankTransferId);
      expect(fila?.state).toBe('TIMEOUT');
      expect(fila?.verdictEnqueuedAt).not.toBeNull();
    });

    it('el que pierde el guardia de estado no deja nada encolado', async () => {
      const abierto = await repository.open({ send: nuevo(), now });

      /*
       * El `from` equivocado: es la carrera que el guardia atrapa. Lo que se
       * comprueba es el `ROLLBACK` — sin él, el veredicto del que perdió
       * quedaría en el outbox y la Saga oiría dos finales.
       */
      const movido = await repository.advance({
        interbankTransferId: abierto.send.interbankTransferId,
        from: 'ACCEPTED',
        to: 'REVERSED',
        reason: null,
        nextAttemptAt: null,
        now,
        outbound: [mensaje('payment.failed.v1')],
      });

      expect(movido).toBe(false);
      const encolado = await pool.query('SELECT 1 FROM outbox_messages');
      expect(encolado.rowCount).toBe(0);
    });

    it('una transición sin veredicto no pone la marca', async () => {
      const abierto = await repository.open({ send: nuevo(), now });

      await repository.advance({
        interbankTransferId: abierto.send.interbankTransferId,
        from: 'PENDING',
        to: 'SENT',
        reason: null,
        nextAttemptAt: null,
        now,
        outbound: [mensaje('payment.interbank.sent.v1')],
      });

      /*
       * `SENT` no es un veredicto, así que la marca sigue nula aunque este
       * cambio sí llevara un evento consigo. Si se pusiera aquí, la red de
       * seguridad quedaría apagada para esta fila sin que nadie lo notara.
       */
      const fila = await repository.find(abierto.send.interbankTransferId);
      expect(fila?.state).toBe('SENT');
      expect(fila?.verdictEnqueuedAt).toBeNull();
    });
  });

  /**
   * La reconciliación, contra el índice parcial de verdad (TD-093, pieza b).
   *
   * Las filas que busca se construyen a mano con `UPDATE`, porque son las que
   * dejó una versión del código que ya no existe: decididas, con `decided_at`
   * escrito y sin veredicto encolado. Es la forma de la fila del Q1.00.
   */
  describe('reconciliar un veredicto perdido', () => {
    /**
     * Deja la fila como la dejaba el defecto: decidida y sin marca.
     *
     * Los cuatro `CHECK` de la tabla obligan a construirla con cuidado, y eso
     * es una buena noticia: `next_attempt_at` tiene que ser nulo en cuanto se
     * sale de `PENDING`, y `reversed_at` existe **si y sólo si** el estado es
     * `REVERSED`. La máquina de estados está escrita en SQL además de en
     * TypeScript, así que ni un test puede fabricar una fila incoherente — lo
     * descubrí intentándolo.
     */
    async function comoAntesDeTD093(id: string, estado: string, hace: number): Promise<void> {
      const decidido = new Date(now.getTime() - hace);

      await pool.query(
        `UPDATE interbank_sends
            SET state = $2::text,
                decided_at = $3::timestamptz,
                verdict_enqueued_at = NULL,
                reason = 'CONFIRMATION_TIMEOUT',
                next_attempt_at = NULL,
                -- Los dos casts, por lo mismo que lleva advance: un parametro
                -- que asigna a una columna y aparece en un CASE a la vez deja a
                -- PostgreSQL sin tipo que deducir. Hizo falta en los dos, y el
                -- comentario del repositorio ya avisaba del primero.
                reversed_at = CASE WHEN $2::text = 'REVERSED' THEN $3::timestamptz ELSE NULL END
          WHERE interbank_transfer_id = $1`,
        [id, estado, decidido],
      );
    }

    it('encuentra el decidido sin veredicto, pasado el margen', async () => {
      const abierto = await repository.open({ send: nuevo(), now });
      await comoAntesDeTD093(abierto.send.interbankTransferId, 'TIMEOUT', 300_000);

      const perdidos = await repository.claimUnreconciled(new Date(now.getTime() - 120_000), 10);

      expect(perdidos.map((p) => p.interbankTransferId)).toEqual([
        abierto.send.interbankTransferId,
      ]);
    });

    it('no toca el que ya tiene su veredicto encolado', async () => {
      const abierto = await repository.open({ send: nuevo(), now });
      await comoAntesDeTD093(abierto.send.interbankTransferId, 'TIMEOUT', 300_000);
      await pool.query(
        'UPDATE interbank_sends SET verdict_enqueued_at = $2 WHERE interbank_transfer_id = $1',
        [abierto.send.interbankTransferId, now],
      );

      expect(await repository.claimUnreconciled(new Date(now.getTime() - 120_000), 10)).toEqual(
        [],
      );
    });

    it('no toca el que todavía espera, ni el ya compensado', async () => {
      const esperando = await repository.open({ send: nuevo(), now });
      const compensado = await repository.open({ send: nuevo(), now });
      await comoAntesDeTD093(compensado.send.interbankTransferId, 'REVERSED', 300_000);

      const perdidos = await repository.claimUnreconciled(new Date(now.getTime() - 120_000), 10);

      expect(perdidos).toEqual([]);
      expect((await repository.find(esperando.send.interbankTransferId))?.state).toBe('PENDING');
    });

    it('encola el veredicto una sola vez, aunque dos barridos coincidan', async () => {
      const abierto = await repository.open({ send: nuevo(), now });
      await comoAntesDeTD093(abierto.send.interbankTransferId, 'TIMEOUT', 300_000);

      const dos = await Promise.all([
        repository.enqueueVerdict({
          interbankTransferId: abierto.send.interbankTransferId,
          outbound: [mensaje('payment.failed.v1')],
          now,
        }),
        repository.enqueueVerdict({
          interbankTransferId: abierto.send.interbankTransferId,
          outbound: [mensaje('payment.failed.v1')],
          now,
        }),
      ]);

      /*
       * Uno gana y el otro no. Es la misma garantía que el `from` de `advance`,
       * aplicada a la marca: dos réplicas barriendo a la vez no pueden publicar
       * el mismo veredicto dos veces con dos `messageId` distintos — que es lo
       * único que la deduplicación de Transaction no podría atrapar.
       */
      expect(dos.filter(Boolean)).toHaveLength(1);
      const encolado = await pool.query('SELECT 1 FROM outbox_messages');
      expect(encolado.rowCount).toBe(1);
    });
  });
});
