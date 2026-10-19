import { randomUUID } from 'node:crypto';

import type { MessageEnvelope } from '@bank/contracts';
import { Pool } from 'pg';

import { SimulationUseCase } from '../src/application/manage-simulation.use-case';
import { ProcessPaymentUseCase } from '../src/application/process-payment.use-case';
import type { ProviderCall, ProviderTelemetry } from '../src/application/ports';
import { quetzales } from '../src/domain/money';
import type { SimulationSettings } from '../src/domain/simulation';
import { migrate } from '../src/infrastructure/persistence/migrations';
import { PostgresPaymentRepository } from '../src/infrastructure/persistence/postgres-payment.repository';
import { InboundMessageRouter } from '../src/interfaces/inbound-message.handler';
import {
  SimulationQueryHandler,
  SimulationUpdateHandler,
} from '../src/interfaces/message-handlers';
import { RecordingPublisher } from './support/in-memory';

/**
 * T-44, from the broker's door down to PostgreSQL: the two simulation commands
 * parsed by their real handlers, executed by the real use case, written by the
 * real repository.
 *
 * What the unit suites cannot show is what happens to a *row* when a command is
 * refused, malformed or raced: that a customer's `payment.simulation.update.v1`
 * leaves the table untouched, that a payload the contract would refuse never
 * reaches it, and that two administrators changing the dial at the same moment
 * leave one consistent row rather than a blend of the two.
 *
 * Requires `DATABASE_URL`; skipped without it, like the other integration suites.
 */

const DATABASE_URL = process.env.DATABASE_URL;
const describeIntegration = DATABASE_URL === undefined ? describe.skip : describe;

jest.setTimeout(30_000);

const NOTHING: SimulationSettings = { failureRatePercent: 0, timeoutRatePercent: 0, latencyMs: 0 };
const ADMIN = { customerId: randomUUID(), role: 'ADMINISTRADOR' } as const;
const TELLER = { customerId: randomUUID(), role: 'CAJERO_RECEPTOR' } as const;
const CLIENT = { customerId: randomUUID(), role: 'CLIENTE' } as const;

const envelope = (
  messageType: string,
  payload: unknown,
  identity: MessageEnvelope<unknown>['identity'] = ADMIN,
): MessageEnvelope<unknown> => ({
  messageId: randomUUID(),
  messageType,
  messageVersion: 1,
  producer: 'gateway',
  correlationId: randomUUID(),
  causationId: null,
  idempotencyKey: randomUUID(),
  occurredAt: new Date().toISOString(),
  identity,
  payload,
});

class RecordingTelemetry implements ProviderTelemetry {
  public readonly calls: ProviderCall[] = [];
  public readonly changes: string[] = [];

  public providerCall(call: ProviderCall): void {
    this.calls.push(call);
  }

  public simulationChanged(change: { action: string }): void {
    this.changes.push(change.action);
  }
}

describeIntegration('the simulation commands over PostgreSQL', () => {
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

  /** One replica's door: the handlers over a use case over its own repository. */
  function door(repo: PostgresPaymentRepository = repository) {
    const telemetry = new RecordingTelemetry();
    const publisher = new RecordingPublisher();
    const useCase = new SimulationUseCase({
      repository: repo,
      defaults: NOTHING,
      clock: { now: () => new Date() },
      telemetry,
    });
    const router = new InboundMessageRouter([
      new SimulationUpdateHandler(useCase, publisher),
      new SimulationQueryHandler(useCase, publisher),
    ]);

    return { router, publisher, telemetry, useCase };
  }

  const rows = async (): Promise<number> => {
    const found = await pool.query<{ n: number }>(
      'SELECT count(*)::INT AS n FROM payment_simulation_settings',
    );

    return found.rows[0]!.n;
  };

  const update = (
    settings: SimulationSettings,
    identity: MessageEnvelope<unknown>['identity'] = ADMIN,
  ) => envelope('payment.simulation.update.v1', settings, identity);

  it('persists an administrator’s change and answers with the simulation now in force', async () => {
    const { router, publisher } = door();

    await router.route(update({ failureRatePercent: 35, timeoutRatePercent: 5, latencyMs: 400 }));

    await expect(repository.loadSimulation()).resolves.toMatchObject({
      settings: { failureRatePercent: 35, timeoutRatePercent: 5, latencyMs: 400 },
    });
    expect(publisher.replied[0]).toMatchObject({
      messageType: 'payment.simulation.replied.v1',
      payload: { failureRatePercent: 35, timeoutRatePercent: 5, latencyMs: 400, source: 'RUNTIME' },
    });
  });

  it.each([
    ['a customer', CLIENT],
    ['a teller', TELLER],
    ['a message with no identity', null],
  ])('leaves the table untouched when %s sends the change', async (_who, identity) => {
    const { router, publisher, telemetry } = door();

    await router.route(update({ failureRatePercent: 100, timeoutRatePercent: 0, latencyMs: 0 }, identity));

    expect(await rows()).toBe(0);
    expect(publisher.replied[0]!.payload).toMatchObject({ source: 'DEFAULTS', failureRatePercent: 0 });
    expect(telemetry.changes).toEqual(['DENIED']);
  });

  it('refuses a reset from a non-administrator, which would otherwise erase the real override', async () => {
    const { router } = door();

    await router.route(update({ failureRatePercent: 60, timeoutRatePercent: 0, latencyMs: 0 }));
    await router.route(envelope('payment.simulation.update.v1', { reset: true }, CLIENT));

    expect(await rows()).toBe(1);
  });

  it('removes the row on a reset and answers with the defaults', async () => {
    const { router, publisher } = door();

    await router.route(update({ failureRatePercent: 60, timeoutRatePercent: 0, latencyMs: 0 }));
    await router.route(envelope('payment.simulation.update.v1', { reset: true }));

    expect(await rows()).toBe(0);
    expect(publisher.replied.at(-1)!.payload).toMatchObject({ source: 'DEFAULTS', updatedAt: null });
  });

  it.each([
    ['rates over every attempt', { failureRatePercent: 70, timeoutRatePercent: 40, latencyMs: 0 }],
    ['a rate over 100', { failureRatePercent: 150, timeoutRatePercent: 0, latencyMs: 0 }],
    ['a partial set', { failureRatePercent: 10 }],
    ['a latency past the ceiling', { failureRatePercent: 0, timeoutRatePercent: 0, latencyMs: 99_999 }],
  ])('never writes a row for %s: the handler throws before the repository is reached', async (_label, payload) => {
    const { router } = door();

    await expect(router.route(envelope('payment.simulation.update.v1', payload))).rejects.toThrow();
    expect(await rows()).toBe(0);
  });

  it('answers a query with the defaults, and with the override once there is one', async () => {
    const { router, publisher } = door();

    await router.route(envelope('payment.simulation.query.v1', {}));
    await router.route(update({ failureRatePercent: 20, timeoutRatePercent: 0, latencyMs: 0 }));
    await router.route(envelope('payment.simulation.query.v1', {}));

    expect(publisher.replied[0]!.payload).toMatchObject({ source: 'DEFAULTS' });
    expect(publisher.replied[2]!.payload).toMatchObject({ source: 'RUNTIME', failureRatePercent: 20 });
  });

  it('keeps one consistent row when two administrators change the dial at the same moment', async () => {
    const one = door(repository);
    const two = door(otherRepository);

    await Promise.all([
      one.router.route(update({ failureRatePercent: 10, timeoutRatePercent: 10, latencyMs: 100 })),
      two.router.route(update({ failureRatePercent: 80, timeoutRatePercent: 5, latencyMs: 900 })),
    ]);

    const stored = await repository.loadSimulation();

    expect(await rows()).toBe(1);
    // One of the two, whole: never a blend of one's rates with the other's latency.
    expect([
      { failureRatePercent: 10, timeoutRatePercent: 10, latencyMs: 100 },
      { failureRatePercent: 80, timeoutRatePercent: 5, latencyMs: 900 },
    ]).toContainEqual(stored!.settings);
  });

  it('records the moment of the change in the row', async () => {
    const { router } = door();
    const before = Date.now();

    await router.route(update({ failureRatePercent: 5, timeoutRatePercent: 0, latencyMs: 0 }));

    const stored = await repository.loadSimulation();

    expect(stored!.updatedAt.getTime()).toBeGreaterThanOrEqual(before - 1_000);
    expect(stored!.updatedAt.getTime()).toBeLessThanOrEqual(Date.now() + 1_000);
  });

  /**
   * Two replicas reach for the same due attempt while the provider is slow. The
   * row is locked for the write only, so both wait out the latency; the second
   * to arrive must find the attempt already made and record nothing.
   */
  it('records an attempt once when two replicas race for it while the provider is slow', async () => {
    const telemetry = new RecordingTelemetry();
    const build = (repo: PostgresPaymentRepository) =>
      new ProcessPaymentUseCase({
        repository: repo,
        clock: { now: () => new Date() },
        ids: { next: () => randomUUID() },
        delays: [1_000, 5_000, 30_000],
        simulation: new SimulationUseCase({
          repository: repo,
          defaults: { failureRatePercent: 100, timeoutRatePercent: 0, latencyMs: 200 },
          clock: { now: () => new Date() },
          telemetry,
        }),
        random: { next: () => 0.5 },
        sleeper: { sleep: async (ms: number) => await new Promise((resolve) => setTimeout(resolve, ms)) },
        telemetry,
      });

    const paid = {
      paymentId: randomUUID(),
      transactionId: randomUUID(),
      amount: quetzales(25_000),
      scenario: null,
      originCorrelationId: randomUUID(),
    };

    await build(repository).open(paid, new RecordingPublisher());
    const due = (await repository.findById(paid.paymentId))!;

    await Promise.all([
      build(repository).retry(due, new RecordingPublisher()),
      build(otherRepository).retry(due, new RecordingPublisher()),
    ]);

    const attempts = await repository.attemptsOf(paid.paymentId);

    expect(attempts.map((attempt) => attempt.attemptNumber)).toEqual([1, 2]);
    expect(telemetry.calls.map((call) => call.attempt)).toEqual([1, 2]);
  });
});
