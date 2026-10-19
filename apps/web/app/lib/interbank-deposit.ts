import { isUuidV4 } from './account.ts';
import type { WireMoney } from './account.ts';

/**
 * Seguir un depósito ya enviado al banco pareja (T-60, B10 / TD-090).
 *
 * `interbank.ts` decide si un depósito se puede **mandar**; este archivo decide
 * cómo se **lee** uno mandado. Existe por una razón concreta: el seguimiento
 * que había (`/transferencias/[id]`) cuenta la Saga, que sólo conoce seis
 * estados propios, y lo que el otro banco responde vive en una tabla de Payment
 * con otros seis. Cada cosa de aquí es un lugar donde una pantalla podría
 * decirle a alguien que su dinero llegó cuando no llegó.
 *
 * Mismo trato que el resto de `app/lib/` (TD-010): todo lo que decide algo es
 * una función pura que `node --test` puede ejecutar, y los componentes sólo
 * dibujan. Nada de aquí habla con el Gateway.
 */

/** Los seis estados del depósito, tal como Payment los escribe. */
export type InterbankSendState =
  | 'PENDING'
  | 'SENT'
  | 'ACCEPTED'
  | 'REJECTED'
  | 'TIMEOUT'
  | 'REVERSED';

/** En el orden del ciclo de vida, que es el orden en que el filtro los ofrece. */
export const INTERBANK_STATES: readonly InterbankSendState[] = [
  'PENDING',
  'SENT',
  'ACCEPTED',
  'REJECTED',
  'TIMEOUT',
  'REVERSED',
];

export type InterbankReversalState = 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED';

/** Un depósito, como `GET /api/interbank/transfers` lo devuelve. */
export interface InterbankSendView {
  readonly interbankTransferId: string;
  readonly paymentId: string;
  readonly transactionId: string;
  readonly state: InterbankSendState;
  readonly reason: string | null;
  readonly destinationBankCode: string;
  /** Ya enmascarada por Payment: asteriscos y los últimos cuatro caracteres. */
  readonly destinationAccount: string;
  readonly originAccount: string | null;
  readonly amount: WireMoney;
  readonly correlationId: string;
  readonly traceId: string | null;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly sentAt: string | null;
  readonly decidedAt: string | null;
  readonly reversedAt: string | null;
  readonly attempts: number;
  readonly releasedUnverified: boolean;
  readonly reversal: {
    readonly reversalId: string;
    readonly state: InterbankReversalState;
  } | null;
}

/** Un paso del historial: del más antiguo al más reciente. */
export interface InterbankHistoryEntry {
  readonly state: InterbankSendState;
  readonly reason: string | null;
  readonly at: string;
}

export interface InterbankStatePresentation {
  readonly label: string;
  readonly color: 'success' | 'warning' | 'error' | 'neutral';
  readonly explanation: string;
}

/**
 * Qué significa cada estado para quien espera su dinero.
 *
 * Las palabras están elegidas contra un error concreto: decir «enviado» o
 * «acreditado» antes de que el otro banco conteste. `SENT` es **esperar**, no
 * entregar; sólo `ACCEPTED` dice que llegó. Y los dos finales que devuelven el
 * dinero se dicen distinto, como `STATUS_PRESENTATION` hace con `FAILED` y
 * `COMPENSATED`: `REJECTED` es «el otro banco dijo que no», y `REVERSED` es «y
 * el dinero ya está de vuelta», que es lo que alguien quiere saber después.
 *
 * `TIMEOUT` no es un «no»: el contrato le da al otro banco tiempo para
 * contestar, y mientras tanto el dinero **sigue reservado**. Pintarlo como un
 * fallo invitaría a repetir un depósito que quizá ya se acreditó.
 */
export const INTERBANK_STATE_PRESENTATION: Readonly<
  Record<InterbankSendState, InterbankStatePresentation>
> = {
  PENDING: {
    label: 'Por enviar',
    color: 'warning',
    explanation:
      'El dinero ya salió de la cuenta de origen. Falta entregar la solicitud al otro banco.',
  },
  SENT: {
    label: 'Esperando al otro banco',
    color: 'warning',
    explanation:
      'El otro banco recibió la solicitud y falta su respuesta. El dinero sigue reservado: si lo rechaza, vuelve a la cuenta de origen.',
  },
  ACCEPTED: {
    label: 'Acreditado',
    color: 'success',
    explanation: 'El otro banco confirmó el depósito: el dinero llegó a la cuenta de destino.',
  },
  REJECTED: {
    label: 'Rechazado',
    color: 'error',
    explanation:
      'El otro banco no aceptó el depósito. El dinero vuelve a la cuenta de origen automáticamente.',
  },
  TIMEOUT: {
    label: 'Sin respuesta',
    color: 'warning',
    explanation:
      'El otro banco no confirmó a tiempo. Le estamos preguntando qué pasó y el dinero sigue reservado hasta saberlo; no repitas el depósito todavía.',
  },
  REVERSED: {
    label: 'Devuelto',
    color: 'neutral',
    explanation: 'El depósito no se completó y el dinero ya volvió a la cuenta de origen.',
  },
};

/** El valor del filtro que no filtra. Un `''` haría que el `USelect` no abriera nunca. */
export const ALL_STATES = 'TODOS';

export type InterbankStateFilter = InterbankSendState | typeof ALL_STATES;

/** Las opciones del filtro: «todos» primero y después los seis estados. */
export function interbankStateFilterOptions(): readonly {
  readonly value: InterbankStateFilter;
  readonly label: string;
}[] {
  return [
    { value: ALL_STATES, label: 'Todos los estados' },
    ...INTERBANK_STATES.map((value) => ({
      value,
      label: INTERBANK_STATE_PRESENTATION[value].label,
    })),
  ];
}

/** Cuántos depósitos pide el listado. El Gateway acepta de 1 a 200. */
export const INTERBANK_LIST_LIMIT = 50;

/** La consulta de `GET /api/interbank/transfers` para un filtro; sin `state` si no filtra. */
export function interbankListQuery(filter: InterbankStateFilter): Record<string, string> {
  return {
    limit: String(INTERBANK_LIST_LIMIT),
    ...(filter === ALL_STATES ? {} : { state: filter }),
  };
}

/**
 * Cada motivo que un depósito puede traer, dicho como una frase.
 *
 * Tres familias, y se separan porque no vienen del mismo sitio:
 *
 * - **Los siete del contrato** (`ReasonCode`): lo que el otro banco responde.
 * - **Los locales del protocolo de TIMEOUT** (TD-095): los pone este banco
 *   cuando resuelve un depósito sin respuesta; el contrato no los conoce.
 * - **Los provisionales**: los que el callback anterior al contrato oficial
 *   aceptaba. Siguen aquí porque una fila vieja, o un banco pareja que aún no
 *   migró, puede traerlos, y mostrar `AMOUNT_EXCEEDS_LIMIT` en crudo es la
 *   forma de que alguien llame al banco sin saber qué decir.
 *
 * La prueba de `interbank-deposit.test.mjs` lee el contrato y falla si aparece
 * ahí un código que esta tabla no explica.
 */
const REASON_TEXT: Readonly<Record<string, string>> = {
  // El contrato oficial (`ReasonCode`).
  ACCOUNT_NOT_FOUND:
    'La cuenta de destino no existe en el otro banco. Revisa el número de cuenta y vuelve a intentarlo.',
  ACCOUNT_INACTIVE:
    'La cuenta de destino existe pero no está activa en el otro banco, así que no puede recibir dinero.',
  AMOUNT_LIMIT_EXCEEDED: 'El monto supera el máximo que el otro banco acepta por operación.',
  CURRENCY_NOT_SUPPORTED:
    'El otro banco no acepta depósitos en esta moneda. Sólo se admiten quetzales (GTQ).',
  EXPIRED: 'La solicitud llegó al otro banco fuera de su plazo de validez, así que no la procesó.',
  CANCELLED: 'La solicitud se canceló antes de que el otro banco la acreditara.',
  PROCESSING_ERROR:
    'El otro banco tuvo un problema al procesar el depósito. Puedes intentarlo de nuevo más tarde.',

  // Los que pone este banco al resolver un depósito sin respuesta (TD-095).
  // En pasado a propósito: también se lee en el historial de un depósito que luego se resolvió.
  CONFIRMATION_TIMEOUT: 'El otro banco no confirmó el depósito dentro del plazo.',
  CANCELLED_AT_PARTNER:
    'Pedimos cancelar el depósito porque el otro banco no lo confirmó a tiempo, y lo canceló: no se acreditó.',
  REJECTED_AT_PARTNER:
    'Al consultarle, el otro banco informó que había rechazado el depósito: no se acreditó.',
  RELEASED_NO_ANSWER:
    'El otro banco no contestó a ninguna consulta dentro del margen de espera. Devolvimos el dinero sin tener su confirmación.',
  RELEASED_UNKNOWN_AT_PARTNER:
    'El otro banco dijo no tener registro del depósito. Devolvimos el dinero sin tener su confirmación.',

  // Los del callback provisional, anteriores al contrato oficial.
  AMOUNT_EXCEEDS_LIMIT: 'El monto supera el máximo que el otro banco acepta por operación.',
  UNSUPPORTED_CURRENCY:
    'El otro banco no acepta depósitos en esta moneda. Sólo se admiten quetzales (GTQ).',
  WRONG_DESTINATION_BANK: 'El depósito llegó a un banco que no es el de la cuenta de destino.',
  BANK_NOT_AUTHORIZED:
    'El otro banco no reconoce a este banco como autorizado para enviarle depósitos.',
  INVALID_REQUEST: 'El otro banco consideró que la solicitud estaba mal formada.',
  IDEMPOTENCY_CONFLICT: 'El otro banco ya tenía una solicitud distinta con el mismo identificador.',
};

/** Los códigos que `explainInterbankReason` sabe decir en una frase. */
export const KNOWN_INTERBANK_REASONS: readonly string[] = Object.keys(REASON_TEXT);

/**
 * El motivo como frase, o `null` cuando no hay motivo que dar.
 *
 * Un código que no está en la tabla **no se descarta ni se traduce a ciegas**:
 * se dice que no es uno de los que se conocen y se deja el código entre
 * paréntesis, que es lo único que sirve cuando alguien llama a soporte.
 */
export function explainInterbankReason(reason: string | null): string | null {
  if (reason === null || reason.trim().length === 0) {
    return null;
  }

  return (
    REASON_TEXT[reason] ??
    `El motivo que dio el otro banco no es uno de los que conocemos (${reason}). Si necesitas más detalle, comparte el código de seguimiento con el banco.`
  );
}

/**
 * Para qué sirve el recuadro del motivo en cada estado: un `TIMEOUT` explica
 * por qué se espera, no por qué se falló.
 */
export function reasonTitleFor(state: InterbankSendState): string {
  return state === 'TIMEOUT' ? 'Por qué seguimos esperando' : 'Por qué no se completó';
}

/** Si el depósito ya no va a cambiar. `REJECTED` todavía espera el regreso del dinero. */
export function isSettled(state: InterbankSendState): boolean {
  return state === 'ACCEPTED' || state === 'REVERSED';
}

/**
 * Cada cuántos milisegundos volver a preguntar, o `null` para dejar de hacerlo.
 *
 * **Sigue preguntando en `REJECTED`**, no sólo mientras el depósito está en
 * `PENDING`, `SENT` o `TIMEOUT`: un rechazo es el momento en que el dinero
 * *empieza* a volver, y lo que alguien espera ver después es `REVERSED`. Parar
 * en `REJECTED` dejaría la pantalla diciendo «vuelve automáticamente» cuando ya
 * volvió.
 *
 * El techo es de diez minutos y no los dos de la Saga porque el protocolo de
 * `TIMEOUT` retiene el dinero hasta ocho en el peor caso (`expiresAt` + 300 s):
 * una pantalla que se rinde a los dos le diría a alguien «no lo sabemos» cuando
 * el sistema todavía está resolviéndolo. Pasado el primer minuto pregunta más
 * despacio, porque ya no espera un cambio de segundos.
 */
export const INTERBANK_POLL_FAST_MS = 2_000;
export const INTERBANK_POLL_SLOW_MS = 5_000;
export const INTERBANK_POLL_FAST_WINDOW_MS = 60_000;
export const INTERBANK_POLL_CEILING_MS = 600_000;

export function interbankPollDelay(state: InterbankSendState, elapsedMs: number): number | null {
  if (isSettled(state) || elapsedMs >= INTERBANK_POLL_CEILING_MS) {
    return null;
  }

  return elapsedMs < INTERBANK_POLL_FAST_WINDOW_MS ? INTERBANK_POLL_FAST_MS : INTERBANK_POLL_SLOW_MS;
}

/**
 * Cuánto se tolera un «no existe» justo después de enviar.
 *
 * El `202` sale en cuanto el comando está en el broker, y la fila del depósito
 * la escribe Payment cuando la Saga llega al paso del pago: después de la
 * verificación y del débito. La primera consulta tras enviar encuentra,
 * legítimamente, nada. Veinte segundos y no los diez de la Saga porque aquí hay
 * un paso más antes de que la fila exista.
 */
export const INTERBANK_CREATION_GRACE_MS = 20_000;

export type InterbankMissingMeaning = 'STILL_STARTING' | 'MISSING';

export function meaningOfMissingSend(elapsedMs: number): InterbankMissingMeaning {
  return elapsedMs < INTERBANK_CREATION_GRACE_MS ? 'STILL_STARTING' : 'MISSING';
}

/** Un paso del historial, listo para dibujar. */
export interface InterbankHistoryStep {
  readonly state: InterbankSendState;
  readonly label: string;
  readonly tone: 'ok' | 'wait' | 'fail';
  readonly at: string;
  readonly reasonText: string | null;
}

const HISTORY_LABEL: Readonly<
  Record<InterbankSendState, { label: string; tone: 'ok' | 'wait' | 'fail' }>
> = {
  PENDING: { label: 'Depósito registrado', tone: 'ok' },
  SENT: { label: 'Solicitud entregada al otro banco', tone: 'ok' },
  ACCEPTED: { label: 'El otro banco acreditó el depósito', tone: 'ok' },
  REJECTED: { label: 'El otro banco rechazó el depósito', tone: 'fail' },
  TIMEOUT: { label: 'El otro banco no confirmó a tiempo', tone: 'wait' },
  REVERSED: { label: 'El dinero volvió a la cuenta de origen', tone: 'ok' },
};

/**
 * El historial como pasos, **en el orden en que llegó**.
 *
 * No reordena ni completa: si Payment no registró un `SENT` porque el banco
 * contestó antes de que se anotara la entrega, la línea no lo inventa. Una
 * línea de tiempo que muestra lo que debió pasar en vez de lo que pasó es
 * justo lo que este historial existe para no ser.
 */
export function interbankHistorySteps(
  history: readonly InterbankHistoryEntry[],
): readonly InterbankHistoryStep[] {
  return history.map((entry) => ({
    state: entry.state,
    label: HISTORY_LABEL[entry.state].label,
    tone: HISTORY_LABEL[entry.state].tone,
    at: entry.at,
    reasonText: explainInterbankReason(entry.reason),
  }));
}

export interface InterbankReversalPresentation {
  readonly label: string;
  readonly color: InterbankStatePresentation['color'];
}

/**
 * El reverso (paso 5 del contrato): lo que este banco le pide al otro cuando
 * éste acredita un depósito **después** de que aquí ya se devolvió el dinero.
 */
export const INTERBANK_REVERSAL_PRESENTATION: Readonly<
  Record<InterbankReversalState, InterbankReversalPresentation>
> = {
  PENDING: { label: 'Pedido', color: 'warning' },
  PROCESSING: { label: 'En proceso en el otro banco', color: 'warning' },
  COMPLETED: { label: 'Completado', color: 'success' },
  FAILED: { label: 'No se pudo completar', color: 'error' },
};

/**
 * A dónde llevar a alguien tras enviar.
 *
 * Al depósito, no a la Saga: es lo que el otro banco decida lo que importa
 * ver. El identificador de la transferencia viaja en la dirección para que, si
 * el depósito no aparece (la verificación o el débito lo cerraron antes de
 * llegar al otro banco), la pantalla sepa a dónde mandar a quien pregunta.
 */
export function interbankDetailPath(interbankTransferId: string, transactionId?: string): string {
  const base = `/transferencias/interbancarias/${interbankTransferId}`;

  return transactionId !== undefined && isUuidV4(transactionId)
    ? `${base}?transferencia=${transactionId.trim()}`
    : base;
}

/**
 * La transferencia (Saga) a la que enlazar, o `null`.
 *
 * Gana la que trae el depósito; la de la dirección sólo vale mientras el
 * depósito no existe, y **sólo si es un UUID**: viene de la barra de
 * direcciones y cualquiera puede escribir ahí lo que quiera.
 */
export function sagaTransferFor(
  send: Pick<InterbankSendView, 'transactionId'> | null,
  fromAddress: unknown,
): string | null {
  if (send !== null) {
    return send.transactionId;
  }

  return typeof fromAddress === 'string' && isUuidV4(fromAddress) ? fromAddress.trim() : null;
}
