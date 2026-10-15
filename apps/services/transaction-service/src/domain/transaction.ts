import { amountProblem, sameAmount } from './money';
import type { Money } from './money';

/**
 * The Saga's state, and the only place that decides what may follow what.
 *
 * The vocabulary is spelled out rather than imported. `@bank/contracts` has the
 * same enums and the lint rules forbid reaching for them here — rightly: a
 * domain that imported its own vocabulary from the wire format would change
 * shape whenever the wire did, and the dependency would point outward.
 *
 * **This service decides transitions, never money.** Whether the source account
 * has funds is Account Service's judgement and arrives here as an event; what
 * this file does with that verdict is the whole of Transaction Service's job.
 * A rule here that read a balance would be this service quietly becoming the
 * owner of somebody else's invariant.
 */

export type TransactionStatus =
  'PENDING' | 'DEBITING' | 'PAYMENT_PENDING' | 'COMPLETED' | 'FAILED' | 'COMPENSATED';

/** The reasons a debit can be refused, as Account Service is allowed to say them. */
export type DebitRejection =
  'INSUFFICIENT_FUNDS' | 'ACCOUNT_INACTIVE' | 'ACCOUNT_NOT_FOUND' | 'INVALID_AMOUNT_PRECISION';

/**
 * The one reason the KYC gate can refuse, as Customer Service is allowed to
 * say it (T-31, §4.1 p. 4). A single value rather than a union because the
 * gate asks one question — "may this customer initiate a transaction at all"
 * — and `customer.kyc.checked.v1` answers it with a boolean, not a status this
 * service would have to interpret.
 */
export type KycRejection = 'KYC_NOT_VERIFIED';

/** The reasons a credit can be refused. */
export type CreditRejection = 'ACCOUNT_NOT_FOUND' | 'INVALID_AMOUNT_PRECISION';

/** The reasons a payment can fail. */
export type PaymentRejection = 'PAYMENT_DECLINED' | 'PAYMENT_RETRIES_EXHAUSTED';

/** The reasons a request is refused before any Saga starts. */
export type RequestRejection =
  | 'INVALID_AMOUNT'
  | 'INVALID_AMOUNT_PRECISION'
  | 'SAME_ACCOUNT_TRANSFER'
  | 'IDEMPOTENCY_KEY_CONFLICT';

/** Everything this service can record as a cause of not completing. */
export type FailureReason =
  | DebitRejection
  | CreditRejection
  | PaymentRejection
  | RequestRejection
  | KycRejection;

/**
 * The demonstration scenario, carried and never obeyed here.
 *
 * `TIMEOUT` added by T-29, alongside Payment Service's simulated provider.
 * This service still decides nothing from it — only Payment Service acts on
 * the value.
 */
export type PaymentScenario = 'APPROVE' | 'REJECT' | 'TRANSIENT_FAILURE' | 'TIMEOUT';

/**
 * The aggregate this service owns.
 *
 * It holds no balance and never will. `sourceAccount` and `targetAccount` are
 * opaque references to rows in a database this service may not read
 * (constitution II, §8.2 criterion 2.3) — what they contain is Account
 * Service's business and arrives here only as the outcome of a command.
 */
/**
 * El destino de un depósito en otro banco, estructuralmente el
 * `interbankDestination` de los contratos (T-47).
 *
 * Declarado aquí y no importado por la misma regla que el resto de este
 * archivo: el dominio no importa `@bank/contracts`, para que lo que decide una
 * transferencia pueda discutirse sin broker y sin esquemas. Es el mismo trato
 * que recibe `PaymentStatus`.
 */
export interface InterbankDestination {
  readonly bankCode: string;
  readonly account: string;
  readonly interbankTransferId: string;
  readonly idempotencyKey: string;
}

export interface Transaction {
  readonly transactionId: string;
  readonly sourceAccount: string;
  readonly targetAccount: string;
  readonly amount: Money;
  readonly status: TransactionStatus;
  /** The flow this transfer was born in. Never regenerated (constitution VIII). */
  readonly correlationId: string;
  readonly idempotencyKey: string;
  /**
   * Who asked for this transfer, from the envelope's verified identity.
   *
   * The only thing in this service that knows a transaction belongs to a
   * person. Both account references are opaque here — resolving either to a
   * customer means reading Account Service's database, which §8.2 (2.3)
   * forbids — so without this column "which transfers are mine" and "may this
   * actor read this transfer" were both unanswerable (TD-033, TD-035).
   *
   * `null` for a transfer nobody originated, and for the rows that existed
   * before the column did.
   */
  readonly customerId: string | null;
  /**
   * What a service payment is for — the biller's contract or meter number.
   *
   * `null` for an ordinary transfer between two people. This service never
   * interprets it: the number belongs to the biller, and a bank that validated
   * its shape would refuse a valid one the day the biller changed theirs.
   */
  readonly reference: string | null;
  readonly failureReason: FailureReason | null;
  readonly paymentScenario: PaymentScenario | null;
  /**
   * A dónde va de verdad el dinero, cuando el destino está en otro banco
   * (T-47).
   *
   * `null` para una transferencia interna. Este servicio **no lo interpreta**:
   * lo guarda y lo copia en la orden de pago, donde Payment Service —el único
   * que habla con el banco pareja— sí lo entiende. Es el mismo trato que
   * `reference` recibe del pago de servicios, y por el mismo motivo: un
   * orquestador que opina sobre un contrato ajeno rechaza un destino válido el
   * día que el otro banco cambia el suyo.
   *
   * Que esté aquí no cambia la máquina de estados ni una línea: para la Saga,
   * un depósito interbancario es un débito, un pago y un crédito a la cuenta de
   * liquidación, exactamente como cualquier transferencia.
   */
  readonly interbank: InterbankDestination | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  /** Set once, when the transaction reaches a terminal state. */
  readonly completedAt: Date | null;
}

/** The three states nothing follows. */
const TERMINAL: ReadonlySet<TransactionStatus> = new Set<TransactionStatus>([
  'COMPLETED',
  'FAILED',
  'COMPENSATED',
]);

export function isTerminal(status: TransactionStatus): boolean {
  return TERMINAL.has(status);
}

/**
 * Whether a transaction is still exactly where `openTransaction` left it:
 * accepted, but with no `KYC_CHECK_ORDERED` ever applied to it.
 *
 * The one place outside this file allowed to ask is `RequestTransferUseCase`,
 * to tell an ordinary redelivery apart from a transfer whose Saga never
 * started — a crash between the row committing and the KYC check being
 * ordered leaves exactly this shape, and a redelivery that finds it has to
 * resume the Saga rather than treat the row's mere existence as proof it
 * already did.
 */
export function isPending(transaction: { readonly status: TransactionStatus }): boolean {
  return transaction.status === 'PENDING';
}

/**
 * What happened, in the domain's own words rather than the broker's.
 *
 * The names are not the message names on purpose. A domain that spoke in
 * `account.debited.v1` would be a domain that could not be reasoned about
 * without the catalogue open, and renaming a message would become a change to
 * the state machine.
 */
export type SagaEvent =
  | { readonly kind: 'KYC_CHECK_ORDERED' }
  | { readonly kind: 'KYC_APPROVED' }
  | { readonly kind: 'KYC_REJECTED'; readonly reason: KycRejection }
  | { readonly kind: 'DEBITED' }
  | { readonly kind: 'DEBIT_REJECTED'; readonly reason: DebitRejection }
  | { readonly kind: 'PAYMENT_SUCCEEDED' }
  | { readonly kind: 'PAYMENT_FAILED'; readonly reason: PaymentRejection }
  | { readonly kind: 'CREDITED' }
  | { readonly kind: 'CREDIT_REJECTED'; readonly reason: CreditRejection }
  | { readonly kind: 'DEBIT_COMPENSATED' };

/** What the Saga must order next, if anything. */
export type SagaCommand = 'KYC_CHECK' | 'DEBIT' | 'PAYMENT' | 'CREDIT' | 'COMPENSATION';

/** The result of a legal transition: where it lands and what it orders. */
export interface Transition {
  readonly from: TransactionStatus;
  readonly status: TransactionStatus;
  readonly failureReason: FailureReason | null;
  readonly command: SagaCommand | null;
}

/**
 * One row of the transaction's real history, as opposed to `timelineFor`'s
 * projection from the current status alone.
 *
 * `from` is `null` for exactly one row per transaction: the one `start()`
 * writes when the transfer is accepted, before any Saga event has moved it.
 * Every later row is a `Transition` this file actually applied, self-
 * transitions on `PAYMENT_PENDING` included — a history that skipped them
 * could not explain why a transfer ended up compensated.
 */
export interface TransitionRecord {
  readonly from: TransactionStatus | null;
  readonly to: TransactionStatus;
  readonly event: string;
  readonly failureReason: FailureReason | null;
  readonly occurredAt: Date;
}

/**
 * An event that has no place in the diagram, from the state the transaction is
 * actually in.
 *
 * Invariant T-6: it is discarded and **recorded**, never applied. It is an
 * error class rather than a returned union because every caller does the same
 * thing with it — write it to the local audit table, change nothing, do not
 * retry — and threading a union through eight handlers buys nothing for that.
 *
 * It is deliberately **not** a thrown failure in the operational sense. The
 * message is not redelivered and not dead-lettered: an out-of-order event is a
 * normal consequence of a distributed system with retries, and treating it as
 * an outage would fill the dead-letter queue with correct behaviour.
 */
export class IllegalTransition extends Error {
  public readonly code = 'ILLEGAL_TRANSITION' as const;
  public readonly from: TransactionStatus;
  public readonly event: SagaEvent['kind'];

  constructor(from: TransactionStatus, event: SagaEvent['kind']) {
    super(`"${event}" is not a legal event for a transaction in ${from}.`);
    this.name = 'IllegalTransition';
    this.from = from;
    this.event = event;
  }
}

/**
 * Why a transfer request cannot start a Saga, or `null` when it can.
 *
 * Both invariants it checks — T-1 and T-2 — are properties of the request
 * itself and need no state at all, which is why they are decided before a
 * transaction exists rather than after.
 */
export function requestRefusal(request: {
  readonly sourceAccount: string;
  readonly targetAccount: string;
  readonly amount: Money;
}): RequestRejection | null {
  const problem = amountProblem(request.amount);

  if (problem !== null) {
    return problem;
  }

  // T-2. A transfer to yourself is not a small transfer, it is a request that
  // would debit and credit the same row and could deadlock against itself.
  if (request.sourceAccount === request.targetAccount) {
    return 'SAME_ACCOUNT_TRANSFER';
  }

  return null;
}

/**
 * Whether a repeat of an idempotency key is the same intention or a different one.
 *
 * Invariant T-3 says the same key with the same content returns the original
 * transaction; T-4 says the same key with **different** content is a conflict.
 * Answering a different request with the original's result would be a lie, and
 * a lie about where somebody's money went.
 *
 * `transactionId` is excluded from the comparison deliberately: the Gateway
 * mints a fresh one per HTTP request, so a genuine retry always carries a new
 * one. Comparing it would make every retry a conflict, which is the exact
 * opposite of what an idempotency key is for.
 */
export function conflictsWithOriginal(
  original: Transaction,
  request: {
    readonly sourceAccount: string;
    readonly targetAccount: string;
    readonly amount: Money;
  },
): boolean {
  return (
    original.sourceAccount !== request.sourceAccount ||
    original.targetAccount !== request.targetAccount ||
    !sameAmount(original.amount, request.amount)
  );
}

/** A transfer just accepted: `PENDING`, nothing ordered yet. */
export function openTransaction(input: {
  readonly transactionId: string;
  readonly sourceAccount: string;
  readonly targetAccount: string;
  readonly amount: Money;
  readonly correlationId: string;
  readonly idempotencyKey: string;
  readonly customerId: string | null;
  readonly reference: string | null;
  readonly paymentScenario: PaymentScenario | null;
  /**
   * Opcional en la ENTRADA, obligatorio en la transacción: una transferencia
   * interna no lo nombra y vale `null`, y así los ciento y pico casos que ya
   * existían siguen diciendo lo que decían. Omitirlo es declarar que el dinero
   * no sale de este banco.
   */
  readonly interbank?: InterbankDestination | null;
  readonly now: Date;
}): Transaction {
  return {
    transactionId: input.transactionId,
    sourceAccount: input.sourceAccount,
    targetAccount: input.targetAccount,
    amount: input.amount,
    status: 'PENDING',
    correlationId: input.correlationId,
    idempotencyKey: input.idempotencyKey,
    customerId: input.customerId,
    reference: input.reference,
    failureReason: null,
    paymentScenario: input.paymentScenario,
    interbank: input.interbank ?? null,
    createdAt: input.now,
    updatedAt: input.now,
    completedAt: null,
  };
}

/**
 * The diagram, as the one function that enforces it.
 *
 * ```
 * PENDING ──► DEBITING ──► PAYMENT_PENDING ──► COMPLETED
 *    │           │                │
 *    │           │                └──► COMPENSATED   (payment failed, or credit rejected)
 *    │           └──► FAILED                          (debit rejected: nothing to undo)
 *    └──► FAILED                                      (KYC gate refused: T-31)
 * ```
 *
 * Two things it guarantees that the picture does not say out loud:
 *
 * - **Invariant T-7.** Nothing reaches `FAILED` except a KYC refusal or a
 *   rejected debit — both of them before any money has moved. Once the money
 *   has left the source account the Saga can only end in `COMPLETED` or
 *   `COMPENSATED`, because those are the two endings in which the money is
 *   somewhere. `FAILED` after a successful debit would mean a transfer closed
 *   with the money outside every account in the bank.
 * - **A compensation is ordered once.** `failureReason` is what records that
 *   the decision was already taken, so a second `payment.failed` — a
 *   redelivery, or a payment service that answered twice — is illegal rather
 *   than a second refund (T-5).
 *
 * `KYC_CHECK_ORDERED`, `PAYMENT_SUCCEEDED` and the two compensation triggers
 * are **self-transitions**: they order the next command without moving the
 * status. That is not an oversight in the diagram. The states are the ones
 * the assignment fixed and the database's `CHECK` admits; inventing a
 * `CHECKING_KYC`, a `CREDITING` or a `COMPENSATING` here would mean a status
 * the contract cannot carry and the column will not store.
 *
 * @throws IllegalTransition when the event has no place from this state (T-6).
 */
export function applyEvent(transaction: Transaction, event: SagaEvent): Transition {
  const from = transaction.status;
  const stay = (command: SagaCommand | null, failureReason: FailureReason | null): Transition => ({
    from,
    status: from,
    failureReason,
    command,
  });
  const move = (
    status: TransactionStatus,
    failureReason: FailureReason | null,
    command: SagaCommand | null = null,
  ): Transition => ({ from, status, failureReason, command });

  switch (event.kind) {
    /**
     * Step 2 of the Saga (T-31): the first thing a freshly-accepted transfer
     * asks is not Account Service, it is Customer Service — whether this
     * customer may initiate a transaction at all. `PENDING` stays `PENDING`
     * for the length of the question, the same way it does not move while
     * `DEBIT_ORDERED` used to be this event's name before the gate existed.
     */
    case 'KYC_CHECK_ORDERED':
      return from === 'PENDING' ? stay('KYC_CHECK', null) : illegal(transaction, event);

    case 'KYC_APPROVED':
      return from === 'PENDING' ? move('DEBITING', null, 'DEBIT') : illegal(transaction, event);

    case 'KYC_REJECTED':
      // The other door to FAILED, and the reason it needs no compensation:
      // refused before the debit was ever ordered.
      return from === 'PENDING' ? move('FAILED', event.reason) : illegal(transaction, event);

    case 'DEBITED':
      return from === 'DEBITING'
        ? move('PAYMENT_PENDING', null, 'PAYMENT')
        : illegal(transaction, event);

    case 'DEBIT_REJECTED':
      // The only door to FAILED, and the reason T-7 holds.
      return from === 'DEBITING' ? move('FAILED', event.reason) : illegal(transaction, event);

    case 'PAYMENT_SUCCEEDED':
      return from === 'PAYMENT_PENDING' && transaction.failureReason === null
        ? stay('CREDIT', null)
        : illegal(transaction, event);

    case 'PAYMENT_FAILED':
      return from === 'PAYMENT_PENDING' && transaction.failureReason === null
        ? stay('COMPENSATION', event.reason)
        : illegal(transaction, event);

    case 'CREDITED':
      return from === 'PAYMENT_PENDING' && transaction.failureReason === null
        ? move('COMPLETED', null)
        : illegal(transaction, event);

    case 'CREDIT_REJECTED':
      return from === 'PAYMENT_PENDING' && transaction.failureReason === null
        ? stay('COMPENSATION', event.reason)
        : illegal(transaction, event);

    case 'DEBIT_COMPENSATED':
      /**
       * Legal only where a compensation was actually ordered. A
       * `account.debit.compensated.v1` arriving at a transaction nobody asked
       * to compensate is either an event for another Saga or one that overtook
       * its own cause, and applying it would close a transfer as refunded while
       * its payment was still in flight.
       */
      return from === 'PAYMENT_PENDING' && transaction.failureReason !== null
        ? move('COMPENSATED', transaction.failureReason)
        : illegal(transaction, event);
  }
}

function illegal(transaction: Transaction, event: SagaEvent): never {
  throw new IllegalTransition(transaction.status, event.kind);
}

/** The transaction as it stands after a transition, ready to be written down. */
export function afterTransition(
  transaction: Transaction,
  transition: Transition,
  now: Date,
): Transaction {
  return {
    ...transaction,
    status: transition.status,
    failureReason: transition.failureReason,
    updatedAt: now,
    /**
     * Written once. A terminal state that could be re-stamped would let a
     * redelivery move the closing time of a transfer that closed yesterday.
     */
    completedAt: isTerminal(transition.status) ? (transaction.completedAt ?? now) : null,
  };
}

/**
 * Who may read a transfer: its originator, or staff.
 *
 * The check TD-035 said this service could not make. It can now, because the
 * row records who asked — and it is made **here**, in the domain, rather than
 * at the Gateway, because the Gateway holds no transactions and would have to
 * read one to decide whether it may be read.
 *
 * A transfer with no recorded originator is readable by staff alone. That is
 * the safe reading of an unknown: the rows that predate the column belong to
 * somebody, and guessing which client would be worse than showing nobody.
 */
export function mayReadTransaction(
  actor: { readonly customerId: string; readonly role: string } | null,
  transaction: { readonly customerId: string | null },
): boolean {
  if (actor === null) {
    return false;
  }

  if (actor.role !== 'CLIENTE') {
    return true;
  }

  return transaction.customerId !== null && transaction.customerId === actor.customerId;
}
