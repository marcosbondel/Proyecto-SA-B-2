import {
  v1AmountFromMinor,
  v1CancelRequest,
  v1ReversalRequest,
  v1TransferRequest,
  v1TransferResult,
} from '@bank/contracts';
import type {
  V1CancelRequest,
  V1ReversalRequest,
  V1TransferRequest,
  V1TransferResult,
} from '@bank/contracts';

import type { InterbankDeposit } from '../../application/interbank.ports';
import type { InterbankSend } from '../../application/interbank-send.ports';
import { v1ReasonOf } from '../../domain/interbank-receipt';
import type { InterbankReceiptRejection } from '../../domain/interbank-receipt';

/**
 * Los cuerpos que este banco le manda al banco pareja, **tal como el contrato
 * oficial los define** (T-60).
 *
 * Aparte del adaptador HTTP a propósito: son funciones puras, y lo que hay que
 * poder probar sin red es justamente esto — que lo que sale cumple el esquema
 * del curso. Cada una construye el cuerpo y lo pasa por el esquema estricto de
 * `@bank/contracts` antes de devolverlo, así que un cuerpo que el contrato
 * rechazaría no llega nunca a la red: falla aquí, con el campo, y no como un
 * `400` del otro banco el día de la integración.
 *
 * Hasta T-60 el cuerpo era el provisional —`accountId`, `timestamp`,
 * `idempotencyKey`— y un banco que validara contra el esquema oficial
 * (`additionalProperties: false`) nos rechazaba todos los envíos.
 */

/** `POST /transfers` — el depósito que este banco manda. */
export function buildTransferRequest(send: InterbankSend, ourBankCode: string): V1TransferRequest {
  if (send.originAccount === null) {
    throw new Error('El depósito no lleva la cuenta origen; el contrato la exige.');
  }

  return v1TransferRequest.parse({
    interbankTransferId: send.interbankTransferId,
    originBankCode: ourBankCode,
    destinationBankCode: send.destinationBankCode,
    originAccount: send.originAccount,
    destinationAccount: send.destinationAccount,
    /* Texto con dos decimales, sin pasar por un float: `v1AmountFromMinor` parte el entero. */
    amount: v1AmountFromMinor(send.amount.amountMinor),
    currency: send.amount.currency,
    /*
     * Los dos sellos salen de la fila, no del reloj: un reenvío tiene que decir
     * exactamente lo mismo que el primer envío, o el otro banco lo vería como
     * «mismo id, contenido distinto» y contestaría `409`. `expiresAt` es
     * `createdAt + 180 s`, que `timeoutSchedule` calculó al abrir la fila.
     */
    createdAt: send.createdAt.toISOString(),
    expiresAt: send.confirmationDueAt.toISOString(),
  });
}

/** `POST /transfers/{id}/cancel`. */
export function buildCancelRequest(ourBankCode: string): V1CancelRequest {
  return v1CancelRequest.parse({ originBankCode: ourBankCode, reason: 'TIMEOUT' });
}

/** `POST /reversals`. */
export function buildReversalRequest(
  send: InterbankSend,
  reversalId: string,
  ourBankCode: string,
): V1ReversalRequest {
  return v1ReversalRequest.parse({
    reversalId,
    originalTransferId: send.interbankTransferId,
    originBankCode: ourBankCode,
    amount: v1AmountFromMinor(send.amount.amountMinor),
    currency: send.amount.currency,
  });
}

/**
 * Un mensaje corto para el humano que lea el rechazo en el otro banco.
 * `reasonMessage` es opcional en el contrato (≤ 200); aquí nunca viaja nada
 * personal: es una frase fija por motivo.
 */
const REASON_MESSAGES: Readonly<Record<string, string>> = {
  ACCOUNT_NOT_FOUND: 'La cuenta destino no existe',
  ACCOUNT_INACTIVE: 'La cuenta destino está inactiva',
  AMOUNT_LIMIT_EXCEEDED: 'El monto excede el límite por operación',
  CURRENCY_NOT_SUPPORTED: 'Sólo se admite GTQ',
  EXPIRED: 'El depósito venció antes de poder acreditarse',
  CANCELLED: 'El depósito fue cancelado por el emisor',
  PROCESSING_ERROR: 'El depósito no pudo procesarse',
};

/**
 * `POST /transfers/{id}/result` — el callback que este banco, como **receptor**,
 * le devuelve al emisor.
 *
 * `destinationBankCode` es **nuestro** código: el contrato lo pone en el
 * cuerpo para que el emisor compruebe que contesta quien debe. `processedAt` es
 * cuándo decidimos, no cuándo reintentamos entregar.
 */
export function buildTransferResult(
  deposit: InterbankDeposit,
  ourBankCode: string,
): V1TransferResult {
  if (deposit.stage !== 'ACCEPTED' && deposit.stage !== 'REJECTED') {
    throw new Error(`Un depósito en ${deposit.stage} no tiene resultado que contar.`);
  }

  const processedAt = (deposit.decidedAt ?? deposit.createdAt).toISOString();

  if (deposit.stage === 'ACCEPTED') {
    return v1TransferResult.parse({
      interbankTransferId: deposit.externalTransferId,
      destinationBankCode: ourBankCode,
      status: 'ACCEPTED',
      processedAt,
    });
  }

  const reasonCode = v1ReasonOf((deposit.reason ?? 'INVALID_REQUEST') as InterbankReceiptRejection);

  return v1TransferResult.parse({
    interbankTransferId: deposit.externalTransferId,
    destinationBankCode: ourBankCode,
    status: 'REJECTED',
    reasonCode,
    reasonMessage: REASON_MESSAGES[reasonCode],
    processedAt,
  });
}
