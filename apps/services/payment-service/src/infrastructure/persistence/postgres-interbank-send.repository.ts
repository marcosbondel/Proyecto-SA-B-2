import type { MessageEnvelope } from '@bank/contracts';
import type { Pool } from 'pg';

import type {
  InterbankSend,
  InterbankSendRepository,
} from '../../application/interbank-send.ports';
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
}

const COLUMNS = `interbank_transfer_id, payment_id, transaction_id, idempotency_key,
                 destination_bank_code, destination_account, amount_minor, currency,
                 correlation_id, origin_envelope, state, reason, attempts,
                 confirmation_due_at, trace_context, created_at`;

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
    send: Omit<InterbankSend, 'state' | 'reason' | 'attempts'>;
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
  async advance(input: {
    interbankTransferId: string;
    from: InterbankSendState;
    to: InterbankSendState;
    reason: string | null;
    nextAttemptAt: Date | null;
    now: Date;
  }): Promise<boolean> {
    const decided = ['ACCEPTED', 'REJECTED', 'TIMEOUT', 'REVERSED'].includes(input.to);
    const moved = await this.pool.query(
      `UPDATE interbank_sends
          SET state = $3,
              reason = $4,
              attempts = attempts + 1,
              next_attempt_at = $5,
              sent_at = CASE WHEN $3 = 'SENT' AND sent_at IS NULL THEN $6 ELSE sent_at END,
              decided_at = CASE WHEN $7 THEN COALESCE(decided_at, $6) ELSE decided_at END,
              reversed_at = CASE WHEN $3 = 'REVERSED' THEN $6 ELSE reversed_at END
        WHERE interbank_transfer_id = $1
          AND state = $2`,
      [
        input.interbankTransferId,
        input.from,
        input.to,
        input.reason,
        input.nextAttemptAt,
        input.now,
        decided,
      ],
    );

    return (moved.rowCount ?? 0) > 0;
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
