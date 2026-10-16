import { z } from 'zod';

import {
  amountMinor,
  currencyCode,
  idempotencyKey,
  isoTimestamp,
  uuidV4,
} from '../../schemas/primitives';
import { defineContract } from '../contract';

/** Provisional wire shapes until the course publishes its OpenAPI contract. */
export const bankCode = z.string().regex(/^[A-Z][A-Z0-9_]{1,31}$/);
export const interbankTransferId = z.string().min(1).max(128);
export const interbankMoney = z.object({ amountMinor, currency: currencyCode });

/**
 * La cuenta destino **tal como la escribió el otro banco** (T-56).
 *
 * Una cadena opaca y no un UUID, y es un cambio de criterio deliberado. Hasta
 * T-56 este campo era `uuidV4`, lo que tenía una consecuencia que nadie
 * buscaba: un banco pareja que mandara un número de cuenta —`001-2345-6`, lo
 * que manda un banco de verdad— recibía un **400 sin callback**. Su depósito
 * se quedaba esperando hasta que venciera *su* plazo, sin saber por qué, y
 * nuestra bitácora no tenía ni una fila de lo que había pasado.
 *
 * Con una cadena, ese depósito entra, se registra, se rechaza con
 * `ACCOUNT_NOT_FOUND` y **se le contesta por callback**. Un rechazo explicado
 * es interoperable; un `400` es un silencio.
 *
 * Que una referencia que no es un UUID no puede ser una cuenta de este banco
 * lo decide `domain/interbank-receipt.ts`, no el esquema: es una regla de
 * negocio de **este** banco y no una propiedad del mensaje. Si el contrato
 * oficial fija otro formato, cambia la regla y no el contrato.
 */
export const interbankAccountRef = z.string().min(1).max(64);

/**
 * El **cuerpo que manda el banco pareja**, que no es el comando que viaja por
 * el broker (T-56).
 *
 * Vive en los contratos y no en el Gateway porque es parte del acuerdo con el
 * otro banco: el catálogo es el único sitio donde se define la forma del
 * mensaje interbancario, y tenerla en el borde la habría dejado invisible para
 * la prueba de contratos.
 *
 * Tres diferencias con el comando interno, y las tres existen para que un banco
 * cuyo contrato no sea idéntico al nuestro **interopere en el primer intento**
 * en vez de recibir un `400` que no explica nada:
 *
 * 1. **`timestamp` es obligatorio y es suyo.** §4.1 lo pide entre los datos
 *    mínimos. Antes de T-56 el borde era `.strict()` sin ese campo, así que un
 *    banco que lo mandaba —como pide el enunciado— recibía un `400` por
 *    mandarlo bien.
 * 2. **El monto se acepta en los dos formatos**: `amountMinor` entero, que es
 *    el nuestro, o `value` decimal, que es lo que manda quien piensa en
 *    quetzales. La conversión ocurre en el borde, con aritmética entera.
 * 3. **La cuenta es una cadena.** Ver `interbankAccountRef`.
 */
export const interbankPartnerMoney = z.union([
  z.object({ amountMinor, currency: currencyCode }).strict(),
  z.object({ value: z.union([z.string(), z.number()]), currency: currencyCode }).strict(),
]);

export const interbankDepositRequest = z
  .object({
    interbankTransferId,
    idempotencyKey,
    originBankCode: bankCode,
    destinationBankCode: bankCode,
    accountId: interbankAccountRef,
    amount: interbankPartnerMoney,
    timestamp: isoTimestamp,
  })
  .strict();
export type InterbankDepositRequest = z.infer<typeof interbankDepositRequest>;

/**
 * Un monto decimal a centavos **sin que un `float` lo toque**.
 *
 * `Math.round(1.15 * 100)` es la forma habitual y está mal: en coma flotante
 * `1.15 * 100` es `114.99999999999999`, y redondear eso es apostar. Aquí se
 * parte la cadena por el punto y se cuenta con enteros, que es la misma regla
 * que Account aplica desde T-17 — ningún `float` toca el dinero.
 *
 * Devuelve `null` cuando no es un entero con dos decimales o menos; el llamador
 * lo convierte en el rechazo que corresponda.
 */
export function interbankMinorUnits(value: string | number): number | null {
  const text = typeof value === 'number' ? value.toString() : value.trim();
  const match = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(text);
  if (match === null) return null;

  const [, signo = '', entero = '0', decimales = ''] = match;
  const centavos = Number(`${entero}${decimales.padEnd(2, '0')}`);
  if (!Number.isSafeInteger(centavos)) return null;

  return signo === '-' ? -centavos : centavos;
}
export const interbankRejectionReason = z.enum([
  'ACCOUNT_NOT_FOUND',
  'ACCOUNT_INACTIVE',
  'AMOUNT_EXCEEDS_LIMIT',
  'UNSUPPORTED_CURRENCY',
  'WRONG_DESTINATION_BANK',
  'BANK_NOT_AUTHORIZED',
  'INVALID_REQUEST',
  'IDEMPOTENCY_CONFLICT',
]);

export const paymentInterbankReceiveV1 = defineContract({
  name: 'payment.interbank.receive.v1',
  category: 'command',
  producer: 'gateway',
  consumers: ['payment-service'],
  schema: z.object({
    depositId: uuidV4,
    interbankTransferId,
    idempotencyKey,
    originBankCode: bankCode,
    destinationBankCode: bankCode,
    accountId: interbankAccountRef,
    amount: interbankMoney,
    /**
     * Cuándo dice el **otro banco** que originó el depósito. §4.1 lo pide entre
     * los datos mínimos del mensaje, y hasta T-56 no estaba: el Gateway
     * rechazaba el campo por `.strict()` y ponía el suyo.
     */
    partnerTimestamp: isoTimestamp,
    /**
     * Cuándo lo recibimos **nosotros**. Separado del anterior a propósito: con
     * un solo sello de tiempo no se puede distinguir un reloj desfasado de un
     * depósito que tardó en llegar, y los dos se arreglan distinto.
     */
    requestedAt: isoTimestamp,
  }),
});
export type PaymentInterbankReceiveV1 = z.infer<typeof paymentInterbankReceiveV1.schema>;

export const accountInterbankEligibilityQueryV1 = defineContract({
  name: 'account.interbank.eligibility.query.v1',
  category: 'command',
  producer: 'payment-service',
  consumers: ['account-service'],
  schema: z.object({ depositId: uuidV4, accountId: uuidV4 }),
});
export type AccountInterbankEligibilityQueryV1 = z.infer<
  typeof accountInterbankEligibilityQueryV1.schema
>;

export const accountInterbankEligibilityRepliedV1 = defineContract({
  name: 'account.interbank.eligibility.replied.v1',
  category: 'reply',
  producer: 'account-service',
  consumers: ['payment-service'],
  schema: z
    .object({
      depositId: uuidV4,
      accountId: uuidV4,
      eligible: z.boolean(),
      reason: z.enum(['ACCOUNT_NOT_FOUND', 'ACCOUNT_INACTIVE']).nullable(),
    })
    .refine((value) => value.eligible === (value.reason === null), { path: ['reason'] }),
});
export type AccountInterbankEligibilityRepliedV1 = z.infer<
  typeof accountInterbankEligibilityRepliedV1.schema
>;

export const accountInterbankCreditRequestedV1 = defineContract({
  name: 'account.interbank.credit.requested.v1',
  category: 'command',
  producer: 'payment-service',
  consumers: ['account-service'],
  schema: z.object({ depositId: uuidV4, accountId: uuidV4, amount: interbankMoney }),
});
export type AccountInterbankCreditRequestedV1 = z.infer<
  typeof accountInterbankCreditRequestedV1.schema
>;

export const accountInterbankCreditedV1 = defineContract({
  name: 'account.interbank.credited.v1',
  category: 'event',
  producer: 'account-service',
  consumers: ['payment-service', 'notification-audit-service'],
  schema: z.object({ depositId: uuidV4, accountId: uuidV4, creditedAt: isoTimestamp }),
});
export type AccountInterbankCreditedV1 = z.infer<typeof accountInterbankCreditedV1.schema>;

export const accountInterbankCreditRejectedV1 = defineContract({
  name: 'account.interbank.credit.rejected.v1',
  category: 'event',
  producer: 'account-service',
  consumers: ['payment-service', 'notification-audit-service'],
  schema: z.object({
    depositId: uuidV4,
    accountId: uuidV4,
    reason: z.enum(['ACCOUNT_NOT_FOUND', 'ACCOUNT_INACTIVE', 'INVALID_REQUEST']),
  }),
});
export type AccountInterbankCreditRejectedV1 = z.infer<
  typeof accountInterbankCreditRejectedV1.schema
>;

export const paymentInterbankAcceptedV1 = defineContract({
  name: 'payment.interbank.accepted.v1',
  category: 'event',
  producer: 'payment-service',
  consumers: ['notification-audit-service'],
  schema: z.object({ depositId: uuidV4, decidedAt: isoTimestamp }),
});
export type PaymentInterbankAcceptedV1 = z.infer<typeof paymentInterbankAcceptedV1.schema>;

export const paymentInterbankRejectedV1 = defineContract({
  name: 'payment.interbank.rejected.v1',
  category: 'event',
  producer: 'payment-service',
  consumers: ['notification-audit-service'],
  schema: z.object({
    depositId: uuidV4,
    reason: interbankRejectionReason,
    decidedAt: isoTimestamp,
  }),
});
export type PaymentInterbankRejectedV1 = z.infer<typeof paymentInterbankRejectedV1.schema>;
