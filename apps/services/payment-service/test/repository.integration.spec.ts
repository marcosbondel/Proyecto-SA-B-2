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
});
