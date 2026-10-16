import { currentTraceparent } from '@bank/observability';
import type { MessageEnvelope } from '@bank/contracts';
import type { Pool, PoolClient } from 'pg';

import type {
  InterbankSend,
  InterbankSendRepository,
} from '../../application/interbank-send.ports';
import type { OutboxMessage } from '../../application/ports';
import type { InterbankSendState } from '../../domain/interbank-send';

interface Row {
  readonly interbank_transfer_id: string;
  readonly payment_id: string;
  readonly transaction_id: string;
  readonly idempotency_key: string;
  readonly destination_bank_code: string;
  readonly destination_account: string;
  readonly amount_minor: string;
  readonly currency: string;
  readonly correlation_id: string;
  readonly origin_envelope: MessageEnvelope<unknown>;
  readonly state: InterbankSendState;
  readonly reason: string | null;
  readonly attempts: number;
  readonly confirmation_due_at: Date;
  readonly trace_context: string | null;
  readonly created_at: Date;
  readonly verdict_enqueued_at: Date | null;
}

const COLUMNS = `interbank_transfer_id, payment_id, transaction_id, idempotency_key,
                 destination_bank_code, destination_account, amount_minor, currency,
                 correlation_id, origin_envelope, state, reason, attempts,
                 confirmation_due_at, trace_context, created_at, verdict_enqueued_at`;

/**
 * `amount_minor` es `BIGINT`, y el driver lo entrega como **cadena** para no
 * perder precisión en un `number` de JavaScript. Convertirlo aquí, en el borde,
 * es lo que mantiene la regla del repositorio: ningún `float` toca el dinero, y
 * el resto del servicio ve centavos enteros.
 */
function toSend(row: Row): InterbankSend {
  return {
    interbankTransferId: row.interbank_transfer_id,
    paymentId: row.payment_id,
    transactionId: row.transaction_id,
    idempotencyKey: row.idempotency_key,
    destinationBankCode: row.destination_bank_code,
    destinationAccount: row.destination_account,
    amount: { amountMinor: Number(row.amount_minor), currency: row.currency },
    correlationId: row.correlation_id,
    state: row.state,
    reason: row.reason,
    attempts: row.attempts,
    confirmationDueAt: row.confirmation_due_at,
    createdAt: row.created_at,
    traceContext: row.trace_context,
    verdictEnqueuedAt: row.verdict_enqueued_at,
    origin: row.origin_envelope,
  };
}

/** Los depósitos que este banco envía al banco pareja, y su calendario. */
export class PostgresInterbankSendRepository implements InterbankSendRepository {
  constructor(readonly pool: Pool) {}

  /**
   * `ON CONFLICT DO NOTHING` y después leer: el comando puede reentregarse, y
   * la clave primaria es el `interbankTransferId` que generó el Gateway, así
   * que el mismo depósito pedido dos veces **es** un depósito. Lo que no se
   * hace es `ON CONFLICT DO UPDATE`: eso reabriría un depósito ya decidido.
   */
  async open(input: {
    send: Omit<InterbankSend, 'state' | 'reason' | 'attempts' | 'verdictEnqueuedAt'>;
    now: Date;
  }): Promise<{ kind: 'CREATED' | 'DUPLICATE'; send: InterbankSend }> {
    const s = input.send;
    const inserted = await this.pool.query<Row>(
      `INSERT INTO interbank_sends
         (interbank_transfer_id, payment_id, transaction_id, idempotency_key,
          destination_bank_code, destination_account, amount_minor, currency,
          correlation_id, origin_envelope, state, reason, attempts,
          next_attempt_at, confirmation_due_at, trace_context, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,'PENDING',NULL,0,$11,$12,$13,$11)
       ON CONFLICT DO NOTHING
       RETURNING ${COLUMNS}`,
      [
        s.interbankTransferId,
        s.paymentId,
        s.transactionId,
        s.idempotencyKey,
        s.destinationBankCode,
        s.destinationAccount,
        s.amount.amountMinor,
        s.amount.currency,
        s.correlationId,
        JSON.stringify(s.origin),
        input.now,
        s.confirmationDueAt,
        s.traceContext,
      ],
    );

    const row = inserted.rows[0];

    if (row !== undefined) {
      return { kind: 'CREATED', send: toSend(row) };
    }

    const existing = await this.find(s.interbankTransferId);

    if (existing === null) {
      /*
       * El `INSERT` no entró y la fila no existe por su clave primaria: el
       * conflicto fue en una de las dos claves únicas secundarias
       * (`payment_id` o `idempotency_key`). Es un depósito distinto reclamando
       * una identidad ajena, y seguir sería acreditar sobre la fila de otro.
       */
      throw new Error(
        `El deposito ${s.interbankTransferId} choca con una identidad que ya existe.`,
      );
    }

    return { kind: 'DUPLICATE', send: existing };
  }

  async find(interbankTransferId: string): Promise<InterbankSend | null> {
    const found = await this.pool.query<Row>(
      `SELECT ${COLUMNS} FROM interbank_sends WHERE interbank_transfer_id = $1`,
      [interbankTransferId],
    );

    return found.rows[0] === undefined ? null : toSend(found.rows[0]);
  }

  async findByTransaction(transactionId: string): Promise<InterbankSend | null> {
    const found = await this.pool.query<Row>(
      `SELECT ${COLUMNS} FROM interbank_sends WHERE transaction_id = $1`,
      [transactionId],
    );

    return found.rows[0] === undefined ? null : toSend(found.rows[0]);
  }

  /**
   * El guardia de estado, en el `WHERE`.
   *
   * `WHERE state = $from` es lo que hace que dos transiciones legales por
   * separado —un callback y el vencimiento del mismo depósito, llegando a la
   * vez— no se apliquen las dos. La que pierde afecta cero filas, se entera por
   * el `rowCount` y no publica nada. Sin esto, la Saga vería dos finales para
   * el mismo pago.
   *
   * `decided_at` y `reversed_at` se escriben aquí y no los decide el llamador:
   * son consecuencia del estado, y los `CHECK` de la tabla no admiten otra cosa.
   */
  /**
   * Mueve el depósito y escribe sus eventos **en la misma transacción**
   * (TD-093).
   *
   * El `UPDATE` con su guardia de estado era ya correcto; lo que faltaba era
   * que el evento viajara con él. Antes el caso de uso movía la fila y después
   * publicaba, y el hueco entre las dos cosas se cobró Q1.00 el 2026-10-15:
   * el proceso murió en medio, el veredicto se perdió y la fila —ya decidida—
   * quedó fuera de los dos barridos para siempre.
   *
   * Nótese el orden: el `UPDATE` primero y el outbox **sólo si movió**. Un
   * evento escrito junto a un `UPDATE` que no cambió nada sería un veredicto
   * publicado por el que perdió la carrera, y la Saga vería dos finales.
   */
  async advance(input: {
    interbankTransferId: string;
    from: InterbankSendState;
    to: InterbankSendState;
    reason: string | null;
    nextAttemptAt: Date | null;
    now: Date;
    outbound?: readonly OutboxMessage[];
  }): Promise<boolean> {
    const decided = ['ACCEPTED', 'REJECTED', 'TIMEOUT', 'REVERSED'].includes(input.to);
    const client = await this.pool.connect();

    try {
      await client.query('BEGIN');

      const moved = await client.query(
        /*
         * Los `::text` no son decoración. Sin ellos, `$3` se usa a la vez para
         * asignar una columna `VARCHAR(12)` y para comparar contra literales, y
         * PostgreSQL se niega: «inconsistent types deduced for parameter $3». El
         * doble en los tests y `helm template` lo dejaban pasar; lo encontró la
         * suite de integración contra una base de verdad, que es exactamente para
         * lo que está.
         */
        `UPDATE interbank_sends
            SET state = $3::text,
                reason = $4,
                attempts = attempts + 1,
                next_attempt_at = $5,
                sent_at = CASE WHEN $3::text = 'SENT' AND sent_at IS NULL THEN $6 ELSE sent_at END,
                decided_at = CASE WHEN $7 THEN COALESCE(decided_at, $6) ELSE decided_at END,
                reversed_at = CASE WHEN $3::text = 'REVERSED' THEN $6 ELSE reversed_at END,
                /*
                 * La marca del veredicto, y sólo cuando este cambio trae los
                 * eventos consigo. Es la condición que el barrido de
                 * reconciliación niega, así que escribirla sin haber encolado
                 * nada apagaría la red de seguridad en silencio.
                 */
                verdict_enqueued_at = CASE
                  WHEN $7 AND $8 THEN COALESCE(verdict_enqueued_at, $6)
                  ELSE verdict_enqueued_at
                END
          WHERE interbank_transfer_id = $1
            AND state = $2::text`,
        [
          input.interbankTransferId,
          input.from,
          input.to,
          input.reason,
          input.nextAttemptAt,
          input.now,
          decided,
          (input.outbound?.length ?? 0) > 0,
        ],
      );

      if ((moved.rowCount ?? 0) === 0) {
        await client.query('ROLLBACK');

        return false;
      }

      for (const message of input.outbound ?? []) {
        await this.#insertOutbox(client, message);
      }

      await client.query('COMMIT');

      return true;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);

      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Los decididos cuyo veredicto nunca llegó al outbox (TD-093, pieza b).
   *
   * `verdict_enqueued_at IS NULL` sobre un estado ya decidido es la condición
   * exacta: con (a) puesto, ninguna fila nueva puede cumplirla. Lee por el
   * índice parcial `interbank_sends_unreconciled_idx`, que en régimen normal
   * está vacío.
   */
  async claimUnreconciled(olderThan: Date, limit: number): Promise<readonly InterbankSend[]> {
    const pendientes = await this.pool.query<Row>(
      `SELECT ${COLUMNS} FROM interbank_sends
        WHERE state IN ('ACCEPTED','REJECTED','TIMEOUT')
          AND verdict_enqueued_at IS NULL
          AND decided_at <= $1
        ORDER BY decided_at
        FOR UPDATE SKIP LOCKED
        LIMIT $2`,
      [olderThan, limit],
    );

    return pendientes.rows.map(toSend);
  }

  /**
   * Encola el veredicto que se perdió, y marca la fila para que no vuelva.
   *
   * La marca va en el `WHERE` además del `SET`: dos réplicas barriendo a la vez
   * no pueden encolar el mismo veredicto dos veces, igual que el `from` de
   * `advance` impide dos transiciones simultáneas.
   */
  async enqueueVerdict(input: {
    interbankTransferId: string;
    outbound: readonly OutboxMessage[];
    now: Date;
  }): Promise<boolean> {
    const client = await this.pool.connect();

    try {
      await client.query('BEGIN');

      const marked = await client.query(
        `UPDATE interbank_sends
            SET verdict_enqueued_at = $2
          WHERE interbank_transfer_id = $1
            AND verdict_enqueued_at IS NULL`,
        [input.interbankTransferId, input.now],
      );

      if ((marked.rowCount ?? 0) === 0) {
        await client.query('ROLLBACK');

        return false;
      }

      for (const message of input.outbound) {
        await this.#insertOutbox(client, message);
      }

      await client.query('COMMIT');

      return true;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);

      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Una fila del outbox, en la transacción que la llama.
   *
   * `payment_id` va **nulo** a propósito: un depósito interbancario no tiene
   * fila en `payments`, y la migración 014 quitó el `NOT NULL` justo por esto.
   * Los identificadores viajan dentro del envelope, que es lo que el relay
   * publica.
   */
  async #insertOutbox(client: PoolClient, message: OutboxMessage): Promise<void> {
    await client.query(
      `INSERT INTO outbox_messages (payment_id, exchange, routing_key, envelope, trace_context)
       VALUES (NULL, $1, $2, $3::JSONB, $4)`,
      [
        message.exchange,
        message.routingKey,
        JSON.stringify(message.envelope),
        currentTraceparent(),
      ],
    );
  }

  /**
   * Los pendientes que toca reintentar, tomados con `SKIP LOCKED`.
   *
   * `SKIP LOCKED` es lo que permite más de una réplica sin que las dos manden
   * el mismo depósito: la que llega segunda no espera, se lleva otras filas.
   */
  async claimSendable(now: Date, limit: number): Promise<readonly InterbankSend[]> {
    const due = await this.pool.query<Row>(
      `SELECT ${COLUMNS} FROM interbank_sends
        WHERE state = 'PENDING' AND next_attempt_at <= $1
        ORDER BY next_attempt_at
        FOR UPDATE SKIP LOCKED
        LIMIT $2`,
      [now, limit],
    );

    return due.rows.map(toSend);
  }

  async claimExpired(now: Date, limit: number): Promise<readonly InterbankSend[]> {
    const due = await this.pool.query<Row>(
      `SELECT ${COLUMNS} FROM interbank_sends
        WHERE state IN ('PENDING','SENT') AND confirmation_due_at <= $1
        ORDER BY confirmation_due_at
        FOR UPDATE SKIP LOCKED
        LIMIT $2`,
      [now, limit],
    );

    return due.rows.map(toSend);
  }
}
