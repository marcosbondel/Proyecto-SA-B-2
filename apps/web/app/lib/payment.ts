import type { Role } from './navigation.ts';
import type { WireMoney } from './account.ts';

/**
 * Everything the Pagos module *decides*, as plain functions.
 *
 * Same reason as `transaction.ts`: the frontend has no component-test framework
 * (TD-010), so a rule written inside a `.vue` file is a rule nobody can assert
 * on. What lives here is the part of the payment interface that can be **wrong
 * about money** — whether a payment was declined or merely failed, whether a
 * retry is under way, how many rungs of the ladder are left — and every one of
 * those is one sentence away from telling somebody their transfer was refused
 * when it is still being attempted.
 *
 * Nothing here talks to the Gateway.
 */

/** `Payment.status`, exactly as the contracts write it on the wire. */
export type PaymentStatus = 'PENDING' | 'SUCCEEDED' | 'FAILED';

/** Why an attempt failed, in the only two kinds that change what happens next. */
export type PaymentErrorType = 'TRANSIENT' | 'PERMANENT';

/** The demonstration scenarios a transfer may ask the payment to act out. */
export type PaymentScenario = 'APPROVE' | 'REJECT' | 'TRANSIENT_FAILURE';

/**
 * The retry ladder, restated from `@bank/contracts`' `RETRY_DELAYS_MS`.
 *
 * Restated rather than imported because `apps/web` does not depend on the
 * contracts package — the same reason `transaction.ts` restates the six Saga
 * states. What keeps the copy honest is not discipline but
 * `test/payment.test.mjs`, which reads `routing/topology.ts` and fails the
 * build the moment the two disagree.
 */
export const RETRY_LADDER_MS: readonly number[] = [1_000, 5_000, 30_000];

/**
 * Four deliveries: the first attempt plus the three rungs.
 *
 * The distinction is worth spelling out because it is the one everybody gets
 * wrong when reading a retry counter. "Three retries" and "three attempts" are
 * different numbers, and a screen that says "intento 3 de 3" on a payment that
 * has one more chance is a screen that announces a failure early.
 */
export const MAX_ATTEMPTS = RETRY_LADDER_MS.length + 1;

/**
 * A payment as this module needs to reason about it.
 *
 * Deliberately narrower than either contract. `transaction.status.replied.v1`
 * calls the failure code `reason` and Payment Service's own reply calls it
 * `failureReason`; rather than accept both names and let a typo pass silently,
 * the two callers each build one of these. Two small conversions beat one loose
 * type.
 */
export interface PaymentSignals {
  readonly status: PaymentStatus;
  /** The kind of the **last** failure, or `null` while nothing has failed. */
  readonly errorType: PaymentErrorType | null;
  /** The catalogue failure code, or `null`. Transport noise has none. */
  readonly failureReason: string | null;
  /** How many attempts have been made. `null` before the first is recorded. */
  readonly attempt: number | null;
}

/**
 * The four endings the ticket names, which are not the three the wire carries.
 *
 * The wire has `PENDING | SUCCEEDED | FAILED`, and that is right for a
 * transport: a payment either resolved or did not. But a person looking at a
 * compensated transfer needs to know **which kind** of not, because the two
 * mean different things about their money and about what to do next:
 *
 * - `REJECTED` — the payment was refused and asking again would be refused
 *   again. Nothing to retry; the money came back.
 * - `FAILED` — the payment could not be completed after every attempt on the
 *   ladder. Nothing was refused; the system gave up. The money came back too,
 *   but the transfer is worth making again.
 *
 * Collapsing them into "no se realizó" would tell somebody their bank declined
 * a transfer that in fact timed out four times, which is both wrong and the
 * kind of wrong that produces an angry phone call.
 */
export type PaymentVerdict = 'PROCESSING' | 'APPROVED' | 'REJECTED' | 'FAILED';

/**
 * Which of the four this payment reached.
 *
 * `errorType` wins over `failureReason` when both are present, and the order is
 * not arbitrary: `errorType` is the retry policy's own statement about the
 * failure, while the failure code describes what was refused. They normally
 * agree — a decline is permanent, exhausted retries are transient — but that
 * agreement is Payment Service's policy rather than a law, and when a policy
 * and an inference disagree the policy is the one that is not guessing.
 *
 * A `FAILED` payment that says neither falls to `FAILED` rather than
 * `REJECTED`. Claiming a refusal nobody recorded would put words in a
 * provider's mouth; admitting the system gave up is the smaller claim, and it
 * is the one that is certainly true.
 */
export function verdictOf(signals: PaymentSignals): PaymentVerdict {
  if (signals.status === 'PENDING') {
    return 'PROCESSING';
  }

  if (signals.status === 'SUCCEEDED') {
    return 'APPROVED';
  }

  if (signals.errorType !== null) {
    return signals.errorType === 'PERMANENT' ? 'REJECTED' : 'FAILED';
  }

  return signals.failureReason === 'PAYMENT_DECLINED' ? 'REJECTED' : 'FAILED';
}

/**
 * Whether the ladder is being climbed right now.
 *
 * This is the whole reason `payment.attempt.failed.v1` exists. A payment that
 * is still `PENDING` **and** already carries the kind of a failure is a payment
 * whose first attempt did not work and whose next one has not happened yet —
 * which is a different thing to show somebody than "en proceso", and the only
 * moment at which the retry policy is visible from outside.
 *
 * `PERMANENT` is excluded even while `PENDING`, because the policy does not
 * retry those: a payment in that state is one event away from being rejected,
 * not one attempt away from succeeding.
 */
export function isRetrying(signals: PaymentSignals): boolean {
  return signals.status === 'PENDING' && signals.errorType === 'TRANSIENT';
}

export interface AttemptProgress {
  /** The rung reached. */
  readonly attempt: number;
  /** How many the ladder allows in total. */
  readonly of: number;
  /** Whether the ladder is spent, whatever the payment's status says. */
  readonly exhausted: boolean;
}

/**
 * The retry counter, or `null` when there is nothing worth saying.
 *
 * `null` on a first attempt on purpose: "intento 1 de 4" on a payment that went
 * through cleanly is noise dressed as diagnostics, and a panel full of that is
 * a panel people stop reading. "Intento 3 de 4" is the story.
 *
 * The count is clamped at `MAX_ATTEMPTS` rather than trusted. A service that
 * reported a fifth attempt would be reporting a bug, and rendering "intento 5
 * de 4" would make the interface look broken instead of the thing that is.
 */
export function attemptProgress(signals: PaymentSignals): AttemptProgress | null {
  const attempt = signals.attempt;

  if (attempt === null || attempt <= 1) {
    return null;
  }

  const clamped = Math.min(attempt, MAX_ATTEMPTS);

  return { attempt: clamped, of: MAX_ATTEMPTS, exhausted: clamped >= MAX_ATTEMPTS };
}

export interface VerdictPresentation {
  readonly label: string;
  readonly color: 'success' | 'warning' | 'error' | 'neutral';
  /** The sentence a person reads first. */
  readonly headline: string;
  /** What it means for their money, in plain words. */
  readonly explanation: string;
}

/**
 * Each ending as a sentence, written for the person it happened to.
 *
 * Every one of the four says explicitly what happened to the money, because
 * that is the only question being asked. The two failures both say it came
 * back — and they are still different entries, because what to do next is
 * different: one is worth retrying and the other is not.
 */
export const VERDICT_PRESENTATION: Readonly<Record<PaymentVerdict, VerdictPresentation>> = {
  PROCESSING: {
    label: 'En proceso',
    color: 'warning',
    headline: 'El pago está en proceso',
    explanation:
      'El pago se solicitó y todavía no ha respondido. El dinero ya salió de la cuenta de ' +
      'origen; si el pago no se completa, se devuelve automáticamente.',
  },
  APPROVED: {
    label: 'Aprobado',
    color: 'success',
    headline: 'El pago se aprobó',
    explanation: 'Se ordenó el crédito a la cuenta de destino.',
  },
  REJECTED: {
    label: 'Rechazado',
    color: 'error',
    headline: 'El pago fue rechazado',
    explanation:
      'El pago se rechazó y no se vuelve a intentar: reintentarlo daría el mismo resultado. ' +
      'El dinero se devolvió a la cuenta de origen.',
  },
  FAILED: {
    label: 'Fallido',
    color: 'error',
    headline: 'No se pudo completar el pago',
    explanation:
      'El pago no se completó después de agotar todos los intentos. Nadie lo rechazó: el ' +
      'sistema dejó de intentarlo. El dinero se devolvió a la cuenta de origen y la ' +
      'transferencia se puede volver a hacer.',
  },
};

export interface ErrorTypePresentation {
  readonly label: string;
  readonly explanation: string;
}

/**
 * The two kinds of failure, said out loud.
 *
 * The label is short enough for a table cell and the explanation answers the
 * only question the label raises, which is whether anything is still going to
 * happen.
 */
export const ERROR_TYPE_PRESENTATION: Readonly<
  Record<PaymentErrorType, ErrorTypePresentation>
> = {
  TRANSIENT: {
    label: 'Transitorio',
    explanation: 'Un fallo pasajero. El sistema lo reintenta hasta agotar la escalera de espera.',
  },
  PERMANENT: {
    label: 'Permanente',
    explanation: 'Un rechazo firme. No se reintenta, porque el resultado sería el mismo.',
  },
};

/**
 * How long until the next attempt, in milliseconds — or `null` if there is none.
 *
 * Reads the ladder rather than a fixed number so that a change to the policy in
 * `@bank/contracts` shows up here as different text instead of as a lie.
 * `attempt` is the rung already spent, so the first failure waits
 * `RETRY_LADDER_MS[0]`.
 */
export function nextRetryDelayMs(signals: PaymentSignals): number | null {
  if (!isRetrying(signals) || signals.attempt === null) {
    return null;
  }

  return RETRY_LADDER_MS[signals.attempt - 1] ?? null;
}

/** A wait as somebody reads it. Seconds, because the ladder is measured in them. */
export function formatDelay(ms: number): string {
  const seconds = Math.round(ms / 1_000);

  return seconds === 1 ? '1 segundo' : `${String(seconds)} segundos`;
}

/**
 * Who may open the payment monitoring screen.
 *
 * The same shape as `mayManageAccounts`, and — like it — **convenience, not
 * defence**. It exists so the interface does not offer a screen that will
 * answer `403`. The prohibition is the Gateway's `@Roles` on
 * `GET /api/payments`, which applies whether or not this function was called.
 *
 * The restriction is unusual and worth knowing why: every other listing in the
 * system narrows itself to what the asker owns, and this one cannot. Payment
 * Service holds a `transactionId` and no customer reference, and resolving one
 * to the other means reading another service's tables (§8.2, 2.3). So a
 * `CLIENTE` sees their payment where it is already scoped — inside the transfer
 * that created it — and the unscoped list is staff work (TD-037).
 */
export function mayMonitorPayments(role: Role | null): boolean {
  return role === 'CAJERO_RECEPTOR' || role === 'ADMINISTRADOR';
}

/** A payment as the listing and the detail screen both read it. */
export interface PaymentRow {
  readonly paymentId: string;
  readonly transactionId: string;
  readonly status: PaymentStatus;
  readonly amount: WireMoney;
  readonly attempt: number | null;
  readonly errorType: PaymentErrorType | null;
  readonly failureReason: string | null;
  readonly providerReference: string | null;
  readonly scenario: PaymentScenario | null;
  readonly originCorrelationId: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly decidedAt: string | null;
}

/** One rung of the ladder, as evidence rather than as narrative. */
export interface PaymentAttempt {
  readonly attemptNumber: number;
  readonly result: 'SUCCEEDED' | 'FAILED';
  readonly errorType: PaymentErrorType | null;
  readonly failureReason: string | null;
  readonly occurredAt: string;
}

/** A row is already the right shape to reason about. This names that. */
export function signalsOf(row: PaymentRow): PaymentSignals {
  return {
    status: row.status,
    errorType: row.errorType,
    failureReason: row.failureReason,
    attempt: row.attempt,
  };
}

export interface FailureSummary {
  readonly total: number;
  readonly permanent: number;
  readonly transient: number;
}

/**
 * What the monitoring screen puts in its banner.
 *
 * The prototype's banner says "3 fallos de integración externa en las últimas
 * 24 horas". This computes the count from the rows on screen rather than from a
 * window nobody can verify: a banner that claims a time range the list does not
 * actually cover is a banner that will eventually contradict the table beneath
 * it. The two numbers here are the ones the table can be counted to confirm.
 *
 * Only genuinely finished failures count. A payment still climbing the ladder
 * has not failed yet, and including it would make the banner alarm about work
 * that is going fine.
 */
export function summariseFailures(rows: readonly PaymentRow[]): FailureSummary {
  let permanent = 0;
  let transient = 0;

  for (const row of rows) {
    const verdict = verdictOf(signalsOf(row));

    if (verdict === 'REJECTED') {
      permanent += 1;
    } else if (verdict === 'FAILED') {
      transient += 1;
    }
  }

  return { total: permanent + transient, permanent, transient };
}

/**
 * Whether a payment is worth asking about again.
 *
 * The detail screen polls on exactly this, and the rule is the same one the
 * transfer screen uses: a payment that has stopped moving will not start again
 * because a browser asked. `PENDING` is the only state anything follows.
 */
export function shouldKeepPolling(status: PaymentStatus): boolean {
  return status === 'PENDING';
}

/** How often the payment detail asks, matched to the transfer screen's cadence. */
export const POLL_INTERVAL_MS = 2_000;

/**
 * Long enough to outlast the whole ladder, and then some.
 *
 * The rungs add up to 36 seconds of deliberate waiting before the first
 * attempt's own duration is counted, so a two-minute ceiling — the same one the
 * transfer screen uses — is the shortest honest one: stopping earlier would
 * report "no sabemos" about a payment that was still on schedule.
 */
export const POLL_CEILING_MS = 120_000;
