import { createHash, randomUUID } from 'node:crypto';

import { Pool } from 'pg';

import { DomainRejection } from '../src/domain/customer';
import { usernameCandidates } from '../src/domain/username';
import { migrate } from '../src/infrastructure/persistence/migrations';
import { PostgresCustomerRepository } from '../src/infrastructure/persistence/postgres-customer.repository';

/**
 * The repository against a real PostgreSQL, because the two guarantees that
 * matter here are enforced by the database and by nothing else.
 *
 * An in-memory double can be made to *look* like it resolves a username
 * collision; only a unique index actually does it when two transactions race.
 * Same for idempotency: `ON CONFLICT DO NOTHING` on a unique key is the
 * guarantee, and a `Map` cannot demonstrate it.
 *
 * Requires the local stack (`infra/docker`) and `DATABASE_URL`. Skipped
 * otherwise, so a clone with no Docker still runs a green suite — and says
 * which tests it did not run.
 */

const DATABASE_URL = process.env.DATABASE_URL;
const describeIntegration = DATABASE_URL === undefined ? describe.skip : describe;

jest.setTimeout(30_000);

describeIntegration('PostgresCustomerRepository', () => {
  let pool: Pool;
  let repository: PostgresCustomerRepository;

  const NOW = new Date('2026-08-26T12:00:00.000Z');

  beforeAll(async () => {
    if (DATABASE_URL === undefined) {
      console.warn('Skipping repository integration tests: DATABASE_URL is not set.');
      return;
    }

    pool = new Pool({ connectionString: DATABASE_URL });
    await migrate(pool);
    repository = new PostgresCustomerRepository(pool);
  });

  afterAll(async () => {
    await pool?.end();
  });

  /** A registration nobody else in this run will collide with by accident. */
  function registration(overrides: Partial<Record<string, string>> = {}) {
    const unique = randomUUID().replaceAll('-', '').slice(0, 12);

    return {
      customerId: randomUUID(),
      fullName: overrides.fullName ?? `Persona ${unique}`,
      identityDocument: overrides.identityDocument ?? unique,
      email: overrides.email ?? `${unique}@correo.test`,
      dateOfBirth: '1996-04-18',
      address: 'Una dirección',
      role: 'CLIENTE' as const,
    };
  }

  function inputFor(
    registrationRequest: ReturnType<typeof registration>,
    idempotencyKey = randomUUID(),
  ) {
    return {
      registration: registrationRequest,
      usernameCandidates: usernameCandidates(registrationRequest.fullName),
      credentialHash: 'scrypt$16384$8$1$c2FsdA==$aGFzaA==',
      document: null,
      activation: null,
      identityStatus: 'PENDING' as const,
      idempotency: {
        idempotencyKey,
        messageType: 'customer.register.v1',
        resultSummary: { outcome: 'REGISTERED' },
      },
      now: NOW,
    };
  }

  it('applies its migrations and can be asked whether it is reachable', async () => {
    await expect(repository.isReachable()).resolves.toBe(true);
  });

  it('stores a customer and reads it back with its dates intact', async () => {
    const request = registration();

    const stored = await repository.registerCustomer(inputFor(request));
    const found = await repository.findById(stored.customerId);

    // The date must survive the round trip: `DATE` comes back as a local
    // midnight `Date`, and `toISOString()` on it would shift a day west of
    // Greenwich, which is exactly where this bank is.
    expect(found?.dateOfBirth).toBe('1996-04-18');
    expect(found?.status).toBe('PENDING_ACTIVATION');
  });

  it('refuses a duplicated document with the invariant it violated (C-1)', async () => {
    const first = registration();
    await repository.registerCustomer(inputFor(first));

    const second = registration({ identityDocument: first.identityDocument });

    await expect(repository.registerCustomer(inputFor(second))).rejects.toMatchObject({
      code: 'DOCUMENT_ALREADY_REGISTERED',
    });
  });

  it('refuses a duplicated email whatever its case (C-3)', async () => {
    const first = registration();
    await repository.registerCustomer(inputFor(first));

    const second = registration({ email: first.email.toUpperCase() });

    await expect(repository.registerCustomer(inputFor(second))).rejects.toBeInstanceOf(
      DomainRejection,
    );
  });

  it('gives two people with the same name two usernames, under concurrency', async () => {
    const name = `Juan ${randomUUID().replaceAll('-', '').slice(0, 8)}`;

    // Started together on purpose: this is the race the assignment names, and
    // a read-then-write implementation passes the sequential version of this
    // test while failing this one.
    const [first, second] = await Promise.all([
      repository.registerCustomer(inputFor(registration({ fullName: name }))),
      repository.registerCustomer(inputFor(registration({ fullName: name }))),
    ]);

    expect(first.username).not.toBe(second.username);
    expect([first.username, second.username].sort()).toEqual(
      [...take(usernameCandidates(name), 2)].sort(),
    );
  });

  it('records a processed message once, and reports it thereafter', async () => {
    const key = randomUUID();

    await repository.recordProcessed({
      idempotencyKey: key,
      messageType: 'customer.update.v1',
      resultSummary: { outcome: 'UPDATED' },
    });
    await repository.recordProcessed({
      idempotencyKey: key,
      messageType: 'customer.update.v1',
      resultSummary: { outcome: 'SOMETHING ELSE' },
    });

    const found = await repository.findProcessed(key, 'customer.update.v1');

    // The second write does not overwrite the first: a redelivery must be
    // answered with what actually happened, not with what it thought.
    expect(found?.resultSummary).toEqual({ outcome: 'UPDATED' });
  });

  it('burns an activation token exactly once, even when two deliveries race', async () => {
    const request = registration();
    const tokenHash = createHash('sha256').update(randomUUID()).digest('hex');

    const customer = await repository.registerCustomer({
      ...inputFor(request),
      activation: { tokenHash, expiresAt: new Date(NOW.getTime() + 3_600_000).toISOString() },
    });

    const activated = {
      ...customer,
      status: 'ACTIVE' as const,
      emailVerifiedAt: NOW.toISOString(),
      updatedAt: NOW.toISOString(),
    };

    const attempt = async (): Promise<void> =>
      await repository.saveEmailVerification({
        customer: activated,
        tokenHash,
        usedAt: NOW.toISOString(),
        idempotency: {
          idempotencyKey: randomUUID(),
          messageType: 'customer.verify-email.v1',
          resultSummary: { outcome: 'VERIFIED' },
        },
      });

    const outcomes = await Promise.allSettled([attempt(), attempt()]);

    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
    expect(await repository.findByActivationToken(tokenHash, NOW)).toEqual({ outcome: 'UNKNOWN' });
  });

  it('reports an expired token as expired and a used one as unknown', async () => {
    const expiredHash = createHash('sha256').update(randomUUID()).digest('hex');
    const request = registration();

    await repository.registerCustomer({
      ...inputFor(request),
      activation: { tokenHash: expiredHash, expiresAt: new Date(NOW.getTime() - 1).toISOString() },
    });

    expect(await repository.findByActivationToken(expiredHash, NOW)).toEqual({
      outcome: 'EXPIRED',
    });
    // A token nobody issued is unknown, and so is one already used: confirming
    // that a token once existed for an address is the enumeration this avoids.
    expect(await repository.findByActivationToken('0'.repeat(64), NOW)).toEqual({
      outcome: 'UNKNOWN',
    });
  });

  it('sees a photograph that already backs another identity', async () => {
    const digest = createHash('sha256').update(randomUUID()).digest('hex');
    const owner = registration();

    const customer = await repository.registerCustomer({
      ...inputFor(owner),
      document: {
        originalFilename: 'dpi.jpg',
        mimeType: 'image/jpeg',
        sizeBytes: 12,
        sha256: digest,
        content: Buffer.from('twelve bytes'),
        validationStatus: 'VALIDATED',
      },
    });

    expect(await repository.isDocumentDigestTaken(digest, randomUUID())).toBe(true);
    // Not "taken" for its own owner: re-uploading your own photo is not fraud.
    expect(await repository.isDocumentDigestTaken(digest, customer.customerId)).toBe(false);
  });
});

function* take<T>(values: Iterable<T>, count: number): Generator<T> {
  let taken = 0;

  for (const value of values) {
    if (taken >= count) {
      return;
    }

    taken += 1;
    yield value;
  }
}
