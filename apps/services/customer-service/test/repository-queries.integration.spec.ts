import { randomUUID } from 'node:crypto';

import { Pool } from 'pg';

import { applyChanges } from '../src/domain/customer';
import { usernameCandidates } from '../src/domain/username';
import { migrate } from '../src/infrastructure/persistence/migrations';
import { PostgresCustomerRepository } from '../src/infrastructure/persistence/postgres-customer.repository';
import { ScryptPasswordHasher } from '../src/infrastructure/security/scrypt-password-hasher';

/**
 * The read paths and the credential/reset lifecycle, against a real
 * PostgreSQL — because none of this is provable against an in-memory double.
 *
 * `listCustomers`, `listPendingIdentityValidation`, `findNames` and `stats`
 * are one `ORDER BY`, one `WHERE`, one `ANY($1::uuid[])` and one set of
 * `FILTER (WHERE …)` clauses away from returning the wrong rows — a `Map`
 * iterates in insertion order for free and would never catch an `ORDER BY`
 * that quietly fell back to the table's physical order.
 *
 * The password-change and password-reset paths matter here for a different
 * reason: `savePasswordChange`/`savePasswordReset` write a credential that a
 * later `findByEmail` must read back correctly, and the whole point of a
 * scrypt hash is that it verifies against a real derivation — a double that
 * stored plaintext or a stub `verify()` returning `true` would never expose a
 * hasher/repository mismatch. Every read in this file that claims
 * "persisted" opens a **second, brand-new `Pool`** to prove the state lives
 * in the database, not in the first connection's memory.
 *
 * Requires the local stack (`infra/docker`) and `DATABASE_URL`. Skipped
 * otherwise, exactly like `repository.integration.spec.ts`.
 */

const DATABASE_URL = process.env.DATABASE_URL;
const describeIntegration = DATABASE_URL === undefined ? describe.skip : describe;

jest.setTimeout(30_000);

describeIntegration('PostgresCustomerRepository — queries and credential lifecycle', () => {
  let pool: Pool;
  let repository: PostgresCustomerRepository;
  const hasher = new ScryptPasswordHasher();

  const NOW = new Date('2026-08-26T12:00:00.000Z');

  beforeAll(async () => {
    if (DATABASE_URL === undefined) {
      console.warn('Skipping repository-queries integration tests: DATABASE_URL is not set.');
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
    overrides: {
      readonly identityStatus?: 'PENDING' | 'VALIDATED' | 'REJECTED';
      readonly credentialHash?: string;
      readonly now?: Date;
    } = {},
  ) {
    return {
      registration: registrationRequest,
      usernameCandidates: usernameCandidates(registrationRequest.fullName),
      credentialHash: overrides.credentialHash ?? 'scrypt$16384$8$1$c2FsdA==$aGFzaA==',
      document: null,
      activation: null,
      identityStatus: overrides.identityStatus ?? ('PENDING' as const),
      idempotency: {
        idempotencyKey: randomUUID(),
        messageType: 'customer.register.v1',
        resultSummary: { outcome: 'REGISTERED' },
      },
      now: overrides.now ?? NOW,
    };
  }

  describe('listCustomers', () => {
    /**
     * This table is deliberately never truncated between test runs (see the
     * file-top comment), so it already holds however many rows every earlier
     * run of this suite left behind — asserting that three freshly-inserted
     * rows are literally the *global* top of the table would be a coin flip
     * against that history, whatever base timestamp is chosen: a fixed
     * future literal collides with a previous run's own rows at that exact
     * value (`ORDER BY` has no defined tiebreak), and a `Date.now()`-derived
     * one can still be beaten by an earlier run's wider spread if the two
     * runs' base timestamps land close enough together.
     *
     * So instead of asserting a position in the whole table, this fetches
     * every row (`listCustomers` with a limit covering the full count) and
     * checks two things a bug could actually break: that `third`/`second`/
     * `first` appear in that order *relative to each other*, and that
     * `listCustomers(2)` returns exactly the first two rows of that same
     * list — i.e. the limit and the ordering agree with one another,
     * regardless of what else is in the table.
     */
    it('orders newest first, and LIMIT truncates the same order it reports the total for', async () => {
      const base = new Date(NOW.getTime());
      const first = await repository.registerCustomer(
        inputFor(registration(), { now: new Date(base.getTime()) }),
      );
      const second = await repository.registerCustomer(
        inputFor(registration(), { now: new Date(base.getTime() + 1_000) }),
      );
      const third = await repository.registerCustomer(
        inputFor(registration(), { now: new Date(base.getTime() + 2_000) }),
      );

      const limited = await repository.listCustomers(2);
      const everyone = await repository.listCustomers(limited.total);
      const everyoneIds = everyone.customers.map((customer) => customer.customerId);

      // Relative order among the three this test controls: newest to oldest.
      const thirdIndex = everyoneIds.indexOf(third.customerId);
      const secondIndex = everyoneIds.indexOf(second.customerId);
      const firstIndex = everyoneIds.indexOf(first.customerId);
      expect(thirdIndex).toBeGreaterThanOrEqual(0);
      expect(thirdIndex).toBeLessThan(secondIndex);
      expect(secondIndex).toBeLessThan(firstIndex);

      // LIMIT 2 is exactly the first two rows of the unlimited order.
      expect(limited.customers.map((customer) => customer.customerId)).toEqual(
        everyoneIds.slice(0, 2),
      );
      expect(limited.total).toBe(everyone.total);
      expect(limited.total).toBeGreaterThanOrEqual(3);
    });
  });

  describe('listPendingIdentityValidation', () => {
    it('excludes customers whose identity was already decided', async () => {
      const pending = await repository.registerCustomer(
        inputFor(registration(), { identityStatus: 'PENDING' }),
      );
      const validated = await repository.registerCustomer(
        inputFor(registration(), { identityStatus: 'VALIDATED' }),
      );
      const rejected = await repository.registerCustomer(
        inputFor(registration(), { identityStatus: 'REJECTED' }),
      );

      const { customers } = await repository.listPendingIdentityValidation(1_000);
      const ids = customers.map((customer) => customer.customerId);

      expect(ids).toContain(pending.customerId);
      expect(ids).not.toContain(validated.customerId);
      expect(ids).not.toContain(rejected.customerId);
    });

    it('orders newest first, and LIMIT 1 is exactly the head of the unlimited order', async () => {
      // Same reasoning as the listCustomers ordering test above: relative
      // order among this test's own rows, and self-consistency between the
      // limited and unlimited calls, rather than a position in a table this
      // suite never truncates.
      const base = new Date(NOW.getTime() + 500);
      const older = await repository.registerCustomer(
        inputFor(registration(), { now: new Date(base.getTime()) }),
      );
      const newer = await repository.registerCustomer(
        inputFor(registration(), { now: new Date(base.getTime() + 1_000) }),
      );

      const limited = await repository.listPendingIdentityValidation(1);
      const everyone = await repository.listPendingIdentityValidation(limited.total);
      const everyoneIds = everyone.customers.map((customer) => customer.customerId);

      const newerIndex = everyoneIds.indexOf(newer.customerId);
      const olderIndex = everyoneIds.indexOf(older.customerId);
      expect(newerIndex).toBeGreaterThanOrEqual(0);
      expect(newerIndex).toBeLessThan(olderIndex);

      expect(limited.customers.map((customer) => customer.customerId)).toEqual(
        everyoneIds.slice(0, 1),
      );
      expect(limited.total).toBe(everyone.total);
    });
  });

  describe('findNames', () => {
    it('returns only the ids that exist, silently dropping the rest', async () => {
      const known = await repository.registerCustomer(inputFor(registration()));
      const unknown = randomUUID();

      const found = await repository.findNames([known.customerId, unknown]);

      expect(found).toEqual([{ customerId: known.customerId, fullName: known.fullName }]);
    });

    it('returns an empty array for an empty request, without touching the database', async () => {
      await expect(repository.findNames([])).resolves.toEqual([]);
    });

    it('returns an empty array when none of the requested ids exist', async () => {
      await expect(repository.findNames([randomUUID(), randomUUID()])).resolves.toEqual([]);
    });
  });

  describe('stats', () => {
    it('counts registered and pending-validation customers across mixed statuses', async () => {
      const before = await repository.stats();

      await repository.registerCustomer(inputFor(registration(), { identityStatus: 'PENDING' }));
      await repository.registerCustomer(inputFor(registration(), { identityStatus: 'VALIDATED' }));

      const after = await repository.stats();

      expect(after.registered).toBe(before.registered + 2);
      expect(after.pendingValidation).toBe(before.pendingValidation + 1);
    });

    it('counts activatedToday only for a customer verified today, not one still pending activation', async () => {
      const before = await repository.stats();

      const verifiedToday = await repository.registerCustomer(inputFor(registration()));
      const stillPending = await repository.registerCustomer(inputFor(registration()));

      // Verified with the real current time, so it lands on the actual
      // "today" the AT TIME ZONE conversion in `stats()` computes against.
      const verifiedAt = new Date();
      const verifiedRow = { ...verifiedToday, status: 'ACTIVE' as const, emailVerifiedAt: verifiedAt.toISOString(), updatedAt: verifiedAt.toISOString() };
      const tokenHash = `token-${randomUUID()}`;
      await pool.query(
        `INSERT INTO email_activation_tokens (token_id, customer_id, token_hash, expires_at)
         VALUES ($1, $2, $3, $4)`,
        [randomUUID(), verifiedToday.customerId, tokenHash, new Date(verifiedAt.getTime() + 3_600_000).toISOString()],
      );
      await repository.saveEmailVerification({
        customer: verifiedRow,
        tokenHash,
        usedAt: verifiedAt.toISOString(),
        idempotency: {
          idempotencyKey: randomUUID(),
          messageType: 'customer.verify-email.v1',
          resultSummary: { outcome: 'VERIFIED' },
        },
      });

      const after = await repository.stats();

      expect(after.activatedToday).toBeGreaterThanOrEqual(before.activatedToday + 1);
      // `stillPending` never had its email verified, so it must not have
      // pushed the count any further than the one customer that was.
      const stillPendingFromDb = await repository.findById(stillPending.customerId);
      expect(stillPendingFromDb?.emailVerifiedAt).toBeNull();
    });
  });

  describe('the credential lifecycle', () => {
    it('persists a changed password that a fresh Pool can authenticate, and the old one no longer verifies', async () => {
      const oldPlaintext = 'Contraseña-Vieja#1';
      const newPlaintext = 'Contraseña-Nueva#2';
      const oldHash = await hasher.hash(oldPlaintext);
      const newHash = await hasher.hash(newPlaintext);

      const request = registration();
      await repository.registerCustomer(inputFor(request, { credentialHash: oldHash }));

      await repository.savePasswordChange({
        customerId: (await repository.findByEmail(request.email))!.customer.customerId,
        credentialHash: newHash,
        changedAt: NOW.toISOString(),
        idempotency: {
          idempotencyKey: randomUUID(),
          messageType: 'customer.change-password.v1',
          resultSummary: { outcome: 'CHANGED' },
        },
      });

      // A second, brand-new Pool: the state has to live in the database, not
      // in the connection that wrote it.
      const freshPool = new Pool({ connectionString: DATABASE_URL });
      try {
        const freshRepository = new PostgresCustomerRepository(freshPool);
        const found = await freshRepository.findByEmail(request.email);

        expect(found).not.toBeNull();
        await expect(hasher.verify(newPlaintext, found!.credentialHash)).resolves.toBe(true);
        await expect(hasher.verify(oldPlaintext, found!.credentialHash)).resolves.toBe(false);
      } finally {
        await freshPool.end();
      }
    });

    it('burns every outstanding password-reset token for a customer when their password changes', async () => {
      const request = registration();
      const stored = await repository.registerCustomer(inputFor(request));
      const tokenHash = `reset-${randomUUID()}`;

      await repository.savePasswordResetToken({
        customerId: stored.customerId,
        tokenHash,
        expiresAt: new Date(NOW.getTime() + 3_600_000).toISOString(),
      });
      expect(await repository.findByPasswordResetToken(tokenHash, NOW)).toEqual({
        outcome: 'FOUND',
        customer: expect.objectContaining({ customerId: stored.customerId }),
      });

      await repository.savePasswordChange({
        customerId: stored.customerId,
        credentialHash: await hasher.hash('Otra-Contraseña#3'),
        changedAt: NOW.toISOString(),
        idempotency: {
          idempotencyKey: randomUUID(),
          messageType: 'customer.change-password.v1',
          resultSummary: { outcome: 'CHANGED' },
        },
      });

      // A live link in an inbox is exactly what changing the password from
      // inside the account is supposed to close off.
      expect(await repository.findByPasswordResetToken(tokenHash, NOW)).toEqual({
        outcome: 'UNKNOWN',
      });
    });

    it('leaves exactly one live reset token: issuing a second invalidates the first', async () => {
      const stored = await repository.registerCustomer(inputFor(registration()));
      const firstHash = `reset-${randomUUID()}`;
      const secondHash = `reset-${randomUUID()}`;

      await repository.savePasswordResetToken({
        customerId: stored.customerId,
        tokenHash: firstHash,
        expiresAt: new Date(NOW.getTime() + 3_600_000).toISOString(),
      });
      await repository.savePasswordResetToken({
        customerId: stored.customerId,
        tokenHash: secondHash,
        expiresAt: new Date(NOW.getTime() + 3_600_000).toISOString(),
      });

      expect(await repository.findByPasswordResetToken(firstHash, NOW)).toEqual({
        outcome: 'UNKNOWN',
      });
      expect(await repository.findByPasswordResetToken(secondHash, NOW)).toEqual({
        outcome: 'FOUND',
        customer: expect.objectContaining({ customerId: stored.customerId }),
      });
    });

    it('reports a reset token past its expiry as EXPIRED, distinct from an unknown one', async () => {
      const stored = await repository.registerCustomer(inputFor(registration()));
      const tokenHash = `reset-${randomUUID()}`;

      await repository.savePasswordResetToken({
        customerId: stored.customerId,
        tokenHash,
        expiresAt: new Date(NOW.getTime() - 1).toISOString(),
      });

      expect(await repository.findByPasswordResetToken(tokenHash, NOW)).toEqual({
        outcome: 'EXPIRED',
      });
      expect(await repository.findByPasswordResetToken(`0`.repeat(64), NOW)).toEqual({
        outcome: 'UNKNOWN',
      });
    });

    it('refuses to spend an already-spent reset token, and does not touch the password hash again', async () => {
      const oldHash = await hasher.hash('Contraseña-Original#4');
      const request = registration();
      const stored = await repository.registerCustomer(inputFor(request, { credentialHash: oldHash }));
      const tokenHash = `reset-${randomUUID()}`;

      await repository.savePasswordResetToken({
        customerId: stored.customerId,
        tokenHash,
        expiresAt: new Date(NOW.getTime() + 3_600_000).toISOString(),
      });

      const firstReplacement = await hasher.hash('Contraseña-Primer-Reset#5');
      await repository.savePasswordReset({
        customerId: stored.customerId,
        credentialHash: firstReplacement,
        tokenHash,
        usedAt: NOW.toISOString(),
        idempotency: {
          idempotencyKey: randomUUID(),
          messageType: 'customer.reset-password.v1',
          resultSummary: { outcome: 'RESET' },
        },
      });

      const secondReplacement = await hasher.hash('Contraseña-Segundo-Intento#6');
      await expect(
        repository.savePasswordReset({
          customerId: stored.customerId,
          credentialHash: secondReplacement,
          tokenHash,
          usedAt: NOW.toISOString(),
          idempotency: {
            idempotencyKey: randomUUID(),
            messageType: 'customer.reset-password.v1',
            resultSummary: { outcome: 'RESET' },
          },
        }),
      ).rejects.toMatchObject({ code: 'RESET_TOKEN_INVALID' });

      const found = await repository.findByEmail(request.email);
      await expect(hasher.verify('Contraseña-Primer-Reset#5', found!.credentialHash)).resolves.toBe(
        true,
      );
      await expect(
        hasher.verify('Contraseña-Segundo-Intento#6', found!.credentialHash),
      ).resolves.toBe(false);
    });

    it('persists a reset password that a brand-new Pool reads back correctly', async () => {
      const request = registration();
      const stored = await repository.registerCustomer(inputFor(request));
      const tokenHash = `reset-${randomUUID()}`;
      const newPlaintext = 'Contraseña-Tras-Reset#7';

      await repository.savePasswordResetToken({
        customerId: stored.customerId,
        tokenHash,
        expiresAt: new Date(NOW.getTime() + 3_600_000).toISOString(),
      });
      await repository.savePasswordReset({
        customerId: stored.customerId,
        credentialHash: await hasher.hash(newPlaintext),
        tokenHash,
        usedAt: NOW.toISOString(),
        idempotency: {
          idempotencyKey: randomUUID(),
          messageType: 'customer.reset-password.v1',
          resultSummary: { outcome: 'RESET' },
        },
      });

      const freshPool = new Pool({ connectionString: DATABASE_URL });
      try {
        const freshRepository = new PostgresCustomerRepository(freshPool);
        const found = await freshRepository.findByEmail(request.email);

        await expect(hasher.verify(newPlaintext, found!.credentialHash)).resolves.toBe(true);
      } finally {
        await freshPool.end();
      }
    });

    it('refuses a sequential reuse of an already-verified activation token (idempotence, not a race)', async () => {
      const request = registration();
      const tokenHash = `activation-${randomUUID()}`;

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

      // The very same call again, well after the first has committed — a
      // retry with no race involved, distinct from the concurrent case in
      // repository.integration.spec.ts.
      await expect(
        repository.saveEmailVerification({
          customer: activated,
          tokenHash,
          usedAt: NOW.toISOString(),
          idempotency: {
            idempotencyKey: randomUUID(),
            messageType: 'customer.verify-email.v1',
            resultSummary: { outcome: 'VERIFIED' },
          },
        }),
      ).rejects.toMatchObject({ code: 'ACTIVATION_TOKEN_INVALID' });
    });
  });

  describe('concurrent updates, one more shape', () => {
    it('lets a losing optimistic update be retried successfully against the fresh version it rolled back to', async () => {
      const stored = await repository.registerCustomer(inputFor(registration()));
      const base = await repository.findById(stored.customerId);

      const resultA = applyChanges(base!, { address: 'Dirección Ganadora' }, NOW);
      const resultB = applyChanges(base!, { fullName: 'Nombre Perdedor' }, NOW);

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

      const loserIndex = settled.findIndex((outcome) => outcome.status === 'rejected');
      expect(loserIndex).toBeGreaterThanOrEqual(0);

      // The retry a broker redelivery would perform: re-read, re-apply, re-write.
      const refreshed = await repository.findById(stored.customerId);
      const retried = applyChanges(refreshed!, { fullName: 'Nombre Reintentado' }, NOW);

      await repository.saveUpdate({
        customer: retried.customer,
        idempotency: {
          idempotencyKey: randomUUID(),
          messageType: 'customer.update.v1',
          resultSummary: { outcome: 'UPDATED' },
        },
      });

      const after = await repository.findById(stored.customerId);
      expect(after?.fullName).toBe('Nombre Reintentado');
      expect(after?.version).toBe(2);
    });
  });
});
