/**
 * El ciclo del depósito que este banco **recibe** del banco pareja
 * (Fase 3, §4.1 — Integración interbancaria; escrito en T-56).
 *
 * **Este archivo no importa nada fuera del dominio**, `@bank/contracts`
 * incluido: `pnpm lint` lo exige y el diseño está de acuerdo — si un depósito
 * ajeno se acredita o se rechaza tiene que poder discutirse sin un broker y sin
 * una base de datos a la vista.
 *
 * ## Por qué existe este archivo
 *
 * Hasta T-56 estas transiciones vivían como **diez ternarios repartidos** por
 * `application/interbank.use-case.ts` (`reason === null ? 'ELIGIBILITY' :
 * 'REJECTED'`, y así nueve veces más). Cada uno era correcto por separado, y
 * juntos no formaban nada que se pudiera leer: para saber si un `ACCEPTED`
 * podía venir de `ELIGIBILITY` había que reconstruir el grafo de memoria. §4.1
 * pide los estados del depósito interbancario escritos y con las transiciones
 * decididas por una función pura, **en las dos direcciones**, y la dirección
 * enviada ya lo tenía (`interbank-send.ts`). Ésta no.
 *
 * ## Por qué los estados no son los mismos que los del envío
 *
 * Los seis que nombra §4.1 —`PENDING`, `SENT`, `ACCEPTED`, `REJECTED`,
 * `TIMEOUT`, `REVERSED`— son los del depósito **enviado**, y aplicarlos aquí
 * sería copiar un vocabulario que no describe este flujo:
 *
 * - no hay `SENT`, porque no mandamos nada: el depósito ya llegó;
 * - no hay `TIMEOUT`, porque no esperamos la decisión de nadie — **la decisión
 *   es nuestra**, y la toma este banco en dos pasos;
 * - no hay `REVERSED`, porque un depósito recibido que se rechaza no mueve
 *   dinero que haya que devolver: se rechaza **antes** de acreditar.
 *
 * Lo que sí hay, y el envío no tiene, son los **dos pasos de la decisión**:
 * primero si la cuenta admite el dinero (se lo pregunta a Account por el
 * broker), después si el crédito se aplicó. Son dos porque los decide otro
 * servicio y cada respuesta llega en su propio mensaje; colapsarlos en uno
 * dejaría un depósito «decidido» antes de que el saldo se hubiera movido.
 *
 * Así que son cuatro, y cada uno responde a una pregunta distinta:
 *
 * - `ELIGIBILITY` — llegó y se le preguntó a Account si la cuenta lo admite.
 * - `CREDIT` — la cuenta lo admite y se ordenó el crédito. **El dinero todavía
 *   no está**: falta la confirmación de Account.
 * - `ACCEPTED` — acreditado. Final, y el único que mueve el saldo.
 * - `REJECTED` — no se acreditó, con un motivo del conjunto cerrado. Final.
 *
 * El callback al banco pareja **no es un estado**: es una entrega que se
 * reintenta, y vive en sus propias columnas (`callback_attempts`,
 * `callback_due_at`, `callback_delivered_at`). Un depósito `ACCEPTED` cuyo
 * callback todavía no salió está acreditado igual — el dinero no depende de que
 * el otro banco se haya enterado.
 */

/** Los cuatro estados de un depósito recibido. */
export type InterbankReceiptState = 'ELIGIBILITY' | 'CREDIT' | 'ACCEPTED' | 'REJECTED';

/**
 * Dónde puede **caer** una transición, que no es lo mismo que dónde puede estar
 * un depósito.
 *
 * `ELIGIBILITY` es donde un depósito **empieza** —lo pone el `INSERT`, no una
 * transición— así que ninguna de las tres transiciones puede devolverlo.
 * Decirlo en el tipo y no en un comentario es lo que permite que el repositorio
 * mantenga su `to` estrecho: si algún día una transición volviera a
 * `ELIGIBILITY`, el error aparecería aquí y no en una fila.
 */
export type InterbankReceiptLanding = Exclude<InterbankReceiptState, 'ELIGIBILITY'>;

/**
 * El conjunto cerrado de motivos de rechazo (§4.1, *Validaciones*).
 *
 * Cerrado y no una cadena libre: el banco pareja tiene que poder **programar**
 * contra estos valores, y un motivo nuevo inventado en un `if` es un cambio de
 * contrato que nadie acordó. Si el contrato oficial del curso trae otro
 * conjunto, **manda el contrato** y esta lista cambia con él.
 */
export type InterbankReceiptRejection =
  | 'ACCOUNT_NOT_FOUND'
  | 'ACCOUNT_INACTIVE'
  | 'AMOUNT_EXCEEDS_LIMIT'
  | 'UNSUPPORTED_CURRENCY'
  | 'WRONG_DESTINATION_BANK'
  | 'BANK_NOT_AUTHORIZED'
  | 'INVALID_REQUEST'
  | 'IDEMPOTENCY_CONFLICT';

/** Lo que puede pasarle a un depósito recibido mientras se decide. */
export type InterbankReceiptEvent =
  /** Account contestó si la cuenta admite el dinero. */
  | { readonly kind: 'ELIGIBILITY_ANSWERED'; readonly rejection: InterbankReceiptRejection | null }
  /** Account confirmó que el saldo se movió. */
  | { readonly kind: 'CREDITED' }
  /** Account no pudo aplicar el crédito, con su motivo. */
  | { readonly kind: 'CREDIT_REFUSED'; readonly rejection: InterbankReceiptRejection };

/** Dónde queda un depósito, y si eso cierra su decisión. */
export interface InterbankReceiptTransition {
  readonly from: InterbankReceiptState;
  readonly state: InterbankReceiptLanding;
  readonly rejection: InterbankReceiptRejection | null;
  /** `true` cuando esta transición es la que hay que contarle al banco pareja. */
  readonly decided: boolean;
}

/** Una transición que el diagrama no tiene. Se lanza en vez de guardarse. */
export class IllegalInterbankReceiptTransition extends Error {
  readonly from: InterbankReceiptState;
  readonly event: InterbankReceiptEvent['kind'];

  constructor(from: InterbankReceiptState, event: InterbankReceiptEvent['kind']) {
    super(`No hay transición de ${from} con ${event}.`);
    this.name = 'IllegalInterbankReceiptTransition';
    this.from = from;
    this.event = event;
  }
}

/**
 * Dónde cae un depósito recibido cuando ocurre `event`, o por qué no cae en
 * ninguna parte.
 *
 * Lanza en vez de devolver un estado tolerante, y es deliberado: un mensaje que
 * llega fuera de orden —la confirmación de un crédito que nunca se ordenó, una
 * elegibilidad para un depósito ya rechazado— no es un caso que haya que
 * absorber, es una incoherencia que hay que ver. El llamador la convierte en un
 * log y en un mensaje aparcado; lo que no debe hacer es escribirla.
 */
export function applyInterbankReceipt(
  from: InterbankReceiptState,
  event: InterbankReceiptEvent,
): InterbankReceiptTransition {
  const illegal = (): never => {
    throw new IllegalInterbankReceiptTransition(from, event.kind);
  };
  const to = (
    state: InterbankReceiptLanding,
    rejection: InterbankReceiptRejection | null = null,
  ): InterbankReceiptTransition => ({
    from,
    state,
    rejection,
    decided: isReceiptDecided(state),
  });

  if (isReceiptDecided(from)) {
    /*
     * Un depósito ya decidido no se mueve. Es la misma regla que protege al
     * envío, y aquí vale doble: `ACCEPTED` ya movió el saldo, así que una
     * segunda transición sobre él sería un segundo crédito — el depósito
     * duplicado que §8.3 penaliza con un 50 %.
     */
    return illegal();
  }

  switch (event.kind) {
    case 'ELIGIBILITY_ANSWERED':
      /*
       * Sólo desde `ELIGIBILITY`. Una respuesta de elegibilidad para un
       * depósito que ya ordenó el crédito es una respuesta duplicada, y
       * volver a `CREDIT` ordenaría el crédito otra vez.
       */
      if (from !== 'ELIGIBILITY') return illegal();

      return event.rejection === null ? to('CREDIT') : to('REJECTED', event.rejection);

    case 'CREDITED':
      // Sólo desde `CREDIT`: un crédito confirmado que nadie ordenó no es nuestro.
      return from === 'CREDIT' ? to('ACCEPTED') : illegal();

    case 'CREDIT_REFUSED':
      return from === 'CREDIT' ? to('REJECTED', event.rejection) : illegal();
  }
}

/**
 * `true` cuando ya hay un veredicto que contarle al banco pareja.
 *
 * Vive aquí y no en el caso de uso por lo que defiende la prueba de aislamiento
 * de este servicio: qué significa cada estado es vocabulario del dominio, y en
 * cuanto una capa de arriba empieza a comparar esas cadenas, la decisión se ha
 * mudado a un sitio donde ya no se puede discutir sin una base de datos.
 */
export function isReceiptDecided(state: InterbankReceiptState): boolean {
  return state === 'ACCEPTED' || state === 'REJECTED';
}

/**
 * Si una referencia de cuenta **puede** ser una cuenta de este banco.
 *
 * Aquí y no en el esquema del mensaje: que las cuentas de este banco se
 * identifiquen por UUID es una decisión de **este** banco (T-56), no una
 * propiedad del contrato interbancario. El banco pareja puede mandar lo que su
 * contrato permita; lo que pasa con una referencia que no reconocemos es
 * asunto nuestro, y la respuesta correcta es un `ACCOUNT_NOT_FOUND` **con
 * callback** y no un `400` sin explicación.
 *
 * No se le pregunta a Account por una referencia que no puede ser suya: sería
 * un viaje por el broker para que contestara lo que ya se sabe.
 */
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function couldBeOurAccount(reference: string): boolean {
  return UUID_V4.test(reference);
}
