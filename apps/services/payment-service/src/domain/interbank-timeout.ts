/**
 * El protocolo de TIMEOUT del emisor, como una función pura (TD-095).
 *
 * **Lo que esto evita es pagar dos veces el mismo dinero.** Hasta aquí, un
 * depósito que no recibía su callback en 30 s se compensaba directamente: el
 * dinero volvía a la cuenta del cliente y la transferencia se cerraba en
 * `FAILED`. Pero el banco pareja **tiene 24 horas** para reintentar su callback
 * según el contrato oficial, así que durante esas 24 horas nuestro «no
 * contestó» podía convivir con su «ya lo acredité». Los dos bancos creen haber
 * hecho lo correcto y el descuadre aparece en la conciliación diaria, que es la
 * variante del «monto perdido sin compensación» que §8.3 penaliza con un 50 % y
 * la más difícil de detectar.
 *
 * El contrato define cinco pasos y el orden **es** el protocolo:
 *
 * 1. A los `V1_TRANSFER_TTL_MS` (180 s) el depósito pasa a `TIMEOUT` **con el
 *    monto todavía reservado**. Esto es lo que cambia de raíz: `TIMEOUT` deja de
 *    ser un veredicto y pasa a ser una pregunta abierta.
 * 2. Se **consulta** `GET /transfers/{id}`, con reintentos.
 * 3. Si eso da `404` o `PROCESSING`, se **cancela** con
 *    `POST /transfers/{id}/cancel`, y las tres respuestas del contrato deciden:
 *    `CANCELLED` y `ALREADY_REJECTED` liberan, `ALREADY_ACCEPTED` confirma.
 * 4. Si el receptor no contesta ni a la consulta ni a la cancelación, la reserva
 *    sólo se libera después de `expiresAt + V1_RELEASE_MARGIN_MS` (300 s), **y
 *    hay que alertar**: es la única rama en la que liberamos sin saber.
 * 5. Un `ACCEPTED` que llegue sobre una transferencia ya liberada es un
 *    incidente de nivel ERROR, y se resuelve pidiendo `POST /reversals`.
 *
 * ## Por qué es pura
 *
 * No hay reloj, ni base de datos, ni HTTP a la vista: los hechos entran como
 * argumentos y sale una decisión. Es lo mismo que hace `provider.ts` con un
 * intento de pago, y por la misma razón — un protocolo que decide cuándo se
 * puede devolver dinero del cliente tiene que poder discutirse en una prueba de
 * tres líneas, no levantando dos bancos.
 *
 * **Este archivo no importa nada fuera del dominio**, `@bank/contracts`
 * incluido: `pnpm lint` lo exige. Los dos plazos del contrato se reciben como
 * argumentos, no se leen de la constante — así la función se puede probar con
 * plazos de milisegundos y el que manda sigue siendo el contrato.
 */

/** Lo que el banco pareja dijo cuando se le consultó, o que no se le pudo consultar. */
export type PartnerProbe =
  /** `GET /transfers/{id}` contestó, con uno de los cuatro estados del contrato. */
  | { readonly kind: 'ANSWERED'; readonly status: 'PROCESSING' | 'ACCEPTED' | 'REJECTED' | 'CANCELLED' }
  /**
   * `404`: el banco pareja **no conoce** este depósito.
   *
   * No es lo mismo que «lo rechazó», y confundirlos sería liberar por el motivo
   * equivocado. Lo que dice un `404` es que nuestra solicitud no llegó nunca, o
   * llegó y no la guardaron; el contrato manda cancelar igual, porque cancelar
   * algo que no existe es inocuo y es la única forma de dejarlo por escrito.
   */
  | { readonly kind: 'UNKNOWN' }
  /** No se pudo preguntar: red, `5xx`, tiempo límite. Nadie ha opinado. */
  | { readonly kind: 'UNREACHABLE' };

/** Lo que `POST /transfers/{id}/cancel` contestó, o que no se pudo pedir. */
export type PartnerCancel =
  | { readonly kind: 'ANSWERED'; readonly result: 'CANCELLED' | 'ALREADY_ACCEPTED' | 'ALREADY_REJECTED' }
  | { readonly kind: 'UNREACHABLE' };

/** Los hechos de un depósito vencido, sin nada más. */
export interface TimeoutFacts {
  /** Ahora. Entra como dato: esta función no tiene reloj. */
  readonly now: Date;
  /** Cuándo expira el depósito según el contrato — `createdAt + 180 s`. */
  readonly expiresAt: Date;
  /** `expiresAt + 300 s`: antes de esto no se libera nada a ciegas. */
  readonly releaseNotBefore: Date;
  /** La última consulta, o `null` si todavía no se ha preguntado. */
  readonly probe: PartnerProbe | null;
  /** La última cancelación pedida, o `null` si todavía no se ha pedido. */
  readonly cancel: PartnerCancel | null;
}

/** Qué hacer ahora con un depósito vencido. */
export type TimeoutAction =
  /** Preguntar: `GET /transfers/{id}`. */
  | { readonly kind: 'PROBE' }
  /** Cancelar: `POST /transfers/{id}/cancel`. */
  | { readonly kind: 'CANCEL' }
  /** El otro banco acreditó. Cerrar la transferencia bien. */
  | { readonly kind: 'CONFIRM' }
  /** Hay constancia de que no se acreditó. Devolver el dinero, con su motivo. */
  | { readonly kind: 'RELEASE'; readonly reason: string }
  /**
   * Liberar sin saber, pasado el margen, **y alertar**.
   *
   * Es la única rama que devuelve dinero sin una respuesta del otro banco, y por
   * eso lleva la alerta pegada al tipo en vez de en una línea de log que alguien
   * pueda quitar: una liberación a ciegas que nadie mira es exactamente el
   * descuadre que este protocolo existe para evitar.
   */
  | { readonly kind: 'RELEASE_UNVERIFIED'; readonly reason: string }
  /** Todavía no toca: esperar al siguiente barrido. */
  | { readonly kind: 'WAIT'; readonly until: Date };

/**
 * Qué toca hacer con un depósito que venció.
 *
 * El orden de las ramas es el orden del contrato, y las dos primeras son las
 * que importan: **una respuesta del otro banco manda sobre cualquier plazo**.
 * Si sabemos que acreditó, confirmamos aunque el margen haya pasado; si sabemos
 * que no, liberamos aunque no haya pasado. El margen sólo gobierna el caso en
 * que no sabemos nada, que es el único en el que hay que elegir entre retener el
 * dinero del cliente y arriesgarse a pagarlo dos veces.
 */
export function resolveTimeout(facts: TimeoutFacts): TimeoutAction {
  /*
   * 1. La cancelación, si ya se pidió y contestó. Va antes que la consulta
   *    porque es posterior en el protocolo: una vez cancelado, lo que dijera la
   *    consulta anterior está superado.
   */
  if (facts.cancel?.kind === 'ANSWERED') {
    switch (facts.cancel.result) {
      case 'ALREADY_ACCEPTED':
        // Se nos adelantaron: acreditaron antes de que llegara la cancelación.
        // El dinero está donde tenía que estar, y la Saga debe cerrar bien.
        return { kind: 'CONFIRM' };
      case 'CANCELLED':
        return { kind: 'RELEASE', reason: 'CANCELLED_AT_PARTNER' };
      case 'ALREADY_REJECTED':
        return { kind: 'RELEASE', reason: 'REJECTED_AT_PARTNER' };
    }
  }

  /* 2. La consulta, si contestó. */
  if (facts.probe?.kind === 'ANSWERED') {
    switch (facts.probe.status) {
      case 'ACCEPTED':
        return { kind: 'CONFIRM' };
      case 'REJECTED':
        return { kind: 'RELEASE', reason: 'REJECTED_AT_PARTNER' };
      case 'CANCELLED':
        return { kind: 'RELEASE', reason: 'CANCELLED_AT_PARTNER' };
      case 'PROCESSING':
        /*
         * Sigue en vuelo en el otro banco. El contrato manda cancelar, y es la
         * decisión correcta: `PROCESSING` pasado el TTL significa que su propio
         * plazo también venció, y sin cancelar podrían acreditar en cualquier
         * momento de las próximas 24 horas sobre una reserva que nosotros
         * queremos soltar.
         */
        return { kind: 'CANCEL' };
    }
  }

  /*
   * 3. Un `404` manda cancelar igual. No se libera directamente, aunque sea
   *    tentador: cancelar deja la constancia de que pedimos que no se acredite,
   *    y es lo que convierte nuestra liberación en defendible ante la
   *    conciliación en vez de en una decisión unilateral.
   */
  if (facts.probe?.kind === 'UNKNOWN' && facts.cancel === null) {
    return { kind: 'CANCEL' };
  }

  /* 4. Nunca se ha preguntado. Preguntar. */
  if (facts.probe === null) {
    return { kind: 'PROBE' };
  }

  /*
   * 5. No contestan. Aquí es donde el margen gobierna, y es la única rama que
   *    libera sin saber.
   *
   * Antes del margen se espera **con el dinero reservado**, que es
   * incómodo para el cliente y correcto para el banco: el otro lado tiene 24
   * horas para reintentar su callback, y devolver el dinero mientras ellos
   * acreditan es pagarlo dos veces.
   */
  if (facts.now < facts.releaseNotBefore) {
    return { kind: 'WAIT', until: facts.releaseNotBefore };
  }

  return {
    kind: 'RELEASE_UNVERIFIED',
    reason: facts.probe.kind === 'UNKNOWN' ? 'RELEASED_UNKNOWN_AT_PARTNER' : 'RELEASED_NO_ANSWER',
  };
}

/**
 * Cuándo expira un depósito y cuándo se puede liberar a ciegas.
 *
 * Los dos plazos salen del mismo instante y del contrato, no de una variable de
 * entorno — que es lo que los hacía incumplirlo: `INTERBANK_CONFIRMATION_TIMEOUT_MS`
 * valía 30 s y el contrato manda 180. Un plazo de interoperabilidad que cada
 * banco configura a su gusto no es un plazo.
 */
export function timeoutSchedule(
  createdAt: Date,
  ttlMs: number,
  releaseMarginMs: number,
): { readonly expiresAt: Date; readonly releaseNotBefore: Date } {
  const expiresAt = new Date(createdAt.getTime() + ttlMs);

  return {
    expiresAt,
    releaseNotBefore: new Date(expiresAt.getTime() + releaseMarginMs),
  };
}
