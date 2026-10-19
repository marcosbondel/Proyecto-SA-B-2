/**
 * El reembolso de un reverso, como una función pura (T-60, defecto de QA 13c).
 *
 * ## El defecto que esto cierra
 *
 * Cuando el banco pareja acredita un depósito **después** de que lo liberamos,
 * el cliente ya recuperó su dinero (la compensación) y le pedimos un reverso
 * (`POST /reversals`). El contrato dice cómo lo cumple el receptor: «debe
 * debitar la cuenta acreditada y devolver el monto con un depósito nuevo hacia
 * el emisor, usando el flujo normal de `POST /transfers`». Ese depósito llega a
 * nuestro Gateway como cualquier otro, dirigido a la cuenta origen del envío —
 * y entraba por el camino de recepción, que lo acreditaba **al cliente**: el
 * mismo dinero dos veces, la compensación y el reembolso. Es el 50 % de §8.3.
 *
 * ## La regla
 *
 * Un depósito entrante que **es el reembolso de un reverso nuestro** no llega
 * al cliente: lo absorbe la cuenta de liquidación interbancaria. El cliente ya
 * está compensado; lo que el banco recibe del pareja es justamente la partida
 * que cierra el descuadre.
 *
 * ## Por qué hace falta decidir y no sólo comparar
 *
 * El reembolso suele llegar **antes** de que `GET /reversals/{id}` diga
 * `COMPLETED` con su `refundTransferId` (el receptor manda el depósito y
 * después marca el reverso completado). En ese intervalo no se puede saber si
 * el depósito es el reembolso o un depósito cualquiera que casualmente tiene el
 * mismo monto y destino. Acreditarlo al cliente «por si acaso» duplica el
 * dinero; mandarlo a liquidación «por si acaso» le quita a un cliente un
 * depósito legítimo. Así que **se retiene**: se acepta (el `202` ya se dio) y no
 * se acredita nada hasta que el reverso se resuelva.
 *
 * Este archivo no importa nada fuera del dominio.
 */

/** En qué punto está el reverso que se esperaba, visto desde un depósito entrante. */
export interface ExpectedRefund {
  /** El estado del reverso que pedimos. */
  readonly state: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
  /** El depósito de devolución que el banco pareja dijo haber mandado, si ya lo dijo. */
  readonly refundTransferId: string | null;
}

/** Qué hacer con un depósito entrante frente a un reverso abierto. */
export type RefundDecision =
  /** No tiene que ver con ningún reverso: se acredita al cliente como siempre. */
  | { readonly kind: 'NORMAL' }
  /**
   * Es el reembolso (el pareja ya dio su identificador y coincide): se acredita
   * a la cuenta de liquidación, nunca al cliente.
   */
  | { readonly kind: 'SETTLE'; readonly reason: 'MATCHED_BY_ID' | 'MATCHED_BY_AMOUNT' }
  /** Todavía no se sabe: se acepta y se retiene hasta que el reverso se resuelva. */
  | { readonly kind: 'HOLD' };

/**
 * Qué se hace con un depósito entrante `inboundId` dado el reverso esperado
 * (o `null` si no hay ninguno con el mismo banco, monto y destino).
 *
 * - Sin reverso, o con uno que **falló**: normal. Un reverso fallido no
 *   garantiza que el pareja no mandara nada, pero tampoco hay motivo para
 *   desviar un depósito que nadie ha identificado como reembolso.
 * - `PENDING`/`PROCESSING`: se retiene. Es el caso habitual.
 * - `COMPLETED` con identificador: sólo el depósito con **ese** identificador es
 *   el reembolso; los demás son depósitos normales aunque se parezcan.
 * - `COMPLETED` **sin** identificador: el contrato lo exige («incluye el id del
 *   depósito de devolución»), así que el pareja lo incumplió. Aquí se prefiere
 *   no duplicar: el depósito que coincide en banco, monto y destino se trata
 *   como el reembolso, y quien llama lo registra en ERROR.
 */
export function decideRefund(inboundId: string, expected: ExpectedRefund | null): RefundDecision {
  if (expected === null || expected.state === 'FAILED') return { kind: 'NORMAL' };

  if (expected.state === 'PENDING' || expected.state === 'PROCESSING') return { kind: 'HOLD' };

  if (expected.refundTransferId === null) return { kind: 'SETTLE', reason: 'MATCHED_BY_AMOUNT' };

  return expected.refundTransferId === inboundId
    ? { kind: 'SETTLE', reason: 'MATCHED_BY_ID' }
    : { kind: 'NORMAL' };
}

/** Lo que dice el reverso cuando se vuelve a mirar para resolver un depósito retenido. */
export type HeldResolution =
  /** Sigue sin saberse: se espera, hasta el vencimiento del propio depósito. */
  | { readonly kind: 'WAIT' }
  /** Era el reembolso: a la cuenta de liquidación. */
  | { readonly kind: 'SETTLE'; readonly reason: 'MATCHED_BY_ID' | 'MATCHED_BY_AMOUNT' }
  /** No era el reembolso (o el reverso falló): se acredita al cliente, con retraso. */
  | { readonly kind: 'RELEASE'; readonly reason: 'DIFFERENT_REFUND_ID' | 'REVERSAL_FAILED' };

/** Resuelve un depósito retenido a la luz del estado actual de su reverso. */
export function resolveHeld(inboundId: string, reversal: ExpectedRefund): HeldResolution {
  switch (reversal.state) {
    case 'PENDING':
    case 'PROCESSING':
      return { kind: 'WAIT' };
    case 'FAILED':
      return { kind: 'RELEASE', reason: 'REVERSAL_FAILED' };
    case 'COMPLETED': {
      const decision = decideRefund(inboundId, reversal);

      return decision.kind === 'SETTLE'
        ? decision
        : { kind: 'RELEASE', reason: 'DIFFERENT_REFUND_ID' };
    }
  }
}
