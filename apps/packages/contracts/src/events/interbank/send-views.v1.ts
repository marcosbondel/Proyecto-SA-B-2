import { z } from 'zod';

import { isoTimestamp, uuidV4 } from '../../schemas/primitives';
import { defineContract } from '../contract';
import { bankCode, interbankMoney, interbankTransferId } from './incoming.v1';
import { interbankSendState } from './outgoing.v1';

/**
 * Consultar los depósitos que este banco **envió** al banco pareja (T-60, B10).
 *
 * Hasta aquí, tras pedir un depósito, la pantalla seguía a la Saga
 * (`GET /api/transfers/{id}`), que sólo conoce seis estados propios y no los
 * seis del depósito que §4.1 enumera: `PENDING`, `SENT`, `ACCEPTED`,
 * `REJECTED`, `TIMEOUT` y `REVERSED`. Esos viven en una tabla de Payment, y
 * esto es la forma de preguntárselos por el broker — nunca por HTTP.
 *
 * Quién puede ver qué lo decide Payment desde la identidad del sobre, no el
 * Gateway: la fila guarda el cliente que originó el depósito, y un `CLIENTE`
 * sólo ve los suyos mientras el personal ve todos.
 */

/** Un paso del historial de estados del depósito. */
export const interbankSendHistoryEntry = z.object({
  state: interbankSendState,
  reason: z.string().nullable(),
  at: isoTimestamp,
});
export type InterbankSendHistoryEntry = z.infer<typeof interbankSendHistoryEntry>;

/**
 * El estado de un reverso pedido al banco pareja por un `ACCEPTED` tardío
 * (paso 5 del contrato).
 */
export const interbankSendReversalState = z.enum([
  'PENDING',
  'PROCESSING',
  'COMPLETED',
  'FAILED',
]);

/**
 * Un depósito enviado, tal como la pantalla lo necesita.
 *
 * **La cuenta destino viaja enmascarada.** El operador necesita reconocerla y
 * nadie necesita copiarla desde un listado; el número completo sigue en el
 * registro del banco y en el mensaje que se le mandó a la pareja.
 */
export const interbankSendView = z.object({
  interbankTransferId,
  paymentId: uuidV4,
  transactionId: uuidV4,
  state: interbankSendState,
  /** Por qué está así: el motivo del rechazo, del vencimiento o de la liberación. */
  reason: z.string().nullable(),
  destinationBankCode: bankCode,
  /** Enmascarada: los últimos cuatro caracteres. */
  destinationAccount: z.string(),
  originAccount: z.string().nullable(),
  amount: interbankMoney,
  correlationId: uuidV4,
  /** El `traceId` W3C de la petición que lo originó, o `null` si no había traza. */
  traceId: z
    .string()
    .regex(/^[0-9a-f]{32}$/)
    .nullable(),
  /** Cuándo se pidió. */
  createdAt: isoTimestamp,
  /** `createdAt + 180 s`: el momento en que deja de esperarse el callback. */
  expiresAt: isoTimestamp,
  sentAt: isoTimestamp.nullable(),
  decidedAt: isoTimestamp.nullable(),
  /** Cuándo volvió el dinero a la cuenta origen. */
  reversedAt: isoTimestamp.nullable(),
  /** Intentos de entrega al banco pareja. */
  attempts: z.number().int().nonnegative(),
  /**
   * `true` cuando el depósito se liberó sin que el banco pareja lo confirmara
   * (`expiresAt + 300 s` sin respuesta). Es la rama que dispara la alerta.
   */
  releasedUnverified: z.boolean(),
  /** El reverso pedido tras un `ACCEPTED` tardío, o `null` si no hizo falta. */
  reversal: z.object({ reversalId: uuidV4, state: interbankSendReversalState }).nullable(),
});
export type InterbankSendView = z.infer<typeof interbankSendView>;

export const paymentInterbankSendQueryV1 = defineContract({
  name: 'payment.interbank.send.query.v1',
  category: 'command',
  producer: 'gateway',
  consumers: ['payment-service'],
  schema: z.object({ interbankTransferId }),
});
export type PaymentInterbankSendQueryV1 = z.infer<typeof paymentInterbankSendQueryV1.schema>;

/**
 * `NOT_FOUND` tanto si no existe como si es de otro cliente: distinguirlos
 * sería regalar una forma de averiguar qué depósitos existen.
 */
export const paymentInterbankSendRepliedV1 = defineContract({
  name: 'payment.interbank.send.replied.v1',
  category: 'reply',
  producer: 'payment-service',
  consumers: ['gateway'],
  schema: z.discriminatedUnion('outcome', [
    z.object({
      outcome: z.literal('FOUND'),
      send: interbankSendView,
      /** Del más antiguo al más reciente. */
      history: z.array(interbankSendHistoryEntry),
    }),
    z.object({ outcome: z.literal('NOT_FOUND') }),
  ]),
});
export type PaymentInterbankSendRepliedV1 = z.infer<typeof paymentInterbankSendRepliedV1.schema>;

export const paymentInterbankSendListQueryV1 = defineContract({
  name: 'payment.interbank.send.list.query.v1',
  category: 'command',
  producer: 'gateway',
  consumers: ['payment-service'],
  schema: z.object({
    state: interbankSendState.optional(),
    limit: z.number().int().min(1).max(200).optional(),
  }),
});
export type PaymentInterbankSendListQueryV1 = z.infer<
  typeof paymentInterbankSendListQueryV1.schema
>;

export const paymentInterbankSendListRepliedV1 = defineContract({
  name: 'payment.interbank.send.list.replied.v1',
  category: 'reply',
  producer: 'payment-service',
  consumers: ['gateway'],
  schema: z.object({
    /** Del más reciente al más antiguo. Sin historial: eso es el detalle. */
    sends: z.array(interbankSendView),
  }),
});
export type PaymentInterbankSendListRepliedV1 = z.infer<
  typeof paymentInterbankSendListRepliedV1.schema
>;
