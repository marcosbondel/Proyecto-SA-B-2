import { randomUUID } from 'node:crypto';

import { Pool } from 'pg';

import { ActivityMonitor } from '../src/application/activity-monitor';
import { CompensateDebitUseCase } from '../src/application/compensate-debit.use-case';
import { CreditAccountUseCase } from '../src/application/credit-account.use-case';
import { DebitAccountUseCase } from '../src/application/debit-account.use-case';
import { DomainRejection, compensate, credit, debit, openAccount } from '../src/domain/account';
import { quetzales } from '../src/domain/money';
import { migrate } from '../src/infrastructure/persistence/migrations';
import { PostgresAccountRepository } from '../src/infrastructure/persistence/postgres-account.repository';
import { FixedClock, RecordingActivityTelemetry, RecordingPublisher } from './support/in-memory';

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
    await pool.query('TRUNCATE account_anomalies, account_operations, accounts, processed_messages, deactivation_runs');
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

  /**
   * T-42: the high-frequency rule, decided by the database.
   *
   * What these prove cannot be shown with a double: that two detections racing
   * for one account announce one anomaly (an advisory lock), that the window is
   * counted from rows rather than from memory, and that detection never makes a
   * balance movement wait (its lock is not the row lock).
   */
  describe('the high-frequency anomaly (T-42)', () => {
    const RULE = { maxOperations: 10, windowMinutes: 5 };
    const T0 = new Date('2026-10-04T16:00:00.000Z');
    const SECOND = 1_000;
    const MINUTE = 60 * SECOND;

    async function ledger(
      accountId: string,
      type: 'DEBIT' | 'CREDIT' | 'COMPENSATION' | 'COMMISSION',
      at: Date,
    ): Promise<void> {
      await pool.query(
        `INSERT INTO account_operations
           (operation_id, account_id, type, amount, balance_after, transaction_id, status, idempotency_key, created_at)
         VALUES ($1, $2, $3, 1.00, 1.00, NULL, 'APPLIED', $4, $5)`,
        [randomUUID(), accountId, type, randomUUID(), at],
      );
    }

    async function burst(accountId: string, count: number, from: Date = T0): Promise<void> {
      for (let i = 0; i < count; i += 1) {
        await ledger(accountId, i % 2 === 0 ? 'DEBIT' : 'CREDIT', new Date(from.getTime() + i * SECOND));
      }
    }

    const claim = async (accountId: string, now: Date, rule = RULE) =>
      await repository.claimAnomaly({
        account: { accountId, customerId: CUSTOMER, accountType: 'AHORRO' },
        rule,
        now,
      });

    const storedAnomalies = async (accountId: string) =>
      (await pool.query('SELECT * FROM account_anomalies WHERE account_id = $1', [accountId])).rows;

    it('stays quiet at exactly N operations and announces the N + 1st', async () => {
      const accountId = await seed(0);

      await burst(accountId, 10);
      expect(await claim(accountId, new Date(T0.getTime() + 9 * SECOND))).toBeNull();

      await burst(accountId, 1, new Date(T0.getTime() + 10 * SECOND));
      const claimed = await claim(accountId, new Date(T0.getTime() + 10 * SECOND));

      expect(claimed).toMatchObject({
        firstTime: true,
        anomaly: {
          accountId,
          customerId: CUSTOMER,
          accountType: 'AHORRO',
          operationCount: 11,
          threshold: 10,
          windowMinutes: 5,
        },
      });
      expect(claimed?.anomaly.windowStart.toISOString()).toBe(
        new Date(T0.getTime() + 10 * SECOND - 5 * MINUTE).toISOString(),
      );
      expect(await storedAnomalies(accountId)).toHaveLength(1);
    });

    it('counts the window from the database, whichever instance asks', async () => {
      const accountId = await seed(0);
      await burst(accountId, 11);

      // A second repository over the same database stands in for a second replica.
      const otherReplica = new PostgresAccountRepository(pool);
      const now = new Date(T0.getTime() + 10 * SECOND);

      const fromOther = await otherReplica.claimAnomaly({
        account: { accountId, customerId: CUSTOMER, accountType: 'AHORRO' },
        rule: RULE,
        now,
      });

      expect(fromOther?.anomaly.operationCount).toBe(11);
      // And the first one now finds the anomaly the other recorded.
      expect(await claim(accountId, now)).toBeNull();
    });

    it('announces exactly one anomaly when twenty detections race for the same account', async () => {
      const accountId = await seed(0);
      await burst(accountId, 12);
      const now = new Date(T0.getTime() + 11 * SECOND);

      const results = await Promise.all(Array.from({ length: 20 }, () => claim(accountId, now)));

      expect(results.filter((result) => result !== null)).toHaveLength(1);
      expect(results.find((result) => result !== null)?.firstTime).toBe(true);
      expect(await storedAnomalies(accountId)).toHaveLength(1);
    });

    it('stays quiet for the rest of the window, then announces a new burst', async () => {
      const accountId = await seed(0);
      await burst(accountId, 11);

      const first = await claim(accountId, new Date(T0.getTime() + 10 * SECOND));
      expect(first).not.toBeNull();
      // It reached the broker, so nobody has anything left to announce.
      await repository.markAnomalyPublished(first!.anomaly.anomalyId, new Date(T0.getTime() + 11 * SECOND));

      expect(await claim(accountId, new Date(T0.getTime() + 2 * MINUTE))).toBeNull();
      expect(await claim(accountId, new Date(T0.getTime() + 4 * MINUTE))).toBeNull();

      const later = new Date(T0.getTime() + 10 * MINUTE);
      await burst(accountId, 11, later);

      expect(await claim(accountId, new Date(later.getTime() + 10 * SECOND))).not.toBeNull();
      expect(await storedAnomalies(accountId)).toHaveLength(2);
    });

    it('counts only debits and credits, and only inside the window', async () => {
      const accountId = await seed(0);

      // Eight debits and credits, plus fees and compensations that must not count.
      await burst(accountId, 8);
      for (let i = 0; i < 6; i += 1) {
        await ledger(accountId, 'COMMISSION', new Date(T0.getTime() + i * SECOND));
        await ledger(accountId, 'COMPENSATION', new Date(T0.getTime() + i * SECOND));
      }
      // Four more, but ten minutes old: outside a five-minute window.
      await burst(accountId, 4, new Date(T0.getTime() - 10 * MINUTE));

      expect(await claim(accountId, new Date(T0.getTime() + 9 * SECOND))).toBeNull();
    });

    it('excludes the operation made exactly M minutes ago', async () => {
      const accountId = await seed(0);
      const now = new Date(T0.getTime() + 5 * MINUTE);

      // Ten at exactly the start of the window, and one inside it.
      for (let i = 0; i < 10; i += 1) {
        await ledger(accountId, 'DEBIT', T0);
      }
      await ledger(accountId, 'DEBIT', now);

      expect(await claim(accountId, now)).toBeNull();
    });

    it('follows N and M when they are configured differently', async () => {
      const accountId = await seed(0);
      await burst(accountId, 3);

      const now = new Date(T0.getTime() + 2 * SECOND);

      expect(await claim(accountId, now, { maxOperations: 3, windowMinutes: 5 })).toBeNull();
      expect(await claim(accountId, now, { maxOperations: 2, windowMinutes: 5 })).toMatchObject({
        anomaly: { operationCount: 3, threshold: 2, windowMinutes: 5 },
      });
    });

    it('keeps accounts apart', async () => {
      const first = await seed(0);
      const second = await seed(0);

      await burst(first, 6);
      await burst(second, 6);

      expect(await claim(first, new Date(T0.getTime() + 6 * SECOND))).toBeNull();
      expect(await claim(second, new Date(T0.getTime() + 6 * SECOND))).toBeNull();
    });

    it('hands an unannounced anomaly back only once its claim has gone stale', async () => {
      const accountId = await seed(0);
      await burst(accountId, 11);
      const now = new Date(T0.getTime() + 10 * SECOND);

      const first = await claim(accountId, now);
      expect(first?.firstTime).toBe(true);

      // Whoever holds it may still be publishing: nobody else takes it yet.
      expect(await claim(accountId, new Date(now.getTime() + 30 * SECOND))).toBeNull();

      // Silent for longer than the lease, and still inside the window: take it over.
      const retry = await claim(accountId, new Date(now.getTime() + 90 * SECOND));
      expect(retry).toMatchObject({
        firstTime: false,
        anomaly: { anomalyId: first?.anomaly.anomalyId, operationCount: 11 },
      });

      // Once it is announced, nobody takes it again.
      await repository.markAnomalyPublished(
        first!.anomaly.anomalyId,
        new Date(now.getTime() + 91 * SECOND),
      );
      expect(await claim(accountId, new Date(now.getTime() + 4 * MINUTE))).toBeNull();
    });

    it('records when the anomaly was announced, once', async () => {
      const accountId = await seed(0);
      await burst(accountId, 11);
      const claimed = await claim(accountId, new Date(T0.getTime() + 10 * SECOND));

      const firstMark = new Date(T0.getTime() + 11 * SECOND);
      await repository.markAnomalyPublished(claimed!.anomaly.anomalyId, firstMark);
      await repository.markAnomalyPublished(claimed!.anomaly.anomalyId, new Date(firstMark.getTime() + MINUTE));

      const [row] = await storedAnomalies(accountId);
      expect((row.published_at as Date).toISOString()).toBe(firstMark.toISOString());
    });

    it('refuses to record an anomaly that does not exceed its own limit', async () => {
      const accountId = await seed(0);

      await expect(
        pool.query(
          `INSERT INTO account_anomalies
             (anomaly_id, account_id, operation_count, threshold, window_minutes, window_start, detected_at, claimed_at)
           VALUES ($1, $2, 10, 10, 5, $3, $3, $3)`,
          [randomUUID(), accountId, T0],
        ),
      ).rejects.toMatchObject({ constraint: 'account_anomalies_exceeds_limit' });
    });

    it('never makes a balance movement wait: its lock is not the account row lock', async () => {
      const accountId = await seed(1_000_000);
      await burst(accountId, 11);

      // Hold exactly the lock a detection takes for this account, as a slow detection would.
      const holder = await pool.connect();

      try {
        await holder.query('BEGIN');
        await holder.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
          `account-anomaly:${accountId}`,
        ]);

        const startedAt = Date.now();
        const moved = await Promise.race([
          repository.applyMovement({
            accountId,
            type: 'DEBIT',
            transactionId: randomUUID(),
            idempotencyKey: randomUUID(),
            messageType: 'account.debit.requested.v1',
            decide: (account) => debit(account, quetzales(100), NOW),
            now: NOW,
          }),
          new Promise<'WAITED'>((resolve) => setTimeout(() => resolve('WAITED'), 3_000)),
        ]);

        expect(moved).not.toBe('WAITED');
        expect(Date.now() - startedAt).toBeLessThan(3_000);
      } finally {
        await holder.query('ROLLBACK');
        holder.release();
      }
    });
  });

  /**
   * T-42, end to end against a real database: the real use cases, the real
   * repository and the real monitor, with only the broker replaced. This is the
   * shape the ticket's criteria are about — one event per window and account,
   * N and M changing behaviour, and a monitor that cannot hurt a movement.
   */
  describe('the monitor through the real use cases (T-42)', () => {
    const SECOND = 1_000;

    function stack(rule = { maxOperations: 10, windowMinutes: 5 }, repo = repository) {
      const publisher = new RecordingPublisher();
      const clock = new FixedClock(NOW);
      const telemetry = new RecordingActivityTelemetry();
      const activity = new ActivityMonitor({ repository: repo, publisher, clock, telemetry, rule });
      const dependencies = { repository: repo, publisher, clock, activity };

      return {
        publisher,
        clock,
        telemetry,
        dependencies,
        debit: new DebitAccountUseCase(dependencies),
        credit: new CreditAccountUseCase(dependencies),
        compensate: new CompensateDebitUseCase(dependencies),
      };
    }

    const anomalyEvents = (publisher: RecordingPublisher) =>
      publisher.events.filter((event) => event.messageType === 'account.anomaly.detected.v1');

    const debitCommand = (accountId: string) => ({
      transactionId: randomUUID(),
      accountId,
      amount: quetzales(100),
    });

    it('flags the account on the eleventh debit, once, and records that it was announced', async () => {
      const accountId = await seed(1_000_000, { accountType: 'AHORRO' });
      const { publisher, clock, debit } = stack();

      for (let i = 0; i < 12; i += 1) {
        clock.advanceTo(new Date(NOW.getTime() + i * SECOND));
        await debit.execute(debitCommand(accountId), randomUUID());
      }

      const events = anomalyEvents(publisher);
      expect(events).toHaveLength(1);
      expect(events[0]!.payload).toMatchObject({
        accountId,
        accountType: 'AHORRO',
        rule: 'HIGH_FREQUENCY',
        operationCount: 11,
        threshold: 10,
        windowMinutes: 5,
      });

      const stored = await pool.query(
        'SELECT published_at FROM account_anomalies WHERE account_id = $1',
        [accountId],
      );
      expect(stored.rows).toHaveLength(1);
      expect(stored.rows[0].published_at).not.toBeNull();
    });

    it('does not count the AHORRO commission each debit writes beside itself', async () => {
      const accountId = await seed(1_000_000, { accountType: 'AHORRO' });
      const { publisher, clock, debit } = stack();

      // `seed` funds the account with one credit, so nine debits make ten operations — exactly the
      // limit — and eighteen further ledger rows once each debit's commission is in. If commissions
      // counted, this account would be flagged.
      for (let i = 0; i < 9; i += 1) {
        clock.advanceTo(new Date(NOW.getTime() + i * SECOND));
        await debit.execute(debitCommand(accountId), randomUUID());
      }

      const rows = await pool.query(
        `SELECT type, COUNT(*)::INT AS count FROM account_operations
          WHERE account_id = $1 AND type IN ('DEBIT', 'COMMISSION') GROUP BY type ORDER BY type`,
        [accountId],
      );
      expect(Object.fromEntries(rows.rows.map((row) => [row.type, row.count]))).toEqual({
        COMMISSION: 9,
        DEBIT: 9,
      });
      expect(anomalyEvents(publisher)).toHaveLength(0);
    });

    it('announces exactly one anomaly when twelve debits arrive at the same time', async () => {
      const accountId = await seed(1_000_000);
      const { publisher, debit } = stack();

      await Promise.all(
        Array.from({ length: 12 }, () => debit.execute(debitCommand(accountId), randomUUID())),
      );

      expect(anomalyEvents(publisher)).toHaveLength(1);
      expect((await pool.query('SELECT 1 FROM account_anomalies WHERE account_id = $1', [accountId])).rows)
        .toHaveLength(1);
    });

    it('announces one anomaly when two replicas share the traffic', async () => {
      const accountId = await seed(1_000_000);
      // A second repository and monitor over the same database stand in for a second pod.
      const replicaA = stack();
      const replicaB = stack(undefined, new PostgresAccountRepository(pool));

      await Promise.all(
        Array.from({ length: 14 }, (_unused, i) =>
          (i % 2 === 0 ? replicaA : replicaB).debit.execute(debitCommand(accountId), randomUUID()),
        ),
      );

      expect(anomalyEvents(replicaA.publisher).length + anomalyEvents(replicaB.publisher).length).toBe(1);
    });

    it('takes N and M from the rule it is given: the same ledger, two rules, two answers', async () => {
      const first = await seed(1_000_000);
      const second = await seed(1_000_000);
      const strict = stack({ maxOperations: 3, windowMinutes: 5 });
      const lenient = stack({ maxOperations: 10, windowMinutes: 5 });

      for (let i = 0; i < 5; i += 1) {
        await strict.debit.execute(debitCommand(first), randomUUID());
        await lenient.debit.execute(debitCommand(second), randomUUID());
      }

      expect(anomalyEvents(strict.publisher)).toHaveLength(1);
      expect(anomalyEvents(strict.publisher)[0]!.payload).toMatchObject({ threshold: 3, operationCount: 4 });
      expect(anomalyEvents(lenient.publisher)).toHaveLength(0);
    });

    it('does not flag the compensation of a transfer that went wrong as customer activity', async () => {
      const accountId = await seed(1_000_000);
      const { publisher, debit, compensate } = stack({ maxOperations: 2, windowMinutes: 5 });

      const command = debitCommand(accountId);
      await debit.execute(command, randomUUID());
      await compensate.execute({ ...command, triggeredBy: 'PAYMENT_DECLINED' }, randomUUID());

      // One debit and one compensation: one operation by the customer, which is under the limit of two.
      expect(anomalyEvents(publisher)).toHaveLength(0);
    });

    it('leaves a movement untouched when the monitor itself fails', async () => {
      const accountId = await seed(1_000_000);
      const broken = new PostgresAccountRepository(pool);
      broken.claimAnomaly = () => Promise.reject(new Error('detector exploded'));
      const { publisher, telemetry, debit } = stack({ maxOperations: 0 + 1, windowMinutes: 5 }, broken);

      await expect(debit.execute(debitCommand(accountId), randomUUID())).resolves.toBeUndefined();

      // The debit committed and was announced; the failure is telemetry, not an error.
      expect(publisher.typesPublished()).toContain('account.debited.v1');
      expect((await repository.findById(accountId))?.balanceMinor).toBe(1_000_000 - 100);
      expect(telemetry.failures).toMatchObject([{ accountId, stage: 'detection', reason: 'detector exploded' }]);
    });
  });
});
