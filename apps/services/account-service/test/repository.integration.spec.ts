import { randomUUID } from 'node:crypto';

import { Pool } from 'pg';

import { DomainRejection, compensate, credit, debit, openAccount } from '../src/domain/account';
import { quetzales } from '../src/domain/money';
import { migrate } from '../src/infrastructure/persistence/migrations';
import { PostgresAccountRepository } from '../src/infrastructure/persistence/postgres-account.repository';

/**
 * The repository against a real PostgreSQL, because the guarantees that matter
 * here are enforced by the database and by nothing else.
 *
 * An in-memory double can be made to *look* like it refuses a second debit;
 * only a row lock actually does it when two transactions race. Same for
 * idempotency: a unique key is the guarantee, and a `Map` cannot demonstrate
 * one. Criteria 4 and 5 of the ticket live in this file.
 *
 * Requires the local stack (`infra/docker`) and `DATABASE_URL`. Skipped
 * otherwise, so a clone with no Docker still runs a green suite — and says
 * which tests it did not run.
 */

const DATABASE_URL = process.env.DATABASE_URL;
const describeIntegration = DATABASE_URL === undefined ? describe.skip : describe;

jest.setTimeout(30_000);

describeIntegration('PostgresAccountRepository', () => {
  let pool: Pool;
  let repository: PostgresAccountRepository;

  const NOW = new Date('2026-08-26T12:00:00.000Z');
  const CUSTOMER = '9f1c8b2a-4d63-4e57-8a90-1b2c3d4e5f60';

  beforeAll(async () => {
    if (DATABASE_URL === undefined) {
      console.warn('Skipping repository integration tests: DATABASE_URL is not set.');

      return;
    }

    pool = new Pool({ connectionString: DATABASE_URL });
    await migrate(pool);
    repository = new PostgresAccountRepository(pool);
  });

  afterAll(async () => {
    await pool?.end();
  });

  beforeEach(async () => {
    await pool.query('TRUNCATE account_operations, accounts, processed_messages, deactivation_runs');
  });

  async function seed(
    balanceMinor: number,
    overrides: { customerId?: string; accountType?: 'MONETARIA' | 'AHORRO' } = {},
  ) {
    const account = openAccount({
      accountId: randomUUID(),
      customerId: overrides.customerId ?? CUSTOMER,
      accountType: overrides.accountType ?? 'MONETARIA',
      now: NOW,
    });

    const { account: stored } = await repository.openAccount({
      account,
      idempotency: {
        idempotencyKey: randomUUID(),
        messageType: 'account.create.v1',
        resultSummary: { outcome: 'OPENED' },
      },
    });

    if (balanceMinor > 0) {
      await repository.applyMovement({
        accountId: stored.accountId,
        type: 'CREDIT',
        transactionId: null,
        idempotencyKey: randomUUID(),
        messageType: 'account.credit.requested.v1',
        decide: (found) => credit(found, quetzales(balanceMinor), NOW),
        now: NOW,
      });
    }

    return stored.accountId;
  }

  describe('money survives the round trip', () => {
    it('stores and reads back the values that floating point ruins', async () => {
      for (const minor of [1, 7, 1_999, 5_000, 100_049]) {
        const accountId = await seed(minor);

        expect((await repository.findById(accountId))?.balanceMinor).toBe(minor);
      }
    });
  });

  describe('opening', () => {
    it('is a no-op the second time, because the id comes from the Gateway', async () => {
      const account = openAccount({
        accountId: randomUUID(),
        customerId: CUSTOMER,
        accountType: 'AHORRO',
        now: NOW,
      });

      const idempotency = {
        idempotencyKey: randomUUID(),
        messageType: 'account.create.v1',
        resultSummary: { outcome: 'OPENED' },
      };

      const first = await repository.openAccount({ account, idempotency });
      const second = await repository.openAccount({ account, idempotency });

      expect(first.created).toBe(true);
      expect(second.created).toBe(false);
      expect(second.account.accountId).toBe(account.accountId);
    });

    /** T-27: AHORRO's minimum opening deposit becomes the row's real balance. */
    it('persists a non-zero initial deposit as the balance, with no operation row for it', async () => {
      const accountId = randomUUID();
      const account = openAccount({
        accountId,
        customerId: CUSTOMER,
        accountType: 'AHORRO',
        now: NOW,
        initialDepositMinor: 10_000,
      });

      await repository.openAccount({
        account,
        idempotency: {
          idempotencyKey: randomUUID(),
          messageType: 'account.create.v1',
          resultSummary: { outcome: 'OPENED' },
        },
      });

      expect((await repository.findById(accountId))?.balanceMinor).toBe(10_000);
      expect(await repository.operationsOf(accountId)).toHaveLength(0);
    });
  });

  /** Criterion 4, second half: two concurrent operations, never a negative balance. */
  describe('concurrency', () => {
    it('lets exactly one of two simultaneous debits through when only one fits', async () => {
      const accountId = await seed(10_000);

      const attempt = async () =>
        await repository
          .applyMovement({
            accountId,
            type: 'DEBIT',
            transactionId: randomUUID(),
            idempotencyKey: randomUUID(),
            messageType: 'account.debit.requested.v1',
            decide: (account) => debit(account, quetzales(7_500), NOW),
            now: NOW,
          })
          .then(() => 'applied' as const)
          .catch((error: unknown) =>
            error instanceof DomainRejection ? ('rejected' as const) : Promise.reject(error),
          );

      const outcomes = await Promise.all([attempt(), attempt()]);

      expect(outcomes.filter((outcome) => outcome === 'applied')).toHaveLength(1);
      expect(outcomes.filter((outcome) => outcome === 'rejected')).toHaveLength(1);
      expect((await repository.findById(accountId))?.balanceMinor).toBe(2_500);
    });

    it('never lets the balance go below zero, whatever arrives at once', async () => {
      const accountId = await seed(1_000);

      const attempts = Array.from({ length: 8 }, async () =>
        await repository
          .applyMovement({
            accountId,
            type: 'DEBIT',
            transactionId: randomUUID(),
            idempotencyKey: randomUUID(),
            messageType: 'account.debit.requested.v1',
            decide: (account) => debit(account, quetzales(300), NOW),
            now: NOW,
          })
          .catch((error: unknown) => {
            if (!(error instanceof DomainRejection)) {
              throw error;
            }

            return null;
          }),
      );

      const applied = (await Promise.all(attempts)).filter((result) => result !== null);

      // Three of eight fit in Q10.00, and the balance lands exactly on Q1.00.
      expect(applied).toHaveLength(3);
      expect((await repository.findById(accountId))?.balanceMinor).toBe(100);
    });

    it('advances the version once per accepted movement', async () => {
      const accountId = await seed(10_000);

      // One CREDIT from `seed`, then one DEBIT here: version 0 → 1 → 2.
      await repository.applyMovement({
        accountId,
        type: 'DEBIT',
        transactionId: randomUUID(),
        idempotencyKey: randomUUID(),
        messageType: 'account.debit.requested.v1',
        decide: (account) => debit(account, quetzales(1), NOW),
        now: NOW,
      });

      expect((await repository.findById(accountId))?.version).toBe(2);
    });
  });

  /** Criterion 4, first half: a duplicated message does not duplicate the debit. */
  describe('idempotency, which is a unique key and not a check', () => {
    it('refuses a second operation under the same key and type', async () => {
      const accountId = await seed(10_000);
      const idempotencyKey = randomUUID();

      const move = async () =>
        await repository.applyMovement({
          accountId,
          type: 'DEBIT',
          transactionId: randomUUID(),
          idempotencyKey,
          messageType: 'account.debit.requested.v1',
          decide: (account) => debit(account, quetzales(2_500), NOW),
          now: NOW,
        });

      await move();

      // The use case never gets here — it checks `findProcessed` first — but the
      // constraint is what makes that check safe under a race rather than
      // merely usual.
      await expect(move()).rejects.toThrow(/account_operations_once|duplicate key/i);
      expect((await repository.findById(accountId))?.balanceMinor).toBe(7_500);
    });

    it('lets a compensation share the Saga key with the debit it undoes', async () => {
      const accountId = await seed(10_000);
      const sagaKey = randomUUID();
      const transactionId = randomUUID();

      await repository.applyMovement({
        accountId,
        type: 'DEBIT',
        transactionId,
        idempotencyKey: sagaKey,
        messageType: 'account.debit.requested.v1',
        decide: (account) => debit(account, quetzales(2_500), NOW),
        now: NOW,
      });

      await repository.applyMovement({
        accountId,
        type: 'COMPENSATION',
        transactionId,
        idempotencyKey: sagaKey,
        messageType: 'account.debit.compensation.requested.v1',
        decide: (account, commissionToReverse) =>
          compensate(account, quetzales(2_500), commissionToReverse, NOW),
        compensates: { transactionId },
        now: NOW,
      });

      expect((await repository.findById(accountId))?.balanceMinor).toBe(10_000);

      const operations = await repository.operationsOf(accountId);

      expect(operations.find((o) => o.type === 'DEBIT')?.status).toBe('COMPENSATED');
      expect(operations.find((o) => o.type === 'COMPENSATION')?.status).toBe('APPLIED');
    });

    it('refuses to compensate a transfer that was never debited, crediting nothing', async () => {
      const accountId = await seed(10_000);
      const transactionId = randomUUID();

      // No debit for this transaction exists. Crediting the compensation back
      // would create money that never left, so the movement must abort.
      await expect(
        repository.applyMovement({
          accountId,
          type: 'COMPENSATION',
          transactionId,
          idempotencyKey: randomUUID(),
          messageType: 'account.debit.compensation.requested.v1',
          decide: (account, commissionToReverse) =>
            compensate(account, quetzales(2_500), commissionToReverse, NOW),
          compensates: { transactionId },
          now: NOW,
        }),
      ).rejects.toThrow(/no applied debit/i);

      // The balance is untouched: nothing was credited.
      expect((await repository.findById(accountId))?.balanceMinor).toBe(10_000);
    });

    it('blocks a second movement of the same type for one transfer (business-identity dedup)', async () => {
      const accountId = await seed(10_000);
      const transactionId = randomUUID();

      await repository.applyMovement({
        accountId,
        type: 'CREDIT',
        transactionId,
        idempotencyKey: randomUUID(),
        messageType: 'account.credit.requested.v1',
        decide: (account) => credit(account, quetzales(2_500), NOW),
        now: NOW,
      });

      // A second CREDIT for the same transfer, under a *fresh* idempotency key
      // (the re-published-event bug). The transport dedup does not catch it; the
      // (transaction_id, type) unique index does, and its transaction rolls back
      // — the balance cannot move twice for one transfer.
      await expect(
        repository.applyMovement({
          accountId,
          type: 'CREDIT',
          transactionId,
          idempotencyKey: randomUUID(),
          messageType: 'account.credit.requested.v1',
          decide: (account) => credit(account, quetzales(2_500), NOW),
          now: NOW,
        }),
      ).rejects.toThrow();

      expect((await repository.findById(accountId))?.balanceMinor).toBe(12_500);
    });

    it('records a processed message once, letting the second insert lose quietly', async () => {
      const record = {
        idempotencyKey: randomUUID(),
        messageType: 'account.create.v1',
        resultSummary: { outcome: 'FIRST' },
      };

      await repository.recordProcessed(record);
      await repository.recordProcessed({ ...record, resultSummary: { outcome: 'SECOND' } });

      const found = await repository.findProcessed(record.idempotencyKey, record.messageType);

      expect(found?.resultSummary).toEqual({ outcome: 'FIRST' });
    });
  });

  describe('a rejected movement changes nothing at all', () => {
    it('rolls back the operation row along with the balance', async () => {
      const accountId = await seed(1_000);

      await expect(
        repository.applyMovement({
          accountId,
          type: 'DEBIT',
          transactionId: randomUUID(),
          idempotencyKey: randomUUID(),
          messageType: 'account.debit.requested.v1',
          decide: (account) => debit(account, quetzales(5_000), NOW),
          now: NOW,
        }),
      ).rejects.toThrow(DomainRejection);

      expect((await repository.findById(accountId))?.balanceMinor).toBe(1_000);
      expect(await repository.operationsOf(accountId)).toHaveLength(1); // the seeding credit
    });
  });

  /** T-27: the commission an AHORRO debit charges, as its own row and a real UPDATE. */
  describe('the AHORRO commission', () => {
    it('records the debit and the commission as two separate rows, and one balance', async () => {
      const accountId = await seed(20_000, { accountType: 'AHORRO' });

      const applied = await repository.applyMovement({
        accountId,
        type: 'DEBIT',
        transactionId: randomUUID(),
        idempotencyKey: randomUUID(),
        messageType: 'account.debit.requested.v1',
        decide: (account) => debit(account, quetzales(2_500), NOW),
        now: NOW,
      });

      expect(applied?.commission).toMatchObject({ type: 'COMMISSION', amount: quetzales(300) });

      const operations = await repository.operationsOf(accountId);

      // The seeding credit, plus the debit, plus the commission.
      expect(operations).toHaveLength(3);
      expect(operations.map((operation) => operation.type).sort()).toEqual([
        'COMMISSION',
        'CREDIT',
        'DEBIT',
      ]);

      const commissionRow = operations.find((operation) => operation.type === 'COMMISSION');
      const debitRow = operations.find((operation) => operation.type === 'DEBIT');

      // amount + commission left the account; the ledger is one number.
      expect((await repository.findById(accountId))?.balanceMinor).toBe(17_200);
      // The DEBIT's own balanceAfter is the intermediate figure (amount only) —
      // what account.debited.v1 carries — while the COMMISSION row's is final.
      expect(debitRow?.balanceAfter).toEqual(quetzales(17_500));
      expect(commissionRow?.balanceAfter).toEqual(quetzales(17_200));
    });

    it('charges no commission row at all on a MONETARIA debit', async () => {
      const accountId = await seed(20_000, { accountType: 'MONETARIA' });

      const applied = await repository.applyMovement({
        accountId,
        type: 'DEBIT',
        transactionId: randomUUID(),
        idempotencyKey: randomUUID(),
        messageType: 'account.debit.requested.v1',
        decide: (account) => debit(account, quetzales(2_500), NOW),
        now: NOW,
      });

      expect(applied?.commission).toBeNull();

      const operations = await repository.operationsOf(accountId);

      expect(operations.map((operation) => operation.type).sort()).toEqual(['CREDIT', 'DEBIT']);
    });

    it('does not double-charge the commission on a redelivered debit', async () => {
      const accountId = await seed(20_000, { accountType: 'AHORRO' });
      const idempotencyKey = randomUUID();

      const attempt = async () =>
        await repository.applyMovement({
          accountId,
          type: 'DEBIT',
          transactionId: randomUUID(),
          idempotencyKey,
          messageType: 'account.debit.requested.v1',
          decide: (account) => debit(account, quetzales(2_500), NOW),
          now: NOW,
        });

      await attempt();

      // The second delivery must not reach `decide` at all in the real use
      // case — `DebitAccountUseCase` checks `findProcessed` first — but this
      // proves the database-level backstop too: the same (idempotency_key,
      // type='COMMISSION') can only ever insert once.
      await expect(attempt()).rejects.toThrow();

      const operations = await repository.operationsOf(accountId);

      expect(operations.filter((operation) => operation.type === 'COMMISSION')).toHaveLength(1);
      expect((await repository.findById(accountId))?.balanceMinor).toBe(17_200);
    });

    /**
     * T-29 correction: compensating an `AHORRO` transfer used to return the
     * transfer amount and keep the Q3.00 commission, discovered testing T-29's
     * TIMEOUT scenario end to end against the real application. The full
     * balance — amount and commission both — must come back, and the
     * commission's own `account_operations` row must read `COMPENSATED`
     * rather than staying `APPLIED` forever for a fee that was refunded.
     */
    it('refunds the commission alongside the amount when the debit it charged is compensated', async () => {
      const accountId = await seed(20_000, { accountType: 'AHORRO' });
      const transactionId = randomUUID();
      const sagaKey = randomUUID();

      await repository.applyMovement({
        accountId,
        type: 'DEBIT',
        transactionId,
        idempotencyKey: sagaKey,
        messageType: 'account.debit.requested.v1',
        decide: (account) => debit(account, quetzales(2_500), NOW),
        now: NOW,
      });

      // Amount 2,500 + commission 300 left the account: 20,000 - 2,800 = 17,200.
      expect((await repository.findById(accountId))?.balanceMinor).toBe(17_200);

      const compensated = await repository.applyMovement({
        accountId,
        type: 'COMPENSATION',
        transactionId,
        idempotencyKey: sagaKey,
        messageType: 'account.debit.compensation.requested.v1',
        decide: (account, commissionToReverse) =>
          compensate(account, quetzales(2_500), commissionToReverse, NOW),
        compensates: { transactionId },
        now: NOW,
      });

      // Back to the exact balance before the transfer — the fee did not stick.
      expect((await repository.findById(accountId))?.balanceMinor).toBe(20_000);
      expect(compensated?.operation.amount).toEqual(quetzales(2_800));

      const operations = await repository.operationsOf(accountId);

      expect(operations.find((operation) => operation.type === 'DEBIT')?.status).toBe(
        'COMPENSATED',
      );
      expect(operations.find((operation) => operation.type === 'COMMISSION')?.status).toBe(
        'COMPENSATED',
      );
      expect(operations.find((operation) => operation.type === 'COMPENSATION')?.status).toBe(
        'APPLIED',
      );
    });

    it('compensates a MONETARIA debit for the amount alone — there was never a commission to reverse', async () => {
      const accountId = await seed(20_000, { accountType: 'MONETARIA' });
      const transactionId = randomUUID();
      const sagaKey = randomUUID();

      await repository.applyMovement({
        accountId,
        type: 'DEBIT',
        transactionId,
        idempotencyKey: sagaKey,
        messageType: 'account.debit.requested.v1',
        decide: (account) => debit(account, quetzales(2_500), NOW),
        now: NOW,
      });

      const compensated = await repository.applyMovement({
        accountId,
        type: 'COMPENSATION',
        transactionId,
        idempotencyKey: sagaKey,
        messageType: 'account.debit.compensation.requested.v1',
        decide: (account, commissionToReverse) =>
          compensate(account, quetzales(2_500), commissionToReverse, NOW),
        compensates: { transactionId },
        now: NOW,
      });

      expect((await repository.findById(accountId))?.balanceMinor).toBe(20_000);
      expect(compensated?.operation.amount).toEqual(quetzales(2_500));
    });
  });

  /** Criterion 6: the job deactivates exactly the accounts that qualify. */
  describe('the automatic deactivation, in SQL', () => {
    const LONG_AGO = new Date('2026-01-01T00:00:00.000Z');

    async function age(accountId: string, lastActivityAt: Date): Promise<void> {
      await pool.query('UPDATE accounts SET last_activity_at = $1 WHERE account_id = $2', [
        lastActivityAt,
        accountId,
      ]);
    }

    it('takes the accounts below Q50.00 and leaves the one sitting on it', async () => {
      const below = await seed(4_999);
      const exactly = await seed(5_000);
      const recent = await seed(0);

      await age(below, LONG_AGO);
      await age(exactly, LONG_AGO);

      const deactivated = await repository.deactivateInactive({
        now: NOW,
        criteria: { minBalanceMinor: 5_000, inactivityMonths: 6 },
        runId: randomUUID(),
      });

      expect(deactivated.map((account) => account.accountId)).toEqual([below]);
      expect((await repository.findById(exactly))?.status).toBe('ACTIVE');
      expect((await repository.findById(recent))?.status).toBe('ACTIVE');
    });

    it('finds nothing on a second run the same day', async () => {
      const accountId = await seed(0);
      await age(accountId, LONG_AGO);

      const criteria = { minBalanceMinor: 5_000, inactivityMonths: 6 };

      expect(
        await repository.deactivateInactive({ now: NOW, criteria, runId: randomUUID() }),
      ).toHaveLength(1);
      expect(
        await repository.deactivateInactive({ now: NOW, criteria, runId: randomUUID() }),
      ).toHaveLength(0);
    });

    it('records every run, including the ones that found nothing', async () => {
      await repository.deactivateInactive({
        now: NOW,
        criteria: { minBalanceMinor: 5_000, inactivityMonths: 6 },
        runId: randomUUID(),
      });

      const runs = await pool.query<{ deactivated_count: number }>(
        'SELECT deactivated_count FROM deactivation_runs',
      );

      expect(runs.rows).toEqual([{ deactivated_count: 0 }]);
    });
  });

  describe('reading back', () => {
    it('filters a list by customer, status and type', async () => {
      const mine = await seed(100);
      await seed(100, { customerId: '1e2d3c4b-5a69-4f78-9012-3456789abcde' });

      const found = await repository.list({ customerId: CUSTOMER, accountType: 'MONETARIA' });

      expect(found.map((account) => account.accountId)).toEqual([mine]);
    });

    it('returns the movements newest first, with the balance each one produced', async () => {
      const accountId = await seed(10_000);

      await repository.applyMovement({
        accountId,
        type: 'DEBIT',
        transactionId: randomUUID(),
        idempotencyKey: randomUUID(),
        messageType: 'account.debit.requested.v1',
        decide: (account) => debit(account, quetzales(2_500), new Date(NOW.getTime() + 1_000)),
        now: new Date(NOW.getTime() + 1_000),
      });

      const operations = await repository.operationsOf(accountId);

      expect(operations.map((operation) => operation.type)).toEqual(['DEBIT', 'CREDIT']);
      expect(operations[0]?.balanceAfter).toEqual(quetzales(7_500));
      expect(operations[1]?.balanceAfter).toEqual(quetzales(10_000));
    });
  });
});
