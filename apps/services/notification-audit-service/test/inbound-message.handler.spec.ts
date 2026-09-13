import { createEnvelope } from '@bank/contracts';
import type { MessageEnvelope } from '@bank/contracts';

import { RecordEventUseCase } from '../src/application/record-event.use-case';
import { InboundMessageRouter } from '../src/interfaces/inbound-message.handler';
import type { InboundMessageHandler } from '../src/interfaces/inbound-message.handler';
import { StructuredLogger } from '../src/interfaces/logging';
import { RecordEventHandler } from '../src/interfaces/message-handlers';
import {
  CountingIds,
  FixedClock,
  InMemoryAuditRepository,
  RecordingSender,
} from './support/in-memory';

const recordingHandler = (messageType: string, seen: MessageEnvelope<unknown>[]) =>
  ({
    messageType,
    handle: async (envelope) => {
      seen.push(envelope);
    },
  }) satisfies InboundMessageHandler;

describe('notification-audit-service inbound message router', () => {
  it('hands a delivery to the handler that claimed its type', async () => {
    const seen: MessageEnvelope<unknown>[] = [];
    const router = new InboundMessageRouter([recordingHandler('customer.registered.v1', seen)]);
    const envelope = createEnvelope(
      { reference: 'INV-1' },
      {
        messageType: 'customer.registered.v1',
        producer: 'notification-audit-service',
        identity: null,
      },
    );

    await expect(router.route(envelope)).resolves.toBe(true);
    expect(seen).toEqual([envelope]);
  });

  it('reports an unclaimed message instead of failing', async () => {
    const router = new InboundMessageRouter([recordingHandler('customer.registered.v1', [])]);
    const envelope = createEnvelope(
      {},
      { messageType: 'something.else.v1', producer: 'notification-audit-service', identity: null },
    );

    await expect(router.route(envelope)).resolves.toBe(false);
  });

  it('refuses two handlers claiming the same type', () => {
    const seen: MessageEnvelope<unknown>[] = [];

    expect(
      () =>
        new InboundMessageRouter([
          recordingHandler('customer.registered.v1', seen),
          recordingHandler('customer.registered.v1', seen),
        ]),
    ).toThrow(/Two handlers claim/);
  });
});

describe('RecordEventHandler classifies what it records (§4.1)', () => {
  function handlerWith(repository: InMemoryAuditRepository): RecordEventHandler {
    const useCase = new RecordEventUseCase({
      repository,
      sender: new RecordingSender(),
      clock: new FixedClock(),
      ids: new CountingIds(),
    });

    return new RecordEventHandler(useCase, 'audit.transaction', new StructuredLogger('test', () => {}));
  }

  it('classifies a valid event by its contract, not by its status alone', async () => {
    const repository = new InMemoryAuditRepository();
    const envelope = createEnvelope(
      {
        transactionId: '9f2a41c7-4d7b-4f0e-9c1e-0242ac120002',
        customerId: null,
        sourceAccount: '11111111-4d7b-4f0e-9c1e-0242ac120001',
        targetAccount: '22222222-4d7b-4f0e-9c1e-0242ac120002',
        amount: { amountMinor: 10_000, currency: 'GTQ' },
        status: 'COMPLETED',
        completedAt: '2026-08-27T15:00:00.000Z',
      },
      { messageType: 'transaction.completed.v1', producer: 'transaction-service', identity: null },
    );

    await handlerWith(repository).handle(envelope);

    expect(repository.events[0]?.processingStatus).toBe('PROCESSED');
    expect(repository.events[0]?.severity).toBe('INFO');
  });

  /** A payload this consumer cannot read is WARNING, whatever the message would otherwise mean. */
  it('classifies an invalid payload as WARNING', async () => {
    const repository = new InMemoryAuditRepository();
    const envelope = createEnvelope(
      { thisFieldDoesNotExistOnTheContract: true },
      { messageType: 'transaction.completed.v1', producer: 'transaction-service', identity: null },
    );

    await handlerWith(repository).handle(envelope);

    expect(repository.events[0]?.processingStatus).toBe('INVALID');
    expect(repository.events[0]?.severity).toBe('WARNING');
  });

  it('classifies an unknown message type as WARNING', async () => {
    const repository = new InMemoryAuditRepository();
    const envelope = createEnvelope(
      {},
      { messageType: 'made-up.unknown.v1', producer: 'transaction-service', identity: null },
    );

    await handlerWith(repository).handle(envelope);

    expect(repository.events[0]?.processingStatus).toBe('INVALID');
    expect(repository.events[0]?.severity).toBe('WARNING');
  });
});
