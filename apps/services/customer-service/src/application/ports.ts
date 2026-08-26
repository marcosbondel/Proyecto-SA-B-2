import type { PhotoReference } from '@bank/contracts';

import type { Customer, IdentityStatus, RegistrationRequest } from '../domain/customer';

/**
 * Everything this service needs from the outside, named by what it is for.
 *
 * The application layer may not import `@bank/messaging` or the driver — the
 * lint rules say so and the reason is the usual one: a use case that knows it
 * publishes over AMQP cannot be tested without AMQP. What it may import is
 * `@bank/contracts`, because a contract is a shape, not a transport.
 */

/** An identity document, as it is stored beside the customer. */
export interface StoredIdentityDocument {
  readonly documentId: string;
  readonly customerId: string;
  readonly originalFilename: string | null;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly sha256: string;
  readonly content: Buffer;
  readonly validationStatus: IdentityStatus;
}

/**
 * What a previously-processed message produced.
 *
 * Stored so a redelivery can be answered with the **same** result instead of
 * being done twice. A reply that a retry could not reproduce would make the
 * broker's at-least-once delivery visible to the caller as a random failure.
 */
export interface ProcessedMessage {
  readonly idempotencyKey: string;
  readonly messageType: string;
  readonly resultSummary: Record<string, unknown>;
}

/**
 * The one door to this service's own database, and no other's.
 *
 * `registerCustomer` takes the whole registration rather than an assembled
 * `Customer` because the username cannot be chosen outside a transaction:
 * picking it by reading first and writing second is precisely the race the
 * assignment asks this service to survive (§4.1, p. 5).
 */
export interface CustomerRepository {
  /**
   * Inserts the customer, its document and the idempotency record atomically,
   * walking the username candidates until one is free.
   *
   * @throws DomainRejection DOCUMENT_ALREADY_REGISTERED / EMAIL_ALREADY_REGISTERED
   */
  registerCustomer(input: {
    readonly registration: RegistrationRequest;
    readonly usernameCandidates: Iterable<string>;
    readonly credentialHash: string;
    readonly document: Omit<StoredIdentityDocument, 'documentId' | 'customerId'> | null;
    readonly activation: { readonly tokenHash: string; readonly expiresAt: string } | null;
    readonly identityStatus: IdentityStatus;
    readonly idempotency: ProcessedMessage;
    readonly now: Date;
  }): Promise<Customer>;

  findById(customerId: string): Promise<Customer | null>;

  /** By email, because email is the login identifier (D-05). */
  findByEmail(email: string): Promise<{ readonly customer: Customer; readonly credentialHash: string } | null>;

  /**
   * Applies an update and records it as processed, in one transaction.
   *
   * The customer passed in is the **result** of applying the changes, not the
   * changes themselves: deciding what a change means is the domain's job, and
   * a repository that re-derived it would be a second place where that decision
   * lives.
   */
  saveUpdate(input: {
    readonly customer: Customer;
    readonly idempotency: ProcessedMessage;
  }): Promise<void>;

  /** Marks the account active and burns the token, in one transaction. */
  saveEmailVerification(input: {
    readonly customer: Customer;
    readonly tokenHash: string;
    readonly usedAt: string;
    readonly idempotency: ProcessedMessage;
  }): Promise<void>;

  /** Stores a new identity document and the verdict on it. */
  saveIdentityVerdict(input: {
    readonly customer: Customer;
    readonly document: Omit<StoredIdentityDocument, 'documentId' | 'customerId'> | null;
    readonly idempotency: ProcessedMessage;
  }): Promise<void>;

  /** Records a new activation token for an account that is still pending. */
  saveActivationToken(input: {
    readonly customerId: string;
    readonly tokenHash: string;
    readonly expiresAt: string;
  }): Promise<void>;

  /** The customer a live activation token belongs to, or why it cannot be used. */
  findByActivationToken(tokenHash: string, now: Date): Promise<
    | { readonly outcome: 'FOUND'; readonly customer: Customer }
    | { readonly outcome: 'EXPIRED' }
    | { readonly outcome: 'UNKNOWN' }
  >;

  /** Whether this exact photo already belongs to somebody else. */
  isDocumentDigestTaken(sha256: string, customerId: string): Promise<boolean>;

  /** What this message produced the first time, or `null` if it is new. */
  findProcessed(idempotencyKey: string, messageType: string): Promise<ProcessedMessage | null>;

  /** Records the outcome of a message that changed nothing. */
  recordProcessed(record: ProcessedMessage): Promise<void>;

  /** For the readiness probe: can this service reach its own database? */
  isReachable(): Promise<boolean>;
}

/** One outbound message, already shaped as a contract payload. */
export interface OutboundMessage {
  readonly messageType: string;
  readonly payload: unknown;
}

/**
 * How this service speaks to the rest of the system: events and replies only.
 *
 * `publish` and `reply` are separate because they are different statements —
 * an event is narrated to whoever cares, a reply is addressed to whoever
 * asked — and the exchange each one goes to differs accordingly.
 */
export interface EventPublisher {
  publish(message: OutboundMessage): Promise<void>;
  reply(message: OutboundMessage): Promise<void>;
}

/**
 * Password hashing, kept behind a port.
 *
 * Not because the algorithm might change, but because a use case that hashed
 * inline would take tens of milliseconds per test for no gain in confidence.
 */
export interface PasswordHasher {
  hash(plaintext: string): Promise<string>;
  verify(plaintext: string, hash: string): Promise<boolean>;
}

/** The activation token: a secret the service issues and only ever stores hashed. */
export interface ActivationTokenFactory {
  /** The clear value goes in the email; the digest is what is persisted. */
  issue(): { readonly token: string; readonly tokenHash: string };
  digest(token: string): string;
}

/** Fetches the bytes the Gateway parked in object storage. */
export interface IdentityDocumentReader {
  read(photo: PhotoReference): Promise<Buffer>;
}

/** Injected so a test can decide what "now" is. */
export interface Clock {
  now(): Date;
}
