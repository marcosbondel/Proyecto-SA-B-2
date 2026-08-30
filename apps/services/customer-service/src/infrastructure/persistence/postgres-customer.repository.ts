import { randomUUID } from 'node:crypto';

import type { Pool, PoolClient } from 'pg';

import { DomainRejection, registerCustomer } from '../../domain/customer';
import type { Customer, IdentityStatus, RegistrationRequest, Role } from '../../domain/customer';
import type {
  CustomerRepository,
  ProcessedMessage,
  StoredIdentityDocument,
} from '../../application/ports';

/** PostgreSQL's code for a unique violation. */
const UNIQUE_VIOLATION = '23505';

interface CustomerRow {
  readonly customer_id: string;
  readonly full_name: string;
  readonly document_number: string;
  readonly email: string;
  readonly birth_date: Date | string;
  readonly address: string | null;
  readonly username: string;
  readonly role: string;
  readonly status: string;
  readonly identity_status: string;
  readonly email_verified_at: Date | null;
  readonly created_at: Date;
  readonly updated_at: Date;
  readonly version: number;
}

/**
 * This service's own database, and the only code that touches it.
 *
 * Hand-written SQL rather than an ORM: the schema is four tables that nobody
 * else may read, and the two operations that matter — claiming a username under
 * concurrency, recording a message as processed exactly once — are decided by
 * unique constraints. An ORM would hide precisely those two behind a mapping
 * layer.
 *
 * Every write that produces an event also writes its idempotency record **in
 * the same transaction**. That is what makes "the same command twice" cost one
 * row and one event: the two cannot come apart, because a crash between them is
 * not a state this code can reach.
 */
export class PostgresCustomerRepository implements CustomerRepository {
  readonly #pool: Pool;

  constructor(pool: Pool) {
    this.#pool = pool;
  }

  /**
   * Inserts the customer, its document, its activation token and the
   * idempotency record — atomically, and with the username decided by the
   * database.
   *
   * The candidate loop is the answer to the race the assignment names (§4.1,
   * p. 5). Two simultaneous registrations of two people called Juan Pérez both
   * try `juanperez`; one commits, the other gets a unique violation, rolls back
   * and tries `juanperez2`. Reading "is this username taken?" first would have
   * let both through, because the answer would have been "no" for both.
   */
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
    // Throws INVALID_BIRTH_DATE before a connection is taken: an incoherent
    // date should not cost a transaction.
    const shape = registerCustomer(input.registration, 'pending', input.now);

    for (const username of input.usernameCandidates) {
      const client = await this.#pool.connect();

      try {
        await client.query('BEGIN');

        const inserted = await client.query<CustomerRow>(
          `INSERT INTO customers (
             customer_id, full_name, document_number, email, birth_date, address,
             username, role, status, identity_status, password_hash, created_at, updated_at
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $12)
           RETURNING *`,
          [
            shape.customerId,
            shape.fullName,
            shape.identityDocument,
            shape.email,
            shape.dateOfBirth,
            shape.address,
            username,
            shape.role,
            shape.status,
            input.identityStatus,
            input.credentialHash,
            input.now.toISOString(),
          ],
        );

        if (input.document !== null) {
          await this.#insertDocument(client, shape.customerId, input.document);
        }

        if (input.activation !== null) {
          await client.query(
            `INSERT INTO email_activation_tokens (token_id, customer_id, token_hash, expires_at)
             VALUES ($1, $2, $3, $4)`,
            [randomUUID(), shape.customerId, input.activation.tokenHash, input.activation.expiresAt],
          );
        }

        await this.#recordProcessed(client, input.idempotency);
        await client.query('COMMIT');

        return toCustomer(inserted.rows[0]!);
      } catch (error) {
        await client.query('ROLLBACK');

        const constraint = constraintOf(error);

        if (constraint === 'customers_username_key') {
          // Somebody else took it between our attempt and theirs. Next candidate.
          continue;
        }

        throw translate(error);
      } finally {
        client.release();
      }
    }

    /**
     * A hundred people with the same name and no free suffix. Not a rejection
     * the caller can act on, so it is a failure the broker will retry — by
     * which time a suffix may well be free.
     */
    throw new Error('No username candidate was free after the whole sequence.');
  }

  public async findById(customerId: string): Promise<Customer | null> {
    const found = await this.#pool.query<CustomerRow>(
      'SELECT * FROM customers WHERE customer_id = $1',
      [customerId],
    );

    return found.rows.length === 0 ? null : toCustomer(found.rows[0]!);
  }

  public async findByEmail(
    email: string,
  ): Promise<{ readonly customer: Customer; readonly credentialHash: string } | null> {
    const found = await this.#pool.query<CustomerRow & { password_hash: string }>(
      'SELECT * FROM customers WHERE LOWER(email) = LOWER($1)',
      [email],
    );

    if (found.rows.length === 0) {
      return null;
    }

    const row = found.rows[0]!;

    return { customer: toCustomer(row), credentialHash: row.password_hash };
  }

  public async listPendingIdentityValidation(limit: number): Promise<{
    readonly customers: readonly Customer[];
    readonly total: number;
  }> {
    const [rows, count] = await Promise.all([
      this.#pool.query<CustomerRow>(
        `SELECT * FROM customers WHERE identity_status = 'PENDING'
          ORDER BY created_at DESC LIMIT $1`,
        [limit],
      ),
      this.#pool.query<{ total: string }>(
        `SELECT COUNT(*)::TEXT AS total FROM customers WHERE identity_status = 'PENDING'`,
      ),
    ]);

    return {
      customers: rows.rows.map(toCustomer),
      total: Number(count.rows[0]?.total ?? '0'),
    };
  }

  public async saveUpdate(input: {
    readonly customer: Customer;
    readonly idempotency: ProcessedMessage;
  }): Promise<void> {
    await this.#inTransaction(async (client) => {
      /**
       * Optimistic guard: the write only lands if the row is still at the
       * version the use case read (`input.customer.version`), and it bumps that
       * version. Two concurrent updates read the same version; the first to
       * commit wins, the second matches no row. A zero `rowCount` is a lost
       * race, not a missing customer — the whole transaction rolls back (the
       * idempotency record with it) and the broker redelivers, which re-reads
       * fresh and succeeds. This is what closes the lost-update the assignment's
       * "protección contra condiciones de carrera" asks this service to prevent.
       */
      const written = await client.query(
        `UPDATE customers
            SET full_name = $2, address = $3, birth_date = $4, updated_at = $5,
                version = version + 1
          WHERE customer_id = $1 AND version = $6`,
        [
          input.customer.customerId,
          input.customer.fullName,
          input.customer.address,
          input.customer.dateOfBirth,
          input.customer.updatedAt,
          input.customer.version,
        ],
      );

      if (written.rowCount === 0) {
        throw new Error(
          `concurrent update of customer ${input.customer.customerId} at version ${input.customer.version}`,
        );
      }

      await this.#recordProcessed(client, input.idempotency);
    });
  }

  public async saveEmailVerification(input: {
    readonly customer: Customer;
    readonly tokenHash: string;
    readonly usedAt: string;
    readonly idempotency: ProcessedMessage;
  }): Promise<void> {
    await this.#inTransaction(async (client) => {
      /**
       * `used_at IS NULL` in the WHERE clause, not checked beforehand: two
       * deliveries of the same link race here, and the one that finds the token
       * already burned updates nothing.
       */
      const burned = await client.query(
        `UPDATE email_activation_tokens
            SET used_at = $2
          WHERE token_hash = $1 AND used_at IS NULL`,
        [input.tokenHash, input.usedAt],
      );

      if (burned.rowCount === 0) {
        throw new DomainRejection('ACTIVATION_TOKEN_INVALID', 'the token was already used');
      }

      await client.query(
        `UPDATE customers
            SET status = 'ACTIVE', email_verified_at = $2, updated_at = $3
          WHERE customer_id = $1 AND email_verified_at IS NULL`,
        [input.customer.customerId, input.customer.emailVerifiedAt, input.customer.updatedAt],
      );

      await this.#recordProcessed(client, input.idempotency);
    });
  }

  public async saveIdentityVerdict(input: {
    readonly customer: Customer;
    readonly document: Omit<StoredIdentityDocument, 'documentId' | 'customerId'> | null;
    readonly idempotency: ProcessedMessage;
  }): Promise<void> {
    await this.#inTransaction(async (client) => {
      await client.query(
        'UPDATE customers SET identity_status = $2, updated_at = $3 WHERE customer_id = $1',
        [input.customer.customerId, input.customer.identityStatus, input.customer.updatedAt],
      );

      if (input.document !== null) {
        await this.#insertDocument(client, input.customer.customerId, input.document);
      }

      await this.#recordProcessed(client, input.idempotency);
    });
  }

  public async saveActivationToken(input: {
    readonly customerId: string;
    readonly tokenHash: string;
    readonly expiresAt: string;
  }): Promise<void> {
    await this.#inTransaction(async (client) => {
      // Invalidate the customer's still-usable tokens before issuing a new one,
      // so only the latest activation link works. Otherwise every sign-in on an
      // unverified account left another live link valid for 24h, growing the
      // attack surface and the table without bound.
      await client.query(
        `UPDATE email_activation_tokens
            SET used_at = now()
          WHERE customer_id = $1 AND used_at IS NULL`,
        [input.customerId],
      );

      await client.query(
        `INSERT INTO email_activation_tokens (token_id, customer_id, token_hash, expires_at)
         VALUES ($1, $2, $3, $4)`,
        [randomUUID(), input.customerId, input.tokenHash, input.expiresAt],
      );
    });
  }

  public async findByActivationToken(
    tokenHash: string,
    now: Date,
  ): Promise<
    | { readonly outcome: 'FOUND'; readonly customer: Customer }
    | { readonly outcome: 'EXPIRED' }
    | { readonly outcome: 'UNKNOWN' }
  > {
    const found = await this.#pool.query<CustomerRow & { expires_at: Date; used_at: Date | null }>(
      `SELECT c.*, t.expires_at, t.used_at
         FROM email_activation_tokens t
         JOIN customers c ON c.customer_id = t.customer_id
        WHERE t.token_hash = $1`,
      [tokenHash],
    );

    if (found.rows.length === 0) {
      return { outcome: 'UNKNOWN' };
    }

    const row = found.rows[0]!;

    // A used token is reported as unknown, not as used. Confirming that a token
    // once existed for an address is the enumeration this flow avoids.
    if (row.used_at !== null) {
      return { outcome: 'UNKNOWN' };
    }

    if (row.expires_at.getTime() <= now.getTime()) {
      return { outcome: 'EXPIRED' };
    }

    return { outcome: 'FOUND', customer: toCustomer(row) };
  }

  public async savePasswordResetToken(input: {
    readonly customerId: string;
    readonly tokenHash: string;
    readonly expiresAt: string;
  }): Promise<void> {
    await this.#inTransaction(async (client) => {
      // The same invalidation `saveActivationToken` does, and for the same
      // reason: asking twice must not leave two live ways into the account.
      await client.query(
        `UPDATE password_reset_tokens
            SET used_at = now()
          WHERE customer_id = $1 AND used_at IS NULL`,
        [input.customerId],
      );

      await client.query(
        `INSERT INTO password_reset_tokens (token_id, customer_id, token_hash, expires_at)
         VALUES ($1, $2, $3, $4)`,
        [randomUUID(), input.customerId, input.tokenHash, input.expiresAt],
      );
    });
  }

  public async findByPasswordResetToken(
    tokenHash: string,
    now: Date,
  ): Promise<
    | { readonly outcome: 'FOUND'; readonly customer: Customer }
    | { readonly outcome: 'EXPIRED' }
    | { readonly outcome: 'UNKNOWN' }
  > {
    const found = await this.#pool.query<CustomerRow & { expires_at: Date; used_at: Date | null }>(
      `SELECT c.*, t.expires_at, t.used_at
         FROM password_reset_tokens t
         JOIN customers c ON c.customer_id = t.customer_id
        WHERE t.token_hash = $1`,
      [tokenHash],
    );

    if (found.rows.length === 0) {
      return { outcome: 'UNKNOWN' };
    }

    const row = found.rows[0]!;

    // A spent token is reported as unknown, not as spent — the same refusal to
    // confirm that a token once existed for an address.
    if (row.used_at !== null) {
      return { outcome: 'UNKNOWN' };
    }

    if (row.expires_at.getTime() <= now.getTime()) {
      return { outcome: 'EXPIRED' };
    }

    return { outcome: 'FOUND', customer: toCustomer(row) };
  }

  public async savePasswordReset(input: {
    readonly customerId: string;
    readonly credentialHash: string;
    readonly tokenHash: string;
    readonly usedAt: string;
    readonly idempotency: ProcessedMessage;
  }): Promise<void> {
    await this.#inTransaction(async (client) => {
      /**
       * `used_at IS NULL` in the WHERE clause rather than checked beforehand:
       * two deliveries of the same link race here, and the one that finds the
       * token already spent updates nothing and changes no password.
       */
      const burned = await client.query(
        `UPDATE password_reset_tokens
            SET used_at = $2
          WHERE token_hash = $1 AND used_at IS NULL`,
        [input.tokenHash, input.usedAt],
      );

      if (burned.rowCount === 0) {
        throw new DomainRejection('RESET_TOKEN_INVALID', 'the token was already used');
      }

      // Every other live link for this customer dies with it.
      await client.query(
        `UPDATE password_reset_tokens
            SET used_at = $2
          WHERE customer_id = $1 AND used_at IS NULL`,
        [input.customerId, input.usedAt],
      );

      await client.query(
        `UPDATE customers
            SET password_hash = $2, updated_at = $3, version = version + 1
          WHERE customer_id = $1`,
        [input.customerId, input.credentialHash, input.usedAt],
      );

      await this.#recordProcessed(client, input.idempotency);
    });
  }

  public async savePasswordChange(input: {
    readonly customerId: string;
    readonly credentialHash: string;
    readonly changedAt: string;
    readonly idempotency: ProcessedMessage;
  }): Promise<void> {
    await this.#inTransaction(async (client) => {
      await client.query(
        `UPDATE customers
            SET password_hash = $2, updated_at = $3, version = version + 1
          WHERE customer_id = $1`,
        [input.customerId, input.credentialHash, input.changedAt],
      );

      /*
       * Every outstanding reset link dies too. Somebody who has just proved
       * they know the current password does not need one, and a live link in an
       * inbox is exactly what an attacker who asked for one is waiting on.
       */
      await client.query(
        `UPDATE password_reset_tokens
            SET used_at = $2
          WHERE customer_id = $1 AND used_at IS NULL`,
        [input.customerId, input.changedAt],
      );

      await this.#recordProcessed(client, input.idempotency);
    });
  }

  public async findNames(
    customerIds: readonly string[],
  ): Promise<readonly { readonly customerId: string; readonly fullName: string }[]> {
    if (customerIds.length === 0) {
      return [];
    }

    const found = await this.#pool.query<{ customer_id: string; full_name: string }>(
      'SELECT customer_id, full_name FROM customers WHERE customer_id = ANY($1::uuid[])',
      [[...customerIds]],
    );

    return found.rows.map((row) => ({ customerId: row.customer_id, fullName: row.full_name }));
  }

  public async isDocumentDigestTaken(sha256: string, customerId: string): Promise<boolean> {
    const found = await this.#pool.query(
      'SELECT 1 FROM identity_documents WHERE sha256 = $1 AND customer_id <> $2 LIMIT 1',
      [sha256, customerId],
    );

    return (found.rowCount ?? 0) > 0;
  }

  public async findProcessed(
    idempotencyKey: string,
    messageType: string,
  ): Promise<ProcessedMessage | null> {
    const found = await this.#pool.query<{ result_summary: Record<string, unknown> }>(
      `SELECT result_summary FROM processed_messages
        WHERE idempotency_key = $1 AND message_type = $2`,
      [idempotencyKey, messageType],
    );

    return found.rows.length === 0
      ? null
      : { idempotencyKey, messageType, resultSummary: found.rows[0]!.result_summary };
  }

  public async recordProcessed(record: ProcessedMessage): Promise<void> {
    await this.#recordProcessed(this.#pool, record);
  }

  public async isReachable(): Promise<boolean> {
    try {
      await this.#pool.query('SELECT 1');
      return true;
    } catch {
      return false;
    }
  }

  async #insertDocument(
    client: PoolClient,
    customerId: string,
    document: Omit<StoredIdentityDocument, 'documentId' | 'customerId'>,
  ): Promise<void> {
    await client.query(
      `INSERT INTO identity_documents (
         document_id, customer_id, original_filename, mime_type, size_bytes,
         sha256, content, validation_status
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (sha256) DO NOTHING`,
      [
        randomUUID(),
        customerId,
        document.originalFilename,
        document.mimeType,
        document.sizeBytes,
        document.sha256,
        document.content,
        document.validationStatus,
      ],
    );
  }

  /**
   * `ON CONFLICT DO NOTHING`, because losing this race is not an error.
   *
   * Two deliveries of the same command can reach here concurrently; the second
   * one's transaction has already done the same work, and failing it would turn
   * a successful duplicate into a dead-lettered message.
   */
  async #recordProcessed(
    client: Pool | PoolClient,
    record: ProcessedMessage,
  ): Promise<void> {
    await client.query(
      `INSERT INTO processed_messages (message_id, idempotency_key, message_type, result_summary)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (idempotency_key, message_type) DO NOTHING`,
      [randomUUID(), record.idempotencyKey, record.messageType, JSON.stringify(record.resultSummary)],
    );
  }

  async #inTransaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.#pool.connect();

    try {
      await client.query('BEGIN');
      const result = await work(client);
      await client.query('COMMIT');

      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw translate(error);
    } finally {
      client.release();
    }
  }
}

/** Turns a constraint violation into the invariant it violated. */
function translate(error: unknown): unknown {
  const constraint = constraintOf(error);

  if (constraint === 'customers_document_number_key') {
    return new DomainRejection('DOCUMENT_ALREADY_REGISTERED');
  }

  if (constraint === 'customers_email_key' || constraint === 'customers_email_lower_key') {
    return new DomainRejection('EMAIL_ALREADY_REGISTERED');
  }

  return error;
}

function constraintOf(error: unknown): string | null {
  if (typeof error !== 'object' || error === null) {
    return null;
  }

  const candidate = error as { code?: unknown; constraint?: unknown };

  return candidate.code === UNIQUE_VIOLATION && typeof candidate.constraint === 'string'
    ? candidate.constraint
    : null;
}

/** A row as the domain sees it, with dates as ISO strings and no credential. */
function toCustomer(row: CustomerRow): Customer {
  return {
    customerId: row.customer_id,
    fullName: row.full_name,
    identityDocument: row.document_number,
    email: row.email,
    dateOfBirth: toDateOnly(row.birth_date),
    address: row.address ?? '',
    username: row.username,
    role: row.role as Role,
    status: row.status as Customer['status'],
    identityStatus: row.identity_status as IdentityStatus,
    emailVerifiedAt: row.email_verified_at === null ? null : row.email_verified_at.toISOString(),
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    version: row.version,
  };
}

/**
 * `DATE` comes back as a `Date` at local midnight.
 *
 * Formatting it with `toISOString()` would shift it a day west of Greenwich —
 * which is exactly where this bank is — so the local components are read
 * directly instead.
 */
function toDateOnly(value: Date | string): string {
  if (typeof value === 'string') {
    return value.slice(0, 10);
  }

  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');

  return `${String(value.getFullYear())}-${month}-${day}`;
}
