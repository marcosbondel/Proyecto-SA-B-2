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
    await pool.query('TRUNCATE interbank_send_history');
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
      Omit<
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
      >
    > = {},
  ) {
    return {
      interbankTransferId: randomUUID(),
      paymentId: randomUUID(),
      transactionId: randomUUID(),
      idempotencyKey: randomUUID(),
      destinationBankCode: 'BANK99',
      destinationAccount: 'cuenta-de-alla-1',
      originAccount: '02-000000052',
      customerId: null,
      amount: { amountMinor: 12_500, currency: 'GTQ' },
      correlationId: randomUUID(),
      // Los plazos del contrato, no los 30 s de antes de TD-095.
      confirmationDueAt: new Date(now.getTime() + 180_000),
      releaseNotBefore: new Date(now.getTime() + 180_000 + 300_000),
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

    const fila = await pool.query<{
      next_attempt_at: Date;
      confirmation_due_at: Date;
      release_not_before: Date;
    }>(
      `SELECT next_attempt_at, confirmation_due_at, release_not_before
         FROM interbank_sends WHERE interbank_transfer_id = $1`,
      [abierto.send.interbankTransferId],
    );

    // El plazo es una COLUMNA, que es todo el punto: un pod nuevo lo encuentra.
    expect(fila.rows[0]?.next_attempt_at).toEqual(now);
    // 180 s del contrato, no los 30 s que ponía una variable de entorno
    // (TD-095). Un plazo de interoperabilidad que cada banco configura a su
    // gusto no es un plazo.
    expect(fila.rows[0]?.confirmation_due_at).toEqual(new Date(now.getTime() + 180_000));
    // Y el margen antes de poder liberar a ciegas: 300 s más, también columna.
    expect(fila.rows[0]?.release_not_before).toEqual(new Date(now.getTime() + 480_000));
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
    // Nacen arrendados a quien los entrega en línea; aquí esa entrega ya terminó.
    await pool.query('UPDATE interbank_sends SET claimed_until = NULL');

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

    const expirados = await repository.claimExpired(new Date(now.getTime() + 180_001), 10);
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

      /*
       * `REJECTED` y no `TIMEOUT`: desde TD-095 un vencimiento NO es un
       * veredicto —el dinero sigue reservado mientras el protocolo pregunta— así
       * que no lleva final para la Saga ni pone la marca. El veredicto que se
       * encola aquí es un rechazo de verdad.
       */
      const movido = await repository.advance({
        interbankTransferId: abierto.send.interbankTransferId,
        from: 'PENDING',
        to: 'REJECTED',
        reason: 'ACCOUNT_NOT_FOUND',
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
      expect(fila?.state).toBe('REJECTED');
      expect(fila?.verdictEnqueuedAt).not.toBeNull();
    });

    it('un vencimiento encola su auditoría pero no pone la marca', async () => {
      const abierto = await repository.open({ send: nuevo(), now });

      await repository.advance({
        interbankTransferId: abierto.send.interbankTransferId,
        from: 'PENDING',
        to: 'TIMEOUT',
        reason: 'CONFIRMATION_TIMEOUT',
        nextAttemptAt: null,
        now,
        outbound: [mensaje('payment.interbank.sent.v1')],
      });

      /*
       * El punto exacto donde TD-093 y TD-095 se tocan, contra la base de datos.
       *
       * El evento de auditoría sí se encola —el cambio de estado se audita— y la
       * marca del veredicto NO se pone, porque no hay veredicto: el depósito
       * está esperando a que el protocolo lo resuelva. La primera versión de
       * esto usaba `outbound.length > 0` como atajo y marcaba la fila, apagando
       * en silencio la red de seguridad de TD-093 para ese depósito.
       */
      const fila = await repository.find(abierto.send.interbankTransferId);
      expect(fila?.state).toBe('TIMEOUT');
      expect(fila?.verdictEnqueuedAt).toBeNull();
      expect((await pool.query('SELECT 1 FROM outbox_messages')).rowCount).toBe(1);

      // Y no se reconcilia: no hay nada que reemitir.
      expect(await repository.claimUnreconciled(new Date(now.getTime() + 600_000), 10, now)).toEqual(
        [],
      );
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
      const motivo = estado === 'ACCEPTED' ? null : 'ACCOUNT_NOT_FOUND';

      await pool.query(
        `UPDATE interbank_sends
            SET state = $2::text,
                decided_at = $3::timestamptz,
                verdict_enqueued_at = NULL,
                reason = $4,
                next_attempt_at = NULL,
                claimed_until = NULL,
                -- Los dos casts, por lo mismo que lleva advance: un parametro
                -- que asigna a una columna y aparece en un CASE a la vez deja a
                -- PostgreSQL sin tipo que deducir. Hizo falta en los dos, y el
                -- comentario del repositorio ya avisaba del primero.
                reversed_at = CASE WHEN $2::text = 'REVERSED' THEN $3::timestamptz ELSE NULL END
          WHERE interbank_transfer_id = $1`,
        [id, estado, decidido, motivo],
      );
    }

    it('encuentra el decidido sin veredicto, pasado el margen', async () => {
      const abierto = await repository.open({ send: nuevo(), now });
      await comoAntesDeTD093(abierto.send.interbankTransferId, 'REJECTED', 300_000);

      const perdidos = await repository.claimUnreconciled(new Date(now.getTime() - 120_000), 10, now);

      expect(perdidos.map((p) => p.interbankTransferId)).toEqual([
        abierto.send.interbankTransferId,
      ]);
    });

    it('no toca el que ya tiene su veredicto encolado', async () => {
      const abierto = await repository.open({ send: nuevo(), now });
      await comoAntesDeTD093(abierto.send.interbankTransferId, 'REJECTED', 300_000);
      await pool.query(
        'UPDATE interbank_sends SET verdict_enqueued_at = $2 WHERE interbank_transfer_id = $1',
        [abierto.send.interbankTransferId, now],
      );

      expect(await repository.claimUnreconciled(new Date(now.getTime() - 120_000), 10, now)).toEqual(
        [],
      );
    });

    it('no toca el que todavía espera, ni el ya compensado', async () => {
      const esperando = await repository.open({ send: nuevo(), now });
      const compensado = await repository.open({ send: nuevo(), now });
      await comoAntesDeTD093(compensado.send.interbankTransferId, 'REVERSED', 300_000);

      const perdidos = await repository.claimUnreconciled(new Date(now.getTime() - 120_000), 10, now);

      expect(perdidos).toEqual([]);
      expect((await repository.find(esperando.send.interbankTransferId))?.state).toBe('PENDING');
    });

    it('encola el veredicto una sola vez, aunque dos barridos coincidan', async () => {
      const abierto = await repository.open({ send: nuevo(), now });
      await comoAntesDeTD093(abierto.send.interbankTransferId, 'REJECTED', 300_000);

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
  /**
   * Lo que T-60 añade a la persistencia del depósito enviado.
   */
  describe('REVERSED es alcanzable (T-60)', () => {
    it('la compensación escribe REVERSED y conserva el motivo con el que se liberó', async () => {
      /*
       * El dominio emite `COMPENSATED` sin motivo, y el CHECK de la tabla exige
       * motivo en REVERSED: hasta T-60 el `UPDATE` ponía `reason = NULL` y la
       * base lo rechazaba, así que REVERSED era inalcanzable en producción y la
       * compensación se reintentaba hasta la cola muerta. Los dobles del caso de
       * uso no tienen CHECK y nunca lo vieron; sólo esta suite, contra una base
       * de verdad.
       */
      const abierto = await repository.open({ send: nuevo(), now });
      const id = abierto.send.interbankTransferId;
      await repository.advance({ interbankTransferId: id, from: 'PENDING', to: 'SENT', reason: null, nextAttemptAt: null, now });
      await repository.advance({
        interbankTransferId: id,
        from: 'SENT',
        to: 'REJECTED',
        reason: 'CANCELLED_AT_PARTNER',
        nextAttemptAt: null,
        now,
      });

      const movido = await repository.advance({
        interbankTransferId: id,
        from: 'REJECTED',
        to: 'REVERSED',
        reason: null,
        nextAttemptAt: null,
        now,
      });

      expect(movido).toBe(true);
      const fila = await repository.find(id);
      expect(fila?.state).toBe('REVERSED');
      expect(fila?.reason).toBe('CANCELLED_AT_PARTNER');
      expect(fila?.reversedAt).toEqual(now);
    });
  });

  describe('el historial de estados', () => {
    it('anota cada cambio, en orden, y no anota el que no cambia nada', async () => {
      const abierto = await repository.open({ send: nuevo(), now });
      const id = abierto.send.interbankTransferId;
      const paso = (n: number): Date => new Date(now.getTime() + n * 1_000);

      // Un reintento de entrega: PENDING -> PENDING no es un cambio de estado.
      await repository.advance({ interbankTransferId: id, from: 'PENDING', to: 'PENDING', reason: 'ECONNREFUSED', nextAttemptAt: paso(1), now: paso(1) });
      await repository.advance({ interbankTransferId: id, from: 'PENDING', to: 'SENT', reason: null, nextAttemptAt: null, now: paso(2) });
      await repository.advance({ interbankTransferId: id, from: 'SENT', to: 'TIMEOUT', reason: 'CONFIRMATION_TIMEOUT', nextAttemptAt: null, now: paso(3) });
      await repository.advance({ interbankTransferId: id, from: 'TIMEOUT', to: 'ACCEPTED', reason: null, nextAttemptAt: null, now: paso(4) });

      const historial = await repository.history(id);

      expect(historial.map((h) => h.state)).toEqual(['PENDING', 'SENT', 'TIMEOUT', 'ACCEPTED']);
      expect(historial[2]?.reason).toBe('CONFIRMATION_TIMEOUT');
    });

    it('el que pierde el guardia de estado no deja historial', async () => {
      const abierto = await repository.open({ send: nuevo(), now });
      const id = abierto.send.interbankTransferId;

      await repository.advance({ interbankTransferId: id, from: 'ACCEPTED', to: 'REVERSED', reason: null, nextAttemptAt: null, now });

      expect((await repository.history(id)).map((h) => h.state)).toEqual(['PENDING']);
    });
  });

  describe('quién ve qué (B10)', () => {
    const ANA = '00000000-0000-4000-8000-0000000000a1';
    const BETO = '00000000-0000-4000-8000-0000000000b2';

    it('un cliente ve los suyos y el personal ve todos', async () => {
      await repository.open({ send: nuevo({ customerId: ANA }), now });
      await repository.open({ send: nuevo({ customerId: ANA }), now });
      await repository.open({ send: nuevo({ customerId: BETO }), now });

      expect(await repository.list({ customerId: ANA, limit: 50 })).toHaveLength(2);
      expect(await repository.list({ customerId: BETO, limit: 50 })).toHaveLength(1);
      expect(await repository.list({ customerId: null, limit: 50 })).toHaveLength(3);
    });

    it('filtra por estado y respeta el límite', async () => {
      const a = await repository.open({ send: nuevo({ customerId: ANA }), now });
      await repository.open({ send: nuevo({ customerId: ANA }), now });
      await repository.advance({ interbankTransferId: a.send.interbankTransferId, from: 'PENDING', to: 'SENT', reason: null, nextAttemptAt: null, now });

      expect(await repository.list({ customerId: ANA, state: 'SENT', limit: 50 })).toHaveLength(1);
      expect(await repository.list({ customerId: ANA, limit: 1 })).toHaveLength(1);
    });

    it('guarda el cliente y la cuenta origen del depósito', async () => {
      const abierto = await repository.open({ send: nuevo({ customerId: ANA }), now });

      const fila = await repository.find(abierto.send.interbankTransferId);

      expect(fila?.customerId).toBe(ANA);
      expect(fila?.originAccount).toBe('02-000000052');
    });
  });

  describe('el protocolo de TIMEOUT cuenta sus intentos', () => {
    it('suma una consulta y una cancelación por cada vez, y no más', async () => {
      const abierto = await repository.open({ send: nuevo(), now });
      const id = abierto.send.interbankTransferId;
      await repository.advance({ interbankTransferId: id, from: 'PENDING', to: 'TIMEOUT', reason: 'CONFIRMATION_TIMEOUT', nextAttemptAt: null, now });

      await repository.recordResolutionStep({ interbankTransferId: id, probe: { kind: 'UNREACHABLE' }, resolveNotBefore: now, now });
      await repository.recordResolutionStep({ interbankTransferId: id, probe: { kind: 'UNREACHABLE' }, resolveNotBefore: now, now });
      await repository.recordResolutionStep({ interbankTransferId: id, cancel: { kind: 'UNREACHABLE' }, resolveNotBefore: now, now });

      const fila = await repository.find(id);

      expect(fila?.probeAttempts).toBe(2);
      expect(fila?.cancelAttempts).toBe(1);
    });
  });

  describe('el reverso del paso 5', () => {
    async function liberado() {
      const abierto = await repository.open({ send: nuevo(), now });
      const id = abierto.send.interbankTransferId;
      await repository.advance({ interbankTransferId: id, from: 'PENDING', to: 'TIMEOUT', reason: 'CONFIRMATION_TIMEOUT', nextAttemptAt: null, now });
      await repository.advance({ interbankTransferId: id, from: 'TIMEOUT', to: 'REJECTED', reason: 'RELEASED_NO_ANSWER', nextAttemptAt: null, now });

      return id;
    }

    it('se pide una sola vez por depósito, aunque lleguen dos ACCEPTED tardíos a la vez', async () => {
      const id = await liberado();
      const reversalId = randomUUID();

      const dos = await Promise.all([
        repository.requestReversal({ interbankTransferId: id, reversalId, now }),
        repository.requestReversal({ interbankTransferId: id, reversalId, now }),
      ]);

      expect(dos.filter(Boolean)).toHaveLength(1);
      expect((await repository.find(id))?.reversal).toMatchObject({ reversalId, state: 'PENDING' });
    });

    it('no se pide de un depósito que no se ha liberado', async () => {
      const abierto = await repository.open({ send: nuevo(), now });

      expect(
        await repository.requestReversal({
          interbankTransferId: abierto.send.interbankTransferId,
          reversalId: randomUUID(),
          now,
        }),
      ).toBe(false);
    });

    it('claimReversals arrienda la fila: dos barridos no piden el mismo reverso a la vez', async () => {
      const id = await liberado();
      await repository.requestReversal({ interbankTransferId: id, reversalId: randomUUID(), now });

      const primero = await repository.claimReversals(now, 10);
      const segundo = await repository.claimReversals(now, 10);

      expect(primero.map((f) => f.interbankTransferId)).toEqual([id]);
      expect(segundo).toEqual([]);
    });

    it('guarda en qué quedó y deja de reclamarlo al completarse', async () => {
      const id = await liberado();
      await repository.requestReversal({ interbankTransferId: id, reversalId: randomUUID(), now });
      const refund = randomUUID();

      await repository.recordReversalStep({
        interbankTransferId: id,
        state: 'COMPLETED',
        refundTransferId: refund,
        message: null,
        nextAt: null,
        now,
      });

      expect((await repository.find(id))?.reversal).toMatchObject({
        state: 'COMPLETED',
        refundTransferId: refund,
        attempts: 1,
      });
      expect(await repository.claimReversals(new Date(now.getTime() + 3_600_000), 10)).toEqual([]);
    });

    it('la base se niega a un reverso sobre un depósito que sigue siendo nuestro', async () => {
      const abierto = await repository.open({ send: nuevo(), now });

      await expect(
        pool.query(
          `UPDATE interbank_sends SET reversal_id = $2, reversal_state = 'PENDING'
            WHERE interbank_transfer_id = $1`,
          [abierto.send.interbankTransferId, randomUUID()],
        ),
      ).rejects.toThrow(/reversal_after_release/);
    });
  });
});
