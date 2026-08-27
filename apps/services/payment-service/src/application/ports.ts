import type { Money } from '../domain/money';
import type {
  Payment,
  PaymentAttempt,
  PaymentErrorType,
  PaymentScenario,
  PaymentStatus,
} from '../domain/payment';

/**
 * Everything this service needs from the outside, named by what it is for.
 *
 * The application layer may not import `@bank/messaging` or `pg` — `pnpm lint`
 * enforces it — because a use case that knows it publishes over AMQP cannot be
 * tested without AMQP. `@bank/contracts` is fair game: a contract is a shape,
 * not a transport.
 */

/** What became of an order to pay. */
export type OpenOutcome =
  | { readonly kind: 'CREATED'; readonly payment: Payment }
  /**
   * A `payment.requested.v1` for a payment that already exists.
   *
   * Not an error. The Saga's command travels over a broker with at-least-once
   * delivery, so a redelivery is ordinary — and the `paymentId` is minted by
   * Transaction Service, which makes the primary key the deduplication. Running
   * the provider again here would be a second charge for one transfer.
   */
  | { readonly kind: 'EXISTS'; readonly payment: Payment };

/** What became of one attempt, once it was written down. */
export type AttemptRecord =
  | { readonly kind: 'RECORDED'; readonly payment: Payment; readonly attempt: number }
  /**
   * Somebody else got there first: another replica, or the retry sweeper racing
   * the handler. The row was locked and found already settled, or already past
   * this attempt number.
   */
  | { readonly kind: 'SUPERSEDED'; readonly payment: Payment }
  /** No such payment. A sweeper reading a row a rollback removed. */
  | { readonly kind: 'UNKNOWN' };

/** Filters a listing may narrow by. Every one optional; none is a permission. */
export interface PaymentFilter {
  readonly transactionId?: string;
  readonly status?: PaymentStatus;
  readonly errorType?: PaymentErrorType;
}

/**
 * The one door to this service's own database, and to no other's.
 *
 * `attempt` takes a **decision function** rather than an already-computed
 * result, for the reason `transaction-service` gives about its own repository:
 * a repository handed a finished answer has to trust that whoever computed it
 * read the same row the write is about to overwrite. Here that race is a double
 * charge — the handler and the retry sweeper both reading `PENDING` on attempt
 * 2 and both asking the provider. The row is locked, the domain is handed what
 * was actually found, and the decision is written inside the same transaction.
 */
export interface PaymentRepository {
  /**
   * Writes down a payment the Saga ordered, or finds the one already there.
   *
   * The primary key is the whole of it: `paymentId` comes from Transaction
   * Service, so two deliveries of one command race to insert and exactly one
   * wins. That is a fact about the database rather than a hope about timing.
   */
  open(input: { readonly payment: Payment }): Promise<OpenOutcome>;

  /**
   * Locks the payment, asks `decide` what this attempt produced, and writes
   * both the new state and the attempt in one transaction.
   *
   * `expectedAttempt` is what the caller believed the next attempt number was.
   * A mismatch means somebody else advanced the payment in between, and the
   * answer is `SUPERSEDED` rather than a second attempt with a stale number.
   */
  attempt(input: {
    readonly paymentId: string;
    readonly expectedAttempt: number;
    readonly decide: (payment: Payment, attempt: number) => AttemptResult;
    readonly now: Date;
  }): Promise<AttemptRecord>;

  findById(paymentId: string): Promise<Payment | null>;

  attemptsOf(paymentId: string): Promise<readonly PaymentAttempt[]>;

  list(filter: PaymentFilter): Promise<readonly Payment[]>;

  /**
   * Payments owed another attempt, oldest first.
   *
   * Read by the sweeper. It is what makes a retry survive a restart: a delay
   * held only in a `setTimeout` is a payment that stops retrying the moment the
   * pod is rescheduled, leaving a transfer stalled with the money already
   * debited and nothing on its way to fix it.
   */
  due(now: Date, limit: number): Promise<readonly Payment[]>;

  /** For the readiness probe: can this service reach its own database? */
  isReachable(): Promise<boolean>;
}

/** What `decide` tells the repository to write. */
export interface AttemptResult {
  readonly status: PaymentStatus;
  readonly errorType: PaymentErrorType | null;
  readonly failureReason: Payment['failureReason'];
  readonly providerReference: string | null;
  readonly nextAttemptAt: Date | null;
  readonly attemptResult: 'SUCCEEDED' | 'FAILED';
}

/** One outbound message, already shaped as a contract payload. */
export interface OutboundMessage {
  readonly messageType: string;
  readonly payload: unknown;
}

/**
 * How this service speaks to the rest of the system: events and replies.
 *
 * No `send`. This service orders nothing from anybody — it is the end of the
 * command chain, and what it produces is a statement about what happened
 * (`publish`) or an answer to a question (`reply`). A `send` here would mean
 * Payment Service had begun telling another service what to do, which is a
 * different Saga from the one the diagrams show.
 */
export interface EventPublisher {
  publish(message: OutboundMessage): Promise<void>;
  reply(message: OutboundMessage): Promise<void>;
}

/** Injected so a test can decide what "now" is. */
export interface Clock {
  now(): Date;
}

/** Injected so a test can decide what the next identifier is. */
export interface IdGenerator {
  next(): string;
}

/** The shape a caller hands in to open a payment. */
export interface PaymentOrder {
  readonly paymentId: string;
  readonly transactionId: string;
  readonly amount: Money;
  readonly scenario: PaymentScenario | null;
  readonly originCorrelationId: string | null;
}
