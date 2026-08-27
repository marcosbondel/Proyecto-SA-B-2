import { randomUUID } from 'node:crypto';

import { Pool } from 'pg';

import { applyEvent, openTransaction } from '../src/domain/transaction';
import type { Transaction } from '../src/domain/transaction';
import { quetzales } from '../src/domain/money';
import { migrate } from '../src/infrastructure/persistence/migrations';
import { PostgresTransactionRepository } from '../src/infrastructure/persistence/postgres-transaction.repository';

/**
 * The repository against a real PostgreSQL, because the guarantees that matter
 * here are enforced by the database and by nothing else.
 *
 * An in-memory double can be made to *look* like it refuses a second
 * compensation; only a row lock and a unique key actually do it when two Saga
 * events race. That is not a hypothetical for this service: `payment.failed.v1`
 * and `account.credited.v1` genuinely can arrive at the same instant, and the
 * difference between one lock and none is the difference between a transfer
 * that is compensated and one that is both completed and refunded.
 *
 * Requires the local stack (`infra/docker`) and `DATABASE_URL`. Skipped
 * otherwise, so a clone with no Docker still runs a green suite — and says
 * which tests it did not run.
 */

const DATABASE_URL = process.env.DATABASE_URL;
const describeIntegration = DATABASE_URL === undefined ? describe.skip : describe;

jest.setTimeout(30_000);

describeIntegration('PostgresTransactionRepository', () => {
  let pool: Pool;
  let repository: PostgresTransactionRepository;

  const NOW = new Date('2026-08-26T12:00:00.000Z');

  beforeAll(async () => {
    if (DATABASE_URL === undefined) {
      console.warn('Skipping repository integration tests: DATABASE_URL is not set.');

      return;
    }

    pool = new Pool({ connectionString: DATABASE_URL });
    await migrate(pool);
    repository = new PostgresTransactionRepository(pool);
  });

  afterAll(async () => {
    await pool?.end();
  });

  beforeEach(async () => {
    await pool.query(
      'TRUNCATE transaction_aliases, transaction_events, transactions, processed_messages',
    );
  });

  const candidate = (overrides: Partial<Transaction> = {}): Transaction =>
    openTransaction({
      transactionId: randomUUID(),
      sourceAccount: randomUUID(),
      targetAccount: randomUUID(),
      amount: quetzales(15_000),
      correlationId: randomUUID(),
      idempotencyKey: randomUUID(),
      paymentScenario: null,
      now: NOW,
      ...overrides,
    });

  async function seedDebiting(): Promise<Transaction> {
    const { transaction } = (await repository.start({ transaction: candidate() })) as {
      transaction: Transaction;
    };

    const advanced = await repository.applyEvent({
      transactionId: transaction.transactionId,
      messageId: randomUUID(),
      messageType: 'transfer.requested.v1',
      payload: {},
      decide: (found) => applyEvent(found, { kind: 'DEBIT_ORDERED' }),
      now: NOW,
    });

    if (advanced.kind !== 'APPLIED') {
      throw new Error(`Expected the debit to be ordered, got ${advanced.kind}.`);
    }

    return advanced.transaction;
  }

  describe('money survives the round trip', () => {
    /**
     * `NUMERIC(14,2)` read back as text and split on the point. The moment this
     * becomes a float, a ledger starts disagreeing with itself by a centavo.
     */
    it.each([1, 7, 99, 100, 15_000, 999_999_999_999_99])(
      'stores and returns %i centavos',
      async (amountMinor) => {
        const { transaction } = await repository.start({
          transaction: candidate({ amount: quetzales(amountMinor) }),
        });

        const read = await repository.findById(transaction.transactionId);

        expect(read!.amount).toEqual(quetzales(amountMinor));
      },
    );
  });

  describe('the idempotency key, as a unique constraint', () => {
    it('lets exactly one of two identical requests create a transaction (T-3)', async () => {
      const key = randomUUID();
      const first = candidate({ idempotencyKey: key });
      const second = candidate({ idempotencyKey: key });

      const [a, b] = await Promise.all([
        repository.start({ transaction: first }),
        repository.start({ transaction: second }),
      ]);

      const kinds = [a.kind, b.kind].sort();

      expect(kinds).toEqual(['CREATED', 'EXISTS']);
      expect(a.transaction.transactionId).toBe(b.transaction.transactionId);

      const stored = await pool.query('SELECT count(*)::INT AS n FROM transactions');

      expect(stored.rows[0].n).toBe(1);
    });

    it("resolves a retry's identifier through the alias table", async () => {
      const original = candidate();
      await repository.start({ transaction: original });

      const retriedId = randomUUID();
      await repository.recordAlias({
        requestedTransactionId: retriedId,
        transactionId: original.transactionId,
      });

      await expect(repository.findById(retriedId)).resolves.toMatchObject({
        transactionId: original.transactionId,
      });
    });

    it('never writes an alias from a transaction to itself', async () => {
      const original = candidate();
      await repository.start({ transaction: original });

      await repository.recordAlias({
        requestedTransactionId: original.transactionId,
        transactionId: original.transactionId,
      });

      const aliases = await pool.query('SELECT count(*)::INT AS n FROM transaction_aliases');

      expect(aliases.rows[0].n).toBe(0);
    });
  });

  describe('two Saga events arriving at once', () => {
    /**
     * The reason `SELECT ... FOR UPDATE` is in this repository. Both events are
     * legal from `PAYMENT_PENDING` and they lead to opposite endings; without
     * the lock both would read the same row and both would be applied.
     */
    it('lets exactly one of a credit and a payment failure win', async () => {
      const transaction = await seedDebiting();

      await repository.applyEvent({
        transactionId: transaction.transactionId,
        messageId: randomUUID(),
        messageType: 'account.debited.v1',
        payload: {},
        decide: (found) => applyEvent(found, { kind: 'DEBITED' }),
        now: NOW,
      });

      const [credited, failed] = await Promise.all([
        repository.applyEvent({
          transactionId: transaction.transactionId,
          messageId: randomUUID(),
          messageType: 'account.credited.v1',
          payload: {},
          decide: (found) => applyEvent(found, { kind: 'CREDITED' }),
          now: NOW,
        }),
        repository.applyEvent({
          transactionId: transaction.transactionId,
          messageId: randomUUID(),
          messageType: 'payment.failed.v1',
          payload: { paymentId: randomUUID(), failureReason: 'PAYMENT_DECLINED' },
          decide: (found) =>
            applyEvent(found, { kind: 'PAYMENT_FAILED', reason: 'PAYMENT_DECLINED' }),
          now: NOW,
        }),
      ]);

      const kinds = [credited.kind, failed.kind].sort();

      // Whichever arrives second finds a state the other one has moved on from.
      expect(kinds).toEqual(['APPLIED', 'ILLEGAL']);

      const stored = await repository.findById(transaction.transactionId);

      expect(['COMPLETED', 'PAYMENT_PENDING']).toContain(stored!.status);
    });

    /** T-5, as a primary key rather than as a hope about timing. */
    it('applies a redelivered event exactly once', async () => {
      const transaction = await seedDebiting();
      const messageId = randomUUID();

      const deliveries = await Promise.all(
        [1, 2, 3].map(async () =>
          repository.applyEvent({
            transactionId: transaction.transactionId,
            messageId,
            messageType: 'account.debited.v1',
            payload: {},
            decide: (found) => applyEvent(found, { kind: 'DEBITED' }),
            now: NOW,
          }),
        ),
      );

      expect(deliveries.filter((outcome) => outcome.kind === 'APPLIED')).toHaveLength(1);
      expect(deliveries.filter((outcome) => outcome.kind === 'DUPLICATE')).toHaveLength(2);

      const events = await pool.query(
        `SELECT count(*)::INT AS n FROM transaction_events
          WHERE transaction_id = $1 AND event_type = 'account.debited.v1'`,
        [transaction.transactionId],
      );

      expect(events.rows[0].n).toBe(1);
    });
  });

  describe('an event with no place here', () => {
    /** T-6: discarded **and recorded**, with the state left alone. */
    it('records the discard and changes nothing', async () => {
      const transaction = await seedDebiting();

      const outcome = await repository.applyEvent({
        transactionId: transaction.transactionId,
        messageId: randomUUID(),
        messageType: 'account.credited.v1',
        payload: {},
        decide: (found) => applyEvent(found, { kind: 'CREDITED' }),
        now: NOW,
      });

      expect(outcome).toMatchObject({ kind: 'ILLEGAL', from: 'DEBITING' });

      const stored = await repository.findById(transaction.transactionId);

      expect(stored!.status).toBe('DEBITING');

      const discarded = await pool.query(
        `SELECT payload FROM transaction_events
          WHERE transaction_id = $1 AND event_type = 'account.credited.v1#discarded'`,
        [transaction.transactionId],
      );

      expect(discarded.rows[0].payload).toMatchObject({ reason: 'ILLEGAL_TRANSITION' });
    });

    it('claims nothing for an event about a transaction it does not hold', async () => {
      const outcome = await repository.applyEvent({
        transactionId: randomUUID(),
        messageId: randomUUID(),
        messageType: 'account.debited.v1',
        payload: {},
        decide: (found) => applyEvent(found, { kind: 'DEBITED' }),
        now: NOW,
      });

      expect(outcome).toEqual({ kind: 'UNKNOWN_TRANSACTION' });

      const claimed = await pool.query('SELECT count(*)::INT AS n FROM processed_messages');

      expect(claimed.rows[0].n).toBe(0);
    });
  });

  describe('what the column refuses on its own', () => {
    /**
     * The last line of defence. The domain refuses these first and the state
     * machine makes that refusal hold; this makes it hold even if both are
     * wrong.
     */
    it('refuses a status the state machine does not know', async () => {
      const { transaction } = await repository.start({ transaction: candidate() });

      await expect(
        pool.query('UPDATE transactions SET status = $2 WHERE transaction_id = $1', [
          transaction.transactionId,
          'REFUNDED',
        ]),
      ).rejects.toThrow(/transactions_status_known/);
    });

    it('refuses a transfer to the account it came from', async () => {
      const same = randomUUID();

      await expect(
        repository.start({
          transaction: candidate({ sourceAccount: same, targetAccount: same }),
        }),
      ).rejects.toThrow(/transactions_accounts_differ/);
    });

    it('refuses an amount that is not one', async () => {
      await expect(
        repository.start({ transaction: candidate({ amount: quetzales(0) }) }),
      ).rejects.toThrow(/transactions_amount_positive/);
    });
  });

  describe('the payment half of the trail', () => {
    it('folds the ordered payment and its verdict into one answer', async () => {
      const transaction = await seedDebiting();
      const paymentId = randomUUID();

      await repository.recordCommand({
        transactionId: transaction.transactionId,
        messageType: 'payment.requested.v1',
        payload: { paymentId, transactionId: transaction.transactionId },
      });

      await expect(repository.paymentOutcomeOf(transaction.transactionId)).resolves.toMatchObject({
        paymentId,
        status: 'PENDING',
        attempt: null,
      });

      await repository.applyEvent({
        transactionId: transaction.transactionId,
        messageId: randomUUID(),
        messageType: 'account.debited.v1',
        payload: {},
        decide: (found) => applyEvent(found, { kind: 'DEBITED' }),
        now: NOW,
      });

      await repository.applyEvent({
        transactionId: transaction.transactionId,
        messageId: randomUUID(),
        messageType: 'payment.failed.v1',
        payload: {
          paymentId,
          attempt: 3,
          failureReason: 'PAYMENT_RETRIES_EXHAUSTED',
          failedAt: '2026-08-26T12:00:30.000Z',
        },
        decide: (found) =>
          applyEvent(found, { kind: 'PAYMENT_FAILED', reason: 'PAYMENT_RETRIES_EXHAUSTED' }),
        now: NOW,
      });

      await expect(repository.paymentOutcomeOf(transaction.transactionId)).resolves.toEqual({
        paymentId,
        status: 'FAILED',
        attempt: 3,
        reason: 'PAYMENT_RETRIES_EXHAUSTED',
        decidedAt: new Date('2026-08-26T12:00:30.000Z'),
      });
    });

    it('says nothing rather than something when no payment was ever ordered', async () => {
      const transaction = await seedDebiting();

      await expect(repository.paymentOutcomeOf(transaction.transactionId)).resolves.toBeNull();
    });
  });

  describe('finding a transfer', () => {
    it('finds it by the correlation it was created under', async () => {
      const original = candidate();
      await repository.start({ transaction: original });

      await expect(repository.findByCorrelationId(original.correlationId)).resolves.toMatchObject({
        transactionId: original.transactionId,
      });
    });

    it('answers null for an identifier that names nothing', async () => {
      await expect(repository.findById(randomUUID())).resolves.toBeNull();
      await expect(repository.findByCorrelationId(randomUUID())).resolves.toBeNull();
    });
  });
});
