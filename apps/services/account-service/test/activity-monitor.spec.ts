import { randomUUID } from 'node:crypto';

import { accountAnomalyDetectedV1 } from '@bank/contracts';

import { ActivityMonitor } from '../src/application/activity-monitor';
import { DebitAccountUseCase } from '../src/application/debit-account.use-case';
import type { AccountOperation, ObservedMovement } from '../src/application/ports';
import { ANOMALY_CLAIM_TTL_MS } from '../src/domain/activity-policy';
import type { ActivityRule } from '../src/domain/activity-policy';
import { quetzales } from '../src/domain/money';
import {
  FixedClock,
  InMemoryAccountRepository,
  RecordingActivityTelemetry,
  RecordingPublisher,
  cuentaPersistida,
} from './support/in-memory';

/**
 * The detector, against doubles that behave.
 *
 * What is asserted is what the ticket's criteria say: more than N, in M
 * minutes, exactly one event, N and M taken from configuration, and a monitor
 * that can fail without ever failing the movement it watches. Two detections
 * racing for the same account is a fact about the advisory lock and lives in
 * `repository.integration.spec.ts`, against a real PostgreSQL.
 */

const T0 = new Date('2026-10-04T16:00:00.000Z');
const CUSTOMER = '9f1c8b2a-4d63-4e57-8a90-1b2c3d4e5f60';
const RULE: ActivityRule = { maxOperations: 10, windowMinutes: 5 };
const SECOND = 1_000;
const MINUTE = 60 * SECOND;

function build(rule: ActivityRule = RULE) {
  const repository = new InMemoryAccountRepository();
  const publisher = new RecordingPublisher();
  const clock = new FixedClock(T0);
  const telemetry = new RecordingActivityTelemetry();
  const monitor = new ActivityMonitor({ repository, publisher, clock, telemetry, rule });

  function account(accountType: 'MONETARIA' | 'AHORRO' = 'MONETARIA') {
    const opened = cuentaPersistida({
      accountId: randomUUID(),
      customerId: CUSTOMER,
      accountType,
      now: T0,
    });
    repository.accounts.set(opened.accountId, opened);

    return opened;
  }

  /** One movement already on the ledger at `at`, then reported to the monitor. */
  async function move(
    target: { accountId: string; customerId: string; accountType: 'MONETARIA' | 'AHORRO' },
    type: AccountOperation['type'],
    at: Date,
  ): Promise<void> {
    repository.operations.push({
      operationId: randomUUID(),
      accountId: target.accountId,
      type,
      amount: quetzales(100),
      balanceAfter: quetzales(100),
      transactionId: null,
      status: 'APPLIED',
      idempotencyKey: randomUUID(),
      occurredAt: at,
    });
    clock.advanceTo(at);

    if (type === 'DEBIT' || type === 'CREDIT' || type === 'COMPENSATION') {
      const movement: ObservedMovement = { account: target, type, transactionId: null };
      await monitor.afterMovement(movement);
    }
  }

  const anomalies = () =>
    publisher.events.filter((event) => event.messageType === 'account.anomaly.detected.v1');

  return { repository, publisher, clock, telemetry, monitor, account, move, anomalies };
}

describe('the high-frequency rule', () => {
  it('stays quiet at exactly N operations', async () => {
    const { account, move, anomalies } = build();
    const target = account();

    for (let i = 0; i < 10; i += 1) {
      await move(target, 'DEBIT', new Date(T0.getTime() + i * SECOND));
    }

    expect(anomalies()).toHaveLength(0);
  });

  it('publishes one event on the N + 1st, with the numbers behind it', async () => {
    const { account, move, anomalies } = build();
    const target = account('AHORRO');

    for (let i = 0; i < 11; i += 1) {
      await move(target, i % 2 === 0 ? 'DEBIT' : 'CREDIT', new Date(T0.getTime() + i * SECOND));
    }

    expect(anomalies()).toHaveLength(1);

    const payload = anomalies()[0]!.payload;
    expect(payload).toMatchObject({
      accountId: target.accountId,
      customerId: CUSTOMER,
      accountType: 'AHORRO',
      rule: 'HIGH_FREQUENCY',
      operationCount: 11,
      threshold: 10,
      windowMinutes: 5,
      detectedAt: new Date(T0.getTime() + 10 * SECOND).toISOString(),
      windowStart: new Date(T0.getTime() + 10 * SECOND - 5 * MINUTE).toISOString(),
    });
  });

  it('publishes an event that satisfies its own contract', async () => {
    const { account, move, anomalies } = build();
    const target = account();

    for (let i = 0; i < 11; i += 1) {
      await move(target, 'DEBIT', new Date(T0.getTime() + i * SECOND));
    }

    expect(accountAnomalyDetectedV1.schema.safeParse(anomalies()[0]!.payload).success).toBe(true);
  });

  it('publishes exactly one event for a burst of thirty, not one per operation over the limit', async () => {
    const { account, move, anomalies, repository } = build();
    const target = account();

    for (let i = 0; i < 30; i += 1) {
      await move(target, 'DEBIT', new Date(T0.getTime() + i * SECOND));
    }

    expect(anomalies()).toHaveLength(1);
    expect(repository.anomalies).toHaveLength(1);
  });

  it('announces again for a new burst once the window has passed', async () => {
    const { account, move, anomalies } = build();
    const target = account();

    for (let i = 0; i < 11; i += 1) {
      await move(target, 'DEBIT', new Date(T0.getTime() + i * SECOND));
    }
    expect(anomalies()).toHaveLength(1);

    const later = T0.getTime() + 10 * MINUTE;
    for (let i = 0; i < 11; i += 1) {
      await move(target, 'DEBIT', new Date(later + i * SECOND));
    }

    expect(anomalies()).toHaveLength(2);
  });

  it('does not count operations older than the window', async () => {
    const { account, move, anomalies } = build();
    const target = account();

    // Ten operations well outside the window, then one now: eleven in total, one in the window.
    for (let i = 0; i < 10; i += 1) {
      await move(target, 'DEBIT', new Date(T0.getTime() - 20 * MINUTE + i * SECOND));
    }
    await move(target, 'DEBIT', T0);

    expect(anomalies()).toHaveLength(0);
  });

  it('does not count the operation made exactly M minutes ago', async () => {
    const { account, move, anomalies } = build();
    const target = account();

    // Ten at exactly M minutes before the eleventh, which is the only one inside the window.
    for (let i = 0; i < 10; i += 1) {
      await move(target, 'DEBIT', new Date(T0.getTime()));
    }
    await move(target, 'DEBIT', new Date(T0.getTime() + 5 * MINUTE));

    expect(anomalies()).toHaveLength(0);
  });

  it('keeps accounts apart: ten on each of two accounts is not eleven on one', async () => {
    const { account, move, anomalies } = build();
    const first = account();
    const second = account();

    for (let i = 0; i < 10; i += 1) {
      await move(first, 'DEBIT', new Date(T0.getTime() + i * SECOND));
      await move(second, 'DEBIT', new Date(T0.getTime() + i * SECOND));
    }

    expect(anomalies()).toHaveLength(0);
  });

  it('counts a deposit as a credit', async () => {
    const { account, move, anomalies } = build();
    const target = account();

    for (let i = 0; i < 11; i += 1) {
      await move(target, 'CREDIT', new Date(T0.getTime() + i * SECOND));
    }

    expect(anomalies()).toHaveLength(1);
  });

  it('does not count commissions or compensations towards the limit', async () => {
    const { account, move, anomalies } = build();
    const target = account('AHORRO');

    // Five debits, each with its own commission, and six compensations: sixteen rows, five operations.
    for (let i = 0; i < 5; i += 1) {
      await move(target, 'DEBIT', new Date(T0.getTime() + i * SECOND));
      await move(target, 'COMMISSION', new Date(T0.getTime() + i * SECOND));
    }
    for (let i = 0; i < 6; i += 1) {
      await move(target, 'COMPENSATION', new Date(T0.getTime() + (10 + i) * SECOND));
    }

    expect(anomalies()).toHaveLength(0);
  });
});

describe('N and M come from configuration', () => {
  it('fires at the third operation when N is two', async () => {
    const { account, move, anomalies } = build({ maxOperations: 2, windowMinutes: 5 });
    const target = account();

    await move(target, 'DEBIT', T0);
    await move(target, 'DEBIT', new Date(T0.getTime() + SECOND));
    expect(anomalies()).toHaveLength(0);

    await move(target, 'DEBIT', new Date(T0.getTime() + 2 * SECOND));
    expect(anomalies()).toHaveLength(1);
    expect(anomalies()[0]!.payload).toMatchObject({ threshold: 2, windowMinutes: 5 });
  });

  it('forgets operations sooner when M is one minute', async () => {
    const { account, move, anomalies } = build({ maxOperations: 2, windowMinutes: 1 });
    const target = account();

    await move(target, 'DEBIT', T0);
    await move(target, 'DEBIT', new Date(T0.getTime() + 30 * SECOND));
    // The third is 90 s after the first: inside a five-minute window, outside a one-minute one.
    await move(target, 'DEBIT', new Date(T0.getTime() + 90 * SECOND));

    expect(anomalies()).toHaveLength(0);
  });

  it('remembers them longer when M is an hour', async () => {
    const { account, move, anomalies } = build({ maxOperations: 2, windowMinutes: 60 });
    const target = account();

    await move(target, 'DEBIT', T0);
    await move(target, 'DEBIT', new Date(T0.getTime() + 20 * MINUTE));
    await move(target, 'DEBIT', new Date(T0.getTime() + 40 * MINUTE));

    expect(anomalies()).toHaveLength(1);
    expect(anomalies()[0]!.payload).toMatchObject({ windowMinutes: 60 });
  });
});

describe('telemetry', () => {
  it('reports every movement with its type, and the compensation as its own value', async () => {
    const { account, move, telemetry } = build();
    const target = account('AHORRO');

    await move(target, 'DEBIT', T0);
    await move(target, 'CREDIT', new Date(T0.getTime() + SECOND));
    await move(target, 'COMPENSATION', new Date(T0.getTime() + 2 * SECOND));

    expect(telemetry.operations.map((event) => event.operation)).toEqual([
      'debit',
      'credit',
      'compensation',
    ]);
    expect(telemetry.operations[0]).toMatchObject({
      accountId: target.accountId,
      accountType: 'AHORRO',
    });
  });

  it('reports the anomaly once, as a first announcement', async () => {
    const { account, move, telemetry } = build({ maxOperations: 1, windowMinutes: 5 });
    const target = account();

    await move(target, 'DEBIT', T0);
    await move(target, 'DEBIT', new Date(T0.getTime() + SECOND));
    await move(target, 'DEBIT', new Date(T0.getTime() + 2 * SECOND));

    expect(telemetry.anomalies).toHaveLength(1);
    expect(telemetry.anomalies[0]).toMatchObject({
      accountId: target.accountId,
      republished: false,
    });
  });
});

describe('a monitor that fails never fails the movement', () => {
  it('swallows a database failure and reports it', async () => {
    const { account, repository, monitor, telemetry } = build();
    const target = account();
    repository.claimAnomaly = () => Promise.reject(new Error('connection reset'));

    await expect(
      monitor.afterMovement({ account: target, type: 'DEBIT', transactionId: null }),
    ).resolves.toBeUndefined();

    expect(telemetry.failures).toEqual([
      { accountId: target.accountId, stage: 'detection', reason: 'connection reset' },
    ]);
  });

  it('swallows a publication failure, reports it, and publishes the anomaly again later', async () => {
    const { account, move, publisher, telemetry, anomalies, clock } = build({
      maxOperations: 1,
      windowMinutes: 5,
    });
    const target = account();

    await move(target, 'DEBIT', T0);

    const publish = publisher.publish.bind(publisher);
    publisher.publish = () => Promise.reject(new Error('broker is away'));
    await move(target, 'DEBIT', new Date(T0.getTime() + SECOND));

    expect(telemetry.failures[0]).toMatchObject({ stage: 'publication', reason: 'broker is away' });
    expect(anomalies()).toHaveLength(0);

    // A movement soon after finds the claim still held: it does not publish a duplicate.
    publisher.publish = publish;
    await move(target, 'DEBIT', new Date(T0.getTime() + 2 * SECOND));
    expect(anomalies()).toHaveLength(0);

    // Once the claim has gone stale, the next movement inside the window announces it.
    clock.advanceTo(new Date(T0.getTime() + SECOND + ANOMALY_CLAIM_TTL_MS + SECOND));
    await move(target, 'DEBIT', new Date(T0.getTime() + SECOND + ANOMALY_CLAIM_TTL_MS + SECOND));

    expect(anomalies()).toHaveLength(1);
    expect(telemetry.anomalies.at(-1)).toMatchObject({ republished: true });
  });
});

describe('wired to a real use case', () => {
  it('lets a debit through, and flags the account on the eleventh', async () => {
    const repository = new InMemoryAccountRepository();
    const publisher = new RecordingPublisher();
    const clock = new FixedClock(T0);
    const telemetry = new RecordingActivityTelemetry();
    const activity = new ActivityMonitor({ repository, publisher, clock, telemetry, rule: RULE });
    const debitUseCase = new DebitAccountUseCase({ repository, publisher, clock, activity });

    const accountId = randomUUID();
    repository.accounts.set(accountId, {
      ...cuentaPersistida({ accountId, customerId: CUSTOMER, accountType: 'MONETARIA', now: T0 }),
      balanceMinor: 1_000_000,
    });

    for (let i = 0; i < 11; i += 1) {
      clock.advanceTo(new Date(T0.getTime() + i * SECOND));
      await debitUseCase.execute(
        {
          transactionId: randomUUID(),
          accountId,
          amount: { amountMinor: 100, currency: 'GTQ' },
        },
        `key-${String(i)}`,
      );
    }

    const types = publisher.typesPublished();
    expect(types.filter((type) => type === 'account.debited.v1')).toHaveLength(11);
    expect(types.filter((type) => type === 'account.anomaly.detected.v1')).toHaveLength(1);
    // The anomaly is announced after the movement it follows, never before it.
    expect(types.lastIndexOf('account.debited.v1')).toBeLessThan(
      types.indexOf('account.anomaly.detected.v1'),
    );
  });
});
