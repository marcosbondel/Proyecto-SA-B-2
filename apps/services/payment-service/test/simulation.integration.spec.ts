import { randomUUID } from 'node:crypto';

import { Pool } from 'pg';

import { SimulationUseCase } from '../src/application/manage-simulation.use-case';
import { ProcessPaymentUseCase } from '../src/application/process-payment.use-case';
import type { ProviderCall, ProviderTelemetry } from '../src/application/ports';
import { quetzales } from '../src/domain/money';
import { migrate } from '../src/infrastructure/persistence/migrations';
import { PostgresPaymentRepository } from '../src/infrastructure/persistence/postgres-payment.repository';
import { FakeRepository, RecordingPublisher, clockFrom } from './support/in-memory';

/**
 * T-44 across a real process: the simulation use cases over the real
 * repository and a real PostgreSQL.
 *
 * What the in-memory doubles cannot show is the part the design rests on: that
 * the override is one row every replica reads, that a change reaches the next
 * attempt on a *different* connection, and that the simulated latency is waited
 * out **before** the payment's row is locked rather than while it is held.
 *
 * Requires `DATABASE_URL`; skipped without it, like the rest of the integration
 * suites.
 */

const DATABASE_URL = process.env.DATABASE_URL;
const describeIntegration = DATABASE_URL === undefined ? describe.skip : describe;

jest.setTimeout(30_000);

const NOTHING = { failureRatePercent: 0, timeoutRatePercent: 0, latencyMs: 0 };
const ADMIN = { customerId: randomUUID(), role: 'ADMINISTRADOR' as const };

class RecordingTelemetry implements ProviderTelemetry {
  public readonly calls: ProviderCall[] = [];

  public providerCall(call: ProviderCall): void {
    this.calls.push(call);
  }

  public simulationChanged(): void {
    // Not what these cases are about.
  }
}

describeIntegration('the provider simulation over PostgreSQL', () => {
  let pool: Pool;
  let otherPool: Pool;
  let repository: PostgresPaymentRepository;
  let otherRepository: PostgresPaymentRepository;

  beforeAll(async () => {
    if (DATABASE_URL === undefined) {
      return;
    }

    pool = new Pool({ connectionString: DATABASE_URL });
    otherPool = new Pool({ connectionString: DATABASE_URL });
    await migrate(pool);
    repository = new PostgresPaymentRepository(pool);
    otherRepository = new PostgresPaymentRepository(otherPool);
  });

  afterAll(async () => {
    await pool?.end();
    await otherPool?.end();
  });

  beforeEach(async () => {
    await pool.query(
      'TRUNCATE outbox_messages, payment_attempts, payments, payment_simulation_settings',
    );
  });

  /** One replica: a use case pair over its own connection pool. */
  function replica(
    repo: PostgresPaymentRepository,
    options: {
      readonly rolls?: number[];
      readonly sleep?: (milliseconds: number) => Promise<void>;
    } = {},
  ) {
    const clock = clockFrom(new Date());
    const telemetry = new RecordingTelemetry();
    const simulation = new SimulationUseCase({
      repository: repo,
      defaults: NOTHING,
      clock: { now: () => new Date() },
      telemetry,
    });
    let counter = 0;
    const payments = new ProcessPaymentUseCase({
      repository: repo,
      clock: { now: () => new Date() },
      ids: { next: () => `ref-${String((counter += 1))}` },
      delays: [1_000, 5_000, 30_000],
      simulation,
      random: { next: () => options.rolls?.shift() ?? 0.5 },
      sleeper: { sleep: options.sleep ?? (async () => undefined) },
      telemetry,
    });

    return { clock, telemetry, simulation, payments };
  }

  const order = (scenario: 'APPROVE' | 'REJECT' | null = null) => ({
    paymentId: randomUUID(),
    transactionId: randomUUID(),
    amount: quetzales(25_000),
    scenario,
    originCorrelationId: randomUUID(),
  });

  const outboxTypes = async (): Promise<string[]> => {
    const rows = await pool.query<{ routing_key: string }>(
      'SELECT routing_key FROM outbox_messages ORDER BY id',
    );

    return rows.rows.map((row) => row.routing_key);
  };

  const change = async (
    on: ReturnType<typeof replica>,
    command: Parameters<SimulationUseCase['update']>[0]['command'],
  ): Promise<void> => {
    await on.simulation.update({
      command,
      identity: ADMIN,
      correlationId: randomUUID(),
      publisher: new RecordingPublisher(),
    });
  };

  it('climbs the whole ladder at 100 % failure and leaves the payment FAILED with its events in the outbox', async () => {
    const one = replica(repository);
    const paid = order();

    await change(one, { failureRatePercent: 100, timeoutRatePercent: 0, latencyMs: 0 });
    await one.payments.open(paid, new RecordingPublisher());

    for (let rung = 0; rung < 3; rung += 1) {
      const due = await repository.findById(paid.paymentId);
      await one.payments.retry(due!, new RecordingPublisher());
    }

    await expect(repository.findById(paid.paymentId)).resolves.toMatchObject({
      status: 'FAILED',
      failureReason: 'PAYMENT_RETRIES_EXHAUSTED',
      attempt: 4,
    });
    expect(await outboxTypes()).toEqual([
      'payment.attempt.failed.v1',
      'payment.attempt.failed.v1',
      'payment.attempt.failed.v1',
      'payment.attempt.failed.v1',
      'payment.failed.v1',
    ]);
    expect((await repository.attemptsOf(paid.paymentId)).map((a) => a.providerResult)).toEqual([
      'FAILURE',
      'FAILURE',
      'FAILURE',
      'FAILURE',
    ]);
  });

  it('records a timeout as TIMEOUT, and reports one call per recorded attempt', async () => {
    const one = replica(repository);
    const paid = order();

    await change(one, { failureRatePercent: 0, timeoutRatePercent: 100, latencyMs: 0 });
    await one.payments.open(paid, new RecordingPublisher());

    expect((await repository.attemptsOf(paid.paymentId))[0]).toMatchObject({
      result: 'FAILED',
      providerResult: 'TIMEOUT',
    });
    expect(one.telemetry.calls.map((call) => call.result)).toEqual(['TIMEOUT']);
  });

  it('applies a change made on one replica to the next attempt of another', async () => {
    const admin = replica(repository);
    const worker = replica(otherRepository, { rolls: [0.1, 0.1] });

    const before = order();
    await worker.payments.open(before, new RecordingPublisher());
    await expect(otherRepository.findById(before.paymentId)).resolves.toMatchObject({
      status: 'SUCCEEDED',
    });

    await change(admin, { failureRatePercent: 100, timeoutRatePercent: 0, latencyMs: 0 });

    const after = order();
    await worker.payments.open(after, new RecordingPublisher());
    await expect(otherRepository.findById(after.paymentId)).resolves.toMatchObject({
      status: 'PENDING',
      attempt: 1,
      errorType: 'TRANSIENT',
    });
  });

  it('goes back to the defaults on a reset, whichever replica asks', async () => {
    const admin = replica(repository);
    const worker = replica(otherRepository);

    await change(admin, { failureRatePercent: 100, timeoutRatePercent: 0, latencyMs: 0 });
    await expect(worker.simulation.current()).resolves.toMatchObject({ source: 'RUNTIME' });

    await change(admin, { reset: true });

    await expect(worker.simulation.current()).resolves.toEqual({
      settings: NOTHING,
      source: 'DEFAULTS',
      updatedAt: null,
    });
  });

  it('leaves a scripted payment alone, whatever the stored rates', async () => {
    const one = replica(repository);
    const paid = order('APPROVE');

    await change(one, { failureRatePercent: 100, timeoutRatePercent: 0, latencyMs: 0 });
    await one.payments.open(paid, new RecordingPublisher());

    await expect(repository.findById(paid.paymentId)).resolves.toMatchObject({ status: 'SUCCEEDED' });
  });

  /**
   * The reason the wait is before the lock. While the simulated provider is
   * "thinking", another connection must be able to take the payment's row —
   * which is exactly what the retry sweeper or a second replica would do. Were
   * the sleep inside `attempt`, `NOWAIT` would refuse here.
   */
  it('does not hold the payment’s row while the simulated provider is slow', async () => {
    let release: () => void = () => undefined;
    let waiting: () => void = () => undefined;
    const sleeping = new Promise<void>((resolve) => {
      waiting = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    const slow = replica(repository, {
      sleep: async () => {
        waiting();
        await gate;
      },
    });
    const paid = order();

    // The payment has to exist before it can be attempted slowly.
    await repository.open({
      payment: {
        paymentId: paid.paymentId,
        transactionId: paid.transactionId,
        status: 'PENDING',
        amount: paid.amount,
        attempt: null,
        errorType: null,
        failureReason: null,
        providerReference: null,
        scenario: null,
        originCorrelationId: paid.originCorrelationId,
        nextAttemptAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
        decidedAt: null,
      },
    });
    await change(slow, { failureRatePercent: 0, timeoutRatePercent: 0, latencyMs: 5_000 });

    const attempting = slow.payments.retry((await repository.findById(paid.paymentId))!, new RecordingPublisher());

    await sleeping;

    const client = await otherPool.connect();

    try {
      await client.query('BEGIN');
      await expect(
        client.query('SELECT 1 FROM payments WHERE payment_id = $1 FOR UPDATE NOWAIT', [paid.paymentId]),
      ).resolves.toMatchObject({ rowCount: 1 });
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }

    release();
    await attempting;

    await expect(repository.findById(paid.paymentId)).resolves.toMatchObject({ status: 'SUCCEEDED' });
  });

  it('is exercised by the same in-memory double the unit suites use, so the two cannot drift apart', async () => {
    const fake = new FakeRepository();

    await expect(fake.loadSimulation()).resolves.toBeNull();
    await fake.saveSimulation({ failureRatePercent: 1, timeoutRatePercent: 2, latencyMs: 3 }, new Date());
    await expect(fake.loadSimulation()).resolves.toMatchObject({
      settings: { failureRatePercent: 1, timeoutRatePercent: 2, latencyMs: 3 },
    });
    await fake.clearSimulation();
    await expect(fake.loadSimulation()).resolves.toBeNull();
  });
});
