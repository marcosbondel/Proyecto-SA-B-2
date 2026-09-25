import { QUEUES, createEnvelope } from '@bank/contracts';
import type { MessageEnvelope } from '@bank/contracts';

import { AdvanceSagaUseCase } from '../src/application/advance-saga.use-case';
import { GetTransactionStatsUseCase } from '../src/application/get-transaction-stats.use-case';
import { GetTransactionStatusUseCase } from '../src/application/get-transaction-status.use-case';
import { ListTransactionsUseCase } from '../src/application/list-transactions.use-case';
import { RecordPaymentAttemptUseCase } from '../src/application/record-payment-attempt.use-case';
import { RequestTransferUseCase } from '../src/application/request-transfer.use-case';
import { StructuredLogger } from '../src/interfaces/logging';
import { InboundMessageRouter } from '../src/interfaces/inbound-message.handler';
import {
  PaymentAttemptFailedHandler,
  RequestTransferHandler,
  TransactionListHandler,
  TransactionStatsHandler,
  TransactionStatusHandler,
  sagaHandlers,
} from '../src/interfaces/message-handlers';
import { FixedClock, InMemoryTransactionRepository, RecordingPublisher } from './support/in-memory';

/**
 * Every routing key `@bank/contracts`' `QUEUES` binds to this service,
 * checked against the router `main.ts` actually assembles — not a hand-kept
 * list that could silently drift from the topology.
 *
 * The gap this closes: `routing/topology.ts` is the broker's declared shape,
 * `sagaHandlers` plus the three standalone handlers are what claims messages
 * at runtime, and nothing before this file compared the two. A binding added
 * to the topology with no handler behind it would sit there forever, logged
 * once per delivery as "message not claimed" — exactly the gap the docstring
 * on `RecordPaymentAttemptUseCase` records having already happened once for
 * `payment.attempt.failed.v1`.
 */

const OWNED_ROUTING_KEYS: readonly string[] = QUEUES.filter(
  (queue) => queue.owner === 'transaction-service',
).flatMap((queue) => queue.bindings.map((binding) => binding.pattern));

/** The router `main.ts` builds, wired with fakes so this stays a unit test. */
function router(): InboundMessageRouter {
  const repository = new InMemoryTransactionRepository();
  const publisher = new RecordingPublisher();
  const clock = new FixedClock(new Date('2026-09-25T09:00:00.000Z'));
  const ids = { next: () => '44444444-4444-4444-8444-444444444401' };
  const logger = new StructuredLogger('transaction-service', () => {
    /* discarded: this suite asserts on routing, not on log lines */
  });

  const saga = new AdvanceSagaUseCase({ repository, publisher, clock, ids });

  return new InboundMessageRouter([
    ...sagaHandlers(saga, logger),
    new PaymentAttemptFailedHandler(new RecordPaymentAttemptUseCase({ repository }), logger),
    new RequestTransferHandler(
      new RequestTransferUseCase({ repository, publisher, saga, clock }),
      logger,
    ),
    new TransactionStatusHandler(new GetTransactionStatusUseCase({ repository, publisher })),
    new TransactionListHandler(new ListTransactionsUseCase({ repository, publisher })),
    new TransactionStatsHandler(new GetTransactionStatsUseCase({ repository, publisher })),
  ]);
}

/** A minimal, contract-valid payload for each routing key this service owns. */
const PAYLOAD_FOR: Record<string, unknown> = {
  'transfer.requested.v1': {
    transactionId: '33333333-3333-4333-8333-333333333333',
    sourceAccount: '11111111-1111-4111-8111-111111111111',
    targetAccount: '22222222-2222-4222-8222-222222222222',
    amount: { amountMinor: 10_000, currency: 'GTQ' },
  },
  'transaction.status.requested.v1': {
    transactionId: '33333333-3333-4333-8333-333333333333',
  },
  'transaction.list.query.v1': {},
  'transaction.stats.query.v1': {},
  'customer.kyc.checked.v1': {
    transactionId: '33333333-3333-4333-8333-333333333333',
    customerId: '77777777-7777-4777-8777-777777777701',
    kycStatus: 'VERIFIED',
    allowed: true,
  },
  'account.debited.v1': {
    transactionId: '33333333-3333-4333-8333-333333333333',
    accountId: '11111111-1111-4111-8111-111111111111',
    amount: { amountMinor: 10_000, currency: 'GTQ' },
    balanceAfter: { amountMinor: 90_000, currency: 'GTQ' },
    debitedAt: '2026-09-25T09:00:00.000Z',
  },
  'account.debit.rejected.v1': {
    transactionId: '33333333-3333-4333-8333-333333333333',
    accountId: '11111111-1111-4111-8111-111111111111',
    reason: 'INSUFFICIENT_FUNDS',
  },
  'account.credited.v1': {
    transactionId: '33333333-3333-4333-8333-333333333333',
    accountId: '22222222-2222-4222-8222-222222222222',
    amount: { amountMinor: 10_000, currency: 'GTQ' },
    balanceAfter: { amountMinor: 110_000, currency: 'GTQ' },
    reactivated: false,
    creditedAt: '2026-09-25T09:00:00.000Z',
  },
  'account.credit.rejected.v1': {
    transactionId: '33333333-3333-4333-8333-333333333333',
    accountId: '22222222-2222-4222-8222-222222222222',
    reason: 'ACCOUNT_NOT_FOUND',
  },
  'account.debit.compensated.v1': {
    transactionId: '33333333-3333-4333-8333-333333333333',
    accountId: '11111111-1111-4111-8111-111111111111',
    amount: { amountMinor: 10_000, currency: 'GTQ' },
    balanceAfter: { amountMinor: 100_000, currency: 'GTQ' },
    compensatedAt: '2026-09-25T09:00:00.000Z',
  },
  'payment.succeeded.v1': {
    paymentId: '44444444-4444-4444-8444-444444444401',
    transactionId: '33333333-3333-4333-8333-333333333333',
    status: 'SUCCEEDED',
    attempt: 1,
    succeededAt: '2026-09-25T09:00:00.000Z',
  },
  'payment.failed.v1': {
    paymentId: '44444444-4444-4444-8444-444444444401',
    transactionId: '33333333-3333-4333-8333-333333333333',
    status: 'FAILED',
    attempt: 3,
    failureReason: 'PAYMENT_RETRIES_EXHAUSTED',
    failedAt: '2026-09-25T09:00:00.000Z',
  },
  'payment.attempt.failed.v1': {
    paymentId: '44444444-4444-4444-8444-444444444401',
    transactionId: '33333333-3333-4333-8333-333333333333',
    attempt: 1,
    errorType: 'TRANSIENT',
    providerResult: 'FAILURE',
    willRetry: true,
    nextAttemptAt: '2026-09-25T09:00:01.000Z',
    failureReason: null,
    failedAt: '2026-09-25T09:00:01.000Z',
  },
};

function envelopeFor(messageType: string): MessageEnvelope<unknown> {
  const payload = PAYLOAD_FOR[messageType];

  if (payload === undefined) {
    throw new Error(`No fixture payload registered for "${messageType}" — add one above.`);
  }

  return createEnvelope(payload, {
    messageType,
    producer: 'transaction-service',
    identity: null,
  });
}

describe('routing coverage: every key this service binds resolves to a handler', () => {
  // Sanity on the fixture itself: if `topology.ts` ever adds or removes a
  // binding for this service and nobody updates this file, this is the line
  // that fails loudly instead of the matrix quietly under-covering it.
  it('the topology currently binds exactly the keys this suite expects to check', () => {
    expect(new Set(OWNED_ROUTING_KEYS)).toEqual(new Set(Object.keys(PAYLOAD_FOR)));
    expect(OWNED_ROUTING_KEYS.length).toBeGreaterThan(0);
  });

  it.each(OWNED_ROUTING_KEYS.map((key) => [key] as const))(
    '%s is claimed by a registered handler',
    async (routingKey) => {
      const claimed = await router().route(envelopeFor(routingKey));

      expect(claimed).toBe(true);
    },
  );

  it('a routing key nothing binds to falls through unclaimed rather than throwing', async () => {
    const envelope = createEnvelope(
      { anything: true },
      { messageType: 'account.opened.v1', producer: 'account-service', identity: null },
    );

    await expect(router().route(envelope)).resolves.toBe(false);
  });
});
