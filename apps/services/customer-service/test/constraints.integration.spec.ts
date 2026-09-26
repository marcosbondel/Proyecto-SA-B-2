import { randomUUID } from 'node:crypto';

import { Pool } from 'pg';

import { migrate } from '../src/infrastructure/persistence/migrations';

/**
 * The database's own constraints, proven with raw SQL rather than through the
 * repository.
 *
 * Everywhere else in this test/ directory, seeding goes through the
 * repository and the domain — but here the constraint *is* the point, and a
 * repository method would never let a caller construct the invalid row in the
 * first place. A raw `INSERT` is the only way to ask PostgreSQL directly
 * "what happens if this rule is broken", and only PostgreSQL can answer it: a
 * `CHECK` or a `UNIQUE INDEX` enforced in a migration is invisible to any
 * in-memory double, which accepts whatever shape its `Map` is given.
 *
 * Requires the local stack (`infra/docker`) and `DATABASE_URL`. Skipped
 * otherwise, exactly like the other integration suites.
 */

const DATABASE_URL = process.env.DATABASE_URL;
const describeIntegration = DATABASE_URL === undefined ? describe.skip : describe;

jest.setTimeout(30_000);

/** PostgreSQL's code for a check-constraint violation. */
const CHECK_VIOLATION = '23514';
/** PostgreSQL's code for a unique violation. */
const UNIQUE_VIOLATION = '23505';

describeIntegration('customer-service schema — constraints enforced by PostgreSQL', () => {
  let pool: Pool;

  beforeAll(async () => {
    if (DATABASE_URL === undefined) {
      console.warn('Skipping constraints integration tests: DATABASE_URL is not set.');
      return;
    }

    pool = new Pool({ connectionString: DATABASE_URL });
    await migrate(pool);
  });

  afterAll(async () => {
    await pool?.end();
  });

  /** A minimal, otherwise-valid customer row, insertable as-is or overridden. */
  function customerColumns(overrides: Partial<Record<string, unknown>> = {}) {
    const unique = randomUUID().replaceAll('-', '').slice(0, 12);

    return {
      customer_id: overrides.customer_id ?? randomUUID(),
      full_name: overrides.full_name ?? `Persona ${unique}`,
      document_number: overrides.document_number ?? unique,
      email: overrides.email ?? `${unique}@correo.test`,
      birth_date: overrides.birth_date ?? '1996-04-18',
      address: overrides.address ?? 'Una dirección',
      username: overrides.username ?? `user${unique}`,
      identity_status: overrides.identity_status ?? 'PENDING',
      kyc_status: overrides.kyc_status ?? 'PENDING',
      role: overrides.role ?? 'CLIENTE',
      status: overrides.status ?? 'PENDING_ACTIVATION',
      password_hash: overrides.password_hash ?? 'scrypt$16384$8$1$c2FsdA==$aGFzaA==',
      email_verified_at: overrides.email_verified_at ?? null,
    };
  }

  async function insertCustomer(columns: ReturnType<typeof customerColumns>): Promise<void> {
    await pool.query(
      `INSERT INTO customers (
         customer_id, full_name, document_number, email, birth_date, address,
         username, identity_status, kyc_status, role, status, password_hash,
         email_verified_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
      [
        columns.customer_id,
        columns.full_name,
        columns.document_number,
        columns.email,
        columns.birth_date,
        columns.address,
        columns.username,
        columns.identity_status,
        columns.kyc_status,
        columns.role,
        columns.status,
        columns.password_hash,
        columns.email_verified_at,
      ],
    );
  }

  describe('customers_identity_status_known', () => {
    it('rejects an identity_status outside PENDING/VALIDATED/REJECTED', async () => {
      await expect(
        insertCustomer(customerColumns({ identity_status: 'APPROVED' })),
      ).rejects.toMatchObject({ code: CHECK_VIOLATION, constraint: 'customers_identity_status_known' });
    });
  });

  describe('customers_kyc_status_known', () => {
    it('rejects a kyc_status outside PENDING/VERIFIED/REJECTED', async () => {
      await expect(
        insertCustomer(customerColumns({ kyc_status: 'IN_REVIEW' })),
      ).rejects.toMatchObject({ code: CHECK_VIOLATION, constraint: 'customers_kyc_status_known' });
    });
  });

  describe('customers_role_known', () => {
    it('rejects a role outside CLIENTE/CAJERO_RECEPTOR/ADMINISTRADOR', async () => {
      await expect(insertCustomer(customerColumns({ role: 'SUPERUSUARIO' }))).rejects.toMatchObject({
        code: CHECK_VIOLATION,
        constraint: 'customers_role_known',
      });
    });
  });

  describe('customers_active_iff_verified (C-4)', () => {
    it('rejects ACTIVE with no verified-email timestamp', async () => {
      await expect(
        insertCustomer(customerColumns({ status: 'ACTIVE', email_verified_at: null })),
      ).rejects.toMatchObject({ code: CHECK_VIOLATION, constraint: 'customers_active_iff_verified' });
    });

    it('rejects PENDING_ACTIVATION with a verified-email timestamp already set', async () => {
      await expect(
        insertCustomer(
          customerColumns({ status: 'PENDING_ACTIVATION', email_verified_at: new Date().toISOString() }),
        ),
      ).rejects.toMatchObject({ code: CHECK_VIOLATION, constraint: 'customers_active_iff_verified' });
    });
  });

  describe('customers_username_key', () => {
    it('rejects a duplicated username at the database level directly', async () => {
      const shared = `dup${randomUUID().replaceAll('-', '').slice(0, 10)}`;
      await insertCustomer(customerColumns({ username: shared }));

      await expect(insertCustomer(customerColumns({ username: shared }))).rejects.toMatchObject({
        code: UNIQUE_VIOLATION,
        constraint: 'customers_username_key',
      });
    });
  });

  describe('processed_messages_once', () => {
    it('rejects a redelivered (idempotency_key, message_type) pair inserted directly', async () => {
      const idempotencyKey = randomUUID();
      const messageType = 'customer.update.v1';

      await pool.query(
        `INSERT INTO processed_messages (message_id, idempotency_key, message_type, result_summary)
         VALUES ($1, $2, $3, $4)`,
        [randomUUID(), idempotencyKey, messageType, JSON.stringify({ outcome: 'UPDATED' })],
      );

      await expect(
        pool.query(
          `INSERT INTO processed_messages (message_id, idempotency_key, message_type, result_summary)
           VALUES ($1, $2, $3, $4)`,
          [randomUUID(), idempotencyKey, messageType, JSON.stringify({ outcome: 'ANYTHING ELSE' })],
        ),
      ).rejects.toMatchObject({ code: UNIQUE_VIOLATION, constraint: 'processed_messages_once' });
    });
  });

  describe('identity_documents_size_within_ceiling', () => {
    async function insertDocument(customerId: string, sizeBytes: number): Promise<unknown> {
      return pool.query(
        `INSERT INTO identity_documents (
           document_id, customer_id, original_filename, mime_type, size_bytes,
           sha256, content, validation_status
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          randomUUID(),
          customerId,
          'dpi.jpg',
          'image/jpeg',
          sizeBytes,
          randomUUID().replaceAll('-', '').padEnd(64, '0'),
          Buffer.from('content'),
          'PENDING',
        ],
      );
    }

    it('rejects a non-positive size_bytes', async () => {
      const owner = customerColumns();
      await insertCustomer(owner);

      await expect(insertDocument(owner.customer_id as string, 0)).rejects.toMatchObject({
        code: CHECK_VIOLATION,
        constraint: 'identity_documents_size_within_ceiling',
      });
    });

    it('rejects a size_bytes over the 5MB ceiling', async () => {
      const owner = customerColumns();
      await insertCustomer(owner);

      await expect(insertDocument(owner.customer_id as string, 5_242_881)).rejects.toMatchObject({
        code: CHECK_VIOLATION,
        constraint: 'identity_documents_size_within_ceiling',
      });
    });

    it('accepts a size_bytes exactly at the 5MB ceiling', async () => {
      const owner = customerColumns();
      await insertCustomer(owner);

      await expect(insertDocument(owner.customer_id as string, 5_242_880)).resolves.toBeDefined();
    });
  });
});
