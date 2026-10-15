import { z } from 'zod';

import { idempotencyKey, isoTimestamp, uuidV4 } from '../../schemas/primitives';
import { defineContract } from '../contract';
import { bankCode, interbankRejectionReason, interbankTransferId } from './incoming.v1';

/**
 * Enviar un depósito al banco pareja (Fase 3, §4.1 — Integración interbancaria;
 * T-47).
 *
 * **Es la Saga que ya existe, no una nueva.** Un depósito saliente es un débito
 * en la cuenta origen que se confirma o se compensa, y eso es exactamente lo
 * que el flujo de transferencias hace desde T-18: KYC del cliente origen,
 * débito bajo bloqueo de fila, el paso de pago, y compensación si el pago no
 * sale. Lo único que cambia es a quién se le pide el pago —al banco pareja por
 * HTTP, en vez de al proveedor simulado— y que **la respuesta no llega al
 * momento**: el banco pareja contesta `202 Accepted` y el resultado vuelve
 * después, por callback.
 *
 * De ahí la forma de estos tres mensajes:
 *
 * - `interbank.transfer.requested.v1` arranca la Saga. Es un contrato propio y
 *   no un campo más en `transfer.requested.v1` porque **no hay cuenta destino
 *   local**: el destino vive en otro banco y se nombra con una cadena que ese
 *   banco entiende, no con un UUID de este sistema. Hacer `targetAccount`
 *   opcional habría debilitado el invariante T-2 (origen ≠ destino) para todas
 *   las transferencias, incluidas las internas.
 * - `payment.interbank.callback.received.v1` es la decisión del banco pareja
 *   entrando por el Gateway. Un comando y no un evento: dice «registra esta
 *   decisión», y el único que puede hacerlo es Payment.
 * - `payment.interbank.sent.v1` es el rastro de cada cambio de estado, que
 *   §4.1 pide explícitamente («Logs de cada cambio de estado del depósito») y
 *   que la auditoría necesita para contar la historia sin leer la base de
 *   Payment.
 *
 * Lo que **no** hay aquí es un contrato para cerrar la Saga: el resultado viaja
 * por `payment.succeeded.v1` y `payment.failed.v1`, los mismos que usa el
 * proveedor simulado. Así la compensación, el historial, el estado de fase y la
 * notificación salen de la maquinaria que ya está probada, en vez de una
 * segunda copia que habría que mantener igual de correcta.
 */

/**
 * Los seis estados que §4.1 enumera para el depósito interbancario.
 *
 * `PENDING` es «lo tenemos, no lo hemos mandado»; `SENT`, «el banco pareja
 * acusó recibo con 202 y debe su respuesta»; `ACCEPTED` y `REJECTED` son su
 * decisión; `TIMEOUT` es que no llegó antes del vencimiento; y `REVERSED` es
 * que el dinero volvió a la cuenta origen. Los tres últimos **no** son
 * sinónimos: un rechazo y un vencimiento se compensan igual, pero sólo uno de
 * los dos dice que el otro banco opinó.
 */
export const interbankSendState = z.enum([
  'PENDING',
  'SENT',
  'ACCEPTED',
  'REJECTED',
  'TIMEOUT',
  'REVERSED',
]);
export type InterbankSendState = z.infer<typeof interbankSendState>;

/**
 * La cuenta de liquidación interbancaria de este banco: un identificador fijo y
 * conocido (T-47).
 *
 * **Por qué existe.** Un depósito al banco pareja sale de la cuenta del cliente
 * y tiene que entrar en algún sitio, porque la partida es doble y porque la
 * Saga acredita después de pagar. Ese sitio es una cuenta propia que
 * representa lo que este banco le debe al otro — lo que la banca llama una
 * cuenta de liquidación. Sin ella haría falta una transferencia con destino
 * nulo, que es la forma que este catálogo ya rechazó para los depósitos en
 * ventanilla.
 *
 * **Por qué una constante y no una consulta.** Es el mismo trato que reciben
 * las tres cuentas de recaudación de los billers: identificador fijo, sembrado
 * de forma idempotente al arrancar Account Service, y conocido por quien lo
 * necesita. La diferencia con los billers es que allí hay un catálogo que una
 * pantalla lista —y por eso hay una consulta— y aquí hay **una** cuenta del
 * sistema que ninguna pantalla elige.
 *
 * No la ve nadie: pertenece a un cliente sintético, así que no aparece en el
 * listado de cuentas de ninguna persona, y no lleva `billerCode`, así que
 * tampoco sale en el desplegable de pago de servicios.
 */
export const INTERBANK_SETTLEMENT_ACCOUNT_ID = 'c0000000-0000-4000-8000-00000000000a';

/** Cómo se nombra una cuenta del banco pareja: una cadena que él entiende. */
export const partnerAccountRef = z.string().min(1).max(64);

/**
 * A dónde va de verdad el dinero, cuando el destino está en otro banco.
 *
 * Viaja como bloque OPCIONAL en `transfer.requested.v1` y en
 * `payment.requested.v1`, aditivo y compatible, igual que `paymentScenario` en
 * T-15 y `serviceReference` en el prototipo: un mensaje que lo omite valida
 * exactamente como antes, así que la versión no se mueve y ningún consumidor
 * cambia.
 *
 * **Por qué un bloque y no una Saga aparte.** Un depósito al banco pareja es,
 * en los libros de este banco, un débito en la cuenta del cliente y un crédito
 * en la **cuenta de liquidación interbancaria** — una cuenta propia que
 * representa lo que se le debe al otro banco. Visto así, es una transferencia
 * interna de las de siempre: `targetAccount` sigue siendo un UUID de este
 * sistema, origen ≠ destino se sigue cumpliendo, la partida sigue siendo doble
 * y la máquina de estados de la Saga **no cambia ni una línea**. Lo único
 * distinto es a quién se le pide el pago y que su respuesta llega después.
 *
 * La alternativa —una transferencia con cuenta destino nula y un camino nuevo
 * en la máquina— es justo la forma que este catálogo rechazó para los
 * depósitos en ventanilla, y por el mismo motivo: un orquestador con un estado
 * que no puede fallar y una columna que a veces no significa nada.
 */
export const interbankDestination = z.object({
  bankCode,
  /** La cuenta en el banco pareja: una cadena que él entiende, no un UUID nuestro. */
  account: partnerAccountRef,
  /**
   * El identificador con el que el depósito viaja al otro banco, y la clave de
   * idempotencia con la que él lo deduplica. Lo genera el Gateway: un
   * identificador derivado del `transactionId` sería adivinable desde fuera.
   */
  interbankTransferId,
  idempotencyKey,
});
export type InterbankDestination = z.infer<typeof interbankDestination>;

export const paymentInterbankCallbackReceivedV1 = defineContract({
  name: 'payment.interbank.callback.received.v1',
  category: 'command',
  producer: 'gateway',
  consumers: ['payment-service'],
  /**
   * Una unión discriminada y no un objeto con `refine`: «un depósito aceptado
   * no lleva motivo» queda dicho por la ESTRUCTURA, no por una regla aparte que
   * hay que leer para entender la forma. El consumidor estrecha por `status` y
   * el compilador le garantiza que `reason` existe sólo en la rama que lo
   * tiene.
   */
  schema: z.discriminatedUnion('status', [
    z.object({
      interbankTransferId,
      status: z.literal('ACCEPTED'),
      receivedAt: isoTimestamp,
    }),
    z.object({
      interbankTransferId,
      status: z.literal('REJECTED'),
      reason: interbankRejectionReason,
      receivedAt: isoTimestamp,
    }),
  ]),
});
export type PaymentInterbankCallbackReceivedV1 = z.infer<
  typeof paymentInterbankCallbackReceivedV1.schema
>;

export const paymentInterbankSentV1 = defineContract({
  name: 'payment.interbank.sent.v1',
  category: 'event',
  producer: 'payment-service',
  consumers: ['notification-audit-service'],
  schema: z.object({
    paymentId: uuidV4,
    transactionId: uuidV4,
    interbankTransferId,
    state: interbankSendState,
    /** El motivo del rechazo o del vencimiento; `null` en los demás estados. */
    reason: z.string().max(64).nullable(),
    occurredAt: isoTimestamp,
  }),
});
export type PaymentInterbankSentV1 = z.infer<typeof paymentInterbankSentV1.schema>;
