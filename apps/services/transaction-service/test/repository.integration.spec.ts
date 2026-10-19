import { randomUUID } from 'node:crypto';

import { EXCHANGES, createEnvelope, routingKeyFor } from '@bank/contracts';
import { trace } from '@opentelemetry/api';
import { BasicTracerProvider, InMemorySpanExporter, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { Pool } from 'pg';

import { AdvanceSagaUseCase } from '../src/application/advance-saga.use-case';
import type { AppliedEffects, OutboxMessage } from '../src/application/ports';
import { RequestTransferUseCase } from '../src/application/request-transfer.use-case';
import { applyEvent, openTransaction } from '../src/domain/transaction';
import type { Transaction, Transition } from '../src/domain/transaction';
import { quetzales } from '../src/domain/money';
import { migrate } from '../src/infrastructure/persistence/migrations';
import { PostgresTransactionRepository } from '../src/infrastructure/persistence/postgres-transaction.repository';
import { OtelTransferTelemetry } from '../src/infrastructure/telemetry/otel-transfer.telemetry';
import { FixedClock, RecordingPublisher, SequentialIds } from './support/in-memory';

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
      'TRUNCATE outbox_messages, transaction_aliases, transaction_events, transaction_transitions, ' +
        'transactions, processed_messages',
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
      messageType: 'customer.kyc.checked.v1',
      payload: {},
      decide: (found) => applyEvent(found, { kind: 'KYC_APPROVED' }),
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
        errorType: null,
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
     * The debit command a `KYC_APPROVED` transition implies, shaped exactly as
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
        decide: (found: Transaction): Transition => applyEvent(found, { kind: 'KYC_APPROVED' }),
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

    /**
     * `start`'s own outbox write — `transaction.initiated.v1`, moved off the
     * direct-publish path it used to take. Same guarantee as `applyEvent`'s:
     * the row exists in the same transaction as the insert that created it, or
     * not at all.
     */
    it('writes the outbox row in the same transaction as the insert', async () => {
      const opened = candidate();

      await repository.start({
        transaction: opened,
        outbound: (created) => ({
          exchange: EXCHANGES.events,
          routingKey: routingKeyFor('transaction.initiated.v1'),
          envelope: createEnvelope(
            { transactionId: created.transactionId, status: 'PENDING' },
            { messageType: 'transaction.initiated.v1', producer: 'transaction-service', identity: null },
          ),
        }),
      });

      const rows = await pool.query<{ routing_key: string }>(
        'SELECT routing_key FROM outbox_messages WHERE transaction_id = $1',
        [opened.transactionId],
      );

      expect(rows.rows).toHaveLength(1);
      expect(rows.rows[0]!.routing_key).toBe(routingKeyFor('transaction.initiated.v1'));
    });

    /**
     * The delivery that loses the idempotency race never calls `outbound`, so
     * `transaction.initiated.v1` is never announced twice for one transfer.
     */
    it('writes no outbox row for the delivery that finds the key already used', async () => {
      const key = randomUUID();
      let calls = 0;

      const outbound = (created: Transaction): OutboxMessage => {
        calls += 1;

        return {
          exchange: EXCHANGES.events,
          routingKey: routingKeyFor('transaction.initiated.v1'),
          envelope: createEnvelope(
            { transactionId: created.transactionId, status: 'PENDING' },
            { messageType: 'transaction.initiated.v1', producer: 'transaction-service', identity: null },
          ),
        };
      };

      const first = await repository.start({
        transaction: candidate({ idempotencyKey: key }),
        outbound,
      });
      const second = await repository.start({
        transaction: candidate({ idempotencyKey: key }),
        outbound,
      });

      expect(first.kind).toBe('CREATED');
      expect(second.kind).toBe('EXISTS');
      expect(calls).toBe(1);

      const rows = await pool.query<{ n: number }>(
        'SELECT count(*)::INT AS n FROM outbox_messages WHERE transaction_id = $1',
        [first.transaction.transactionId],
      );

      expect(rows.rows[0]!.n).toBe(1);
    });
  });

  describe('recording one rung of the retry ladder', () => {
    it('writes the attempt into the local trail', async () => {
      const transaction = await seedDebiting();

      const outcome = await repository.recordPaymentAttempt({
        transactionId: transaction.transactionId,
        messageId: randomUUID(),
        messageType: 'payment.attempt.failed.v1',
        payload: { paymentId: randomUUID(), attempt: 1, errorType: 'TRANSIENT' },
      });

      expect(outcome).toMatchObject({ kind: 'RECORDED' });

      const rows = await pool.query(
        `SELECT payload FROM transaction_events
          WHERE transaction_id = $1 AND event_type = 'payment.attempt.failed.v1'`,
        [transaction.transactionId],
      );

      expect(rows.rows).toHaveLength(1);
      expect(rows.rows[0]!.payload).toMatchObject({ attempt: 1, errorType: 'TRANSIENT' });

      // Never a transition: recording an attempt leaves the Saga untouched.
      const stored = await repository.findById(transaction.transactionId);

      expect(stored!.status).toBe('DEBITING');
    });

    /** T-5: a redelivered attempt writes no second row. */
    it('claims a redelivered attempt exactly once', async () => {
      const transaction = await seedDebiting();
      const messageId = randomUUID();

      const first = await repository.recordPaymentAttempt({
        transactionId: transaction.transactionId,
        messageId,
        messageType: 'payment.attempt.failed.v1',
        payload: { paymentId: randomUUID(), attempt: 1 },
      });
      const second = await repository.recordPaymentAttempt({
        transactionId: transaction.transactionId,
        messageId,
        messageType: 'payment.attempt.failed.v1',
        payload: { paymentId: randomUUID(), attempt: 1 },
      });

      expect(first).toMatchObject({ kind: 'RECORDED' });
      expect(second).toEqual({ kind: 'DUPLICATE' });

      const rows = await pool.query<{ n: number }>(
        `SELECT count(*)::INT AS n FROM transaction_events
          WHERE transaction_id = $1 AND event_type = 'payment.attempt.failed.v1'`,
        [transaction.transactionId],
      );

      expect(rows.rows[0]!.n).toBe(1);
    });

    it('claims nothing for an attempt about a transaction it does not hold', async () => {
      const outcome = await repository.recordPaymentAttempt({
        transactionId: randomUUID(),
        messageId: randomUUID(),
        messageType: 'payment.attempt.failed.v1',
        payload: { paymentId: randomUUID(), attempt: 1 },
      });

      expect(outcome).toEqual({ kind: 'UNKNOWN_TRANSACTION' });

      const claimed = await pool.query('SELECT count(*)::INT AS n FROM processed_messages');

      expect(claimed.rows[0].n).toBe(0);
    });
  });

  describe('resuming a transfer that crashed before its Saga started', () => {
    /**
     * Reproduces the crash directly against a real lock: `start` committed the
     * row, and nothing ever called `applyEvent` for `KYC_CHECK_ORDERED` —
     * exactly what a process death between the two leaves behind.
     */
    async function crashed(): Promise<Transaction> {
      const { transaction } = await repository.start({ transaction: candidate() });

      return transaction;
    }

    it('lets the first resume order the KYC check', async () => {
      const transaction = await crashed();

      const outcome = await repository.applyEvent({
        transactionId: transaction.transactionId,
        messageId: randomUUID(),
        messageType: 'transfer.requested.v1',
        payload: {},
        decide: (found) => applyEvent(found, { kind: 'KYC_CHECK_ORDERED' }),
        now: NOW,
      });

      expect(outcome.kind).toBe('APPLIED');

      const stored = await repository.findById(transaction.transactionId);

      // A self-transition: the gate is asked, but nothing has answered yet.
      expect(stored!.status).toBe('PENDING');
    });

    /**
     * The common case: the broker redelivers the exact same message. Proves
     * the claim `RequestTransferUseCase` relies on — that `messageId`
     * deduplication alone makes the resume safe against an ordinary retry.
     */
    it('makes a same-messageId redelivery of the resume a no-op', async () => {
      const transaction = await crashed();
      const messageId = randomUUID();

      const resume = (): Promise<unknown> =>
        repository.applyEvent({
          transactionId: transaction.transactionId,
          messageId,
          messageType: 'transfer.requested.v1',
          payload: {},
          decide: (found) => applyEvent(found, { kind: 'KYC_CHECK_ORDERED' }),
          now: NOW,
        });

      const first = await resume();
      const second = await resume();

      expect((first as { kind: string }).kind).toBe('APPLIED');
      expect((second as { kind: string }).kind).toBe('DUPLICATE');
    });

    /**
     * Two *different* deliveries (different `messageId`s) racing to resume the
     * same transfer both succeed here, and that is correct rather than a gap:
     * `KYC_CHECK_ORDERED` is a self-transition that asks a question, not one
     * that moves money, so asking it twice produces two identical questions
     * rather than two effects. The guard that matters — never ordering a
     * second debit — lives one step later, on the gate's answer.
     */
    it('lets two different deliveries both re-ask the KYC gate harmlessly', async () => {
      const transaction = await crashed();

      const [first, second] = await Promise.all([
        repository.applyEvent({
          transactionId: transaction.transactionId,
          messageId: randomUUID(),
          messageType: 'transfer.requested.v1',
          payload: {},
          decide: (found) => applyEvent(found, { kind: 'KYC_CHECK_ORDERED' }),
          now: NOW,
        }),
        repository.applyEvent({
          transactionId: transaction.transactionId,
          messageId: randomUUID(),
          messageType: 'transfer.requested.v1',
          payload: {},
          decide: (found) => applyEvent(found, { kind: 'KYC_CHECK_ORDERED' }),
          now: NOW,
        }),
      ]);

      const kinds = [first.kind, second.kind].sort();

      expect(kinds).toEqual(['APPLIED', 'APPLIED']);
    });

    /**
     * The edge case the old debit-ordering guard used to cover, now one step
     * later: two different deliveries of the gate's own answer racing to move
     * the same transfer out of `PENDING`. The row lock serialises them, and
     * the domain's own `PENDING`-only guard on `KYC_APPROVED` — not the
     * `messageId` dedup — is what stops the second one from ordering a second
     * debit: it finds the row already `DEBITING` and is refused as `ILLEGAL`,
     * discarded and recorded, never applied.
     */
    it('refuses a second debit even when two different KYC verdicts race the resume', async () => {
      const transaction = await crashed();

      const [first, second] = await Promise.all([
        repository.applyEvent({
          transactionId: transaction.transactionId,
          messageId: randomUUID(),
          messageType: 'customer.kyc.checked.v1',
          payload: {},
          decide: (found) => applyEvent(found, { kind: 'KYC_APPROVED' }),
          now: NOW,
        }),
        repository.applyEvent({
          transactionId: transaction.transactionId,
          messageId: randomUUID(),
          messageType: 'customer.kyc.checked.v1',
          payload: {},
          decide: (found) => applyEvent(found, { kind: 'KYC_APPROVED' }),
          now: NOW,
        }),
      ]);

      const kinds = [first.kind, second.kind].sort();

      expect(kinds).toEqual(['APPLIED', 'ILLEGAL']);

      const stored = await repository.findById(transaction.transactionId);

      // Exactly one debit ordered, whichever delivery won the race.
      expect(stored!.status).toBe('DEBITING');
    });
  });

  describe('the real history, as a fact about the database (T-28)', () => {
    it('writes the opening row from start(), with a null from_status and message_id', async () => {
      const transaction = candidate();
      await repository.start({ transaction });

      const rows = await repository.transitionsOf(transaction.transactionId);

      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ from: null, to: 'PENDING', event: 'transfer.requested.v1' });
    });

    it('writes no second opening row for a retried idempotency key', async () => {
      const transaction = candidate();
      await repository.start({ transaction });
      await repository.start({ transaction }); // same idempotency_key: loses the race

      const rows = await repository.transitionsOf(transaction.transactionId);

      expect(rows).toHaveLength(1);
    });

    it('writes one row per applied transition, self-transitions on PAYMENT_PENDING included', async () => {
      const transaction = await seedDebiting();

      await repository.applyEvent({
        transactionId: transaction.transactionId,
        messageId: randomUUID(),
        messageType: 'account.debited.v1',
        payload: {},
        decide: (found) => applyEvent(found, { kind: 'DEBITED' }),
        now: NOW,
      });

      // PAYMENT_SUCCEEDED is a self-transition: PAYMENT_PENDING -> PAYMENT_PENDING.
      // It is the one that orders the credit, and a history without it could not
      // explain a transfer that later shows as compensated.
      await repository.applyEvent({
        transactionId: transaction.transactionId,
        messageId: randomUUID(),
        messageType: 'payment.succeeded.v1',
        payload: {},
        decide: (found) => applyEvent(found, { kind: 'PAYMENT_SUCCEEDED' }),
        now: NOW,
      });

      const rows = await repository.transitionsOf(transaction.transactionId);

      expect(rows.map((row) => `${row.from ?? '—'}->${row.to}`)).toEqual([
        '—->PENDING',
        'PENDING->DEBITING',
        'DEBITING->PAYMENT_PENDING',
        'PAYMENT_PENDING->PAYMENT_PENDING',
      ]);
    });

    it('writes no transition row for a redelivered messageId (T-5)', async () => {
      const transaction = await seedDebiting();
      const messageId = randomUUID();

      await repository.applyEvent({
        transactionId: transaction.transactionId,
        messageId,
        messageType: 'account.debited.v1',
        payload: {},
        decide: (found) => applyEvent(found, { kind: 'DEBITED' }),
        now: NOW,
      });
      await repository.applyEvent({
        transactionId: transaction.transactionId,
        messageId, // same delivery again
        messageType: 'account.debited.v1',
        payload: {},
        decide: (found) => applyEvent(found, { kind: 'DEBITED' }),
        now: NOW,
      });

      const rows = await repository.transitionsOf(transaction.transactionId);

      // seedDebiting() already wrote the opening row and PENDING->DEBITING;
      // exactly one DEBITED transition follows, never two.
      expect(rows).toHaveLength(3);
    });

    /**
     * The unique index is a guard independent of `processed_messages` — this
     * proves it holds even if the application-level dedup were ever bypassed,
     * by writing the same (transaction_id, message_id) pair directly.
     */
    it('refuses a duplicate (transaction_id, message_id) at the database level', async () => {
      const transaction = await seedDebiting();
      const messageId = randomUUID();

      await pool.query(
        `INSERT INTO transaction_transitions
           (transaction_id, from_status, to_status, event_type, message_id)
         VALUES ($1, 'DEBITING', 'PAYMENT_PENDING', 'account.debited.v1', $2)`,
        [transaction.transactionId, messageId],
      );

      await expect(
        pool.query(
          `INSERT INTO transaction_transitions
             (transaction_id, from_status, to_status, event_type, message_id)
           VALUES ($1, 'DEBITING', 'PAYMENT_PENDING', 'account.debited.v1', $2)`,
          [transaction.transactionId, messageId],
        ),
      ).rejects.toThrow();
    });

    it('writes no transition row for an illegal transition, only the discard in transaction_events', async () => {
      const transaction = await seedDebiting();

      const outcome = await repository.applyEvent({
        transactionId: transaction.transactionId,
        messageId: randomUUID(),
        messageType: 'account.credited.v1',
        payload: {},
        // CREDITED is not legal from DEBITING.
        decide: (found) => applyEvent(found, { kind: 'CREDITED' }),
        now: NOW,
      });

      expect(outcome.kind).toBe('ILLEGAL');

      const rows = await repository.transitionsOf(transaction.transactionId);

      // Just what seedDebiting() wrote (opening + PENDING->DEBITING) — the
      // illegal CREDITED attempt left no transition behind.
      expect(rows).toHaveLength(2);
    });

    it('two Saga events racing on the same transaction write exactly one transition row each', async () => {
      const transaction = await seedDebiting();

      await repository.applyEvent({
        transactionId: transaction.transactionId,
        messageId: randomUUID(),
        messageType: 'account.debited.v1',
        payload: {},
        decide: (found) => applyEvent(found, { kind: 'DEBITED' }),
        now: NOW,
      });

      await Promise.all([
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

      const rows = await repository.transitionsOf(transaction.transactionId);

      // Opening + PENDING->DEBITING + DEBITED + exactly one of
      // {CREDITED, PAYMENT_FAILED} — never both.
      expect(rows).toHaveLength(4);
    });
  });

  describe('list(): date range and status filters, combinable (T-28)', () => {
    /**
     * Accepted at `createdAt`, and moved to DEBITING through the real
     * transition when asked.
     *
     * `candidate()`'s own overrides go into `openTransaction`'s *input*, which
     * only reads `now` — passing `createdAt`/`updatedAt` there is silently
     * ignored. Overriding them on the built object instead is what actually
     * reaches the row `start()` inserts.
     */
    async function seeded(advance: boolean, createdAt: Date): Promise<Transaction> {
      const transaction = { ...candidate(), createdAt, updatedAt: createdAt };
      await repository.start({ transaction });

      if (!advance) {
        return transaction;
      }

      const outcome = await repository.applyEvent({
        transactionId: transaction.transactionId,
        messageId: randomUUID(),
        messageType: 'customer.kyc.checked.v1',
        payload: {},
        decide: (found) => applyEvent(found, { kind: 'KYC_APPROVED' }),
        now: createdAt,
      });

      return outcome.kind === 'APPLIED' ? outcome.transaction : transaction;
    }

    it('filters by date range, both ends inclusive', async () => {
      const early = await seeded(false, new Date('2026-08-01T00:00:00.000Z'));
      await seeded(false, new Date('2026-08-20T00:00:00.000Z'));

      const { transactions } = await repository.list({
        ownerId: null,
        from: new Date('2026-08-01T00:00:00.000Z'),
        to: new Date('2026-08-01T00:00:00.000Z'),
        limit: 10,
      });

      expect(transactions.map((t) => t.transactionId)).toEqual([early.transactionId]);
    });

    it('filters by a set of statuses with ANY($n), combined with the date range', async () => {
      await seeded(false, new Date('2026-08-01T00:00:00.000Z'));
      const debiting = await seeded(true, new Date('2026-08-20T00:00:00.000Z'));

      const { transactions } = await repository.list({
        ownerId: null,
        statuses: ['DEBITING', 'PAYMENT_PENDING'],
        from: new Date('2026-08-10T00:00:00.000Z'),
        limit: 10,
      });

      expect(transactions.map((t) => t.transactionId)).toEqual([debiting.transactionId]);
    });
  });

  /**
   * El historial con filtros (Fase 2, §4.1 p. 6: "Consultar historial por
   * cuenta, Filtrar por fecha y estado").
   *
   * `listing-and-scope.spec.ts` ya prueba estas reglas contra un repositorio en
   * memoria, y ahi es donde menos valen: lo que decide el filtrado es el SQL
   * que arma `list()` — sus clausulas, su orden de parametros y como el
   * `ownerId` se combina con el `customerId` que pidio quien llama. Un doble en
   * memoria responde bien a una consulta que la base rechazaria.
   */
  describe('el historial y sus filtros, contra el SQL real', () => {
    const CLIENTE_A = randomUUID();
    const CLIENTE_B = randomUUID();
    const CUENTA = randomUUID();

    async function sembrar(overrides: Partial<Transaction> = {}): Promise<Transaction> {
      const { transaction } = (await repository.start({
        transaction: candidate(overrides),
      })) as { transaction: Transaction };
      return transaction;
    }

    it('filtra por cuenta mirando origen Y destino', async () => {
      await sembrar({ sourceAccount: CUENTA, customerId: CLIENTE_A });
      await sembrar({ targetAccount: CUENTA, customerId: CLIENTE_A });
      await sembrar({ customerId: CLIENTE_A });

      const { transactions } = await repository.list({
        ownerId: null,
        accountId: CUENTA,
        limit: 50,
      });

      // Dos: la que salio de la cuenta y la que entro. Una transferencia
      // aparece en el historial de las dos partes.
      expect(transactions).toHaveLength(2);
    });

    it('filtra por estado, resolviendo la lista que el phaseStatus abre', async () => {
      const completada = await sembrar({ customerId: CLIENTE_B });
      await repository.applyEvent({
        transactionId: completada.transactionId,
        messageId: randomUUID(),
        messageType: 'customer.kyc.checked.v1',
        payload: {},
        decide: (found) => applyEvent(found, { kind: 'KYC_APPROVED' }),
        now: NOW,
      });
      await sembrar({ customerId: CLIENTE_B });

      const { transactions } = await repository.list({
        ownerId: null,
        customerId: CLIENTE_B,
        statuses: ['PENDING'],
        limit: 50,
      });

      // La que avanzo a DEBITING ya no es PENDING; el filtro la deja fuera.
      expect(transactions.every((t) => t.status === 'PENDING')).toBe(true);
    });

    it('acota por rango de fechas, incluyendo los extremos', async () => {
      const dentro = await sembrar({ customerId: CLIENTE_A });

      const antes = new Date(NOW.getTime() - 60_000);
      const despues = new Date(NOW.getTime() + 60_000);

      const conRango = await repository.list({
        ownerId: null,
        customerId: CLIENTE_A,
        from: antes,
        to: despues,
        limit: 50,
      });
      const fueraDeRango = await repository.list({
        ownerId: null,
        customerId: CLIENTE_A,
        from: despues,
        limit: 50,
      });

      expect(conRango.transactions.map((t) => t.transactionId)).toContain(dentro.transactionId);
      expect(fueraDeRango.transactions).toHaveLength(0);
    });

    it('devuelve vacio, nunca ensanchado, cuando el alcance y el filtro se contradicen', async () => {
      await sembrar({ customerId: CLIENTE_A });

      // Un CLIENTE pidiendo el historial de otro: el `ownerId` es lo que puede
      // y el `customerId` lo que pidio. Dos condiciones contradictorias sobre
      // la misma columna dan cero filas — que es exactamente lo que debe pasar,
      // y la razon por la que son clausulas separadas en vez de una sola.
      const { transactions, total } = await repository.list({
        ownerId: CLIENTE_B,
        customerId: CLIENTE_A,
        limit: 50,
      });

      expect(transactions).toHaveLength(0);
      expect(total).toBe(0);
    });

    it('cuenta el total completo aunque el limite recorte la pagina', async () => {
      const cliente = randomUUID();
      for (let i = 0; i < 4; i += 1) {
        await sembrar({ customerId: cliente });
      }

      const { transactions, total } = await repository.list({
        ownerId: null,
        customerId: cliente,
        limit: 2,
      });

      // `total` responde "cuantas hay", no "cuantas te di": sin eso, una
      // interfaz paginada no puede decir cuantas faltan.
      expect(transactions).toHaveLength(2);
      expect(total).toBe(4);
    });
  });

  /**
   * T-43, against a real database: the columns the telemetry needs, the trace a
   * later step joins, and the real use cases producing real spans from them.
   * What these prove cannot be shown with a double: that the context is written
   * in the same insert as the row, that it survives the round trip through the
   * row lock, and that a row from before migration 010 still works.
   */
  describe('the observability of a transfer (T-43)', () => {
    const TRACEPARENT = '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01';
    const SECOND = 1_000;

    const row = async (transactionId: string) =>
      (
        await pool.query<{ requested_at: Date | null; trace_context: string | null; created_at: Date }>(
          'SELECT requested_at, trace_context, created_at FROM transactions WHERE transaction_id = $1',
          [transactionId],
        )
      ).rows[0]!;

    it('stores the request timestamp and the trace context in the same insert as the transfer', async () => {
      const requestedAt = new Date(NOW.getTime() - 1_500);
      const { transaction } = await repository.start({
        transaction: candidate(),
        requestedAt,
        traceContext: TRACEPARENT,
      });

      const stored = await row(transaction.transactionId);

      expect(stored.requested_at?.toISOString()).toBe(requestedAt.toISOString());
      expect(stored.trace_context).toBe(TRACEPARENT);
    });

    it('falls back to the creation time, and to no trace, when it is not given', async () => {
      const { transaction } = await repository.start({ transaction: candidate() });

      const outcome = await repository.applyEvent({
        transactionId: transaction.transactionId,
        messageId: randomUUID(),
        messageType: 'customer.kyc.checked.v1',
        payload: {},
        decide: (found) => applyEvent(found, { kind: 'KYC_APPROVED' }),
        now: NOW,
      });

      expect(outcome).toMatchObject({
        kind: 'APPLIED',
        observation: { requestedAt: NOW, traceContext: null },
      });
    });

    it('hands back the stored trace with every applied transition', async () => {
      const requestedAt = new Date(NOW.getTime() - 2_000);
      const { transaction } = await repository.start({
        transaction: candidate(),
        requestedAt,
        traceContext: TRACEPARENT,
      });

      const outcome = await repository.applyEvent({
        transactionId: transaction.transactionId,
        messageId: randomUUID(),
        messageType: 'customer.kyc.checked.v1',
        payload: {},
        decide: (found) => applyEvent(found, { kind: 'KYC_APPROVED' }),
        now: NOW,
      });

      expect(outcome.kind).toBe('APPLIED');
      expect(
        outcome.kind === 'APPLIED' && outcome.observation.requestedAt.toISOString(),
      ).toBe(requestedAt.toISOString());
      expect(outcome.kind === 'APPLIED' && outcome.observation.traceContext).toBe(TRACEPARENT);
    });

    it('hands the same trace back with a payment attempt, which is not a transition', async () => {
      const { transaction } = await repository.start({
        transaction: candidate(),
        traceContext: TRACEPARENT,
      });

      const outcome = await repository.recordPaymentAttempt({
        transactionId: transaction.transactionId,
        messageId: randomUUID(),
        messageType: 'payment.attempt.failed.v1',
        payload: { attempt: 1 },
      });

      expect(outcome).toMatchObject({
        kind: 'RECORDED',
        observation: { traceContext: TRACEPARENT },
      });
    });

    it('still works for a row from before migration 010, which has neither column', async () => {
      const { transaction } = await repository.start({ transaction: candidate() });
      await pool.query(
        'UPDATE transactions SET requested_at = NULL, trace_context = NULL WHERE transaction_id = $1',
        [transaction.transactionId],
      );

      const outcome = await repository.applyEvent({
        transactionId: transaction.transactionId,
        messageId: randomUUID(),
        messageType: 'customer.kyc.checked.v1',
        payload: {},
        decide: (found) => applyEvent(found, { kind: 'KYC_APPROVED' }),
        now: NOW,
      });

      expect(outcome).toMatchObject({
        kind: 'APPLIED',
        observation: { requestedAt: transaction.createdAt, traceContext: null },
      });
    });

    it('keeps the observation out of a duplicate, which is not a step', async () => {
      const { transaction } = await repository.start({
        transaction: candidate(),
        traceContext: TRACEPARENT,
      });
      const messageId = randomUUID();
      const apply = async () =>
        await repository.applyEvent({
          transactionId: transaction.transactionId,
          messageId,
          messageType: 'customer.kyc.checked.v1',
          payload: {},
          decide: (found) => applyEvent(found, { kind: 'KYC_APPROVED' }),
          now: NOW,
        });

      expect((await apply()).kind).toBe('APPLIED');
      expect((await apply()).kind).toBe('DUPLICATE');
    });

    it('produces one trace, one duration and one result through the real use cases', async () => {
      const spans = new InMemorySpanExporter();
      const provider = new BasicTracerProvider({ spanProcessors: [new SimpleSpanProcessor(spans)] });
      trace.setGlobalTracerProvider(provider);

      const publisher = new RecordingPublisher();
      const clock = new FixedClock(NOW);
      const telemetry = new OtelTransferTelemetry({ info: () => undefined, error: () => undefined });
      const saga = new AdvanceSagaUseCase({
        repository,
        publisher,
        clock,
        ids: new SequentialIds(),
        telemetry,
      });
      const request = new RequestTransferUseCase({ repository, publisher, saga, clock, telemetry });

      const transactionId = randomUUID();
      const customerId = randomUUID();
      await request.execute(
        {
          transactionId,
          sourceAccount: randomUUID(),
          targetAccount: randomUUID(),
          amount: quetzales(15_000),
        },
        {
          messageId: randomUUID(),
          correlationId: randomUUID(),
          idempotencyKey: randomUUID(),
          identity: { customerId, role: 'CLIENTE' },
          occurredAt: NOW.toISOString(),
        },
      );

      const deliver = async (event: Parameters<typeof applyEvent>[1], afterSeconds: number) => {
        clock.advance(NOW.getTime() + afterSeconds * SECOND - clock.now().getTime());
        await saga.execute({
          transactionId,
          event,
          messageId: randomUUID(),
          messageType: 'test.event',
          payload: {},
        });
      };

      await deliver({ kind: 'KYC_APPROVED' }, 1);
      await deliver({ kind: 'DEBITED' }, 2);
      await deliver({ kind: 'PAYMENT_FAILED', reason: 'PAYMENT_DECLINED' }, 3);
      await deliver({ kind: 'DEBIT_COMPENSATED' }, 4);

      const finished = spans.getFinishedSpans();
      const root = finished.find((span) => span.name === 'transfer.requested')!;
      const stored = await row(transactionId);

      // The context in the database is the root span's, and every later span joined it.
      expect(stored.trace_context).toBe(
        `00-${root.spanContext().traceId}-${root.spanContext().spanId}-01`,
      );
      expect(new Set(finished.map((span) => span.spanContext().traceId)).size).toBe(1);
      expect(finished.map((span) => span.name)).toEqual([
        'transfer.requested',
        'saga.step KYC_CHECK_ORDERED',
        'saga.step KYC_APPROVED',
        'saga.step DEBITED',
        'saga.compensation ordered',
        'saga.compensation completed',
        'transfer',
      ]);
      expect(finished.at(-1)!.attributes['bank.transfer.duration_ms']).toBe(4_000);
      expect(finished.at(-1)!.events.map((event) => event.name)).toEqual(['PENDING', 'FAILED']);
    });
  });
});
