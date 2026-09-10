import { createHash, randomUUID } from 'node:crypto';

import { Pool } from 'pg';

import { DomainRejection, applyChanges, recordIdentityVerdict, setKycStatus } from '../src/domain/customer';
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

  it('invalidates prior activation tokens when a new one is issued (US7)', async () => {
    const stored = await repository.registerCustomer(inputFor(registration()));

    // Registration already issued one token; issue a second and a third.
    await repository.saveActivationToken({
      customerId: stored.customerId,
      tokenHash: `hash-${randomUUID()}`,
      expiresAt: '2099-01-01T00:00:00.000Z',
    });
    const latestHash = `hash-${randomUUID()}`;
    await repository.saveActivationToken({
      customerId: stored.customerId,
      tokenHash: latestHash,
      expiresAt: '2099-01-01T00:00:00.000Z',
    });

    const live = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::TEXT AS count FROM email_activation_tokens
        WHERE customer_id = $1 AND used_at IS NULL`,
      [stored.customerId],
    );

    // Exactly one live token, and it is the most recent.
    expect(live.rows[0]?.count).toBe('1');
    const found = await repository.findByActivationToken(latestHash, new Date('2098-01-01'));
    expect(found.outcome).toBe('FOUND');
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

  it('refuses a concurrent update instead of losing one silently (optimistic version)', async () => {
    const stored = await repository.registerCustomer(inputFor(registration()));
    const base = await repository.findById(stored.customerId);
    expect(base?.version).toBe(0);

    // Two updates computed from the *same* read (both at version 0): one changes
    // the address, the other the name. A read-then-write without a version guard
    // would let the second silently revert the first. With the guard, exactly
    // one lands and the other matches no row and throws.
    const resultA = applyChanges(base!, { address: 'Dirección A 1-11' }, NOW);
    const resultB = applyChanges(base!, { fullName: 'Nombre B Distinto' }, NOW);

    const settled = await Promise.allSettled([
      repository.saveUpdate({
        customer: resultA.customer,
        idempotency: {
          idempotencyKey: randomUUID(),
          messageType: 'customer.update.v1',
          resultSummary: { outcome: 'UPDATED' },
        },
      }),
      repository.saveUpdate({
        customer: resultB.customer,
        idempotency: {
          idempotencyKey: randomUUID(),
          messageType: 'customer.update.v1',
          resultSummary: { outcome: 'UPDATED' },
        },
      }),
    ]);

    const fulfilled = settled.filter((s) => s.status === 'fulfilled');
    const rejected = settled.filter((s) => s.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    const after = await repository.findById(stored.customerId);
    expect(after?.version).toBe(1);
  });

  it('refuses a concurrent identity verdict instead of letting the last write win (optimistic version)', async () => {
    const stored = await repository.registerCustomer(inputFor(registration()));
    const base = await repository.findById(stored.customerId);
    expect(base?.identityStatus).toBe('PENDING');
    expect(base?.version).toBe(0);

    // Two verdicts decided from the *same* read (both at version 0): the
    // automatic check and a teller's manual call racing it. Without the
    // version guard both would land and both would publish — two
    // contradictory identity events for the same customer.
    const validated = recordIdentityVerdict(base!, 'VALIDATED', NOW);
    const rejected = recordIdentityVerdict(base!, 'REJECTED', NOW);

    const settled = await Promise.allSettled([
      repository.saveIdentityVerdict({
        customer: validated,
        document: null,
        idempotency: {
          idempotencyKey: randomUUID(),
          messageType: 'customer.validate-identity.v1',
          resultSummary: { outcome: 'VALIDATED' },
        },
      }),
      repository.saveIdentityVerdict({
        customer: rejected,
        document: null,
        idempotency: {
          idempotencyKey: randomUUID(),
          messageType: 'customer.set-identity-verdict.v1',
          resultSummary: { outcome: 'REJECTED' },
        },
      }),
    ]);

    const fulfilled = settled.filter((s) => s.status === 'fulfilled');
    const rejectedSettlements = settled.filter((s) => s.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejectedSettlements).toHaveLength(1);

    const after = await repository.findById(stored.customerId);
    expect(after?.version).toBe(1);
    expect(['VALIDATED', 'REJECTED']).toContain(after?.identityStatus);
  });

  it('persists a KYC verdict, independent of identity_status (C-8)', async () => {
    const stored = await repository.registerCustomer(inputFor(registration()));
    const base = await repository.findById(stored.customerId);
    expect(base?.kycStatus).toBe('PENDING');

    const verified = setKycStatus(base!, 'VERIFIED', NOW);

    await repository.saveKycVerdict({
      customer: verified,
      idempotency: {
        idempotencyKey: randomUUID(),
        messageType: 'customer.set-kyc-status.v1',
        resultSummary: { outcome: 'APPLIED' },
      },
    });

    const after = await repository.findById(stored.customerId);
    expect(after?.kycStatus).toBe('VERIFIED');
    expect(after?.identityStatus).toBe('PENDING');
    expect(after?.version).toBe(1);
  });

  it('refuses a concurrent KYC verdict instead of letting the last write win (optimistic version)', async () => {
    const stored = await repository.registerCustomer(inputFor(registration()));
    const base = await repository.findById(stored.customerId);

    const verified = setKycStatus(base!, 'VERIFIED', NOW);
    const rejected = setKycStatus(base!, 'REJECTED', NOW);

    const settled = await Promise.allSettled([
      repository.saveKycVerdict({
        customer: verified,
        idempotency: {
          idempotencyKey: randomUUID(),
          messageType: 'customer.set-kyc-status.v1',
          resultSummary: { outcome: 'APPLIED', status: 'VERIFIED' },
        },
      }),
      repository.saveKycVerdict({
        customer: rejected,
        idempotency: {
          idempotencyKey: randomUUID(),
          messageType: 'customer.set-kyc-status.v1',
          resultSummary: { outcome: 'APPLIED', status: 'REJECTED' },
        },
      }),
    ]);

    const fulfilled = settled.filter((s) => s.status === 'fulfilled');
    const rejectedSettlements = settled.filter((s) => s.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejectedSettlements).toHaveLength(1);

    const after = await repository.findById(stored.customerId);
    expect(after?.version).toBe(1);
    expect(['VERIFIED', 'REJECTED']).toContain(after?.kycStatus);
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
