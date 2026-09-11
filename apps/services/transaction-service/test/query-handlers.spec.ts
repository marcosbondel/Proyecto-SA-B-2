import { createEnvelope } from '@bank/contracts';
import type {
  Identity,
  TransactionListQueryV1,
  TransactionStatusRequestedV1,
} from '@bank/contracts';

import { TransactionListHandler, TransactionStatusHandler } from '../src/interfaces/message-handlers';

/**
 * The two query handlers this service exposes, at the one layer that
 * previously had no test of its own: `inbound-message.handler.spec.ts`
 * exercises only the generic router, and everything below `.handle()` was
 * covered solely through the use case directly. What is worth proving here is
 * narrow but real — that the **real contract schema** parses an envelope
 * carrying T-28's new fields and hands the use case exactly what it sent,
 * rather than a hand-built object a future field rename could silently stop
 * matching.
 */

describe('TransactionListHandler', () => {
  it('parses the real contract, including the T-28 filters, and hands it to the use case unchanged', async () => {
    let received: { readonly query: TransactionListQueryV1; readonly identity: Identity | null } | null =
      null;

    const useCase = {
      execute: async (query: TransactionListQueryV1, identity: Identity | null) => {
        received = { query, identity };
      },
    };

    const handler = new TransactionListHandler(useCase as never);
    const identity: Identity = { customerId: '77777777-7777-4777-8777-777777777701', role: 'CLIENTE' };

    const envelope = createEnvelope(
      {
        status: 'DEBITING',
        phaseStatus: 'PENDING',
        from: '2026-08-01T00:00:00.000Z',
        to: '2026-08-31T23:59:59.999Z',
        limit: 10,
      },
      { messageType: 'transaction.list.query.v1', producer: 'gateway', identity },
    );

    await handler.handle(envelope);

    expect(received).not.toBeNull();
    expect(received!.query).toEqual({
      status: 'DEBITING',
      phaseStatus: 'PENDING',
      from: '2026-08-01T00:00:00.000Z',
      to: '2026-08-31T23:59:59.999Z',
      limit: 10,
    });
    expect(received!.identity).toEqual(identity);
  });

  it('refuses an envelope carrying a reversed date range, before the use case ever sees it', async () => {
    const useCase = { execute: jest.fn() };
    const handler = new TransactionListHandler(useCase as never);

    const envelope = createEnvelope(
      { from: '2026-08-31T00:00:00.000Z', to: '2026-08-01T00:00:00.000Z' },
      { messageType: 'transaction.list.query.v1', producer: 'gateway', identity: null },
    );

    await expect(handler.handle(envelope)).rejects.toThrow();
    expect(useCase.execute).not.toHaveBeenCalled();
  });
});

describe('TransactionStatusHandler', () => {
  it('parses the real contract and passes the envelope identity through, for the ownership check', async () => {
    let received: {
      readonly payload: TransactionStatusRequestedV1;
      readonly identity: Identity | null;
    } | null = null;

    const useCase = {
      execute: async (payload: TransactionStatusRequestedV1, identity: Identity | null) => {
        received = { payload, identity };
      },
    };

    const handler = new TransactionStatusHandler(useCase as never);
    const identity: Identity = {
      customerId: '88888888-8888-4888-8888-888888888801',
      role: 'CAJERO_RECEPTOR',
    };
    const transactionId = '33333333-3333-4333-8333-333333333333';

    const envelope = createEnvelope(
      { transactionId },
      { messageType: 'transaction.status.requested.v1', producer: 'gateway', identity },
    );

    await handler.handle(envelope);

    expect(received).not.toBeNull();
    expect(received!.payload).toEqual({ transactionId });
    expect(received!.identity).toEqual(identity);
  });
});
