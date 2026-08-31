import { randomUUID } from 'node:crypto';

import { EXCHANGES, createEnvelope, routingKeyFor } from '@bank/contracts';
import { Pool } from 'pg';

import type { AppliedEffects, OutboxMessage } from '../src/application/ports';
import { applyEvent, openTransaction } from '../src/domain/transaction';
import type { Transaction, Transition } from '../src/domain/transaction';
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
      'TRUNCATE outbox_messages, transaction_aliases, transaction_events, transactions, processed_messages',
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
      customerId: null,
      reference: null,
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

  describe('the transactional outbox (TD-031)', () => {
    /**
     * The debit command a `DEBIT_ORDERED` transition implies, shaped exactly as
     * the Saga builds it: the whole envelope, on the commands exchange, ready to
     * be republished byte-for-byte.
     */
    const debitOutbound = (transaction: Transaction): AppliedEffects => ({
      dispatch: [
        {
          exchange: EXCHANGES.commands,
          routingKey: routingKeyFor('account.debit.requested.v1'),
          envelope: createEnvelope(
            {
              transactionId: transaction.transactionId,
              accountId: transaction.sourceAccount,
              amount: transaction.amount,
            },
            {
              messageType: 'account.debit.requested.v1',
              producer: 'transaction-service',
              identity: null,
            },
          ),
        },
      ],
      trail: [],
    });

    const orderDebit = (transactionId: string, messageId: string): Promise<unknown> =>
      repository.applyEvent({
        transactionId,
        messageId,
        messageType: 'transfer.requested.v1',
        payload: {},
        decide: (found: Transaction): Transition => applyEvent(found, { kind: 'DEBIT_ORDERED' }),
        outbound: (transaction) => debitOutbound(transaction),
        now: NOW,
      });

    const pendingCount = async (): Promise<number> => {
      const rows = await pool.query<{ n: number }>(
        `SELECT count(*)::INT AS n FROM outbox_messages WHERE dispatch_status = 'PENDING'`,
      );

      return rows.rows[0]!.n;
    };

    it('writes the outbox row in the same transaction as the state change', async () => {
      const { transaction } = await repository.start({ transaction: candidate() });

      await orderDebit(transaction.transactionId, randomUUID());

      const rows = await pool.query<{ dispatch_status: string; routing_key: string }>(
        'SELECT dispatch_status, routing_key FROM outbox_messages WHERE transaction_id = $1',
        [transaction.transactionId],
      );

      expect(rows.rows).toHaveLength(1);
      expect(rows.rows[0]!.dispatch_status).toBe('PENDING');
      expect(rows.rows[0]!.routing_key).toBe(routingKeyFor('account.debit.requested.v1'));
    });

    it('writes no outbox row for a redelivery that was deduplicated', async () => {
      const { transaction } = await repository.start({ transaction: candidate() });
      const messageId = randomUUID();

      const first = await orderDebit(transaction.transactionId, messageId);
      const second = await orderDebit(transaction.transactionId, messageId);

      expect((first as { kind: string }).kind).toBe('APPLIED');
      expect((second as { kind: string }).kind).toBe('DUPLICATE');

      // The duplicate re-emits nothing: the outbox holds exactly one message.
      const rows = await pool.query<{ n: number }>(
        'SELECT count(*)::INT AS n FROM outbox_messages WHERE transaction_id = $1',
        [transaction.transactionId],
      );

      expect(rows.rows[0]!.n).toBe(1);
    });

    it('publishes each pending row exactly once and marks it dispatched', async () => {
      const { transaction } = await repository.start({ transaction: candidate() });
      await orderDebit(transaction.transactionId, randomUUID());

      const delivered: OutboxMessage[] = [];
      const deliver = async (message: OutboxMessage): Promise<void> => {
        delivered.push(message);
      };

      const first = await repository.dispatchPendingOutbox(deliver, 100);
      const second = await repository.dispatchPendingOutbox(deliver, 100);

      expect(first).toBe(1);
      expect(second).toBe(0); // nothing left PENDING — it is not sent twice
      expect(delivered).toHaveLength(1);
      expect(delivered[0]!.envelope.messageType).toBe('account.debit.requested.v1');
      expect(await pendingCount()).toBe(0);
    });

    it('republishes the same envelope byte-for-byte — messageId intact', async () => {
      const { transaction } = await repository.start({ transaction: candidate() });
      await orderDebit(transaction.transactionId, randomUUID());

      // What the Saga stored, before the relay ever runs.
      const stored = await pool.query<{ envelope: { messageId: string; idempotencyKey: string } }>(
        'SELECT envelope FROM outbox_messages WHERE transaction_id = $1',
        [transaction.transactionId],
      );
      const storedEnvelope = stored.rows[0]!.envelope;

      const delivered: OutboxMessage[] = [];
      await repository.dispatchPendingOutbox(async (m) => void delivered.push(m), 100);

      // The relay must not mint a fresh identity — that would defeat every
      // consumer's deduplication and let a redelivered relay double-apply.
      expect(delivered[0]!.envelope.messageId).toBe(storedEnvelope.messageId);
      expect(delivered[0]!.envelope.idempotencyKey).toBe(storedEnvelope.idempotencyKey);
    });

    it('leaves the row PENDING when the broker is away, and delivers it on recovery', async () => {
      const { transaction } = await repository.start({ transaction: candidate() });
      await orderDebit(transaction.transactionId, randomUUID());

      // The broker is down: every delivery throws, so the batch rolls back.
      await expect(
        repository.dispatchPendingOutbox(() => {
          throw new Error('broker unavailable');
        }, 100),
      ).rejects.toThrow('broker unavailable');

      // Nothing was lost: the message is still waiting to be sent.
      expect(await pendingCount()).toBe(1);

      // The broker is back. The same message is delivered, once.
      const delivered: OutboxMessage[] = [];
      const count = await repository.dispatchPendingOutbox(async (m) => void delivered.push(m), 100);

      expect(count).toBe(1);
      expect(delivered).toHaveLength(1);
      expect(await pendingCount()).toBe(0);
    });
  });
});
