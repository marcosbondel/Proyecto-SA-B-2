import { z } from 'zod';

import { isoTimestamp, uuidV4 } from '../../schemas/primitives';
import { defineContract } from '../contract';
import {
  v1Amount,
  v1BankCode,
  v1CancelResult,
  v1ReasonCode,
  v1ReconciliationItem,
  v1TransferRequest,
  v1TransferResult,
  v1TransferState,
} from './v1';

/**
 * Los mensajes internos de las siete operaciones del contrato oficial (T-56).
 *
 * El Gateway no decide nada —no tiene `domain/` y nunca lo tendrá— así que cada
 * operación del contrato se traduce aquí a un mensaje por el broker y la
 * decisión la toma Payment Service, que es quien tiene las filas.
 *
 * **Cuatro son `request/reply` y no eventos**, lo cual es poco habitual en este
 * repositorio y lo pide el contrato: `POST /transfers` tiene que distinguir
 * `202`, `200` y `409` según lo que ya exista, `GET /transfers/{id}` devuelve un
 * estado, la cancelación devuelve cuál de los tres resultados fue, y la
 * conciliación devuelve una página. Ninguna de las cuatro se puede contestar
 * sin preguntar. El techo de cinco segundos del Gateway es el mismo que para
 * cualquier otra consulta.
 */

/** `POST /transfers` — el depósito, tal como llegó, para que Payment lo decida. */
export const paymentInterbankV1TransferQueryV1 = defineContract({
  name: 'payment.interbank.v1.transfer.query.v1',
  category: 'command',
  producer: 'gateway',
  consumers: ['payment-service'],
  schema: z.object({
    /** El cuerpo del contrato, sin tocar. */
    transfer: v1TransferRequest,
    /** Quién lo manda, según su API key — no según lo que diga el cuerpo. */
    callerBankCode: v1BankCode,
    receivedAt: isoTimestamp,
  }),
});
export type PaymentInterbankV1TransferQueryV1 = z.infer<
  typeof paymentInterbankV1TransferQueryV1.schema
>;

/**
 * Lo que Payment contesta sobre la **admisión** del depósito, que no es su
 * resultado de negocio.
 *
 * - `ACCEPTED_FOR_PROCESSING` → el Gateway responde `202`. El veredicto llegará
 *   por callback.
 * - `DUPLICATE` → `200` con el estado actual. La misma solicitud otra vez no se
 *   procesa de nuevo.
 * - `CONFLICT` → `409`. Mismo id, contenido distinto.
 */
export const paymentInterbankV1TransferRepliedV1 = defineContract({
  name: 'payment.interbank.v1.transfer.replied.v1',
  category: 'reply',
  producer: 'payment-service',
  consumers: ['gateway'],
  schema: z
    .object({
      interbankTransferId: uuidV4,
      admission: z.enum(['ACCEPTED_FOR_PROCESSING', 'DUPLICATE', 'CONFLICT']),
      /** El estado actual, obligatorio en `DUPLICATE` y prohibido en los otros. */
      status: v1TransferState.nullable(),
      reasonCode: v1ReasonCode.nullable(),
      updatedAt: isoTimestamp,
    })
    .refine((value) => (value.admission === 'DUPLICATE') === (value.status !== null), {
      path: ['status'],
      message: 'Sólo un duplicado lleva estado, y todo duplicado lo lleva.',
    }),
});
export type PaymentInterbankV1TransferRepliedV1 = z.infer<
  typeof paymentInterbankV1TransferRepliedV1.schema
>;

/** `GET /transfers/{id}` — la consulta que el emisor hace cuando está en TIMEOUT. */
export const paymentInterbankV1StatusQueryV1 = defineContract({
  name: 'payment.interbank.v1.status.query.v1',
  category: 'command',
  producer: 'gateway',
  consumers: ['payment-service'],
  schema: z.object({ interbankTransferId: uuidV4, callerBankCode: v1BankCode }),
});
export type PaymentInterbankV1StatusQueryV1 = z.infer<
  typeof paymentInterbankV1StatusQueryV1.schema
>;

/**
 * El estado, o que no hay registro.
 *
 * `found: false` es una respuesta y no un error: el contrato le da un
 * significado operativo preciso —«el receptor no tiene registro de ese id,
 * nunca lo recibió»— que es lo que hace al emisor pasar a cancelar.
 */
export const paymentInterbankV1StatusRepliedV1 = defineContract({
  name: 'payment.interbank.v1.status.replied.v1',
  category: 'reply',
  producer: 'payment-service',
  consumers: ['gateway'],
  schema: z.object({
    interbankTransferId: uuidV4,
    found: z.boolean(),
    status: v1TransferState.nullable(),
    reasonCode: v1ReasonCode.nullable(),
    updatedAt: isoTimestamp.nullable(),
  }),
});
export type PaymentInterbankV1StatusRepliedV1 = z.infer<
  typeof paymentInterbankV1StatusRepliedV1.schema
>;

/** `POST /transfers/{id}/cancel`. */
export const paymentInterbankV1CancelQueryV1 = defineContract({
  name: 'payment.interbank.v1.cancel.query.v1',
  category: 'command',
  producer: 'gateway',
  consumers: ['payment-service'],
  schema: z.object({
    interbankTransferId: uuidV4,
    callerBankCode: v1BankCode,
    reason: z.enum(['TIMEOUT', 'CLIENT_REQUEST']),
    requestedAt: isoTimestamp,
  }),
});
export type PaymentInterbankV1CancelQueryV1 = z.infer<
  typeof paymentInterbankV1CancelQueryV1.schema
>;

export const paymentInterbankV1CancelRepliedV1 = defineContract({
  name: 'payment.interbank.v1.cancel.replied.v1',
  category: 'reply',
  producer: 'payment-service',
  consumers: ['gateway'],
  schema: z.object({
    interbankTransferId: uuidV4,
    /**
     * Las tres respuestas del contrato, más `IN_PROGRESS` (T-60), que **no**
     * lo es y el Gateway traduce a `503`: el depósito ya ordenó su crédito y
     * Account todavía no ha dicho si se aplicó. Contestar `CANCELLED` ahí
     * liberaría la reserva del emisor mientras nosotros acreditamos — el mismo
     * dinero dos veces — y contestar `ALREADY_ACCEPTED` sería afirmar algo que
     * aún no es cierto. Lo honesto es «vuelve a preguntar», y el contrato ya
     * tiene esa respuesta: `503` con espera creciente.
     */
    result: z.enum([...v1CancelResult.options, 'IN_PROGRESS']),
  }),
});
export type PaymentInterbankV1CancelRepliedV1 = z.infer<
  typeof paymentInterbankV1CancelRepliedV1.schema
>;

/**
 * `POST /transfers/{id}/result` — el callback que **nos** llega como emisor.
 *
 * Evento y no consulta: el contrato pide `200` en cuanto queda registrado, y un
 * resultado repetido se responde igual sin efectos. Lo que decide qué hacer con
 * él es la máquina de estados del envío, no el Gateway.
 */
export const paymentInterbankV1ResultReceivedV1 = defineContract({
  name: 'payment.interbank.v1.result.received.v1',
  category: 'command',
  producer: 'gateway',
  consumers: ['payment-service'],
  schema: z.object({
    result: v1TransferResult,
    callerBankCode: v1BankCode,
    receivedAt: isoTimestamp,
  }),
});
export type PaymentInterbankV1ResultReceivedV1 = z.infer<
  typeof paymentInterbankV1ResultReceivedV1.schema
>;

/** `POST /reversals` — la devolución de un depósito acreditado por un callback tardío. */
export const paymentInterbankV1ReversalRequestedV1 = defineContract({
  name: 'payment.interbank.v1.reversal.requested.v1',
  category: 'command',
  producer: 'gateway',
  consumers: ['payment-service'],
  schema: z.object({
    reversalId: uuidV4,
    originalTransferId: uuidV4,
    callerBankCode: v1BankCode,
    amount: v1Amount,
    requestedAt: isoTimestamp,
  }),
});
export type PaymentInterbankV1ReversalRequestedV1 = z.infer<
  typeof paymentInterbankV1ReversalRequestedV1.schema
>;

export const paymentInterbankV1ReversalRepliedV1 = defineContract({
  name: 'payment.interbank.v1.reversal.replied.v1',
  category: 'reply',
  producer: 'payment-service',
  consumers: ['gateway'],
  schema: z.object({
    reversalId: uuidV4,
    found: z.boolean(),
    status: z.enum(['PROCESSING', 'COMPLETED', 'FAILED']).nullable(),
    refundTransferId: uuidV4.nullable(),
    reasonMessage: z.string().max(200).nullable(),
  }),
});
export type PaymentInterbankV1ReversalRepliedV1 = z.infer<
  typeof paymentInterbankV1ReversalRepliedV1.schema
>;

/** `GET /reversals/{id}`. */
export const paymentInterbankV1ReversalQueryV1 = defineContract({
  name: 'payment.interbank.v1.reversal.query.v1',
  category: 'command',
  producer: 'gateway',
  consumers: ['payment-service'],
  schema: z.object({ reversalId: uuidV4, callerBankCode: v1BankCode }),
});
export type PaymentInterbankV1ReversalQueryV1 = z.infer<
  typeof paymentInterbankV1ReversalQueryV1.schema
>;

/** `GET /reconciliation?date=` — la conciliación diaria obligatoria. */
export const paymentInterbankV1ReconciliationQueryV1 = defineContract({
  name: 'payment.interbank.v1.reconciliation.query.v1',
  category: 'command',
  producer: 'gateway',
  consumers: ['payment-service'],
  schema: z.object({
    callerBankCode: v1BankCode,
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    page: z.number().int().min(1),
    pageSize: z.number().int().min(1).max(500),
  }),
});
export type PaymentInterbankV1ReconciliationQueryV1 = z.infer<
  typeof paymentInterbankV1ReconciliationQueryV1.schema
>;

export const paymentInterbankV1ReconciliationRepliedV1 = defineContract({
  name: 'payment.interbank.v1.reconciliation.replied.v1',
  category: 'reply',
  producer: 'payment-service',
  consumers: ['gateway'],
  schema: z.object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    page: z.number().int(),
    pageSize: z.number().int(),
    totalItems: z.number().int(),
    items: z.array(v1ReconciliationItem),
  }),
});
export type PaymentInterbankV1ReconciliationRepliedV1 = z.infer<
  typeof paymentInterbankV1ReconciliationRepliedV1.schema
>;
