import type { MessageEnvelope, PaymentErrorType } from '@bank/contracts';

import type {
  PaymentRejection,
  Transaction,
  TransactionStatus,
  Transition,
  TransitionRecord,
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
 * What became of one `payment.attempt.failed.v1`.
 *
 * Three outcomes, not four: this is a trail entry, never a transition, so
 * there is no `ILLEGAL` to report — `domain/transaction.ts` is not consulted
 * and the Saga's status is never touched.
 */
export type PaymentAttemptOutcome =
  | { readonly kind: 'RECORDED' }
  /** Seen before, by `messageId`. No second row for the same rung (T-5). */
  | { readonly kind: 'DUPLICATE' }
  /** An attempt for a transaction this service has no row for. Not an error. */
  | { readonly kind: 'UNKNOWN_TRANSACTION' };

/**
 * What the payment step of this transfer did, folded out of the local trail.
 *
 * It is **not** a read of Payment Service's database — this service has no
 * access to one and must not have (§8.2, 2.3). It is the events this service
 * itself received, written down as they arrived and read back.
 *
 * `status` stays `'PENDING'` while `attempt` and `errorType` climb: a
 * `payment.attempt.failed.v1` mid-ladder never carries a verdict, only which
 * rung was just tried and what kind of failure it was. `transaction.status.replied.v1`
 * already reserves `errorType` for exactly this — "the kind of the last failure
 * … is the only thing that tells a screen a retry is under way" — so filling
 * it in here is completing a wire contract that was already designed for it,
 * not inventing one.
 */
export interface PaymentOutcome {
  readonly paymentId: string;
  readonly status: 'PENDING' | 'SUCCEEDED' | 'FAILED';
  readonly attempt: number | null;
  readonly reason: PaymentRejection | null;
  readonly errorType: PaymentErrorType | null;
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
   *
   * `outbound`, when given, is built and written to the outbox **in the same
   * insert transaction** — and called only for the delivery that actually wins
   * the race (`kind: 'CREATED'`), mirroring `applyEvent`'s own `outbound`. A
   * delivery that loses it and reads the row back (`kind: 'EXISTS'`) never
   * calls it, so a retry of the request never builds, let alone announces,
   * `transaction.initiated.v1` a second time.
   */
  start(input: {
    readonly transaction: Transaction;
    readonly outbound?: (transaction: Transaction) => OutboxMessage;
  }): Promise<StartOutcome>;

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

  /**
   * The dashboard's counts. `inFlight` is deliberately not scoped to today —
   * see `GetTransactionStatsUseCase`.
   */
  stats(): Promise<{
    readonly today: number;
    readonly completedToday: number;
    readonly failedToday: number;
    readonly compensatedToday: number;
    readonly inFlight: number;
  }>;

  /** By its own id, or by an alias a retry was answered with. `null` if unknown. */
  findById(transactionId: string): Promise<Transaction | null>;

  /**
   * A page of transfers, newest first, already narrowed to what the asker may
   * see — and the total before the limit, so a screen can say how much it is
   * not showing.
   *
   * The scope is a parameter rather than a filter the caller may set: `ownerId`
   * is decided by the use case from the envelope identity, and a `CLIENTE`
   * cannot widen it by asking nicely.
   */
  list(input: {
    readonly ownerId: string | null;
    readonly customerId?: string;
    readonly accountId?: string;
    /** Every status the caller's `status` and `phaseStatus` filters resolve to. */
    readonly statuses?: readonly TransactionStatus[];
    readonly from?: Date;
    readonly to?: Date;
    readonly limit: number;
  }): Promise<{ readonly transactions: readonly Transaction[]; readonly total: number }>;

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
    /**
     * What the transition implies, built by the caller and written **in the
     * same transaction** as the state change — the whole of the transactional
     * outbox (TD-031). Called once, only for a transition that actually applied,
     * with the updated transaction. A duplicate or an illegal transition never
     * reaches it, so a redelivery re-emits nothing.
     */
    readonly outbound?: (transaction: Transaction, transition: Transition) => AppliedEffects;
    readonly now: Date;
  }): Promise<EventOutcome>;

  /**
   * Writes one rung of the payment's retry ladder into the local trail.
   *
   * Deliberately **not** `applyEvent`: a `payment.attempt.failed.v1` is not a
   * transition — `PAYMENT_PENDING` stays `PAYMENT_PENDING` — so there is no
   * row to lock and no `decide` to call. What has to hold is only T-5 (no
   * second row for a redelivered attempt) and the same existence check every
   * Saga event gets, so a race with the transaction's own row being written
   * lands on `UNKNOWN_TRANSACTION` rather than an orphaned trail entry.
   */
  recordPaymentAttempt(input: {
    readonly transactionId: string;
    /** The envelope's `messageId`: this system's `eventId` for T-5. */
    readonly messageId: string;
    readonly messageType: string;
    readonly payload: unknown;
  }): Promise<PaymentAttemptOutcome>;

  /**
   * Publishes the outbox rows that are still `PENDING` and marks them dispatched
   * — the relay half of the outbox. `deliver` is the broker publish; each batch
   * runs in one transaction that selects `FOR UPDATE SKIP LOCKED` (so two
   * replicas never send the same row), publishes, and marks. A crash after the
   * publish and before the mark leaves the row `PENDING`, so the next sweep
   * resends it and the consumer deduplicates by the unchanged `messageId`.
   * Returns how many rows it dispatched.
   */
  dispatchPendingOutbox(
    deliver: (message: OutboxMessage) => Promise<void>,
    limit: number,
  ): Promise<number>;

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

  /**
   * The real history (T-28): one row per legal transition actually applied,
   * newest last, plus the opening row `start()` wrote. Never filtered by
   * ownership here — the use case calls this only after `mayReadTransaction`
   * has already let the caller in.
   */
  transitionsOf(transactionId: string): Promise<readonly TransitionRecord[]>;

  /** For the readiness probe: can this service reach its own database? */
  isReachable(): Promise<boolean>;
}

/** One outbound message, already shaped as a contract payload. */
export interface OutboundMessage {
  readonly messageType: string;
  readonly payload: unknown;
}

/**
 * The durable form of an outbound message: its complete envelope, and the
 * exchange and routing key it belongs on. Stored verbatim in the outbox and
 * republished byte-for-byte by the relay, so the `messageId` a consumer
 * deduplicates by never changes between the write and the send.
 */
export interface OutboxMessage {
  readonly exchange: string;
  readonly routingKey: string;
  readonly envelope: MessageEnvelope<unknown>;
}

/**
 * What a transition implies, computed by the use case and persisted by
 * `applyEvent` in the transition's own transaction.
 */
export interface AppliedEffects {
  /** Commands and events to publish durably — written to the outbox. */
  readonly dispatch: readonly OutboxMessage[];
  /**
   * Extra local-trail rows the transition writes beyond the event that caused
   * it — today only `payment.requested.v1`, so the status query can name the
   * payment it ordered. Written to `transaction_events` in the same transaction.
   */
  readonly trail: readonly OutboundMessage[];
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

  /**
   * Builds the durable form of a message — its validated envelope on its
   * exchange — **without** publishing it. This is how the Saga's commands and
   * events reach the outbox: the use case asks for the envelope, `applyEvent`
   * writes it in the transition's transaction, and the relay publishes it later.
   * Synchronous on purpose — building an envelope touches no broker, so it can
   * happen inside the decision the repository is about to persist.
   */
  envelopeFor(message: OutboundMessage, kind: 'command' | 'event'): OutboxMessage;
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
