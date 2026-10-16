import { z } from 'zod';

import { isoTimestamp, uuidV4 } from '../../schemas/primitives';

/**
 * El contrato interbancario oficial, **tal como lo publicó el curso**
 * (`docs/references/interbank-contract-v1.openapi.yaml`, v1.0.0).
 *
 * Este archivo es la traducción de ese OpenAPI a esquemas ejecutables, y su
 * única regla es que **no inventa nada**: cada tipo, cada patrón y cada
 * enumeración sale del archivo, incluidos los nombres que no nos gustan y los
 * que no coinciden con los nuestros. El enunciado es explícito —«los grupos no
 * deben modificarlo»— así que donde el contrato y nuestro vocabulario difieren,
 * la traducción ocurre **aquí, en el borde**, y no retorciendo el contrato.
 *
 * Lo que vive en `incoming.v1.ts` y `outgoing.v1.ts` son los mensajes
 * **internos** por el broker, que son nuestros y siguen siendo nuestros. Lo de
 * aquí es lo que cruza la frontera.
 */

/** `^BANK[0-9]{2}$` — asignado por el curso. Nosotros `BANK02`, el mock `BANK99`. */
export const v1BankCode = z.string().regex(/^BANK[0-9]{2}$/);

/**
 * `^[A-Za-z0-9-]{1,34}$` — el formato lo publica cada banco en su acuerdo de
 * integración. El nuestro es `02-NNNNNNNNN`.
 *
 * **Treinta y cuatro caracteres**, que es la razón de que nuestras cuentas
 * tengan un número además de un UUID: un UUID con guiones son 36.
 */
export const v1AccountNumber = z.string().regex(/^[A-Za-z0-9-]{1,34}$/);

/**
 * El monto **como texto**, `^[0-9]{1,5}\.[0-9]{2}$`, entre `0.01` y `10000.00`.
 *
 * Como texto y no como número, y el contrato dice por qué: «para evitar errores
 * de punto flotante». Es la misma conclusión a la que este repositorio había
 * llegado por su lado —`NUMERIC(14,2)` en la base, centavos enteros en los
 * mensajes— y el acuerdo entre las dos es tranquilizador.
 *
 * El patrón admite hasta `99999.99`; el **límite de negocio** son `10000.00` y
 * no se valida aquí: un monto de `50000.00` es sintácticamente correcto y se
 * rechaza con `AMOUNT_LIMIT_EXCEEDED` **por callback**, que es lo que el
 * contrato pide. Confundir las dos cosas convertiría un rechazo de negocio en
 * un `400`, y el otro banco perdería el motivo.
 */
export const v1Amount = z.string().regex(/^[0-9]{1,5}\.[0-9]{2}$/);

export const v1Currency = z.literal('GTQ');

/**
 * Los siete motivos de rechazo. **Siete, no los ocho que teníamos.**
 *
 * Tres de los nuestros no eran motivos de rechazo sino códigos HTTP, y eso es
 * más que un renombrado: un banco no autorizado no recibe un callback
 * explicándole que no lo está — recibe un `401` y no se entera de nada de la
 * transferencia, que es lo correcto.
 */
export const v1ReasonCode = z.enum([
  'ACCOUNT_NOT_FOUND',
  'ACCOUNT_INACTIVE',
  'AMOUNT_LIMIT_EXCEEDED',
  'CURRENCY_NOT_SUPPORTED',
  'EXPIRED',
  'CANCELLED',
  'PROCESSING_ERROR',
]);
export type V1ReasonCode = z.infer<typeof v1ReasonCode>;

/** El estado de un depósito **en el banco receptor**. */
export const v1TransferState = z.enum(['PROCESSING', 'ACCEPTED', 'REJECTED', 'CANCELLED']);
export type V1TransferState = z.infer<typeof v1TransferState>;

/** `POST /transfers` — el cuerpo del depósito que llega. */
export const v1TransferRequest = z
  .object({
    interbankTransferId: uuidV4,
    originBankCode: v1BankCode,
    destinationBankCode: v1BankCode,
    originAccount: v1AccountNumber,
    destinationAccount: v1AccountNumber,
    amount: v1Amount,
    currency: v1Currency,
    description: z.string().max(140).optional(),
    createdAt: isoTimestamp,
    /** `createdAt` + 180 s. El receptor **no puede acreditar después**. */
    expiresAt: isoTimestamp,
  })
  .strict();
export type V1TransferRequest = z.infer<typeof v1TransferRequest>;

/** `202` de `POST /transfers`. */
export const v1TransferAck = z.object({
  interbankTransferId: uuidV4,
  status: z.literal('PROCESSING'),
  receivedAt: isoTimestamp,
});
export type V1TransferAck = z.infer<typeof v1TransferAck>;

/** `GET /transfers/{id}`, y también el `200` de una solicitud repetida. */
export const v1TransferStatus = z.object({
  interbankTransferId: uuidV4,
  status: v1TransferState,
  reasonCode: v1ReasonCode.optional(),
  updatedAt: isoTimestamp,
});
export type V1TransferStatus = z.infer<typeof v1TransferStatus>;

/**
 * `POST /transfers/{id}/result` — el callback, que **lo expone el emisor**.
 *
 * Que lo exponga el emisor es la diferencia de diseño más grande con lo que
 * teníamos: la URL del callback **no se configura**, se deriva de la URL base
 * de la pareja. Un banco no le pregunta al otro a dónde contestar.
 */
export const v1TransferResult = z
  .object({
    interbankTransferId: uuidV4,
    destinationBankCode: v1BankCode,
    status: z.enum(['ACCEPTED', 'REJECTED']),
    reasonCode: v1ReasonCode.optional(),
    reasonMessage: z.string().max(200).optional(),
    processedAt: isoTimestamp,
  })
  .strict();
export type V1TransferResult = z.infer<typeof v1TransferResult>;

export const v1CallbackAck = z.object({
  interbankTransferId: uuidV4,
  received: z.boolean(),
});

/** `POST /transfers/{id}/cancel`. */
export const v1CancelRequest = z
  .object({
    originBankCode: v1BankCode,
    reason: z.enum(['TIMEOUT', 'CLIENT_REQUEST']),
  })
  .strict();
export type V1CancelRequest = z.infer<typeof v1CancelRequest>;

/**
 * Las tres respuestas posibles a una cancelación, y las tres son distintas para
 * el emisor: `CANCELLED` libera la reserva, `ALREADY_ACCEPTED` **confirma el
 * débito** y `ALREADY_REJECTED` libera. Tratar las tres igual es perder dinero
 * o duplicarlo.
 */
export const v1CancelResult = z.enum(['CANCELLED', 'ALREADY_ACCEPTED', 'ALREADY_REJECTED']);
export type V1CancelResult = z.infer<typeof v1CancelResult>;

export const v1CancelResponse = z.object({
  interbankTransferId: uuidV4,
  result: v1CancelResult,
});
export type V1CancelResponse = z.infer<typeof v1CancelResponse>;

/**
 * `POST /reversals` — la devolución de un depósito que se acreditó por un
 * callback tardío.
 *
 * El caso excepcional, y el que más fácil se omite por parecer raro: el emisor
 * ya liberó la reserva y **después** llegó un `ACCEPTED`. El receptor tiene el
 * dinero acreditado y el emisor no lo descontó, así que hay que deshacerlo — y
 * el contrato dice cómo: debitando la cuenta y **mandando un depósito nuevo**
 * por el flujo normal, no con una operación mágica.
 */
export const v1ReversalRequest = z
  .object({
    reversalId: uuidV4,
    originalTransferId: uuidV4,
    originBankCode: v1BankCode,
    amount: v1Amount,
    currency: v1Currency,
  })
  .strict();
export type V1ReversalRequest = z.infer<typeof v1ReversalRequest>;

export const v1ReversalStatus = z.object({
  reversalId: uuidV4,
  status: z.enum(['PROCESSING', 'COMPLETED', 'FAILED']),
  /** El depósito de devolución que se mandó. Presente en `COMPLETED`. */
  refundTransferId: uuidV4.optional(),
  reasonMessage: z.string().optional(),
});
export type V1ReversalStatus = z.infer<typeof v1ReversalStatus>;

/** `GET /reconciliation?date=` — la conciliación diaria obligatoria. */
export const v1ReconciliationItem = z.object({
  interbankTransferId: uuidV4,
  amount: v1Amount,
  currency: v1Currency,
  status: v1TransferState,
  updatedAt: isoTimestamp,
});

export const v1ReconciliationPage = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  page: z.number().int(),
  pageSize: z.number().int(),
  totalItems: z.number().int(),
  items: z.array(v1ReconciliationItem),
});
export type V1ReconciliationPage = z.infer<typeof v1ReconciliationPage>;

/** El cuerpo de error, con su propio conjunto cerrado de códigos. */
export const v1ErrorCode = z.enum([
  'VALIDATION_ERROR',
  'UNAUTHORIZED',
  'NOT_FOUND',
  'IDEMPOTENCY_CONFLICT',
  'EXPIRED',
  'SERVICE_UNAVAILABLE',
]);
export type V1ErrorCode = z.infer<typeof v1ErrorCode>;

export const v1Error = z.object({
  code: v1ErrorCode,
  message: z.string(),
  timestamp: isoTimestamp,
});

/** `GET /health`, sin autenticación. */
export const v1Health = z.object({
  status: z.enum(['UP', 'DEGRADED']),
  bankCode: v1BankCode,
});

/**
 * Los 180 segundos de vigencia, en un solo sitio.
 *
 * El contrato los fija y **no son configurables**: un banco que los alargara
 * acreditaría depósitos que su pareja ya dio por vencidos, que es la forma
 * exacta de acreditar dos veces el mismo dinero.
 */
export const V1_TRANSFER_TTL_MS = 180_000;

/**
 * El margen antes de liberar una reserva de la que nadie contestó: 300 s
 * **después** de `expiresAt`.
 *
 * Es el número más delicado del contrato. Liberar antes es arriesgarse a que el
 * receptor haya acreditado y esté reintentando su callback — el dinero saldría
 * dos veces del mismo sitio, que es el 50 % que §8.3 penaliza. El contrato pide
 * además **alertar** cuando se llega aquí, porque significa que el otro banco
 * no contestó ni a la consulta ni a la cancelación.
 */
export const V1_RELEASE_MARGIN_MS = 300_000;

/** El tope por operación: Q10 000,00, en centavos. */
export const V1_MAX_AMOUNT_MINOR = 1_000_000;

/** El mínimo: Q0,01. */
export const V1_MIN_AMOUNT_MINOR = 1;

/**
 * Centavos → el texto del contrato. `12500` → `"125.00"`.
 *
 * Sin coma flotante: se parte el entero, no se divide. `12500 / 100` da
 * `125` y hay que volver a formatearlo; peor, `1 / 100` da `0.01` pero
 * `1215 / 100` da `12.15` sólo por suerte del redondeo binario.
 */
export function v1AmountFromMinor(amountMinor: number): string {
  if (!Number.isSafeInteger(amountMinor) || amountMinor < 0) {
    throw new RangeError(`Un monto en centavos no puede ser ${amountMinor}.`);
  }
  const entero = Math.trunc(amountMinor / 100);
  const centavos = amountMinor % 100;
  return `${entero}.${String(centavos).padStart(2, '0')}`;
}

/** El texto del contrato → centavos. `"125.00"` → `12500`. */
export function v1AmountToMinor(amount: string): number | null {
  const match = /^([0-9]{1,5})\.([0-9]{2})$/.exec(amount);
  if (match === null) return null;
  return Number(`${match[1]}${match[2]}`);
}

/** `expiresAt` a partir de `createdAt`, que es la única forma de calcularlo. */
export function v1ExpiresAt(createdAt: Date): Date {
  return new Date(createdAt.getTime() + V1_TRANSFER_TTL_MS);
}
