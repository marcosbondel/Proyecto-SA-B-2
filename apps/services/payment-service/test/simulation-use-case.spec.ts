import { SimulationUseCase } from '../src/application/manage-simulation.use-case';
import { ProcessPaymentUseCase } from '../src/application/process-payment.use-case';
import type { ProviderCall, ProviderTelemetry } from '../src/application/ports';
import { quetzales } from '../src/domain/money';
import type { SimulationSettings } from '../src/domain/simulation';
import { FakeRepository, RecordingPublisher, clockFrom } from './support/in-memory';

/**
 * T-44, the use cases: the dice are rolled, the wait happens outside the lock,
 * a change reaches the very next attempt, and only an administrator can make it.
 *
 * The repository is the faithful `Map`, the dice are a queue the test fills, and
 * the sleeper advances the test's own clock — so "the provider took 750 ms" is
 * something the use case measured, not something the test asserted by fiat.
 */

const NOW = new Date('2026-10-05T12:00:00.000Z');
const LADDER = [1_000, 5_000, 30_000] as const;
const PAYMENT_ID = '11111111-1111-4111-8111-111111111111';
const TRANSACTION_ID = '22222222-2222-4222-8222-222222222222';
const CORRELATION = '33333333-3333-4333-8333-333333333333';

const ADMIN = { customerId: '77777777-7777-4777-8777-777777777701', role: 'ADMINISTRADOR' as const };
const TELLER = { customerId: '77777777-7777-4777-8777-777777777702', role: 'CAJERO_RECEPTOR' as const };
const CLIENT = { customerId: '77777777-7777-4777-8777-777777777703', role: 'CLIENTE' as const };

const NOTHING: SimulationSettings = { failureRatePercent: 0, timeoutRatePercent: 0, latencyMs: 0 };

class RecordingTelemetry implements ProviderTelemetry {
  public readonly calls: ProviderCall[] = [];
  public readonly changes: { action: string; settings: SimulationSettings }[] = [];

  public providerCall(call: ProviderCall): void {
    this.calls.push(call);
  }

  public simulationChanged(change: { action: string; settings: SimulationSettings }): void {
    this.changes.push({ action: change.action, settings: change.settings });
  }
}

function build(defaults: SimulationSettings = NOTHING) {
  const repository = new FakeRepository();
  const publisher = new RecordingPublisher();
  const clock = clockFrom(NOW);
  const telemetry = new RecordingTelemetry();
  /** Everything that touches the database or the clock, in the order it happened. */
  const order: string[] = [];
  const rolls: number[] = [];
  const sleeps: number[] = [];

  const originalAttempt = repository.attempt.bind(repository);
  repository.attempt = async (input) => {
    order.push('attempt');

    return await originalAttempt(input);
  };

  const simulation = new SimulationUseCase({ repository, defaults, clock, telemetry });
  let counter = 0;
  const payments = new ProcessPaymentUseCase({
    repository,
    clock,
    ids: { next: () => `provider-ref-${String((counter += 1))}` },
    delays: LADDER,
    simulation,
    random: {
      next: () => {
        order.push('roll');

        return rolls.shift() ?? 0.5;
      },
    },
    sleeper: {
      sleep: async (milliseconds: number) => {
        order.push('sleep');
        sleeps.push(milliseconds);
        clock.advance(milliseconds);
        await Promise.resolve();
      },
    },
    telemetry,
  });

  return { repository, publisher, clock, telemetry, order, rolls, sleeps, simulation, payments };
}

const ORDER = {
  paymentId: PAYMENT_ID,
  transactionId: TRANSACTION_ID,
  amount: quetzales(25_000),
  scenario: null,
  originCorrelationId: CORRELATION,
};

const types = (publisher: RecordingPublisher): string[] =>
  publisher.published.map((message) => message.messageType);

describe('an unscripted payment, decided by the dice', () => {
  it('fails and climbs the ladder when the roll falls inside the failure rate', async () => {
    const { payments, publisher, rolls, repository } = build({ ...NOTHING, failureRatePercent: 30 });
    rolls.push(0.1);

    await payments.open(ORDER, publisher);

    expect(types(publisher)).toEqual(['payment.attempt.failed.v1']);
    expect(publisher.published[0]!.payload).toMatchObject({
      attempt: 1,
      errorType: 'TRANSIENT',
      providerResult: 'FAILURE',
      willRetry: true,
    });
    expect(await repository.findById(PAYMENT_ID)).toMatchObject({ status: 'PENDING', attempt: 1 });
  });

  it('succeeds when the roll falls outside it', async () => {
    const { payments, publisher, rolls } = build({ ...NOTHING, failureRatePercent: 30 });
    rolls.push(0.9);

    await payments.open(ORDER, publisher);

    expect(types(publisher)).toEqual(['payment.succeeded.v1']);
  });

  it('answers a timeout without waiting for it', async () => {
    const { payments, publisher, rolls, sleeps } = build({ ...NOTHING, timeoutRatePercent: 50, latencyMs: 2_000 });
    rolls.push(0.1);

    await payments.open(ORDER, publisher);

    expect(publisher.published[0]!.payload).toMatchObject({ providerResult: 'TIMEOUT', willRetry: true });
    expect(sleeps).toEqual([]);
  });

  it('with every attempt failing, spends the whole ladder and ends in the event that compensates', async () => {
    const { payments, publisher, repository, clock } = build({ ...NOTHING, failureRatePercent: 100 });

    await payments.open(ORDER, publisher);

    for (let rung = 0; rung < LADDER.length; rung += 1) {
      clock.advance(60_000);
      await payments.retry((await repository.findById(PAYMENT_ID))!, publisher);
    }

    expect(types(publisher)).toEqual([
      'payment.attempt.failed.v1',
      'payment.attempt.failed.v1',
      'payment.attempt.failed.v1',
      'payment.attempt.failed.v1',
      'payment.failed.v1',
    ]);
    expect(publisher.published.at(-1)!.payload).toMatchObject({
      status: 'FAILED',
      failureReason: 'PAYMENT_RETRIES_EXHAUSTED',
      attempt: 4,
    });
  });
});

describe('a scripted payment', () => {
  it('ignores the rates entirely, and never rolls the dice', async () => {
    const { payments, publisher, order } = build({ ...NOTHING, failureRatePercent: 100, latencyMs: 5_000 });

    await payments.open({ ...ORDER, scenario: 'APPROVE' }, publisher);

    expect(types(publisher)).toEqual(['payment.succeeded.v1']);
    expect(order).toEqual(['attempt']);
  });

  it('is still refused permanently by REJECT, whatever the dice say', async () => {
    const { payments, publisher } = build();

    await payments.open({ ...ORDER, scenario: 'REJECT' }, publisher);

    expect(publisher.published[0]!.payload).toMatchObject({ errorType: 'PERMANENT' });
    expect(types(publisher)).toContain('payment.failed.v1');
  });
});

describe('the latency of a slow provider', () => {
  it('is waited out before the row is locked, never inside it', async () => {
    const { payments, publisher, order, sleeps } = build({ ...NOTHING, latencyMs: 750 });

    await payments.open(ORDER, publisher);

    // The roll and the wait both precede the repository's locked section.
    expect(order).toEqual(['roll', 'sleep', 'attempt']);
    expect(sleeps).toEqual([750]);
  });

  it('is measured, and reported with the call', async () => {
    const { payments, publisher, telemetry } = build({ ...NOTHING, latencyMs: 750 });

    await payments.open(ORDER, publisher);

    expect(telemetry.calls).toHaveLength(1);
    expect(telemetry.calls[0]).toMatchObject({ latencyMs: 750, result: 'SUCCESS', source: 'CONFIGURATION' });
  });

  it('does not slow a payment when none is configured', async () => {
    const { payments, publisher, sleeps } = build();

    await payments.open(ORDER, publisher);

    expect(sleeps).toEqual([]);
  });
});

describe('changing the simulation while the system runs', () => {
  it('reaches the very next attempt, with nothing rebuilt and nothing restarted', async () => {
    const { payments, simulation, publisher, rolls } = build();
    rolls.push(0.1, 0.1);

    await payments.open(ORDER, publisher);
    expect(types(publisher)).toEqual(['payment.succeeded.v1']);

    await simulation.update({
      command: { failureRatePercent: 100, timeoutRatePercent: 0, latencyMs: 0 },
      identity: ADMIN,
      correlationId: CORRELATION,
      publisher,
    });

    await payments.open({ ...ORDER, paymentId: '99999999-9999-4999-8999-999999999999' }, publisher);

    expect(types(publisher)).toEqual([
      'payment.succeeded.v1',
      'payment.attempt.failed.v1',
    ]);
  });

  it('holds for another replica, which reads the same row', async () => {
    const { repository, clock, telemetry, simulation } = build();
    const publisher = new RecordingPublisher();

    await simulation.update({
      command: { failureRatePercent: 40, timeoutRatePercent: 10, latencyMs: 300 },
      identity: ADMIN,
      correlationId: CORRELATION,
      publisher,
    });

    const anotherReplica = new SimulationUseCase({ repository, defaults: NOTHING, clock, telemetry });

    expect(await anotherReplica.current()).toEqual({
      settings: { failureRatePercent: 40, timeoutRatePercent: 10, latencyMs: 300 },
      source: 'RUNTIME',
      updatedAt: NOW,
    });
  });

  it('is undone by a reset, which brings the ConfigMap values back', async () => {
    const defaults = { failureRatePercent: 5, timeoutRatePercent: 0, latencyMs: 100 };
    const { simulation } = build(defaults);
    const publisher = new RecordingPublisher();

    await simulation.update({
      command: { failureRatePercent: 90, timeoutRatePercent: 0, latencyMs: 0 },
      identity: ADMIN,
      correlationId: CORRELATION,
      publisher,
    });
    await simulation.update({ command: { reset: true }, identity: ADMIN, correlationId: CORRELATION, publisher });

    expect(await simulation.current()).toEqual({ settings: defaults, source: 'DEFAULTS', updatedAt: null });
    expect(publisher.replied.at(-1)!.payload).toEqual({ ...defaults, source: 'DEFAULTS', updatedAt: null });
  });

  it('answers an update with the simulation now in force, which is its confirmation', async () => {
    const { simulation } = build();
    const publisher = new RecordingPublisher();

    await simulation.update({
      command: { failureRatePercent: 25, timeoutRatePercent: 5, latencyMs: 200 },
      identity: ADMIN,
      correlationId: CORRELATION,
      publisher,
    });

    expect(publisher.replied).toHaveLength(1);
    expect(publisher.replied[0]).toMatchObject({
      messageType: 'payment.simulation.replied.v1',
      payload: {
        failureRatePercent: 25,
        timeoutRatePercent: 5,
        latencyMs: 200,
        source: 'RUNTIME',
        updatedAt: NOW.toISOString(),
      },
    });
  });

  it('reports the defaults to a query while nobody has overridden them', async () => {
    const defaults = { failureRatePercent: 5, timeoutRatePercent: 1, latencyMs: 50 };
    const { simulation } = build(defaults);
    const publisher = new RecordingPublisher();

    await simulation.query(publisher);

    expect(publisher.replied[0]!.payload).toEqual({ ...defaults, source: 'DEFAULTS', updatedAt: null });
  });
});

describe('who may change it', () => {
  it.each([
    ['a teller', TELLER],
    ['a customer', CLIENT],
    ['nobody at all', null],
  ])('refuses %s, changes nothing and answers with what is in force', async (_who, identity) => {
    const { simulation, repository, telemetry } = build();
    const publisher = new RecordingPublisher();

    await simulation.update({
      command: { failureRatePercent: 100, timeoutRatePercent: 0, latencyMs: 0 },
      identity,
      correlationId: CORRELATION,
      publisher,
    });

    expect(repository.simulation).toBeNull();
    expect(publisher.replied[0]!.payload).toMatchObject({ failureRatePercent: 0, source: 'DEFAULTS' });
    expect(telemetry.changes.map((change) => change.action)).toEqual(['DENIED']);
  });

  it('refuses a reset from anyone but an administrator too', async () => {
    const { simulation, repository } = build();
    const publisher = new RecordingPublisher();

    await simulation.update({
      command: { failureRatePercent: 50, timeoutRatePercent: 0, latencyMs: 0 },
      identity: ADMIN,
      correlationId: CORRELATION,
      publisher,
    });
    await simulation.update({ command: { reset: true }, identity: TELLER, correlationId: CORRELATION, publisher });

    expect(repository.simulation).not.toBeNull();
  });

  it('throws on numbers the contract would have refused, so they reach the dead-letter queue', async () => {
    const { simulation } = build();

    await expect(
      simulation.update({
        command: { failureRatePercent: 80, timeoutRatePercent: 80, latencyMs: 0 },
        identity: ADMIN,
        correlationId: CORRELATION,
        publisher: new RecordingPublisher(),
      }),
    ).rejects.toThrow(/cannot honour/);
  });

  it('refuses invalid defaults at construction, before the first attempt', () => {
    expect(
      () =>
        new SimulationUseCase({
          repository: new FakeRepository(),
          defaults: { failureRatePercent: 90, timeoutRatePercent: 20, latencyMs: 0 },
          clock: clockFrom(NOW),
          telemetry: new RecordingTelemetry(),
        }),
    ).toThrow(/not valid/);
  });
});

describe('what the provider reports about its calls', () => {
  it('says once per recorded attempt what the provider answered and who decided it', async () => {
    const { payments, publisher, telemetry, rolls } = build({ ...NOTHING, failureRatePercent: 100 });
    rolls.push(0.5);

    await payments.open(ORDER, publisher);

    expect(telemetry.calls).toEqual([
      {
        paymentId: PAYMENT_ID,
        transactionId: TRANSACTION_ID,
        correlationId: CORRELATION,
        attempt: 1,
        result: 'FAILURE',
        errorType: 'TRANSIENT',
        willRetry: true,
        source: 'CONFIGURATION',
        latencyMs: 0,
      },
    ]);
  });

  it('says RUNTIME, not CONFIGURATION, while an administrator’s override is in force (QA 20)', async () => {
    const { payments, publisher, telemetry, simulation, rolls } = build();
    rolls.push(0.5, 0.5, 0.5);

    await payments.open(ORDER, publisher);
    await simulation.update({
      command: { failureRatePercent: 100, timeoutRatePercent: 0, latencyMs: 0 },
      identity: ADMIN,
      correlationId: CORRELATION,
      publisher,
    });
    await payments.open({ ...ORDER, paymentId: '99999999-9999-4999-8999-999999999999' }, publisher);
    await simulation.update({ command: { reset: true }, identity: ADMIN, correlationId: CORRELATION, publisher });
    await payments.open({ ...ORDER, paymentId: '88888888-8888-4888-8888-888888888888' }, publisher);

    // Before the override: the ConfigMap's. During it: the administrator's. After the reset: the ConfigMap's again.
    expect(telemetry.calls.map((call) => call.source)).toEqual([
      'CONFIGURATION',
      'RUNTIME',
      'CONFIGURATION',
    ]);
  });

  it('a scripted scenario stays the scenario’s even while an override is in force', async () => {
    const { payments, publisher, telemetry, simulation } = build();

    await simulation.update({
      command: { failureRatePercent: 100, timeoutRatePercent: 0, latencyMs: 0 },
      identity: ADMIN,
      correlationId: CORRELATION,
      publisher,
    });
    await payments.open({ ...ORDER, scenario: 'APPROVE' }, publisher);

    expect(telemetry.calls[0]).toMatchObject({ source: 'SCENARIO' });
  });

  it('marks a scripted answer as the scenario’s', async () => {
    const { payments, publisher, telemetry } = build();

    await payments.open({ ...ORDER, scenario: 'REJECT' }, publisher);

    expect(telemetry.calls[0]).toMatchObject({ source: 'SCENARIO', result: 'FAILURE', errorType: 'PERMANENT', willRetry: false });
  });

  it('says nothing for an attempt somebody else already made', async () => {
    const { payments, publisher, telemetry, repository } = build({ ...NOTHING, failureRatePercent: 100 });

    await payments.open(ORDER, publisher);
    const stale = (await repository.findById(PAYMENT_ID))!;
    // The sweeper and a second replica both read attempt 1 and both reach for attempt 2.
    await Promise.all([payments.retry(stale, publisher), payments.retry(stale, publisher)]);

    expect(telemetry.calls.map((call) => call.attempt)).toEqual([1, 2]);
  });

  it('never makes a settled attempt fail, however the telemetry misbehaves', async () => {
    const { repository, publisher, clock, simulation } = build();
    const exploding: ProviderTelemetry = {
      providerCall: () => {
        throw new Error('sink is down');
      },
      simulationChanged: () => undefined,
    };
    const payments = new ProcessPaymentUseCase({
      repository,
      clock,
      ids: { next: () => 'ref' },
      delays: LADDER,
      simulation,
      random: { next: () => 0.5 },
      sleeper: { sleep: async () => undefined },
      telemetry: exploding,
    });

    await expect(payments.open(ORDER, publisher)).resolves.toBeUndefined();
    expect(await repository.findById(PAYMENT_ID)).toMatchObject({ status: 'SUCCEEDED' });
  });
});

describe('a use case built without a simulation', () => {
  it('is the scripted provider it was before T-44', async () => {
    const repository = new FakeRepository();
    const publisher = new RecordingPublisher();
    const payments = new ProcessPaymentUseCase({
      repository,
      clock: clockFrom(NOW),
      ids: { next: () => 'ref' },
      delays: LADDER,
    });

    await payments.open(ORDER, publisher);

    expect(types(publisher)).toEqual(['payment.succeeded.v1']);
  });
});
