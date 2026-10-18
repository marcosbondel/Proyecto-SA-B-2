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

/**
 * Los **cinco** estados de un depósito recibido.
 *
 * Eran cuatro hasta que llegó el contrato oficial, que añade uno que no
 * teníamos: `CANCELLED`. No es un rechazo con otro nombre — es el banco emisor
 * diciendo «ya no lo quiero» después de que su plazo venciera, y la diferencia
 * importa en los dos sentidos: al emisor le dice que puede liberar su reserva
 * sin miedo, y a nosotros nos obliga a **recordar el identificador** para
 * rechazar el mensaje original si llega tarde.
 */
export type InterbankReceiptState =
  'ELIGIBILITY' | 'CREDIT' | 'ACCEPTED' | 'REJECTED' | 'CANCELLED';

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
  | 'IDEMPOTENCY_CONFLICT'
  /** Del contrato oficial: venció antes de poder decidirlo. */
  | 'EXPIRED'
  /** Del contrato oficial: el emisor lo canceló. */
  | 'CANCELLED';

/** Lo que puede pasarle a un depósito recibido mientras se decide. */
export type InterbankReceiptEvent =
  /** Account contestó si la cuenta admite el dinero. */
  | { readonly kind: 'ELIGIBILITY_ANSWERED'; readonly rejection: InterbankReceiptRejection | null }
  /** Account confirmó que el saldo se movió. */
  | { readonly kind: 'CREDITED' }
  /** Account no pudo aplicar el crédito, con su motivo. */
  | { readonly kind: 'CREDIT_REFUSED'; readonly rejection: InterbankReceiptRejection }
  /**
   * El banco emisor pidió cancelarlo (`POST /transfers/{id}/cancel`).
   *
   * Lo pide cuando su plazo venció y quiere saber si puede liberar la reserva.
   * Sólo es legal mientras **no se haya acreditado**: si ya se acreditó, la
   * respuesta correcta no es cancelar sino decirle `ALREADY_ACCEPTED`, y eso lo
   * decide el llamador mirando el estado — no una transición.
   */
  | { readonly kind: 'CANCEL_REQUESTED' }
  /**
   * Venció `expiresAt` con el depósito todavía sin decidir.
   *
   * El contrato es tajante: «el receptor **no puede acreditar** después de
   * `expiresAt`, aunque el mensaje le llegue tarde (reintento, DLQ)», y si lo
   * hace «la responsabilidad y la devolución son suyas». Así que el
   * vencimiento es un rechazo nuestro, con su motivo propio, y no un estado de
   * espera más largo.
   */
  | { readonly kind: 'EXPIRED' };

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

    case 'CANCEL_REQUESTED':
      /*
       * Sólo desde `ELIGIBILITY`, y es el cambio de fondo de T-60 (B4).
       *
       * Antes era legal también desde `CREDIT`, con el argumento de que «el
       * dinero todavía no se movió». Era falso en el sentido que importa:
       * `CREDIT` significa que **la orden de crédito está dada o a punto de
       * darse**, y Account acredita incondicionalmente en cuanto la recibe. Un
       * depósito cancelado desde ahí dejaba al cliente acreditado, al emisor
       * convencido de que podía liberar su reserva, y la confirmación del
       * crédito llegaba después a un estado que ya no la admitía y se
       * descartaba como transición ilegal: dinero creado de la nada, y el
       * 50 % de §8.3.
       *
       * Una vez ordenado el crédito la decisión es de Account: se espera su
       * veredicto (`CREDITED` o `CREDIT_REFUSED`) y sólo entonces hay algo que
       * contarle al emisor. A una cancelación que llega en ese intervalo se le
       * contesta «vuelve a preguntar» (`503`), no una afirmación que todavía no
       * es cierta.
       */
      return from === 'ELIGIBILITY' ? to('CANCELLED', 'CANCELLED') : illegal();

    case 'EXPIRED':
      /*
       * Por lo mismo que arriba, sólo desde `ELIGIBILITY`. Un depósito en
       * `CREDIT` que pasa de `expiresAt` espera el veredicto de Account en vez
       * de rechazarse con `EXPIRED`: rechazar mientras Account acredita es el
       * mismo doble crédito con otro motivo. Lo que sí se evita es *entrar* en
       * `CREDIT` demasiado tarde: la elegibilidad respondida después de
       * `expiresAt` se resuelve como `EXPIRED` en vez de ordenar el crédito
       * (ver `InterbankUseCase.eligibility`).
       */
      return from === 'ELIGIBILITY' ? to('REJECTED', 'EXPIRED') : illegal();
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
  return state === 'ACCEPTED' || state === 'REJECTED' || state === 'CANCELLED';
}

/**
 * Los cinco estados nuestros, traducidos a los cuatro del contrato.
 *
 * `ELIGIBILITY` y `CREDIT` son los dos pasos de **nuestra** decisión y para el
 * otro banco son lo mismo: `PROCESSING`. Que tengamos dos y él vea uno no es una
 * pérdida de información — es que el reparto interno del trabajo no es asunto
 * suyo, y publicarlo nos ataría a no poder cambiarlo.
 */
export function v1StateOf(
  state: InterbankReceiptState,
): 'PROCESSING' | 'ACCEPTED' | 'REJECTED' | 'CANCELLED' {
  switch (state) {
    case 'ELIGIBILITY':
    case 'CREDIT':
      return 'PROCESSING';
    case 'ACCEPTED':
      return 'ACCEPTED';
    case 'REJECTED':
      return 'REJECTED';
    case 'CANCELLED':
      return 'CANCELLED';
  }
}

/**
 * Nuestros motivos de rechazo, traducidos a los **siete** del contrato.
 *
 * Tres de los nuestros no existen allí, y la traducción dice por qué:
 *
 * - `BANK_NOT_AUTHORIZED` no es un motivo de rechazo en el contrato, es un
 *   `401`. Si llegara aquí sería un error nuestro, así que cae en
 *   `PROCESSING_ERROR` — no en algo que insinúe que el otro banco hizo algo mal.
 * - `IDEMPOTENCY_CONFLICT` es un `409` sincrónico. Lo mismo.
 * - `WRONG_DESTINATION_BANK` simplemente no está: alguien nos mandó un depósito
 *   que no era para nosotros, y para el contrato eso es un error de proceso.
 *
 * Y dos se renombran sin cambiar de significado: `AMOUNT_EXCEEDS_LIMIT` →
 * `AMOUNT_LIMIT_EXCEEDED`, `UNSUPPORTED_CURRENCY` → `CURRENCY_NOT_SUPPORTED`.
 */
export function v1ReasonOf(
  rejection: InterbankReceiptRejection,
):
  | 'ACCOUNT_NOT_FOUND'
  | 'ACCOUNT_INACTIVE'
  | 'AMOUNT_LIMIT_EXCEEDED'
  | 'CURRENCY_NOT_SUPPORTED'
  | 'EXPIRED'
  | 'CANCELLED'
  | 'PROCESSING_ERROR' {
  switch (rejection) {
    case 'ACCOUNT_NOT_FOUND':
      return 'ACCOUNT_NOT_FOUND';
    case 'ACCOUNT_INACTIVE':
      return 'ACCOUNT_INACTIVE';
    case 'AMOUNT_EXCEEDS_LIMIT':
      return 'AMOUNT_LIMIT_EXCEEDED';
    case 'UNSUPPORTED_CURRENCY':
      return 'CURRENCY_NOT_SUPPORTED';
    case 'EXPIRED':
      return 'EXPIRED';
    case 'CANCELLED':
      return 'CANCELLED';
    case 'WRONG_DESTINATION_BANK':
    case 'BANK_NOT_AUTHORIZED':
    case 'IDEMPOTENCY_CONFLICT':
    case 'INVALID_REQUEST':
      return 'PROCESSING_ERROR';
  }
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

/** Cómo se le nombra una cuenta a Account: por su UUID interno o por su número. */
export type AccountReference =
  | { readonly accountId: string }
  | { readonly accountNumber: string };

/**
 * La forma en que hay que preguntarle a Account por la cuenta que el otro banco
 * nombró, o `null` si la referencia no puede ser de ninguna cuenta (T-60).
 *
 * El contrato oficial nombra las cuentas por su **número** (`02-NNNNNNNNN`,
 * `^[A-Za-z0-9-]{1,34}$`); el camino provisional las nombraba por UUID. Un UUID
 * con guiones mide 36 y el número admite 34 como máximo, así que los dos
 * conjuntos no se solapan y la clasificación no es ambigua. Qué número es de
 * este banco y cuál no lo decide Account —que es quien los asigna—, no esta
 * función: aquí sólo se decide si merece la pregunta.
 */
export function accountReferenceOf(reference: string): AccountReference | null {
  if (UUID_V4.test(reference)) return { accountId: reference };
  if (/^[A-Za-z0-9-]{1,34}$/.test(reference)) return { accountNumber: reference };
  return null;
}

/**
 * `true` cuando la respuesta de Account habla de la cuenta por la que se
 * preguntó. Defensa en profundidad: el `depositId` ya identifica la fila, pero
 * un crédito atribuido a una cuenta distinta de la ordenada es un error que
 * conviene ver en vez de aplicar.
 */
export function answersAbout(
  reference: string,
  answer: { readonly accountId?: string | undefined; readonly accountNumber?: string | undefined },
): boolean {
  const asked = accountReferenceOf(reference);
  if (asked === null) return false;
  if ('accountId' in asked) {
    return answer.accountId === undefined || answer.accountId === asked.accountId;
  }
  return answer.accountNumber === undefined || answer.accountNumber === asked.accountNumber;
}
