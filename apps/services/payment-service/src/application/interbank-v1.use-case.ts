import { randomUUID } from 'node:crypto';

import {
  paymentInterbankRejectedV1,
  paymentInterbankV1CancelRepliedV1,
  paymentInterbankV1ReconciliationRepliedV1,
  paymentInterbankV1ReversalRepliedV1,
  paymentInterbankV1StatusRepliedV1,
  paymentInterbankV1TransferRepliedV1,
  v1AmountFromMinor,
  v1AmountToMinor,
  V1_MAX_AMOUNT_MINOR,
  V1_MIN_AMOUNT_MINOR,
} from '@bank/contracts';
import type {
  MessageEnvelope,
  PaymentInterbankV1CancelQueryV1,
  PaymentInterbankV1ReconciliationQueryV1,
  PaymentInterbankV1ReversalQueryV1,
  PaymentInterbankV1ReversalRequestedV1,
  PaymentInterbankV1StatusQueryV1,
  PaymentInterbankV1TransferQueryV1,
  V1CancelResult,
  V1ReasonCode,
  V1TransferRequest,
} from '@bank/contracts';

import { v1ReasonOf } from '../domain/interbank-receipt';
import type { InterbankReceiptRejection } from '../domain/interbank-receipt';
import type { InterbankMessenger } from './interbank.ports';
import type { InterbankV1Repository, V1DepositRow, V1Reversal } from './interbank-v1.ports';

/**
 * Las siete operaciones del contrato interbancario oficial, del lado que
 * **decide** (T-56).
 *
 * El Gateway tradujo la forma; aquí se decide el fondo. Qué se admite, en qué
 * estado queda, si se puede cancelar y qué se le contesta a quien pregunta son
 * preguntas de este servicio, porque es el que tiene las filas.
 *
 * Lo que este archivo **no** hace es decidir transiciones: eso es
 * `domain/interbank-receipt.ts`, que es puro. Aquí se persiste lo que la
 * función pura dijo, se publica lo que corresponda y se contesta.
 */
export class InterbankV1UseCase {
  readonly #repository: InterbankV1Repository;
  readonly #messenger: InterbankMessenger;
  readonly #reply: (messageType: string, payload: unknown) => Promise<void>;
  readonly #bankCode: string;
  readonly #maxAmountMinor: number;
  readonly #clock: () => Date;
  readonly #log: {
    info(message: string, fields: Record<string, unknown>): void;
    warn(message: string, fields: Record<string, unknown>): void;
    error(message: string, fields: Record<string, unknown>): void;
  };

  constructor(deps: {
    readonly repository: InterbankV1Repository;
    /** Construye los eventos de resultado (auditoría) que viajan con una decisión. */
    readonly messenger: InterbankMessenger;
    readonly reply: (messageType: string, payload: unknown) => Promise<void>;
    readonly bankCode: string;
    readonly maxAmountMinor?: number;
    readonly clock?: () => Date;
    readonly log: {
      info(message: string, fields: Record<string, unknown>): void;
      warn(message: string, fields: Record<string, unknown>): void;
      error(message: string, fields: Record<string, unknown>): void;
    };
  }) {
    this.#repository = deps.repository;
    this.#messenger = deps.messenger;
    this.#reply = deps.reply;
    this.#bankCode = deps.bankCode;
    this.#maxAmountMinor = deps.maxAmountMinor ?? V1_MAX_AMOUNT_MINOR;
    this.#clock = deps.clock ?? ((): Date => new Date());
    this.#log = deps.log;
  }

  /** `POST /transfers` — admitir o no, y decirlo. */
  async transfer(
    query: PaymentInterbankV1TransferQueryV1,
    cause: MessageEnvelope<unknown>,
  ): Promise<void> {
    const now = this.#clock();
    const depositId = randomUUID();
    /*
     * La política del contrato se aplica **al entrar** (B7): banco destino
     * equivocado, moneda y monto. Antes `rejectionFor` existía y nadie la
     * llamaba, así que un depósito dirigido a otro banco se acreditaba como si
     * fuera nuestro. Un rechazo se guarda ya decidido y se cuenta por callback;
     * el `202` ya se dio — «el resultado de negocio se informa después».
     */
    const razon = this.rejectionFor(query.transfer, query.callerBankCode);
    const resultado = await this.#repository.admit({
      depositId,
      transfer: query.transfer,
      callerBankCode: query.callerBankCode,
      origin: cause,
      rejection:
        razon === null
          ? null
          : { reason: razon, result: this.#rejectionResult(cause, depositId, razon, now) },
      now,
    });

    if (resultado.admission === 'CONFLICT') {
      this.#log.warn('interbank v1 transfer conflict', {
        interbankTransferId: query.transfer.interbankTransferId,
      });
      await this.#replyTransfer(query.transfer.interbankTransferId, 'CONFLICT', null, now);
      return;
    }

    if (resultado.admission === 'DUPLICATE') {
      await this.#replyTransfer(
        query.transfer.interbankTransferId,
        'DUPLICATE',
        resultado.row,
        now,
      );
      return;
    }

    await this.#replyTransfer(
      query.transfer.interbankTransferId,
      'ACCEPTED_FOR_PROCESSING',
      null,
      now,
    );
  }

  /** `GET /transfers/{id}`. */
  async status(query: PaymentInterbankV1StatusQueryV1): Promise<void> {
    const row = await this.#repository.findForBank(query.interbankTransferId, query.callerBankCode);

    await this.#reply(paymentInterbankV1StatusRepliedV1.name, {
      interbankTransferId: query.interbankTransferId,
      found: row !== null,
      status: row?.status ?? null,
      reasonCode: row?.reasonCode ?? null,
      updatedAt: row === null ? null : row.updatedAt.toISOString(),
    });
  }

  /**
   * `POST /transfers/{id}/cancel`.
   *
   * Las tres respuestas no son matices, son instrucciones distintas para el
   * emisor: `CANCELLED` le dice que libere la reserva, `ALREADY_ACCEPTED` que
   * **confirme el débito**, y `ALREADY_REJECTED` que libere. Contestar la
   * equivocada le hace perder dinero o duplicarlo.
   *
   * Un depósito que no existe se contesta `CANCELLED`, y es deliberado: el
   * contrato dice que el receptor «guarda el id y rechaza cualquier llegada
   * posterior del mensaje original». Decir «no lo tengo» y no guardar nada
   * dejaría la puerta abierta a acreditarlo cuando llegue tarde, con el emisor
   * ya convencido de que nunca se procesó.
   */
  async cancel(query: PaymentInterbankV1CancelQueryV1): Promise<void> {
    const now = this.#clock();
    const row = await this.#repository.findForBank(query.interbankTransferId, query.callerBankCode);

    let result: V1CancelResult | 'IN_PROGRESS';

    if (row === null) {
      await this.#repository.admitCancellationOfUnknown({
        interbankTransferId: query.interbankTransferId,
        callerBankCode: query.callerBankCode,
        now,
      });
      result = 'CANCELLED';
    } else if (row.status === 'ACCEPTED') {
      result = 'ALREADY_ACCEPTED';
    } else if (row.status === 'REJECTED') {
      result = 'ALREADY_REJECTED';
    } else if (row.status === 'CANCELLED') {
      /* Idempotente por contrato: cancelar dos veces es cancelar una. */
      result = 'CANCELLED';
    } else if (row.stage === 'CREDIT') {
      /*
       * Ya hay una orden de crédito dada y Account acredita incondicionalmente.
       * Ni `CANCELLED` (liberaría la reserva del emisor mientras acreditamos) ni
       * `ALREADY_ACCEPTED` (todavía no es verdad): «vuelve a preguntar», que el
       * Gateway traduce al `503` con espera creciente del contrato (B4).
       */
      result = 'IN_PROGRESS';
    } else {
      const aplicado = await this.#repository.cancel({
        interbankTransferId: query.interbankTransferId,
        now,
        result:
          row.origin === null
            ? null
            : this.#rejectionResult(row.origin, row.depositId, 'CANCELLED', now),
      });
      /*
       * Si la cancelación no cambió nada es porque alguien decidió el depósito
       * entre la lectura y la escritura — la carrera que el `WHERE stage = …`
       * del repositorio existe para perder. Se vuelve a leer y se contesta lo
       * que de verdad quedó, nunca lo que se intentó.
       */
      result = aplicado
        ? 'CANCELLED'
        : resultOf(
            await this.#repository.findForBank(query.interbankTransferId, query.callerBankCode),
          );
    }

    this.#log.info('interbank v1 cancel decided', {
      interbankTransferId: query.interbankTransferId,
      outcome: result,
    });

    await this.#reply(paymentInterbankV1CancelRepliedV1.name, {
      interbankTransferId: query.interbankTransferId,
      result,
    });
  }

  /** `POST /reversals` — registrar la devolución pedida. */
  async requestReversal(command: PaymentInterbankV1ReversalRequestedV1): Promise<void> {
    const now = this.#clock();
    const amountMinor = v1AmountToMinor(command.amount);
    const original = await this.#repository.findForBank(
      command.originalTransferId,
      command.callerBankCode,
    );

    if (original === null || amountMinor === null) {
      await this.#replyReversal(command.reversalId, null);
      return;
    }

    /*
     * El contrato lo llama «caso excepcional» y lo es, así que se registra en
     * nivel ERROR: significa que un callback nuestro llegó tan tarde que el
     * otro banco ya había liberado su reserva. No es un error de este mensaje
     * —es la consecuencia de uno anterior— y es exactamente lo que alguien
     * querría ver en la bitácora al reconciliar.
     */
    this.#log.error('interbank v1 reversal requested', {
      reversalId: command.reversalId,
      originalTransferId: command.originalTransferId,
    });

    const { reversal } = await this.#repository.openReversal({
      reversalId: command.reversalId,
      originalTransferId: command.originalTransferId,
      requesterBankCode: command.callerBankCode,
      amountMinor,
      origin: command,
      now,
    });

    await this.#replyReversal(command.reversalId, reversal);
  }

  /** `GET /reversals/{id}`. */
  async reversalStatus(query: PaymentInterbankV1ReversalQueryV1): Promise<void> {
    await this.#replyReversal(
      query.reversalId,
      await this.#repository.findReversal(query.reversalId, query.callerBankCode),
    );
  }

  /** `GET /reconciliation?date=`. */
  async reconciliation(query: PaymentInterbankV1ReconciliationQueryV1): Promise<void> {
    const { totalItems, items } = await this.#repository.reconcile(query);

    await this.#reply(paymentInterbankV1ReconciliationRepliedV1.name, {
      date: query.date,
      page: query.page,
      pageSize: query.pageSize,
      totalItems,
      items: items.map((row) => ({
        interbankTransferId: row.interbankTransferId,
        amount: v1AmountFromMinor(row.amountMinor),
        currency: 'GTQ' as const,
        status: row.status,
        updatedAt: row.updatedAt.toISOString(),
      })),
    });
  }

  /**
   * El barrido del vencimiento.
   *
   * Lo que el contrato convierte en obligación: «el receptor **no puede
   * acreditar después de `expiresAt`**, aunque el mensaje le llegue tarde
   * (reintento, DLQ). En ese caso debe responder el callback con `REJECTED` y
   * `reasonCode: EXPIRED`. Si acredita después del vencimiento, la
   * responsabilidad y la devolución son suyas.»
   *
   * Sin esto, un depósito que se quedó a medias —una respuesta de Account que
   * tardó, un pod que se reinició— acabaría acreditándose cuando el otro banco
   * ya liberó su reserva. El mismo dinero existiría dos veces, y la devolución
   * sería nuestra.
   */
  async sweepExpired(limit = 20): Promise<number> {
    const now = this.#clock();
    const vencidos = await this.#repository.claimExpired(now, limit);
    let cerrados = 0;

    for (const row of vencidos) {
      const aplicado = await this.#repository.expire({
        interbankTransferId: row.interbankTransferId,
        now,
        result:
          row.origin === null
            ? null
            : this.#rejectionResult(row.origin, row.depositId, 'EXPIRED', now),
      });

      if (aplicado) {
        cerrados += 1;
        this.#log.warn('interbank v1 deposit expired', {
          interbankTransferId: row.interbankTransferId,
          outcome: 'REJECTED/EXPIRED',
        });
      }
    }

    return cerrados;
  }

  /**
   * La política de admisión del contrato, en una función.
   *
   * Vive aquí y no en `domain/` porque es **de este contrato** y no de este
   * banco: si el curso publica una v2 con otros límites, esto cambia y el
   * dominio no. Lo que sí está en el dominio es qué significa cada estado.
   */
  rejectionFor(
    transfer: V1TransferRequest,
    callerBankCode?: string,
  ): InterbankReceiptRejection | null {
    if (transfer.destinationBankCode !== this.#bankCode) return 'WRONG_DESTINATION_BANK';
    /*
     * Quién llama lo dice su API key y no el cuerpo. Un cuerpo que se atribuye a
     * otro banco es un intento de hacerse pasar por él, y se rechaza como
     * `BANK_NOT_AUTHORIZED` (que el contrato traduce a `PROCESSING_ERROR`).
     */
    if (callerBankCode !== undefined && transfer.originBankCode !== callerBankCode) {
      return 'BANK_NOT_AUTHORIZED';
    }
    if (transfer.currency !== 'GTQ') return 'UNSUPPORTED_CURRENCY';

    const amountMinor = v1AmountToMinor(transfer.amount);

    if (amountMinor === null || amountMinor < V1_MIN_AMOUNT_MINOR) return 'INVALID_REQUEST';
    if (amountMinor > this.#maxAmountMinor) return 'AMOUNT_EXCEEDS_LIMIT';

    return null;
  }

  /** El evento de auditoría de un cierre, atado a la causa que lo originó. */
  #rejectionResult(
    cause: MessageEnvelope<unknown>,
    depositId: string,
    reason: InterbankReceiptRejection,
    now: Date,
  ): MessageEnvelope<unknown> {
    return this.#messenger.result(cause, paymentInterbankRejectedV1.name, {
      depositId,
      reason,
      decidedAt: now.toISOString(),
    });
  }

  async #replyTransfer(
    interbankTransferId: string,
    admission: 'ACCEPTED_FOR_PROCESSING' | 'DUPLICATE' | 'CONFLICT',
    row: V1DepositRow | null,
    now: Date,
  ): Promise<void> {
    await this.#reply(paymentInterbankV1TransferRepliedV1.name, {
      interbankTransferId,
      admission,
      status: row?.status ?? null,
      reasonCode: row?.reasonCode ?? null,
      updatedAt: (row?.updatedAt ?? now).toISOString(),
    });
  }

  async #replyReversal(reversalId: string, reversal: V1Reversal | null): Promise<void> {
    await this.#reply(paymentInterbankV1ReversalRepliedV1.name, {
      reversalId,
      found: reversal !== null,
      status: reversal?.status ?? null,
      refundTransferId: reversal?.refundTransferId ?? null,
      reasonMessage: reversal?.reasonMessage ?? null,
    });
  }
}

/** Lo que se le contesta a una cancelación según dónde quedó el depósito. */
function resultOf(row: V1DepositRow | null): V1CancelResult | 'IN_PROGRESS' {
  if (row !== null && row.stage === 'CREDIT') return 'IN_PROGRESS';
  if (row === null || row.status === 'CANCELLED') return 'CANCELLED';
  if (row.status === 'ACCEPTED') return 'ALREADY_ACCEPTED';
  return 'ALREADY_REJECTED';
}

/** El motivo del contrato para un rechazo nuestro, para quien lo necesite. */
export function v1ReasonCodeOf(rejection: InterbankReceiptRejection): V1ReasonCode {
  return v1ReasonOf(rejection);
}
