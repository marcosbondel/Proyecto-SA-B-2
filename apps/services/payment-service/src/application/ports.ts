import type { MessageEnvelope } from '@bank/contracts';

import type { Money } from '../domain/money';
import type {
  Payment,
  PaymentAttempt,
  PaymentErrorType,
  PaymentScenario,
  PaymentStatus,
} from '../domain/payment';
import type { ProviderResult } from '../domain/provider';
import type { SimulationSettings } from '../domain/simulation';

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
   * The dashboard's counts.
   *
   * `retrying` is a payment that has failed at least once and is still due
   * another attempt — `status = 'PENDING'` with a `next_attempt_at`. It is the
   * one figure here that is about something happening rather than something
   * that happened, which is why it is not scoped to today.
   */
  stats(): Promise<{
    readonly today: number;
    readonly succeededToday: number;
    readonly failedToday: number;
    readonly retrying: number;
  }>;

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
    /**
     * The events this attempt implies, built by the caller and written to the
     * outbox **in the same transaction** as the attempt (TD-047). Called once,
     * only when the attempt is actually `RECORDED`, with the updated payment —
     * so a superseded or unknown attempt enqueues nothing.
     */
    readonly outbound?: (payment: Payment, attempt: number) => readonly OutboxMessage[];
    readonly now: Date;
  }): Promise<AttemptRecord>;

  /**
   * Publishes the `PENDING` outbox rows and marks them dispatched — the relay
   * half of the outbox. `deliver` is the broker publish; each batch runs in one
   * transaction that selects `FOR UPDATE SKIP LOCKED`, publishes, and marks. A
   * crash after a publish and before the mark leaves the row `PENDING`, so the
   * next sweep resends it and every consumer deduplicates on the unchanged
   * `messageId`. Returns how many rows it dispatched.
   */
  dispatchPendingOutbox(
    deliver: (message: OutboxMessage) => Promise<void>,
    limit: number,
  ): Promise<number>;

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

  /**
   * The administrator's override of the provider's simulation, or `null` while
   * the ConfigMap's values are in force (T-44).
   *
   * One row, in this service's own database, read on every attempt: that is
   * what makes a change hold for every replica at once and survive a restart.
   * A value held in memory would be whichever replica happened to take the
   * command.
   */
  loadSimulation(): Promise<StoredSimulation | null>;

  /** Stores the override, replacing any earlier one. */
  saveSimulation(settings: SimulationSettings, now: Date): Promise<StoredSimulation>;

  /** Removes the override, so the ConfigMap's values apply again. */
  clearSimulation(): Promise<void>;

  /** For the readiness probe: can this service reach its own database? */
  isReachable(): Promise<boolean>;
}

/** The override as stored: the three numbers and when they were set. */
export interface StoredSimulation {
  readonly settings: SimulationSettings;
  readonly updatedAt: Date;
}

/** The simulation in force, and where it came from. */
export interface SimulationInForce {
  readonly settings: SimulationSettings;
  readonly source: 'DEFAULTS' | 'RUNTIME';
  readonly updatedAt: Date | null;
}

/** What the attempt path needs to know about the simulation, and nothing more. */
export interface SimulationSource {
  current(): Promise<SimulationInForce>;
}

/**
 * Where the dice come from. Injected so a test can say "the next roll is 0.29"
 * and the provider, which never calls `Math.random` itself, can stay pure.
 */
export interface Randomness {
  /** A number in `[0, 1)`. */
  next(): number;
}

/** Injected so a test does not wait out a simulated latency. */
export interface Sleeper {
  sleep(milliseconds: number): Promise<void>;
}

/** One call to the simulated provider, as telemetry wants to hear about it. */
export interface ProviderCall {
  readonly paymentId: string;
  readonly transactionId: string;
  readonly correlationId: string | null;
  readonly attempt: number;
  readonly result: ProviderResult;
  readonly errorType: PaymentErrorType | null;
  /** Whether a further attempt is owed. Only meaningful for a failure or a timeout. */
  readonly willRetry: boolean;
  /**
   * `SCENARIO` when the transfer scripted the answer, `CONFIGURATION` when the
   * provider's rates did. Either way the failure is simulated: there is no real
   * provider in this system.
   */
  readonly source: 'SCENARIO' | 'CONFIGURATION';
  /** How long the provider took to answer, in milliseconds. */
  readonly latencyMs: number;
}

/**
 * What this service tells OpenTelemetry about the provider (T-44).
 *
 * Implementations never throw: by the time it is called the attempt has
 * committed and its events are in the outbox, so a failing log sink must not
 * turn a settled payment into a retried one.
 */
export interface ProviderTelemetry {
  providerCall(call: ProviderCall): void;
  simulationChanged(change: {
    readonly action: 'UPDATE' | 'RESET' | 'DENIED';
    readonly settings: SimulationSettings;
    readonly correlationId: string | null;
  }): void;
}

/** What `decide` tells the repository to write. */
export interface AttemptResult {
  readonly status: PaymentStatus;
  readonly errorType: PaymentErrorType | null;
  readonly failureReason: Payment['failureReason'];
  readonly providerReference: string | null;
  readonly nextAttemptAt: Date | null;
  readonly attemptResult: 'SUCCEEDED' | 'FAILED';
  /** What the simulated provider answered on this attempt — added by T-29. */
  readonly providerResult: ProviderResult;
}

/** One outbound message, already shaped as a contract payload. */
export interface OutboundMessage {
  readonly messageType: string;
  readonly payload: unknown;
}

/**
 * The durable form of an event: its complete envelope, and the exchange and
 * routing key it belongs on. Stored verbatim in the outbox and republished
 * byte-for-byte by the relay, so the `messageId` a consumer deduplicates by
 * never changes between the write and the send.
 */
export interface OutboxMessage {
  readonly exchange: string;
  readonly routingKey: string;
  readonly envelope: MessageEnvelope<unknown>;
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

  /**
   * Builds the durable form of an event — its validated envelope on the events
   * exchange — **without** publishing it. This is how a payment's events reach
   * the outbox: the use case asks for the envelope, `attempt` writes it in the
   * attempt's transaction, and the relay publishes it later. Synchronous, since
   * building an envelope touches no broker.
   */
  envelopeFor(message: OutboundMessage): OutboxMessage;
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
