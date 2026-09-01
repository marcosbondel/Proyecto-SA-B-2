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

  /**
   * Records a new password-reset token, invalidating the customer's live ones.
   *
   * The invalidation is part of issuing rather than a separate call, for the
   * reason US7 gave for activation tokens: every request otherwise left another
   * usable link behind, so asking twice doubled the number of ways in.
   */
  savePasswordResetToken(input: {
    readonly customerId: string;
    readonly tokenHash: string;
    readonly expiresAt: string;
  }): Promise<void>;

  /** The customer a live reset token belongs to, or why it cannot be used. */
  findByPasswordResetToken(tokenHash: string, now: Date): Promise<
    | { readonly outcome: 'FOUND'; readonly customer: Customer }
    | { readonly outcome: 'EXPIRED' }
    | { readonly outcome: 'UNKNOWN' }
  >;

  /**
   * Replaces the credential, burns every reset token the customer holds, and
   * records the message as processed — in one transaction.
   *
   * Burning **all** of them rather than only the one spent is the point: a
   * person who asks twice and then completes the reset should not leave a
   * second live link in an inbox that may be the reason they were resetting.
   *
   * @throws DomainRejection RESET_TOKEN_INVALID when the token was already spent
   */
  savePasswordReset(input: {
    readonly customerId: string;
    readonly credentialHash: string;
    readonly tokenHash: string;
    readonly usedAt: string;
    readonly idempotency: ProcessedMessage;
  }): Promise<void>;

  /**
   * Replaces the credential of a customer who proved they knew the old one, and
   * records the message as processed — in one transaction.
   *
   * No token to burn, unlike `savePasswordReset`: the authorisation for this
   * one was the current password, verified before this is called.
   */
  savePasswordChange(input: {
    readonly customerId: string;
    readonly credentialHash: string;
    readonly changedAt: string;
    readonly idempotency: ProcessedMessage;
  }): Promise<void>;

  /**
   * The display names behind a set of ids, for the ones that exist.
   *
   * Returns fewer rows than it was asked about when some do not exist, and says
   * nothing about which — the caller cannot tell a missing customer from one it
   * may not see, which is the point.
   */
  findNames(customerIds: readonly string[]): Promise<
    readonly { readonly customerId: string; readonly fullName: string }[]
  >;

  /** Whether this exact photo already belongs to somebody else. */
  isDocumentDigestTaken(sha256: string, customerId: string): Promise<boolean>;

  /**
   * Customers whose identity is still awaiting a teller's verdict
   * (`identityStatus = PENDING`), newest first and bounded by `limit`. `total`
   * is the full count so the caller can report how many were omitted.
   */
  listPendingIdentityValidation(limit: number): Promise<{
    readonly customers: readonly Customer[];
    readonly total: number;
  }>;

  /**
   * The most recently stored identity document for a customer, or `null` when
   * none was ever uploaded — legal, since `customer.register.v1` accepts
   * `photo: null` (`docs/domain/entities.md`).
   *
   * "Most recent" rather than "the one", because the table has no uniqueness
   * on `customer_id`: a rejected photo is kept alongside whatever replaces it,
   * so a teller asked why an identity was refused can still see what was
   * uploaded.
   */
  findLatestIdentityDocument(customerId: string): Promise<{
    readonly mimeType: string;
    readonly sizeBytes: number;
    readonly sha256: string;
    readonly content: Buffer;
  } | null>;

  /**
   * The dashboard's counts, computed in SQL rather than by loading the table.
   *
   * "Today" is computed once, in SQL, against Guatemala's calendar day —
   * `AT TIME ZONE 'America/Guatemala'` on both sides of the comparison — so the
   * number does not shift with Node's clock and does not silently become
   * tomorrow's the moment the container's own timezone (UTC) crosses local
   * midnight, which for Guatemala (UTC-6) starts at 18:00.
   */
  stats(): Promise<{
    readonly registered: number;
    readonly pendingValidation: number;
    readonly activatedToday: number;
  }>;

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

/**
 * Parks this service's own stored bytes back in the object store, so the
 * Gateway can fetch them without either the broker carrying image bytes or
 * Customer Service exposing HTTP.
 *
 * The same transfer buffer ADR-012 defines for the write path, used in
 * reverse: there the Gateway writes and this service reads once to persist;
 * here this service writes a short-lived copy of what it already persisted,
 * and the Gateway reads it once to answer one request. Nothing about the
 * object store's role changes — it still holds no business state, and the
 * document's owner remains this service's own database.
 */
export interface IdentityDocumentStager {
  stage(document: {
    readonly content: Buffer;
    readonly mimeType: 'image/jpeg' | 'image/png';
    readonly sha256: string;
    readonly sizeBytes: number;
  }): Promise<PhotoReference>;
}

/** Injected so a test can decide what "now" is. */
export interface Clock {
  now(): Date;
}
