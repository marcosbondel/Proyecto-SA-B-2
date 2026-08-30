import { randomUUID } from 'node:crypto';

import { DomainRejection, registerCustomer } from '../../src/domain/customer';
import type { Customer, IdentityStatus, RegistrationRequest } from '../../src/domain/customer';
import type {
  ActivationTokenFactory,
  Clock,
  CustomerRepository,
  EventPublisher,
  IdentityDocumentReader,
  OutboundMessage,
  PasswordHasher,
  ProcessedMessage,
  StoredIdentityDocument,
} from '../../src/application/ports';

/**
 * The doubles the use-case tests run against.
 *
 * They are hand-written rather than mocked because the behaviour that matters —
 * a unique constraint refusing a duplicate, an idempotency record making a
 * second delivery a no-op — is behaviour, not a call count. A mock asserting
 * "insert was called once" would pass against a repository that inserted twice
 * into two different tables.
 */

export class InMemoryCustomerRepository implements CustomerRepository {
  public readonly customers = new Map<string, Customer>();
  public readonly credentials = new Map<string, string>();
  public readonly documents: StoredIdentityDocument[] = [];
  public readonly tokens = new Map<
    string,
    { customerId: string; expiresAt: string; usedAt: string | null }
  >();
  /** The reset links, in their own map for the reason they have their own table. */
  public readonly resetTokens = new Map<
    string,
    { customerId: string; expiresAt: string; usedAt: string | null }
  >();
  public readonly processed = new Map<string, ProcessedMessage>();

  public async registerCustomer(input: {
    readonly registration: RegistrationRequest;
    readonly usernameCandidates: Iterable<string>;
    readonly credentialHash: string;
    readonly document: Omit<StoredIdentityDocument, 'documentId' | 'customerId'> | null;
    readonly activation: { readonly tokenHash: string; readonly expiresAt: string } | null;
    readonly identityStatus: IdentityStatus;
    readonly idempotency: ProcessedMessage;
    readonly now: Date;
  }): Promise<Customer> {
    const shape = registerCustomer(input.registration, 'pending', input.now);

    for (const existing of this.customers.values()) {
      if (existing.identityDocument === shape.identityDocument) {
        throw new DomainRejection('DOCUMENT_ALREADY_REGISTERED');
      }

      if (existing.email === shape.email) {
        throw new DomainRejection('EMAIL_ALREADY_REGISTERED');
      }
    }

    const taken = new Set([...this.customers.values()].map((customer) => customer.username));
    let username: string | null = null;

    for (const candidate of input.usernameCandidates) {
      if (!taken.has(candidate)) {
        username = candidate;
        break;
      }
    }

    if (username === null) {
      throw new Error('No username candidate was free.');
    }

    const customer: Customer = {
      ...shape,
      username,
      identityStatus: input.identityStatus,
    };

    this.customers.set(customer.customerId, customer);
    this.credentials.set(customer.customerId, input.credentialHash);

    if (input.document !== null) {
      this.documents.push({
        ...input.document,
        documentId: randomUUID(),
        customerId: customer.customerId,
      });
    }

    if (input.activation !== null) {
      this.tokens.set(input.activation.tokenHash, {
        customerId: customer.customerId,
        expiresAt: input.activation.expiresAt,
        usedAt: null,
      });
    }

    await this.recordProcessed(input.idempotency);

    return customer;
  }

  public async findById(customerId: string): Promise<Customer | null> {
    return await Promise.resolve(this.customers.get(customerId) ?? null);
  }

  public async listPendingIdentityValidation(limit: number): Promise<{
    readonly customers: readonly Customer[];
    readonly total: number;
  }> {
    const pending = [...this.customers.values()].filter((c) => c.identityStatus === 'PENDING');

    return await Promise.resolve({ customers: pending.slice(0, limit), total: pending.length });
  }

  public async findByEmail(
    email: string,
  ): Promise<{ readonly customer: Customer; readonly credentialHash: string } | null> {
    for (const customer of this.customers.values()) {
      if (customer.email === email.toLowerCase()) {
        return await Promise.resolve({
          customer,
          credentialHash: this.credentials.get(customer.customerId)!,
        });
      }
    }

    return await Promise.resolve(null);
  }

  public async saveUpdate(input: {
    readonly customer: Customer;
    readonly idempotency: ProcessedMessage;
  }): Promise<void> {
    this.customers.set(input.customer.customerId, input.customer);
    await this.recordProcessed(input.idempotency);
  }

  public async saveEmailVerification(input: {
    readonly customer: Customer;
    readonly tokenHash: string;
    readonly usedAt: string;
    readonly idempotency: ProcessedMessage;
  }): Promise<void> {
    const token = this.tokens.get(input.tokenHash);

    if (token === undefined || token.usedAt !== null) {
      throw new DomainRejection('ACTIVATION_TOKEN_INVALID');
    }

    token.usedAt = input.usedAt;
    this.customers.set(input.customer.customerId, input.customer);
    await this.recordProcessed(input.idempotency);
  }

  public async saveIdentityVerdict(input: {
    readonly customer: Customer;
    readonly document: Omit<StoredIdentityDocument, 'documentId' | 'customerId'> | null;
    readonly idempotency: ProcessedMessage;
  }): Promise<void> {
    this.customers.set(input.customer.customerId, input.customer);

    if (input.document !== null) {
      this.documents.push({
        ...input.document,
        documentId: randomUUID(),
        customerId: input.customer.customerId,
      });
    }

    await this.recordProcessed(input.idempotency);
  }

  public async saveActivationToken(input: {
    readonly customerId: string;
    readonly tokenHash: string;
    readonly expiresAt: string;
  }): Promise<void> {
    this.tokens.set(input.tokenHash, {
      customerId: input.customerId,
      expiresAt: input.expiresAt,
      usedAt: null,
    });

    await Promise.resolve();
  }

  public async findByActivationToken(
    tokenHash: string,
    now: Date,
  ): Promise<
    | { readonly outcome: 'FOUND'; readonly customer: Customer }
    | { readonly outcome: 'EXPIRED' }
    | { readonly outcome: 'UNKNOWN' }
  > {
    const token = this.tokens.get(tokenHash);

    if (token === undefined || token.usedAt !== null) {
      return await Promise.resolve({ outcome: 'UNKNOWN' });
    }

    if (new Date(token.expiresAt).getTime() <= now.getTime()) {
      return await Promise.resolve({ outcome: 'EXPIRED' });
    }

    return await Promise.resolve({
      outcome: 'FOUND',
      customer: this.customers.get(token.customerId)!,
    });
  }

  public async savePasswordResetToken(input: {
    readonly customerId: string;
    readonly tokenHash: string;
    readonly expiresAt: string;
  }): Promise<void> {
    // Issuing invalidates the customer's live links, exactly as the real
    // repository does inside one transaction. Without this the fake would let a
    // test pass that the database would refuse.
    for (const token of this.resetTokens.values()) {
      if (token.customerId === input.customerId && token.usedAt === null) {
        token.usedAt = input.expiresAt;
      }
    }

    this.resetTokens.set(input.tokenHash, {
      customerId: input.customerId,
      expiresAt: input.expiresAt,
      usedAt: null,
    });

    await Promise.resolve();
  }

  public async findByPasswordResetToken(
    tokenHash: string,
    now: Date,
  ): Promise<
    | { readonly outcome: 'FOUND'; readonly customer: Customer }
    | { readonly outcome: 'EXPIRED' }
    | { readonly outcome: 'UNKNOWN' }
  > {
    const token = this.resetTokens.get(tokenHash);

    if (token === undefined || token.usedAt !== null) {
      return await Promise.resolve({ outcome: 'UNKNOWN' });
    }

    if (new Date(token.expiresAt).getTime() <= now.getTime()) {
      return await Promise.resolve({ outcome: 'EXPIRED' });
    }

    return await Promise.resolve({
      outcome: 'FOUND',
      customer: this.customers.get(token.customerId)!,
    });
  }

  public async savePasswordReset(input: {
    readonly customerId: string;
    readonly credentialHash: string;
    readonly tokenHash: string;
    readonly usedAt: string;
    readonly idempotency: ProcessedMessage;
  }): Promise<void> {
    const token = this.resetTokens.get(input.tokenHash);

    if (token === undefined || token.usedAt !== null) {
      throw new DomainRejection('RESET_TOKEN_INVALID');
    }

    // Every live link for this customer dies with the one being spent.
    for (const other of this.resetTokens.values()) {
      if (other.customerId === input.customerId && other.usedAt === null) {
        other.usedAt = input.usedAt;
      }
    }

    this.credentials.set(input.customerId, input.credentialHash);
    await this.recordProcessed(input.idempotency);
  }

  public async savePasswordChange(input: {
    readonly customerId: string;
    readonly credentialHash: string;
    readonly changedAt: string;
    readonly idempotency: ProcessedMessage;
  }): Promise<void> {
    this.credentials.set(input.customerId, input.credentialHash);

    // Outstanding reset links die with the change, as the real repository does.
    for (const token of this.resetTokens.values()) {
      if (token.customerId === input.customerId && token.usedAt === null) {
        token.usedAt = input.changedAt;
      }
    }

    await this.recordProcessed(input.idempotency);
  }

  public async findNames(
    customerIds: readonly string[],
  ): Promise<readonly { readonly customerId: string; readonly fullName: string }[]> {
    return await Promise.resolve(
      customerIds
        .map((customerId) => this.customers.get(customerId))
        .filter((customer): customer is Customer => customer !== undefined)
        .map((customer) => ({ customerId: customer.customerId, fullName: customer.fullName })),
    );
  }

  public async isDocumentDigestTaken(sha256: string, customerId: string): Promise<boolean> {
    return await Promise.resolve(
      this.documents.some(
        (document) => document.sha256 === sha256 && document.customerId !== customerId,
      ),
    );
  }

  public async findProcessed(
    idempotencyKey: string,
    messageType: string,
  ): Promise<ProcessedMessage | null> {
    return await Promise.resolve(this.processed.get(`${idempotencyKey}|${messageType}`) ?? null);
  }

  public async recordProcessed(record: ProcessedMessage): Promise<void> {
    const key = `${record.idempotencyKey}|${record.messageType}`;

    if (!this.processed.has(key)) {
      this.processed.set(key, record);
    }

    await Promise.resolve();
  }

  public async isReachable(): Promise<boolean> {
    return await Promise.resolve(true);
  }
}

/** Records what was said, so a test can assert on the conversation. */
export class RecordingPublisher implements EventPublisher {
  public readonly published: OutboundMessage[] = [];
  public readonly replies: OutboundMessage[] = [];

  public async publish(message: OutboundMessage): Promise<void> {
    this.published.push(message);
    await Promise.resolve();
  }

  public async reply(message: OutboundMessage): Promise<void> {
    this.replies.push(message);
    await Promise.resolve();
  }

  public typesPublished(): string[] {
    return this.published.map((message) => message.messageType);
  }

  public payloadOf(messageType: string): Record<string, unknown> | undefined {
    return this.published.find((message) => message.messageType === messageType)?.payload as
      | Record<string, unknown>
      | undefined;
  }
}

/** Reversible "hashing": fast, and obviously not the real thing. */
export class FakeHasher implements PasswordHasher {
  public async hash(plaintext: string): Promise<string> {
    return await Promise.resolve(`hashed:${plaintext}`);
  }

  public async verify(plaintext: string, hash: string): Promise<boolean> {
    return await Promise.resolve(hash === `hashed:${plaintext}`);
  }
}

export class PredictableTokens implements ActivationTokenFactory {
  #issued = 0;

  public issue(): { readonly token: string; readonly tokenHash: string } {
    this.#issued += 1;
    const token = `token-${String(this.#issued)}`;

    return { token, tokenHash: this.digest(token) };
  }

  public digest(token: string): string {
    return `digest:${token}`;
  }
}

export class StubDocumentReader implements IdentityDocumentReader {
  #bytes: Buffer | null;

  constructor(bytes: Buffer | null) {
    this.#bytes = bytes;
  }

  public setBytes(bytes: Buffer | null): void {
    this.#bytes = bytes;
  }

  public async read(): Promise<Buffer> {
    if (this.#bytes === null) {
      throw new Error('no such object');
    }

    return await Promise.resolve(this.#bytes);
  }
}

export class FixedClock implements Clock {
  #instant: Date;

  constructor(instant: Date) {
    this.#instant = instant;
  }

  public now(): Date {
    return this.#instant;
  }

  public advanceTo(instant: Date): void {
    this.#instant = instant;
  }
}
