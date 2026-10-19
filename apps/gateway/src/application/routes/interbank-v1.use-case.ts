import {
  paymentInterbankV1CancelQueryV1,
  paymentInterbankV1CancelRepliedV1,
  paymentInterbankV1ReconciliationQueryV1,
  paymentInterbankV1ReconciliationRepliedV1,
  paymentInterbankV1ResultReceivedV1,
  paymentInterbankV1ReversalQueryV1,
  paymentInterbankV1ReversalRepliedV1,
  paymentInterbankV1ReversalRequestedV1,
  paymentInterbankV1StatusQueryV1,
  paymentInterbankV1StatusRepliedV1,
  paymentInterbankV1TransferQueryV1,
  paymentInterbankV1TransferRepliedV1,
  v1CancelRequest,
  v1ReversalRequest,
  v1TransferRequest,
  v1TransferResult,
} from '@bank/contracts';
import type {
  V1CancelResponse,
  V1ReconciliationPage,
  V1ReversalStatus,
  V1TransferAck,
  V1TransferStatus,
} from '@bank/contracts';
import { Inject, Injectable } from '@nestjs/common';

import { GatewayError } from '../errors/gateway-error';
import { MESSAGE_PUBLISHER, REPLY_WAITER } from '../ports';
import type { MessagePublisherPort, ReplyWaiterPort } from '../ports';
import { askAndWait } from '../request-reply';
import { envelopeForRequest } from '../request-envelope';

/**
 * Las siete operaciones del contrato interbancario oficial (T-56).
 *
 * **El Gateway sigue sin decidir nada**, que es la regla de ADR-008 y la razón
 * de que este archivo sea largo pero tonto: valida la forma contra el contrato,
 * traduce a un mensaje del broker, espera la respuesta cuando hace falta
 * esperarla, y convierte lo que Payment contestó en el código HTTP que el
 * contrato manda. Ni un `if` de negocio.
 *
 * Hay **una** excepción deliberada y es el vencimiento: si `expiresAt` ya pasó,
 * el Gateway responde `422` sin preguntar. Es una comparación de relojes y no
 * una regla de negocio, el contrato lo pide explícitamente —«si el mensaje ya
 * venció, responde `422` y no lo procesa»— y preguntarlo sería meter en la
 * máquina de estados un depósito que el contrato dice no procesar.
 */
@Injectable()
export class InterbankV1UseCase {
  constructor(
    @Inject(MESSAGE_PUBLISHER) readonly publisher: MessagePublisherPort,
    @Inject(REPLY_WAITER) readonly replies: ReplyWaiterPort,
  ) {}

  /** `POST /transfers` — recibir un depósito. */
  async receiveTransfer(
    body: unknown,
    headers: { readonly idempotencyKey: string | null },
    caller: { readonly bankCode: string },
    correlationId: string,
    now: Date,
  ): Promise<
    | { readonly kind: 'ACCEPTED'; readonly body: V1TransferAck }
    | { readonly kind: 'DUPLICATE'; readonly body: V1TransferStatus }
  > {
    const transfer = parseOrFail(v1TransferRequest, body, 'Depósito interbancario inválido.');

    /*
     * «El header `Idempotency-Key` debe ser igual a `interbankTransferId`», y
     * el contrato pone su incumplimiento en el `400` junto a los campos que
     * faltan. Es una comprobación del borde y no de negocio: dos valores que
     * deberían ser el mismo y no lo son hacen ambigua la clave con la que se
     * deduplica, y deduplicar mal es acreditar dos veces.
     */
    if (headers.idempotencyKey !== transfer.interbankTransferId) {
      throw GatewayError.validation(
        'El header Idempotency-Key debe ser igual a interbankTransferId.',
        'Idempotency-Key',
      );
    }

    if (new Date(transfer.expiresAt).getTime() <= now.getTime()) {
      throw GatewayError.expired(
        'El depósito venció antes de llegar; no se procesa.',
        transfer.interbankTransferId,
      );
    }

    const answer = paymentInterbankV1TransferRepliedV1.schema.parse(
      (
        await askAndWait(
          this.publisher,
          this.replies,
          envelopeForRequest(
            paymentInterbankV1TransferQueryV1.schema.parse({
              transfer,
              /* Quién llama lo dice su API key, no el cuerpo (§seguridad). */
              callerBankCode: caller.bankCode,
              receivedAt: now.toISOString(),
            }),
            paymentInterbankV1TransferQueryV1.name,
            null,
            correlationId,
            { idempotencyKey: transfer.interbankTransferId },
          ),
        )
      ).payload,
    );

    if (answer.admission === 'CONFLICT') {
      throw GatewayError.idempotencyConflict(
        'Ya existe un depósito con ese identificador y otro contenido.',
        transfer.interbankTransferId,
      );
    }

    if (answer.admission === 'DUPLICATE') {
      return {
        kind: 'DUPLICATE',
        body: {
          interbankTransferId: answer.interbankTransferId,
          status: answer.status ?? 'PROCESSING',
          ...(answer.reasonCode === null ? {} : { reasonCode: answer.reasonCode }),
          updatedAt: answer.updatedAt,
        },
      };
    }

    return {
      kind: 'ACCEPTED',
      body: {
        interbankTransferId: transfer.interbankTransferId,
        status: 'PROCESSING',
        receivedAt: now.toISOString(),
      },
    };
  }

  /** `GET /transfers/{id}` — consultar el estado. */
  async transferStatus(
    interbankTransferId: string,
    caller: { readonly bankCode: string },
    correlationId: string,
  ): Promise<V1TransferStatus> {
    const answer = paymentInterbankV1StatusRepliedV1.schema.parse(
      (
        await askAndWait(
          this.publisher,
          this.replies,
          envelopeForRequest(
            paymentInterbankV1StatusQueryV1.schema.parse({
              interbankTransferId,
              callerBankCode: caller.bankCode,
            }),
            paymentInterbankV1StatusQueryV1.name,
            null,
            correlationId,
          ),
          'read',
        )
      ).payload,
    );

    /*
     * `404` y no un estado vacío. El contrato le da un significado operativo:
     * «el receptor no tiene registro de ese id, nunca lo recibió», y es lo que
     * hace al emisor pasar de consultar a cancelar. Un `200` con estado nulo
     * dejaría esa decisión sin información.
     */
    if (!answer.found || answer.status === null || answer.updatedAt === null) {
      throw GatewayError.notFound(
        'No hay registro de ese depósito en este banco.',
        interbankTransferId,
      );
    }

    return {
      interbankTransferId: answer.interbankTransferId,
      status: answer.status,
      ...(answer.reasonCode === null ? {} : { reasonCode: answer.reasonCode }),
      updatedAt: answer.updatedAt,
    };
  }

  /** `POST /transfers/{id}/cancel` — cancelar un depósito en duda. */
  async cancelTransfer(
    interbankTransferId: string,
    body: unknown,
    caller: { readonly bankCode: string },
    correlationId: string,
    now: Date,
  ): Promise<V1CancelResponse> {
    const request = parseOrFail(v1CancelRequest, body, 'Cancelación inválida.');

    const answer = paymentInterbankV1CancelRepliedV1.schema.parse(
      (
        await askAndWait(
          this.publisher,
          this.replies,
          envelopeForRequest(
            paymentInterbankV1CancelQueryV1.schema.parse({
              interbankTransferId,
              callerBankCode: caller.bankCode,
              reason: request.reason,
              requestedAt: now.toISOString(),
            }),
            paymentInterbankV1CancelQueryV1.name,
            null,
            correlationId,
            /* Idempotente por contrato: cancelar dos veces es cancelar una. */
            { idempotencyKey: `cancel:${interbankTransferId}` },
          ),
        )
      ).payload,
    );

    /*
     * `IN_PROGRESS`: el depósito ya ordenó su crédito y Account todavía no dijo
     * si se aplicó (B4). Ni `CANCELLED` (liberaría la reserva del emisor mientras
     * acreditamos) ni `ALREADY_ACCEPTED` (todavía no es cierto). El contrato ya
     * tiene la respuesta honesta —`503`, «el que llama debe reintentar con espera
     * creciente»— y es exactamente lo que el emisor hace con ella.
     */
    if (answer.result === 'IN_PROGRESS') {
      throw GatewayError.brokerUnavailable();
    }

    return { interbankTransferId: answer.interbankTransferId, result: answer.result };
  }

  /**
   * `POST /transfers/{id}/result` — el callback, que **exponemos como emisor**.
   *
   * Publica y contesta: el contrato pide `200` en cuanto queda registrado, y un
   * resultado repetido se responde igual sin efectos adicionales. Sostener la
   * conexión del otro banco mientras una base de datos escribe es cómo un
   * callback acaba reintentándose por timeout habiendo funcionado.
   */
  async receiveResult(
    interbankTransferId: string,
    body: unknown,
    caller: { readonly bankCode: string },
    correlationId: string,
    now: Date,
  ): Promise<{ readonly interbankTransferId: string; readonly received: true }> {
    const result = parseOrFail(v1TransferResult, body, 'Resultado interbancario inválido.');

    if (result.interbankTransferId !== interbankTransferId) {
      throw GatewayError.validation(
        'El identificador de la ruta y el del cuerpo no coinciden.',
        'interbankTransferId',
      );
    }

    await this.publisher.publish(
      envelopeForRequest(
        paymentInterbankV1ResultReceivedV1.schema.parse({
          result,
          callerBankCode: caller.bankCode,
          receivedAt: now.toISOString(),
        }),
        paymentInterbankV1ResultReceivedV1.name,
        null,
        correlationId,
        { idempotencyKey: `result:${interbankTransferId}` },
      ),
    );

    return { interbankTransferId, received: true };
  }

  /** `POST /reversals` — pedir la devolución de un depósito acreditado. */
  async requestReversal(
    body: unknown,
    caller: { readonly bankCode: string },
    correlationId: string,
    now: Date,
  ): Promise<V1ReversalStatus> {
    const request = parseOrFail(v1ReversalRequest, body, 'Solicitud de reverso inválida.');

    const answer = paymentInterbankV1ReversalRepliedV1.schema.parse(
      (
        await askAndWait(
          this.publisher,
          this.replies,
          envelopeForRequest(
            paymentInterbankV1ReversalRequestedV1.schema.parse({
              reversalId: request.reversalId,
              originalTransferId: request.originalTransferId,
              callerBankCode: caller.bankCode,
              amount: request.amount,
              requestedAt: now.toISOString(),
            }),
            paymentInterbankV1ReversalRequestedV1.name,
            null,
            correlationId,
            { idempotencyKey: `reversal:${request.reversalId}` },
          ),
        )
      ).payload,
    );

    if (!answer.found) {
      throw GatewayError.notFound(
        'No hay registro del depósito que se pide devolver.',
        request.originalTransferId,
      );
    }

    return reversalBody(answer);
  }

  /** `GET /reversals/{id}` — consultar un reverso. */
  async reversalStatus(
    reversalId: string,
    caller: { readonly bankCode: string },
    correlationId: string,
  ): Promise<V1ReversalStatus> {
    const answer = paymentInterbankV1ReversalRepliedV1.schema.parse(
      (
        await askAndWait(
          this.publisher,
          this.replies,
          envelopeForRequest(
            paymentInterbankV1ReversalQueryV1.schema.parse({
              reversalId,
              callerBankCode: caller.bankCode,
            }),
            paymentInterbankV1ReversalQueryV1.name,
            null,
            correlationId,
          ),
          'read',
        )
      ).payload,
    );

    if (!answer.found) {
      throw GatewayError.notFound('No hay registro de ese reverso.', reversalId);
    }

    return reversalBody(answer);
  }

  /** `GET /reconciliation?date=` — la conciliación diaria. */
  async reconciliation(
    query: { readonly date: string; readonly page: number; readonly pageSize: number },
    caller: { readonly bankCode: string },
    correlationId: string,
  ): Promise<V1ReconciliationPage> {
    const answer = paymentInterbankV1ReconciliationRepliedV1.schema.parse(
      (
        await askAndWait(
          this.publisher,
          this.replies,
          envelopeForRequest(
            paymentInterbankV1ReconciliationQueryV1.schema.parse({
              /* El banco lo pone la API key: el contrato dice «identificado por su API key». */
              callerBankCode: caller.bankCode,
              date: query.date,
              page: query.page,
              pageSize: query.pageSize,
            }),
            paymentInterbankV1ReconciliationQueryV1.name,
            null,
            correlationId,
          ),
          'read',
        )
      ).payload,
    );

    return answer;
  }
}

function reversalBody(answer: {
  readonly reversalId: string;
  readonly status: 'PROCESSING' | 'COMPLETED' | 'FAILED' | null;
  readonly refundTransferId: string | null;
  readonly reasonMessage: string | null;
}): V1ReversalStatus {
  return {
    reversalId: answer.reversalId,
    status: answer.status ?? 'PROCESSING',
    ...(answer.refundTransferId === null ? {} : { refundTransferId: answer.refundTransferId }),
    ...(answer.reasonMessage === null ? {} : { reasonMessage: answer.reasonMessage }),
  };
}

/**
 * Validar contra el contrato, o `400` con el campo.
 *
 * El contrato define un cuerpo de error propio —`code`, `message`,
 * `timestamp`— y traducir el `GatewayError` a esa forma es trabajo del filtro
 * de excepciones, no de aquí: lo que aquí se decide es **qué** está mal, no
 * cómo se escribe.
 */
function parseOrFail<T>(
  schema: {
    safeParse(value: unknown):
      | { readonly success: true; readonly data: T }
      | {
          readonly success: false;
          readonly error: { readonly issues: readonly { message: string; path: unknown[] }[] };
        };
  },
  body: unknown,
  mensaje: string,
): T {
  const parsed = schema.safeParse(body);

  if (!parsed.success) {
    throw GatewayError.validation(
      parsed.error.issues[0]?.message ?? mensaje,
      parsed.error.issues[0]?.path.join('.'),
    );
  }

  return parsed.data;
}
