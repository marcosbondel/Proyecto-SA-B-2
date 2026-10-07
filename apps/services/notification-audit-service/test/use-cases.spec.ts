import { auditQueryRepliedV1, notificationListRepliedV1 } from '@bank/contracts';
import type { Identity } from '@bank/contracts';

import { ListNotificationsUseCase } from '../src/application/list-notifications.use-case';
import { QueryAuditUseCase } from '../src/application/query-audit.use-case';
import { RecordEventUseCase } from '../src/application/record-event.use-case';
import { classify } from '../src/domain/classification';
import type { InboundRecord } from '../src/application/ports';
import {
  CountingIds,
  FixedClock,
  InMemoryAuditRepository,
  RecordingPublisher,
  RecordingSender,
} from './support/in-memory';

/**
 * The acceptance criteria of T-20, as tests rather than as claims.
 *
 * Each `describe` below is numbered against the ticket. What is deliberately
 * *not* here is anything that needs PostgreSQL: the deduplication is asserted
 * against an in-memory double that collides on the same key the unique
 * constraint does, and `repository.integration.spec.ts` proves the SQL agrees.
 */

const CORRELATION = '7d41e8b2-9a3f-4c15-8ee0-1b2f9a4c7d10';
const TRANSACTION = '9f2a41c7-4d7b-4f0e-9c1e-0242ac120002';
const CUSTOMER = '3f2a1c04-9c2e-4a71-b8f5-2d6e7c0a1b93';

const ADMIN: Identity = { customerId: 'a1c2e3f4-4d7b-4f0e-9c1e-0242ac120099', role: 'ADMINISTRADOR' };
const TELLER: Identity = { customerId: CUSTOMER, role: 'CAJERO_RECEPTOR' };

interface Harness {
  readonly repository: InMemoryAuditRepository;
  readonly sender: RecordingSender;
  readonly publisher: RecordingPublisher;
  readonly clock: FixedClock;
  readonly record: RecordEventUseCase;
}

function harness(): Harness {
  const repository = new InMemoryAuditRepository();
  const sender = new RecordingSender();
  const publisher = new RecordingPublisher();
  const clock = new FixedClock();

  return {
    repository,
    sender,
    publisher,
    clock,
    record: new RecordEventUseCase({ repository, sender, clock, ids: new CountingIds() }),
  };
}

function event(overrides: Partial<InboundRecord> = {}): InboundRecord {
  const base = {
    eventId: '8f21c9a0-4d7b-4f0e-9c1e-0242ac120002',
    messageType: 'transaction.completed.v1',
    messageVersion: 1,
    producer: 'transaction-service',
    occurredAt: new Date('2026-08-27T15:00:00.000Z'),
    correlationId: CORRELATION,
    causationId: null,
    payload: { transactionId: TRANSACTION, status: 'COMPLETED' },
    processingStatus: 'PROCESSED' as const,
    consumer: 'audit.transaction',
    ...overrides,
  };

  return {
    ...base,
    traceId: null,
    severity:
      overrides.severity ??
      classify({ messageType: base.messageType, processingStatus: base.processingStatus }),
  };
}

/** Criterion 1: every valid event is recorded, with its payload and correlation. */
describe('criterion 1 — every event of every family is recorded', () => {
  it.each([
    ['audit.customer', 'customer.registered.v1', 'customer-service'],
    ['audit.account', 'account.debited.v1', 'account-service'],
    ['audit.transaction', 'transaction.completed.v1', 'transaction-service'],
    ['audit.payment', 'payment.succeeded.v1', 'payment-service'],
  ])('records what arrives on %s', async (consumer, messageType, producer) => {
    const { record, repository } = harness();

    const outcome = await record.execute({
      event: event({ consumer, messageType, producer }),
      customerId: CUSTOMER,
    });

    expect(outcome.kind).toBe('RECORDED');
    expect(repository.events).toHaveLength(1);
    expect(repository.events[0]).toMatchObject({
      messageType,
      producer,
      consumer,
      correlationId: CORRELATION,
      processingStatus: 'PROCESSED',
    });
  });

  it('stores the payload redacted, never as it was published', async () => {
    const { record, repository } = harness();

    await record.execute({
      event: event({
        messageType: 'customer.registered.v1',
        payload: { customerId: CUSTOMER, email: 'maria@example.gt' },
      }),
      customerId: CUSTOMER,
    });

    expect(repository.events[0]?.payload).toEqual({
      customerId: CUSTOMER,
      email: '[redactado]',
    });
  });
});

/** Criterion 2: a duplicate produces no second record and no second notification. */
describe('criterion 2 — a redelivery changes nothing', () => {
  it('records once and notifies once, however many times the message arrives', async () => {
    const { record, repository, sender } = harness();
    const delivered = event();

    const first = await record.execute({ event: delivered, customerId: CUSTOMER });
    const second = await record.execute({ event: delivered, customerId: CUSTOMER });
    const third = await record.execute({ event: delivered, customerId: CUSTOMER });

    expect(first.kind).toBe('RECORDED');
    expect(second.kind).toBe('DUPLICATE');
    expect(third.kind).toBe('DUPLICATE');
    expect(repository.events).toHaveLength(1);
    expect(repository.notifications).toHaveLength(1);
    expect(sender.sent).toHaveLength(1);
  });

  /**
   * A `DUPLICATE` is a normal outcome and not a failure. Returning it rather
   * than throwing is what keeps a correct redelivery out of the retry ladder,
   * where it would be refused three more times and then land in a dead-letter
   * queue for somebody to investigate the system working as designed.
   */
  it('does not throw for a duplicate', async () => {
    const { record } = harness();
    const delivered = event();

    await record.execute({ event: delivered, customerId: CUSTOMER });

    await expect(
      record.execute({ event: delivered, customerId: CUSTOMER }),
    ).resolves.toEqual({ kind: 'DUPLICATE' });
  });

  /**
   * The same message on two different family queues is not a duplicate. Nothing
   * in the topology overlaps today; the key is the pair so that if a binding
   * ever does, the trail shows what each consumer saw instead of silently
   * losing one.
   */
  it('treats the same message on two consumers as two records', async () => {
    const { record, repository } = harness();

    await record.execute({ event: event({ consumer: 'audit.transaction' }), customerId: null });
    await record.execute({ event: event({ consumer: 'audit.account' }), customerId: null });

    expect(repository.events).toHaveLength(2);
  });

  /** The consumption log is the only place a refused redelivery leaves a trace. */
  it('counts the deliveries it refused, so a climbing ladder is visible', async () => {
    const { record, repository } = harness();
    const delivered = event();

    await record.execute({ event: delivered, customerId: CUSTOMER });
    await record.execute({ event: delivered, customerId: CUSTOMER });

    expect([...repository.deliveries.values()]).toEqual([2]);
  });
});

/** Criterion 3: an invalid payload is marked and costs the producer nothing. */
describe('criterion 3 — a message this service cannot read', () => {
  it('is recorded as INVALID rather than dropped', async () => {
    const { record, repository } = harness();

    const outcome = await record.execute({
      event: event({ processingStatus: 'INVALID', payload: { nonsense: true } }),
      customerId: CUSTOMER,
    });

    expect(outcome.kind).toBe('RECORDED');
    expect(repository.events[0]?.processingStatus).toBe('INVALID');
  });

  /**
   * Notifying on a payload that failed its own contract would mean telling
   * somebody their transfer completed on the strength of a message whose
   * `transactionId` might not be a `transactionId` at all.
   */
  it('notifies nobody on the strength of a payload it could not parse', async () => {
    const { record, repository, sender } = harness();

    await record.execute({
      event: event({ processingStatus: 'INVALID' }),
      customerId: CUSTOMER,
    });

    expect(repository.notifications).toHaveLength(0);
    expect(sender.sent).toHaveLength(0);
  });

  it('never throws, so the producer is unaffected either way', async () => {
    const { record } = harness();

    await expect(
      record.execute({ event: event({ processingStatus: 'INVALID' }), customerId: null }),
    ).resolves.toMatchObject({ kind: 'RECORDED' });
  });
});

/** Criterion 4: a backlog is processed on return, without loss or duplication. */
describe('criterion 4 — the backlog after the service comes back', () => {
  it('records every message that queued up while it was gone, once each', async () => {
    const { record, repository } = harness();
    const backlog = ['a', 'b', 'c', 'd'].map((suffix, index) =>
      event({
        eventId: `8f21c9a0-4d7b-4f0e-9c1e-0242ac12000${String(index)}`,
        messageType: 'account.debited.v1',
        consumer: 'audit.account',
        payload: { transactionId: TRANSACTION, tag: suffix },
      }),
    );

    for (const message of [...backlog, ...backlog]) {
      await record.execute({ event: message, customerId: CUSTOMER });
    }

    expect(repository.events).toHaveLength(4);
  });
});

/** The notification half of the evidence the ticket asks for. */
describe('the notification a flow produces', () => {
  it.each([
    ['transaction.completed.v1', 'transfer.completed'],
    ['transaction.failed.v1', 'transfer.failed'],
    ['transaction.compensated.v1', 'transfer.compensated'],
  ])('sends one on %s', async (messageType, expected) => {
    const { record, repository, sender } = harness();

    await record.execute({ event: event({ messageType }), customerId: CUSTOMER });

    expect(sender.sent).toHaveLength(1);
    expect(repository.notifications[0]).toMatchObject({
      type: expected,
      status: 'SENT',
      referenceId: TRANSACTION,
      recipient: 'cliente-3f2a1c04@simulado.bonking.gt',
    });
  });

  /**
   * A failed delivery is a status somebody can see, not an exception. Throwing
   * would put the send on the retry ladder, and the redelivery would be refused
   * as a duplicate before it ever reached the sender again — a ladder that
   * cannot climb.
   */
  it('records a failed delivery as FAILED and does not throw', async () => {
    const { record, repository, sender } = harness();
    sender.failNext();

    const outcome = await record.execute({ event: event(), customerId: CUSTOMER });

    expect(outcome).toEqual({ kind: 'RECORDED', notified: true });
    expect(repository.notifications[0]?.status).toBe('FAILED');
    expect(repository.notifications[0]?.processedAt).not.toBeNull();
  });

  it('sends nothing for an event the policy does not name', async () => {
    const { record, repository, sender } = harness();

    await record.execute({
      event: event({ messageType: 'account.debit.requested.v1' }),
      customerId: CUSTOMER,
    });

    expect(repository.notifications).toHaveLength(0);
    expect(sender.sent).toHaveLength(0);
  });
});

/** Criterion 5: the query returns ordered events and the notifications with them. */
describe('criterion 5 — the query by correlationId', () => {
  async function trailOf(): Promise<Record<string, unknown>> {
    const { record, repository, publisher } = harness();

    /* Recorded out of order on purpose: the reply must not depend on arrival. */
    await record.execute({
      event: event({
        eventId: '11111111-4d7b-4f0e-9c1e-0242ac120002',
        messageType: 'transaction.completed.v1',
        occurredAt: new Date('2026-08-27T15:00:09.000Z'),
      }),
      customerId: CUSTOMER,
    });
    await record.execute({
      event: event({
        eventId: '22222222-4d7b-4f0e-9c1e-0242ac120002',
        messageType: 'account.debited.v1',
        consumer: 'audit.account',
        occurredAt: new Date('2026-08-27T15:00:02.000Z'),
      }),
      customerId: CUSTOMER,
    });

    await new QueryAuditUseCase({ repository, publisher }).execute(
      { correlationId: CORRELATION },
      ADMIN,
    );

    return publisher.last?.payload as Record<string, unknown>;
  }

  it('replies with the events oldest first, whatever order they were recorded in', async () => {
    const payload = await trailOf();
    const events = payload.events as { messageType: string }[];

    expect(events.map((entry) => entry.messageType)).toEqual([
      'account.debited.v1',
      'transaction.completed.v1',
    ]);
  });

  it('replies with the notifications of the same flow', async () => {
    const payload = await trailOf();

    expect(payload.notifications).toEqual([
      {
        channel: 'EMAIL',
        subject: 'Tu transferencia se completó',
        sentAt: '2026-08-27T15:00:00.000Z',
      },
    ]);
  });

  it('satisfies the contract it answers', async () => {
    const payload = await trailOf();

    expect(auditQueryRepliedV1.schema.safeParse(payload).success).toBe(true);
  });

  it('carries the redacted payload and the processing status', async () => {
    const payload = await trailOf();
    const [first] = payload.events as { payload?: Record<string, unknown> }[];

    expect(first?.payload).toEqual({ transactionId: TRANSACTION, status: 'COMPLETED' });
  });

  /**
   * An unknown correlation is two empty lists, not a refusal. It may mean the
   * flow never existed, that this service was down when it passed, or that it
   * is still running — three things this service cannot tell apart and must not
   * guess between.
   */
  it('answers an unknown correlation emptily rather than refusing', async () => {
    const { repository, publisher } = harness();

    await new QueryAuditUseCase({ repository, publisher }).execute(
      { correlationId: CORRELATION },
      ADMIN,
    );

    expect(publisher.last?.payload).toMatchObject({ events: [], notifications: [] });
  });

  /**
   * D-06, enforced here rather than trusted from the Gateway alone: this
   * service hears every event in the bank, and a flow's trail is as much a
   * fact about everybody as `GetAuditStatsUseCase`'s volume is.
   */
  it('answers a non-administrator emptily too, rather than the trail it asked for', async () => {
    const { record, repository, publisher } = harness();
    await record.execute({ event: event(), customerId: CUSTOMER });

    await new QueryAuditUseCase({ repository, publisher }).execute(
      { correlationId: CORRELATION },
      TELLER,
    );

    expect(publisher.last?.payload).toMatchObject({
      correlationId: CORRELATION,
      events: [],
      notifications: [],
    });
  });

  it('answers an envelope with no identity emptily as well', async () => {
    const { record, repository, publisher } = harness();
    await record.execute({ event: event(), customerId: CUSTOMER });

    await new QueryAuditUseCase({ repository, publisher }).execute(
      { correlationId: CORRELATION },
      null,
    );

    expect(publisher.last?.payload).toMatchObject({ events: [], notifications: [] });
  });

  /**
   * `sentAt` is `null` for a failed delivery as well as for a pending one,
   * because the reply T-05 closed has no third state (TD-040). The console
   * route carries the real status.
   */
  it('reports a failed notification as not sent, because the reply has no third state', async () => {
    const { record, repository, publisher, sender } = harness();
    sender.failNext();

    await record.execute({ event: event(), customerId: CUSTOMER });
    await new QueryAuditUseCase({ repository, publisher }).execute(
      { correlationId: CORRELATION },
      ADMIN,
    );

    const payload = publisher.last?.payload as { notifications: { sentAt: string | null }[] };

    expect(payload.notifications[0]?.sentAt).toBeNull();
  });
});

describe('the notifications console', () => {
  async function fill(count: number): Promise<Harness> {
    const built = harness();

    for (let index = 0; index < count; index += 1) {
      await built.record.execute({
        event: event({
          eventId: `33333333-4d7b-4f0e-9c1e-${String(index).padStart(12, '0')}`,
          occurredAt: new Date(Date.UTC(2026, 7, 27, 15, 0, index)),
        }),
        customerId: CUSTOMER,
      });
    }

    return built;
  }

  it('returns the page and counts what it left out', async () => {
    const { repository, publisher } = await fill(5);

    await new ListNotificationsUseCase({ repository, publisher }).execute({ limit: 2 }, ADMIN);

    const payload = publisher.last?.payload as { notifications: unknown[]; omitted: number };

    expect(payload.notifications).toHaveLength(2);
    expect(payload.omitted).toBe(3);
  });

  it('narrows by status without pretending it is a permission', async () => {
    const { repository, publisher } = await fill(3);

    await new ListNotificationsUseCase({ repository, publisher }).execute(
      { status: 'FAILED' },
      ADMIN,
    );

    expect(publisher.last?.payload).toMatchObject({ notifications: [], omitted: 0 });
  });

  it('satisfies the contract it answers', async () => {
    const { repository, publisher } = await fill(2);

    await new ListNotificationsUseCase({ repository, publisher }).execute({}, ADMIN);

    expect(notificationListRepliedV1.schema.safeParse(publisher.last?.payload).success).toBe(true);
  });

  /**
   * D-06, enforced here rather than trusted from the Gateway alone: this
   * console carries the simulated recipient of every delivery in the system,
   * the same field `ReadInboxUseCase` refuses to show anybody but its owner.
   */
  it('answers a non-administrator emptily rather than the console it asked for', async () => {
    const { repository, publisher } = await fill(3);

    await new ListNotificationsUseCase({ repository, publisher }).execute({}, TELLER);

    expect(publisher.last?.payload).toMatchObject({ notifications: [], omitted: 0 });
  });

  it('answers an envelope with no identity emptily as well', async () => {
    const { repository, publisher } = await fill(3);

    await new ListNotificationsUseCase({ repository, publisher }).execute({}, null);

    expect(publisher.last?.payload).toMatchObject({ notifications: [], omitted: 0 });
  });
});
