import type {
  PaymentRejection,
  Transaction,
  TransactionStatus,
  Transition,
} from '../domain/transaction';

/**
 * Everything this service needs from the outside, named by what it is for.
 *
 * The application layer may not import `@bank/messaging` or `pg` — `pnpm lint`
 * enforces it — because a use case that knows it publishes over AMQP cannot be
 * tested without AMQP. `@bank/contracts` is fair game: a contract is a shape,
 * not a transport.
 */

/**
 * What became of a transfer request.
 *
 * Three outcomes and not two, because invariants T-3 and T-4 are different
 * answers to the same repeated key. `DUPLICATE` is the retry that must be
 * honoured with the original transaction and no second Saga; `CONFLICT` is a
 * different request wearing a used key, and answering it with the original's
 * result would be a lie about where somebody's money went.
 */
export type StartOutcome =
  | { readonly kind: 'CREATED'; readonly transaction: Transaction }
  | { readonly kind: 'EXISTS'; readonly transaction: Transaction };

/**
 * What became of a Saga event.
 *
 * Every one of the four is a normal outcome. None of them is an exception,
 * because the only thing an exception buys here is a redelivery, and three of
 * these four would produce exactly the same answer on every attempt until the
 * message reached the dead-letter queue.
 */
export type EventOutcome =
  | {
      readonly kind: 'APPLIED';
      readonly transaction: Transaction;
      readonly transition: Transition;
    }
  /** Seen before, by `messageId`. No second transition, no second refund (T-5). */
  | { readonly kind: 'DUPLICATE' }
  /**
   * An event about a transaction this service has no row for. Not an error:
   * `transaction.saga` is bound to events by pattern, and an event for a
   * transfer another replica has not yet committed is a race, not a fault.
   */
  | { readonly kind: 'UNKNOWN_TRANSACTION' }
  /** Discarded and recorded, never applied (T-6). */
  | {
      readonly kind: 'ILLEGAL';
      readonly from: TransactionStatus;
      readonly event: string;
    };

/**
 * What the payment step of this transfer did, folded out of the local trail.
 *
 * It is **not** a read of Payment Service's database — this service has no
 * access to one and must not have (§8.2, 2.3). It is the events this service
 * itself received, written down as they arrived and read back.
 */
export interface PaymentOutcome {
  readonly paymentId: string;
  readonly status: 'PENDING' | 'SUCCEEDED' | 'FAILED';
  readonly attempt: number | null;
  readonly reason: PaymentRejection | null;
  readonly decidedAt: Date | null;
}

/**
 * The one door to this service's own database, and to no other's.
 *
 * `applyEvent` takes a **decision function** rather than an already-computed
 * transaction, and that is the load-bearing choice of this file. A repository
 * handed a finished `Transaction` would have to trust that whoever computed it
 * read the same row the write is about to overwrite — which is precisely the
 * read-then-write race that makes two concurrent Saga events corrupt a state
 * machine. Instead the repository locks the row, hands the domain what it
 * actually found, and writes what the domain decided, all in one transaction.
 */
export interface TransactionRepository {
  /**
   * Writes down a new transfer, or finds the one this key already named.
   *
   * The unique constraint on `idempotency_key` is the whole of invariant T-3:
   * two deliveries of one intention race to insert and exactly one wins, which
   * is a fact about the database rather than a hope about timing.
   */
  start(input: { readonly transaction: Transaction }): Promise<StartOutcome>;

  /**
   * Points a second identifier at a transfer that already exists.
   *
   * The Gateway mints a fresh `transactionId` for every HTTP request — a retry
   * included — and hands it back in the `202`. Without this, a caller who
   * retried after a timeout would be holding an identifier that resolves to
   * nothing, which is the failure recorded as TD-025 on the customer side. With
   * it, the retry's identifier resolves to the original transfer, which is what
   * "the same key returns the same logical transaction" has to mean from
   * outside this service.
   *
   * Recorded only for a retry that was **honoured**. A request that reused a
   * key with different content (T-4) is refused, and pointing its identifier at
   * somebody else's transfer would answer a lie to whoever followed it.
   */
  recordAlias(input: {
    readonly requestedTransactionId: string;
    readonly transactionId: string;
  }): Promise<void>;

  /** By its own id, or by an alias a retry was answered with. `null` if unknown. */
  findById(transactionId: string): Promise<Transaction | null>;

  /**
   * By the correlation the transfer was created under.
   *
   * `transaction.status.requested.v1` admits either identifier, and this is the
   * one a caller still has after a reply timeout swallowed the other.
   */
  findByCorrelationId(correlationId: string): Promise<Transaction | null>;

  /**
   * Deduplicates, locks, decides and writes — in that order, in one transaction.
   *
   * The order is the guarantee. Deduplication happens **before** the state is
   * touched, so a redelivery cannot produce a second transition; `decide` runs
   * **inside** the lock, so two events arriving at once cannot both read
   * `PAYMENT_PENDING` and both order a compensation.
   *
   * An `IllegalTransition` thrown by `decide` is caught, recorded in the local
   * trail and returned as `ILLEGAL`. The write of that record commits: T-6 says
   * an out-of-order event is discarded **and recorded**, and rolling back the
   * record along with the transition would lose the only evidence it happened.
   */
  applyEvent(input: {
    readonly transactionId: string;
    /** The envelope's `messageId`: this system's `eventId` for T-5. */
    readonly messageId: string;
    readonly messageType: string;
    readonly payload: unknown;
    readonly decide: (transaction: Transaction) => Transition;
    readonly now: Date;
  }): Promise<EventOutcome>;

  /**
   * Records something this service published, in the same trail as what it
   * received.
   *
   * The Saga's commands are half its story. A trail that held only the events
   * that arrived could say a transfer waited in `PAYMENT_PENDING` but not that
   * a payment was ever ordered, and those are different incidents.
   */
  recordCommand(input: {
    readonly transactionId: string;
    readonly messageType: string;
    readonly payload: unknown;
  }): Promise<void>;

  /** The payment half of the local trail, folded into one answer. */
  paymentOutcomeOf(transactionId: string): Promise<PaymentOutcome | null>;

  /** For the readiness probe: can this service reach its own database? */
  isReachable(): Promise<boolean>;
}

/** One outbound message, already shaped as a contract payload. */
export interface OutboundMessage {
  readonly messageType: string;
  readonly payload: unknown;
}

/**
 * How this service speaks to the rest of the system: commands, events and
 * replies, and nothing else.
 *
 * Three methods because they are three different statements — a command is
 * addressed to one handler, an event is narrated to whoever cares, a reply is
 * addressed to whoever asked — and the exchange each goes to follows from that.
 * This service is the only one in the system that publishes all three, because
 * it is the only one that orders work from others.
 */
export interface EventPublisher {
  send(message: OutboundMessage): Promise<void>;
  publish(message: OutboundMessage): Promise<void>;
  reply(message: OutboundMessage): Promise<void>;
}

/** Injected so a test can decide what "now" is. */
export interface Clock {
  now(): Date;
}

/**
 * Injected so a test can decide what the next identifier is.
 *
 * Only one thing in this service mints an identifier of its own — the
 * `paymentId` — and a test that has to guess a random UUID to assert on the
 * payment it ordered is a test that asserts nothing.
 */
export interface IdGenerator {
  next(): string;
}
