import { randomUUID } from 'node:crypto';

import { EXCHANGES, createEnvelope, routingKeyFor } from '@bank/contracts';
import { Pool } from 'pg';

import type { AttemptResult, OutboxMessage } from '../src/application/ports';
import { quetzales } from '../src/domain/money';
import type { Payment } from '../src/domain/payment';
import { migrate } from '../src/infrastructure/persistence/migrations';
import { PostgresPaymentRepository } from '../src/infrastructure/persistence/postgres-payment.repository';

/**
 * The payment repository against a real PostgreSQL — the transactional outbox
 * (TD-047) and the guards around `open` are enforced by the database, and an
 * in-memory `Map` cannot prove either.
 *
 * Requires the local stack (`infra/docker`) and `DATABASE_URL`. Skipped
 * otherwise, so a clone with no Docker still runs a green suite and says which
 * tests it did not run.
 */

const DATABASE_URL = process.env.DATABASE_URL;
const describeIntegration = DATABASE_URL === undefined ? describe.skip : describe;

jest.setTimeout(30_000);

describeIntegration('PostgresPaymentRepository', () => {
  let pool: Pool;
  let repository: PostgresPaymentRepository;

  const NOW = new Date('2026-08-27T12:00:00.000Z');

  beforeAll(async () => {
    if (DATABASE_URL === undefined) {
      console.warn('Skipping payment integration tests: DATABASE_URL is not set.');

      return;
    }

    pool = new Pool({ connectionString: DATABASE_URL });
    await migrate(pool);
    repository = new PostgresPaymentRepository(pool);
  });

  afterAll(async () => {
    await pool?.end();
  });

  beforeEach(async () => {
    await pool.query('TRUNCATE outbox_messages, payment_attempts, payments');
  });

  const payment = (overrides: Partial<Payment> = {}): Payment => ({
    paymentId: randomUUID(),
    transactionId: randomUUID(),
    status: 'PENDING',
    amount: quetzales(15_000),
    attempt: null,
    errorType: null,
    failureReason: null,
    providerReference: null,
    scenario: null,
    originCorrelationId: randomUUID(),
    nextAttemptAt: NOW,
    createdAt: NOW,
    updatedAt: NOW,
    decidedAt: null,
    ...overrides,
  });

  /** A terminal-success result, and the event it implies, shaped as the use case builds them. */
  const succeed = (paid: Payment): { result: AttemptResult; outbound: () => readonly OutboxMessage[] } => ({
    result: {
      status: 'SUCCEEDED',
      errorType: null,
      failureReason: null,
      providerReference: randomUUID(),
      nextAttemptAt: null,
      attemptResult: 'SUCCEEDED',
      providerResult: 'SUCCESS',
    },
    outbound: () => [
      {
        exchange: EXCHANGES.events,
        routingKey: routingKeyFor('payment.succeeded.v1'),
        envelope: createEnvelope(
          {
            paymentId: paid.paymentId,
            transactionId: paid.transactionId,
            status: 'SUCCEEDED',
            attempt: 1,
            succeededAt: NOW.toISOString(),
          },
          { messageType: 'payment.succeeded.v1', producer: 'payment-service', identity: null },
        ),
      },
    ],
  });

  const attemptSucceeding = async (paid: Payment): Promise<void> => {
    const { result, outbound } = succeed(paid);

    await repository.attempt({
      paymentId: paid.paymentId,
      expectedAttempt: 1,
      now: NOW,
      decide: () => result,
      outbound,
    });
  };

  const pendingCount = async (): Promise<number> => {
    const rows = await pool.query<{ n: number }>(
      `SELECT count(*)::INT AS n FROM outbox_messages WHERE dispatch_status = 'PENDING'`,
    );

    return rows.rows[0]!.n;
  };

  describe('open', () => {
    it('treats a fresh paymentId for a transfer already being paid as already open (T031)', async () => {
      const transactionId = randomUUID();
      const first = payment({ transactionId });

      const created = await repository.open({ payment: first });
      expect(created.kind).toBe('CREATED');

      // A different paymentId, same transfer — the second unique key. Must not
      // crash into the DLQ; it is the same payment, read back.
      const second = payment({ transactionId });
      const outcome = await repository.open({ payment: second });

      expect(outcome.kind).toBe('EXISTS');
      expect(outcome.payment.paymentId).toBe(first.paymentId);

      const count = await pool.query<{ n: number }>('SELECT count(*)::INT AS n FROM payments');
      expect(count.rows[0]!.n).toBe(1);
    });

    it('treats a redelivery of the same paymentId as already open', async () => {
      const paid = payment();
      await repository.open({ payment: paid });

      const outcome = await repository.open({ payment: paid });

      expect(outcome.kind).toBe('EXISTS');
      expect(outcome.payment.paymentId).toBe(paid.paymentId);
    });
  });

  describe('the transactional outbox (TD-047)', () => {
    it('writes the event to the outbox in the same transaction as the attempt', async () => {
      const paid = payment();
      await repository.open({ payment: paid });

      await attemptSucceeding(paid);

      const rows = await pool.query<{ dispatch_status: string; routing_key: string }>(
        'SELECT dispatch_status, routing_key FROM outbox_messages WHERE payment_id = $1',
        [paid.paymentId],
      );

      expect(rows.rows).toHaveLength(1);
      expect(rows.rows[0]!.dispatch_status).toBe('PENDING');
      expect(rows.rows[0]!.routing_key).toBe(routingKeyFor('payment.succeeded.v1'));
    });

    it('writes no outbox row for a superseded attempt', async () => {
      const paid = payment();
      await repository.open({ payment: paid });
      await attemptSucceeding(paid); // now SUCCEEDED, not PENDING

      // A second attempt with the same expected number is superseded — the
      // payment is already settled — and must enqueue nothing.
      const superseded = await repository.attempt({
        paymentId: paid.paymentId,
        expectedAttempt: 1,
        now: NOW,
        decide: () => succeed(paid).result,
        outbound: () => succeed(paid).outbound(),
      });

      expect(superseded.kind).toBe('SUPERSEDED');

      const rows = await pool.query<{ n: number }>(
        'SELECT count(*)::INT AS n FROM outbox_messages WHERE payment_id = $1',
        [paid.paymentId],
      );
      expect(rows.rows[0]!.n).toBe(1); // only the first attempt's event
    });

    it('publishes each pending row exactly once and marks it dispatched', async () => {
      const paid = payment();
      await repository.open({ payment: paid });
      await attemptSucceeding(paid);

      const delivered: OutboxMessage[] = [];
      const deliver = async (message: OutboxMessage): Promise<void> => {
        delivered.push(message);
      };

      const first = await repository.dispatchPendingOutbox(deliver, 100);
      const second = await repository.dispatchPendingOutbox(deliver, 100);

      expect(first).toBe(1);
      expect(second).toBe(0);
      expect(delivered).toHaveLength(1);
      expect(delivered[0]!.envelope.messageType).toBe('payment.succeeded.v1');
      expect(await pendingCount()).toBe(0);
    });

    it('republishes the same envelope byte-for-byte — messageId intact', async () => {
      const paid = payment();
      await repository.open({ payment: paid });
      await attemptSucceeding(paid);

      const stored = await pool.query<{ envelope: { messageId: string; idempotencyKey: string } }>(
        'SELECT envelope FROM outbox_messages WHERE payment_id = $1',
        [paid.paymentId],
      );
      const storedEnvelope = stored.rows[0]!.envelope;

      const delivered: OutboxMessage[] = [];
      await repository.dispatchPendingOutbox(async (m) => void delivered.push(m), 100);

      expect(delivered[0]!.envelope.messageId).toBe(storedEnvelope.messageId);
      expect(delivered[0]!.envelope.idempotencyKey).toBe(storedEnvelope.idempotencyKey);
    });

    it('leaves the row PENDING when the broker is away, and delivers it on recovery', async () => {
      const paid = payment();
      await repository.open({ payment: paid });
      await attemptSucceeding(paid);

      await expect(
        repository.dispatchPendingOutbox(() => {
          throw new Error('broker unavailable');
        }, 100),
      ).rejects.toThrow('broker unavailable');

      expect(await pendingCount()).toBe(1);

      const delivered: OutboxMessage[] = [];
      const count = await repository.dispatchPendingOutbox(async (m) => void delivered.push(m), 100);

      expect(count).toBe(1);
      expect(delivered).toHaveLength(1);
      expect(await pendingCount()).toBe(0);
    });
  });

  describe('the simulated provider result (T-29)', () => {
    it('accepts TIMEOUT as a scenario', async () => {
      const paid = payment({ scenario: 'TIMEOUT' });

      await expect(repository.open({ payment: paid })).resolves.toMatchObject({ kind: 'CREATED' });
    });

    it('persists and reads back the provider result of each attempt', async () => {
      const paid = payment({ scenario: 'TIMEOUT' });
      await repository.open({ payment: paid });

      await repository.attempt({
        paymentId: paid.paymentId,
        expectedAttempt: 1,
        now: NOW,
        decide: () => ({
          status: 'PENDING',
          errorType: 'TRANSIENT',
          failureReason: null,
          providerReference: null,
          nextAttemptAt: new Date(NOW.getTime() + 1_000),
          attemptResult: 'FAILED',
          providerResult: 'TIMEOUT',
        }),
      });

      const attempts = await repository.attemptsOf(paid.paymentId);

      expect(attempts).toMatchObject([{ attemptNumber: 1, providerResult: 'TIMEOUT' }]);
    });

    it('rejects a provider result outside the closed set', async () => {
      const paid = payment();
      await repository.open({ payment: paid });

      await expect(
        pool.query(
          `INSERT INTO payment_attempts (payment_id, attempt_number, result, provider_result)
           VALUES ($1, 1, 'FAILED', 'BOGUS')`,
          [paid.paymentId],
        ),
      ).rejects.toThrow();
    });
  });

  /** A terminal-failure result — the opposite of `succeed` above. */
  const decline = (): AttemptResult => ({
    status: 'FAILED',
    errorType: 'PERMANENT',
    failureReason: 'PAYMENT_DECLINED',
    providerReference: null,
    nextAttemptAt: null,
    attemptResult: 'FAILED',
    providerResult: 'FAILURE',
  });

  /** A retryable-failure result: still `PENDING`, owed another attempt later. */
  const retry = (nextAttemptAt: Date): AttemptResult => ({
    status: 'PENDING',
    errorType: 'TRANSIENT',
    failureReason: null,
    providerReference: null,
    nextAttemptAt,
    attemptResult: 'FAILED',
    providerResult: 'TIMEOUT',
  });

  describe('list (scoping and filtering)', () => {
    /**
     * `PaymentRepository#list` takes a `PaymentFilter` and nothing else — there
     * is no `page`/`limit` on the port, only a fixed `LIMIT 200` inside the
     * query (`postgres-payment.repository.ts`). What is actually worth proving
     * against a real database is that combining filters narrows to exactly the
     * matching rows regardless of how many unrelated payments sit in the same
     * table — an in-memory `Map` double would filter in JavaScript and could
     * never expose a mistake in the generated `WHERE` clause (parameter
     * ordering, an `AND` written as an `OR`, and so on).
     */
    it('narrows by transactionId, status and errorType together, unaffected by other rows', async () => {
      const pending = payment();
      await repository.open({ payment: pending });

      const declined = payment();
      await repository.open({ payment: declined });
      await repository.attempt({
        paymentId: declined.paymentId,
        expectedAttempt: 1,
        now: NOW,
        decide: decline,
      });

      const retrying = payment();
      await repository.open({ payment: retrying });
      await repository.attempt({
        paymentId: retrying.paymentId,
        expectedAttempt: 1,
        now: NOW,
        decide: () => retry(new Date(NOW.getTime() + 60_000)),
      });

      const succeeded = payment();
      await repository.open({ payment: succeeded });
      await attemptSucceeding(succeeded);

      // status alone: both still-PENDING payments, nobody else.
      const stillPending = await repository.list({ status: 'PENDING' });
      expect(stillPending.map((p) => p.paymentId).sort()).toEqual(
        [pending.paymentId, retrying.paymentId].sort(),
      );

      // status + errorType together: only the row matching both.
      const failedTransient = await repository.list({ status: 'PENDING', errorType: 'TRANSIENT' });
      expect(failedTransient).toHaveLength(1);
      expect(failedTransient[0]!.paymentId).toBe(retrying.paymentId);

      // a status with no errorType counterpart in the table: empty, not "close enough".
      expect(await repository.list({ status: 'FAILED', errorType: 'TRANSIENT' })).toHaveLength(0);

      // transactionId alone finds exactly its one payment, ignoring status entirely.
      const byTransaction = await repository.list({ transactionId: declined.transactionId });
      expect(byTransaction).toHaveLength(1);
      expect(byTransaction[0]!.paymentId).toBe(declined.paymentId);

      // and the terminal-success row is reachable the same way the others are.
      const byStatusSucceeded = await repository.list({ status: 'SUCCEEDED' });
      expect(byStatusSucceeded.map((p) => p.paymentId)).toEqual([succeeded.paymentId]);
    });
  });

  describe('attemptsOf (the ladder, folded)', () => {
    it('returns three attempts in the order they were climbed, not the order they were written', async () => {
      const paid = payment();
      await repository.open({ payment: paid });

      await repository.attempt({
        paymentId: paid.paymentId,
        expectedAttempt: 1,
        now: NOW,
        decide: () => retry(new Date(NOW.getTime() + 1_000)),
      });
      await repository.attempt({
        paymentId: paid.paymentId,
        expectedAttempt: 2,
        now: new Date(NOW.getTime() + 1_000),
        decide: () => retry(new Date(NOW.getTime() + 2_000)),
      });
      await repository.attempt({
        paymentId: paid.paymentId,
        expectedAttempt: 3,
        now: new Date(NOW.getTime() + 2_000),
        decide: () => ({
          status: 'SUCCEEDED',
          errorType: null,
          failureReason: null,
          providerReference: 'PROV-3',
          nextAttemptAt: null,
          attemptResult: 'SUCCEEDED',
          providerResult: 'SUCCESS',
        }),
      });

      const attempts = await repository.attemptsOf(paid.paymentId);

      expect(attempts.map((a) => a.attemptNumber)).toEqual([1, 2, 3]);
      expect(attempts.map((a) => a.result)).toEqual(['FAILED', 'FAILED', 'SUCCEEDED']);
      expect(attempts.map((a) => a.providerResult)).toEqual(['TIMEOUT', 'TIMEOUT', 'SUCCESS']);

      const found = await repository.findById(paid.paymentId);
      expect(found).toMatchObject({ status: 'SUCCEEDED', attempt: 3, providerReference: 'PROV-3' });
    });
  });

  describe('stats on an empty database', () => {
    it('answers zeroes, not nulls, when there are no payments at all', async () => {
      const empty = await pool.query<{ n: number }>('SELECT count(*)::INT AS n FROM payments');
      expect(empty.rows[0]!.n).toBe(0); // beforeEach truncated; nothing seeded here on purpose.

      const stats = await repository.stats();

      expect(stats).toEqual({ today: 0, succeededToday: 0, failedToday: 0, retrying: 0 });
      // Not just loosely equal to zero — genuinely the number 0, the shape a
      // dashboard tile can render directly without a `?? 0` guard of its own.
      expect(Number.isInteger(stats.today)).toBe(true);
      expect(Number.isInteger(stats.retrying)).toBe(true);
    });
  });

  describe('the status CHECK (payments_status_known)', () => {
    it('refuses an out-of-set status via a raw INSERT', async () => {
      // Raw SQL is the point here: the repository never builds an invalid
      // status, so the only way to prove the database itself refuses one is to
      // try to write it directly. `decided_at` is set so the row would
      // otherwise satisfy every *other* CHECK (`payments_settled_has_decision`
      // included) — isolating the failure to `payments_status_known` alone,
      // rather than an assertion that would pass for the wrong reason.
      await expect(
        pool.query(
          `INSERT INTO payments (payment_id, transaction_id, amount, status, decided_at)
           VALUES ($1, $2, 100.00, 'BOGUS', now())`,
          [randomUUID(), randomUUID()],
        ),
      ).rejects.toThrow(/payments_status_known/);
    });
  });

  describe('the retry sweeper (due)', () => {
    /**
     * `due(now, limit)` compares the persisted `next_attempt_at` column against
     * whatever `now` it is handed, entirely in SQL (`next_attempt_at <= $1`).
     * Seeded through `repository.open`, not raw SQL — `nextAttemptAt` is a
     * first-class field `open` already accepts, so there is no need to reach
     * around the repository to set it up.
     *
     * A fake repository could return "the due ones" by comparing against
     * `Date.now()` inside the test process and would never catch a mistake in
     * the actual boundary — off-by-one on `<` vs `<=`, or a predicate that
     * forgot `status = 'PENDING'`. Only a real `<=` evaluated by PostgreSQL
     * proves it.
     */
    it('returns only the payments whose next_attempt_at has passed, oldest first, and respects the boundary', async () => {
      const reference = new Date('2026-09-01T00:00:00.000Z');

      const overdue = payment({ nextAttemptAt: new Date(reference.getTime() - 60_000) });
      const dueNow = payment({ nextAttemptAt: reference }); // exactly at the boundary: `<=` must include it
      const notYet = payment({ nextAttemptAt: new Date(reference.getTime() + 60_000) });
      const settled = payment({ nextAttemptAt: null }); // PENDING but nothing owed — must never appear

      for (const candidate of [overdue, dueNow, notYet, settled]) {
        await repository.open({ payment: candidate });
      }

      const due = await repository.due(reference, 10);

      expect(due.map((p) => p.paymentId)).toEqual([overdue.paymentId, dueNow.paymentId]);
      expect(due.map((p) => p.paymentId)).not.toContain(notYet.paymentId);
      expect(due.map((p) => p.paymentId)).not.toContain(settled.paymentId);
    });
  });

  describe('two sweepers racing (SELECT … FOR UPDATE)', () => {
    /**
     * The guarantee `postgres-payment.repository.ts` documents on `attempt`:
     * the row is locked before `decide` runs, so a handler and the retry
     * sweeper — or two sweepers, on two replicas — cannot both ask the
     * provider for the same attempt number. An in-memory double has no lock at
     * all and would let both callers "charge"; this proves the real database
     * actually serialises them.
     *
     * Two concurrent calls into the *same* `repository` (backed by a pooled
     * connection each) stand in for the two replicas: `pg.Pool` hands each
     * concurrent `attempt()` call its own connection, so this is a genuine
     * race between two transactions, not two calls on one client serialised by
     * accident.
     */
    it('lets only one of two concurrent attempts actually decide; the other is SUPERSEDED', async () => {
      const paid = payment();
      await repository.open({ payment: paid });

      let decideCalls = 0;
      const countingDecide = (): AttemptResult => {
        decideCalls += 1;

        return {
          status: 'SUCCEEDED',
          errorType: null,
          failureReason: null,
          providerReference: `PROV-${String(decideCalls)}`,
          nextAttemptAt: null,
          attemptResult: 'SUCCEEDED',
          providerResult: 'SUCCESS',
        };
      };

      const [first, second] = await Promise.all([
        repository.attempt({
          paymentId: paid.paymentId,
          expectedAttempt: 1,
          now: NOW,
          decide: countingDecide,
        }),
        repository.attempt({
          paymentId: paid.paymentId,
          expectedAttempt: 1,
          now: NOW,
          decide: countingDecide,
        }),
      ]);

      const kinds = [first.kind, second.kind].sort();
      expect(kinds).toEqual(['RECORDED', 'SUPERSEDED']);

      // The real assertion: the provider was consulted exactly once. If the
      // row lock were missing, both racers would read PENDING/attempt 1 and
      // both would call `decide` — a double charge for one transfer.
      expect(decideCalls).toBe(1);

      const attempts = await pool.query<{ n: number }>(
        `SELECT count(*)::INT AS n FROM payment_attempts WHERE payment_id = $1 AND attempt_number = 1`,
        [paid.paymentId],
      );
      expect(attempts.rows[0]!.n).toBe(1);

      const final = await repository.findById(paid.paymentId);
      expect(final).toMatchObject({ status: 'SUCCEEDED', attempt: 1 });
    });
  });

  describe('next_attempt_at as a durable column', () => {
    /**
     * The ladder's whole reason to exist (`retry.scheduler.ts`'s own docstring)
     * is that the due time survives a pod restart because it lives in a column,
     * not a `setTimeout`. The only way to actually prove that — rather than
     * assume the write worked because the same object came back — is to read
     * it from a **second, independent `Pool`**: a fresh TCP connection with no
     * shared in-process state with the one that wrote it.
     */
    it('is visible to a brand-new Pool connecting fresh, not just the connection that wrote it', async () => {
      const nextAttemptAt = new Date('2026-09-02T08:30:00.000Z');
      const paid = payment();
      await repository.open({ payment: paid });

      await repository.attempt({
        paymentId: paid.paymentId,
        expectedAttempt: 1,
        now: NOW,
        decide: () => retry(nextAttemptAt),
      });

      const freshPool = new Pool({ connectionString: DATABASE_URL });

      try {
        const freshRepository = new PostgresPaymentRepository(freshPool);

        const seenFresh = await freshRepository.findById(paid.paymentId);
        expect(seenFresh?.nextAttemptAt?.toISOString()).toBe(nextAttemptAt.toISOString());

        // And the sweeper reading from that fresh connection finds it due too.
        const dueFromFreshConnection = await freshRepository.due(
          new Date(nextAttemptAt.getTime() + 1),
          10,
        );
        expect(dueFromFreshConnection.map((p) => p.paymentId)).toContain(paid.paymentId);
      } finally {
        await freshPool.end();
      }
    });
  });
});
