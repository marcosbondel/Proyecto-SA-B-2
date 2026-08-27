import { isUuidV4 } from './account.ts';
import type { WireMoney } from './account.ts';

/**
 * Everything the Transferencias module *decides*, as plain functions.
 *
 * The frontend has no component-test framework (TD-010), so a rule written
 * inside a `.vue` file is a rule nobody can assert on. This module exists so
 * that the parts of the module that can be wrong — whether a request is worth
 * sending, how far along a Saga is, what a failure code means to a person,
 * whether a missing transfer is missing or merely not written down yet — are
 * verifiable without a browser.
 *
 * Nothing here talks to the Gateway.
 */

/** The six states of the Saga, exactly as `transaction.status.replied.v1` sends them. */
export type TransactionStatus =
  | 'PENDING'
  | 'DEBITING'
  | 'PAYMENT_PENDING'
  | 'COMPLETED'
  | 'FAILED'
  | 'COMPENSATED';

/** The demonstration scenarios `POST /api/transfers` accepts. */
export type PaymentScenario = 'APPROVE' | 'REJECT' | 'TRANSIENT_FAILURE';

export type PaymentStatus = 'PENDING' | 'SUCCEEDED' | 'FAILED';

/** The payment half of a status reply. Absent until a payment is ordered. */
export interface PaymentOutcome {
  readonly paymentId: string;
  readonly status: PaymentStatus;
  readonly attempt: number | null;
  readonly reason: string | null;
  /**
   * The kind of the last failed attempt, added by T-19 and optional on the wire.
   *
   * It is what lets this screen tell "the payment was refused" from "the system
   * ran out of attempts", and — while the payment is still `PENDING` — that a
   * retry is under way at all. `app/lib/payment.ts` owns what it means.
   */
  readonly errorType?: 'TRANSIENT' | 'PERMANENT' | null;
  readonly decidedAt: string | null;
}

/** A transfer as `GET /api/transfers/:transactionId` answers. */
export interface TransferStatus {
  readonly outcome: 'FOUND';
  readonly transactionId: string;
  readonly status: TransactionStatus;
  readonly amount: WireMoney;
  readonly reason: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  /** The correlation the transfer was **born** in, not the query's. */
  readonly originCorrelationId?: string;
  readonly payment?: PaymentOutcome;
  /** Added by the Gateway: the correlation of this particular question. */
  readonly correlationId?: string;
}

const TERMINAL: readonly TransactionStatus[] = ['COMPLETED', 'FAILED', 'COMPENSATED'];

/** Whether the Saga has finished moving. Nothing follows these three. */
export function isTerminal(status: TransactionStatus): boolean {
  return TERMINAL.includes(status);
}

/** Whether the screen should keep asking. The one rule the polling obeys. */
export function shouldKeepPolling(status: TransactionStatus): boolean {
  return !isTerminal(status);
}

export interface StatusPresentation {
  readonly label: string;
  readonly color: 'success' | 'warning' | 'error' | 'neutral';
  readonly explanation: string;
}

/**
 * What each state means, in the words somebody waiting on their money needs.
 *
 * The three endings are three different sentences on purpose, and the two that
 * both mean "you still have your money" are the ones most worth separating.
 * `FAILED` means it never left. `COMPENSATED` means it left and came back —
 * which is why the balance moved twice and why the statement will show two
 * lines. A single "no se realizó" for both would make somebody think their
 * account had been debited in error.
 */
export const STATUS_PRESENTATION: Readonly<Record<TransactionStatus, StatusPresentation>> = {
  PENDING: {
    label: 'Aceptada',
    color: 'warning',
    explanation: 'El sistema recibió la solicitud y todavía no ha movido nada.',
  },
  DEBITING: {
    label: 'Debitando',
    color: 'warning',
    explanation: 'Se pidió el débito a la cuenta de origen. Aún no se ha confirmado.',
  },
  PAYMENT_PENDING: {
    label: 'Procesando pago',
    color: 'warning',
    explanation:
      'El dinero ya salió de la cuenta de origen y el pago está en proceso. Si el pago falla, ' +
      'se devuelve automáticamente.',
  },
  COMPLETED: {
    label: 'Completada',
    color: 'success',
    explanation: 'El dinero llegó a la cuenta de destino.',
  },
  FAILED: {
    label: 'Fallida',
    color: 'error',
    explanation: 'La transferencia no se realizó y el dinero nunca salió de tu cuenta.',
  },
  COMPENSATED: {
    label: 'Compensada',
    color: 'error',
    explanation:
      'La transferencia no se completó. El dinero había salido de tu cuenta y fue devuelto ' +
      'automáticamente, así que verás dos movimientos en el estado de cuenta.',
  },
};

export type StepState = 'done' | 'current' | 'pending' | 'failed' | 'skipped';

export interface TimelineStep {
  readonly key: string;
  readonly label: string;
  readonly description: string;
  readonly state: StepState;
}

/**
 * The Saga drawn as a line, with the ending it actually reached.
 *
 * Three decisions worth stating, because each one is a way this could quietly
 * mislead:
 *
 * - **The last step is named after the outcome**, not always "Completada". A
 *   line whose final node says "Completada" in grey next to a red banner reads
 *   as a transfer that is about to succeed.
 * - **A failed step is `failed`, and everything after it is `skipped`, not
 *   `pending`.** `pending` means "still coming"; on a terminal transfer nothing
 *   is still coming, and a spinner-shaped step on a finished flow is a screen
 *   that lies about being alive.
 * - **`COMPENSATED` fails at the payment step, not at the debit.** The debit
 *   genuinely succeeded — that is the whole difference between this ending and
 *   `FAILED`, and the line has to show it.
 */
export function timelineFor(status: TransactionStatus): readonly TimelineStep[] {
  const ending = ENDING[status];

  return [
    step('PENDING', 'Solicitada', 'El sistema aceptó la solicitud.', REACHED.PENDING[status]),
    step('DEBITING', 'Débito', 'Se descuenta de la cuenta de origen.', REACHED.DEBITING[status]),
    step(
      'PAYMENT_PENDING',
      'Pago',
      'Se procesa el pago entre cuentas.',
      REACHED.PAYMENT_PENDING[status],
    ),
    step(ending.key, ending.label, ending.description, REACHED.CLOSING[status]),
  ];
}

function step(key: string, label: string, description: string, state: StepState): TimelineStep {
  return { key, label, description, state };
}

/**
 * The endings, as the fourth node of the line.
 *
 * A non-terminal transfer shows "Completada" greyed out, because that is what
 * it is heading for and naming the two other possibilities on a transfer that
 * is going fine would be alarming for no reason.
 */
const ENDING: Readonly<
  Record<TransactionStatus, { key: string; label: string; description: string }>
> = {
  PENDING: { key: 'COMPLETED', label: 'Completada', description: 'El dinero llega al destino.' },
  DEBITING: { key: 'COMPLETED', label: 'Completada', description: 'El dinero llega al destino.' },
  PAYMENT_PENDING: {
    key: 'COMPLETED',
    label: 'Completada',
    description: 'El dinero llega al destino.',
  },
  COMPLETED: { key: 'COMPLETED', label: 'Completada', description: 'El dinero llegó al destino.' },
  FAILED: {
    key: 'FAILED',
    label: 'Fallida',
    description: 'No se movió nada. El dinero sigue en la cuenta de origen.',
  },
  COMPENSATED: {
    key: 'COMPENSATED',
    label: 'Compensada',
    description: 'El dinero salió y fue devuelto a la cuenta de origen.',
  },
};

/** Where each node stands, per status. A table, because a chain of `if` drifts. */
const REACHED: Readonly<Record<string, Readonly<Record<TransactionStatus, StepState>>>> = {
  PENDING: {
    PENDING: 'current',
    DEBITING: 'done',
    PAYMENT_PENDING: 'done',
    COMPLETED: 'done',
    FAILED: 'done',
    COMPENSATED: 'done',
  },
  DEBITING: {
    PENDING: 'pending',
    DEBITING: 'current',
    PAYMENT_PENDING: 'done',
    COMPLETED: 'done',
    // The only ending reachable from a refused debit, and the only one in which
    // this step is where it went wrong.
    FAILED: 'failed',
    COMPENSATED: 'done',
  },
  PAYMENT_PENDING: {
    PENDING: 'pending',
    DEBITING: 'pending',
    PAYMENT_PENDING: 'current',
    COMPLETED: 'done',
    FAILED: 'skipped',
    COMPENSATED: 'failed',
  },
  CLOSING: {
    PENDING: 'pending',
    DEBITING: 'pending',
    PAYMENT_PENDING: 'pending',
    COMPLETED: 'done',
    FAILED: 'failed',
    COMPENSATED: 'failed',
  },
};

/**
 * What a failure code means, in Spanish, to the person it happened to.
 *
 * The codes are the closed set of `failureCode` in `@bank/contracts` that can
 * reach a transfer. An unknown one falls back rather than rendering the code
 * itself: a customer reading `IDEMPOTENCY_KEY_CONFLICT` learns nothing, and the
 * frontend may well meet a code added after this file was last touched.
 */
export const FAILURE_REASON_TEXT: Readonly<Record<string, string>> = {
  INSUFFICIENT_FUNDS: 'La cuenta de origen no tenía saldo suficiente.',
  ACCOUNT_INACTIVE: 'La cuenta de origen está inactiva, así que no se puede debitar de ella.',
  ACCOUNT_NOT_FOUND: 'Una de las dos cuentas no existe.',
  INVALID_AMOUNT: 'El monto debe ser mayor que cero.',
  INVALID_AMOUNT_PRECISION: 'El monto no se puede representar con dos decimales.',
  SAME_ACCOUNT_TRANSFER: 'La cuenta de origen y la de destino son la misma.',
  IDEMPOTENCY_KEY_CONFLICT:
    'Esta clave de idempotencia ya se usó para otra transferencia distinta. ' +
    'Empieza una transferencia nueva en lugar de reintentar esta.',
  PAYMENT_DECLINED: 'El pago fue rechazado. El dinero se devolvió a la cuenta de origen.',
  PAYMENT_RETRIES_EXHAUSTED:
    'El pago no se pudo procesar tras varios intentos. El dinero se devolvió a la cuenta de origen.',
};

export function explainReason(reason: string | null): string | null {
  if (reason === null) {
    return null;
  }

  return (
    FAILURE_REASON_TEXT[reason] ??
    'La transferencia no se completó. Consulta el rastro de auditoría con el identificador de correlación.'
  );
}

export interface ScenarioPresentation {
  readonly value: PaymentScenario;
  readonly label: string;
  readonly description: string;
}

/**
 * The three endings a demonstration can ask for.
 *
 * They exist because the assignment's Saga is only interesting when it can be
 * shown failing and compensating on demand, and a payment provider cannot be
 * asked to decline to order. The Gateway validates the value and never obeys
 * it; Transaction Service carries it; Payment Service is the only component
 * that acts on it. Anything the interface says about it must make clear that it
 * is a rehearsal, not a setting.
 */
export const PAYMENT_SCENARIOS: readonly ScenarioPresentation[] = [
  {
    value: 'APPROVE',
    label: 'Aprobar el pago',
    description: 'La transferencia llega hasta COMPLETED. Es el camino normal.',
  },
  {
    value: 'REJECT',
    label: 'Rechazar el pago',
    description:
      'El pago se rechaza después del débito, se dispara la compensación y la transferencia ' +
      'termina en COMPENSATED.',
  },
  {
    value: 'TRANSIENT_FAILURE',
    label: 'Fallo transitorio',
    description:
      'El pago falla y se reintenta. Termina en COMPLETED o, si se agotan los intentos, ' +
      'en COMPENSATED.',
  },
];

export const PAYMENT_STATUS_PRESENTATION: Readonly<
  Record<PaymentStatus, { label: string; color: 'success' | 'warning' | 'error' }>
> = {
  PENDING: { label: 'En proceso', color: 'warning' },
  SUCCEEDED: { label: 'Aprobado', color: 'success' },
  FAILED: { label: 'Rechazado', color: 'error' },
};

/** A transfer as the form collects it, before anything is sent. */
export interface TransferDraft {
  readonly sourceAccount: string;
  readonly targetAccount: string;
  readonly amountMinor: number | null;
}

/**
 * Why this transfer cannot be sent, by field.
 *
 * Checked here so a `400` never has to explain itself: the Gateway refuses the
 * same three things, and a validation the interface could have done is an error
 * message somebody has to interpret. This is what the ticket's "validación
 * local: monto > 0 y cuentas distintas, sin request si falla" asks for.
 *
 * Returns a map rather than a boolean so each field can say what is wrong
 * instead of the form just refusing.
 */
export function transferProblems(draft: TransferDraft): Readonly<Record<string, string>> {
  const problems: Record<string, string> = {};
  const source = draft.sourceAccount.trim();
  const target = draft.targetAccount.trim();

  if (!isUuidV4(source)) {
    problems.sourceAccount =
      'Escribe el accountId de la cuenta de origen. Es un UUID de 36 caracteres.';
  }

  if (!isUuidV4(target)) {
    problems.targetAccount =
      'Escribe el accountId de la cuenta de destino. Es un UUID de 36 caracteres.';
  }

  /**
   * Only once both are real identifiers. Telling somebody halfway through
   * typing the second account that it equals the first is noise.
   */
  if (problems.sourceAccount === undefined && problems.targetAccount === undefined) {
    if (source.toLowerCase() === target.toLowerCase()) {
      problems.targetAccount = 'La cuenta de destino debe ser distinta de la de origen.';
    }
  }

  if (draft.amountMinor === null || draft.amountMinor <= 0) {
    problems.amount = 'Ingresa un monto mayor que Q 0.00.';
  }

  return problems;
}

export function canSend(draft: TransferDraft): boolean {
  return Object.keys(transferProblems(draft)).length === 0;
}

/**
 * How long a `404` on a brand-new transfer means "not written down yet".
 *
 * `POST /api/transfers` answers `202` the moment the Gateway publishes; the
 * transaction row is written a few milliseconds later, by another service, over
 * a broker. So the first status query after a redirect legitimately finds
 * nothing, and reporting that as "no existe una transferencia" would tell
 * somebody their transfer vanished a second after they sent it.
 *
 * Ten seconds is generous for a local broker and short enough that a genuinely
 * wrong identifier does not spin forever.
 */
export const CREATION_GRACE_MS = 10_000;

export type MissingMeaning = 'STILL_STARTING' | 'MISSING';

export function meaningOfMissing(elapsedMs: number): MissingMeaning {
  return elapsedMs < CREATION_GRACE_MS ? 'STILL_STARTING' : 'MISSING';
}

/** How often the detail screen asks, and for how long it keeps asking. */
export const POLL_INTERVAL_MS = 2_000;

/**
 * Two minutes. A Saga that has not closed by then is not going to close because
 * this screen asked again — and a page that polls forever is a page somebody
 * leaves open for a week.
 */
export const POLL_CEILING_MS = 120_000;
