import { transactionStatusRepliedV1 } from '@bank/contracts';

import { AdvanceSagaUseCase } from '../src/application/advance-saga.use-case';
import { GetTransactionStatusUseCase } from '../src/application/get-transaction-status.use-case';
import { RequestTransferUseCase } from '../src/application/request-transfer.use-case';
import { quetzales } from '../src/domain/money';
import type { SagaEvent } from '../src/domain/transaction';
import {
  FixedClock,
  InMemoryTransactionRepository,
  RecordingPublisher,
  SequentialIds,
} from './support/in-memory';

const NOW = new Date('2026-08-26T12:00:00.000Z');

const SOURCE = '11111111-1111-4111-8111-111111111111';
const TARGET = '22222222-2222-4222-8222-222222222222';
const TRANSACTION = '33333333-3333-4333-8333-333333333333';
const PAYMENT = '44444444-4444-4444-8444-444444444401';
const CORRELATION = '55555555-5555-4555-8555-555555555555';

const transferRequest = (overrides: Record<string, unknown> = {}) => ({
  transactionId: TRANSACTION,
  sourceAccount: SOURCE,
  targetAccount: TARGET,
  amount: quetzales(15_000),
  ...overrides,
});

const envelope = (overrides: Record<string, string> = {}) => ({
  messageId: '66666666-6666-4666-8666-666666666601',
  correlationId: CORRELATION,
  idempotencyKey: 'transfer-key-1',
  ...overrides,
});

/** One assembled service, wired the way `main.ts` wires it. */
function world() {
  const repository = new InMemoryTransactionRepository();
  const publisher = new RecordingPublisher();
  const clock = new FixedClock(NOW);
  const ids = new SequentialIds();

  const saga = new AdvanceSagaUseCase({ repository, publisher, clock, ids });

  return {
    repository,
    publisher,
    clock,
    saga,
    request: new RequestTransferUseCase({ repository, publisher, saga, clock }),
    status: new GetTransactionStatusUseCase({ repository, publisher }),
    /** One inbound Saga event, as the interface layer would deliver it. */
    async deliver(
      messageType: string,
      event: SagaEvent,
      payload: unknown = {},
      messageId = messageType,
    ) {
      return await saga.execute({
        transactionId: TRANSACTION,
        event,
        messageId,
        messageType,
        payload,
      });
    },
  };
}

describe('step 1: accepting a transfer', () => {
  it('creates the transaction, announces it in PENDING and orders the debit', async () => {
    const { request, publisher, repository } = world();

    const outcome = await request.execute(transferRequest(), envelope());

    expect(outcome.kind).toBe('STARTED');

    /**
     * The order is the audit trail. `transaction.initiated.v1` says PENDING
     * because that is genuinely where the transfer was when it was announced;
     * a first event already claiming DEBITING would leave no record of the
     * transfer having merely been accepted.
     */
    expect(publisher.typesOf('published')).toEqual(['transaction.initiated.v1']);
    expect(publisher.typesOf('sent')).toEqual(['account.debit.requested.v1']);
    expect(publisher.published[0]!.payload).toMatchObject({ status: 'PENDING' });
    expect(publisher.sent[0]!.payload).toEqual({
      transactionId: TRANSACTION,
      accountId: SOURCE,
      amount: quetzales(15_000),
    });

    expect(repository.transactions.get(TRANSACTION)!.status).toBe('DEBITING');
  });

  it('keeps the correlation the Gateway originated', async () => {
    const { request, repository } = world();

    await request.execute(transferRequest(), envelope());

    expect(repository.transactions.get(TRANSACTION)!.correlationId).toBe(CORRELATION);
  });

  it.each([
    ['a zero amount (T-1)', { amount: quetzales(0) }, 'INVALID_AMOUNT'],
    ['the same account twice (T-2)', { targetAccount: SOURCE }, 'SAME_ACCOUNT_TRANSFER'],
  ])('refuses %s without creating anything', async (_label, difference, reason) => {
    const { request, publisher, repository } = world();

    const outcome = await request.execute(transferRequest(difference), envelope());

    expect(outcome).toEqual({ kind: 'REFUSED', reason });
    expect(repository.transactions.size).toBe(0);
    expect(publisher.typesOf('sent')).toEqual([]);
    expect(publisher.typesOf('published')).toEqual(['transaction.failed.v1']);
    expect(publisher.published[0]!.payload).toMatchObject({ reason, status: 'FAILED' });
  });
});

describe('a repeated idempotency key', () => {
  /** Criterion 2: a duplicate request does not start a second Saga. */
  it('honours the retry with the original and orders nothing again (T-3)', async () => {
    const { request, publisher, repository } = world();

    await request.execute(transferRequest(), envelope());

    const retriedId = '77777777-7777-4777-8777-777777777777';
    const outcome = await request.execute(
      transferRequest({ transactionId: retriedId }),
      envelope({ messageId: '66666666-6666-4666-8666-666666666602' }),
    );

    expect(outcome.kind).toBe('DUPLICATE');
    expect(repository.transactions.size).toBe(1);

    // Exactly what the first request produced, and nothing more.
    expect(publisher.typesOf('sent')).toEqual(['account.debit.requested.v1']);
    expect(publisher.typesOf('published')).toEqual(['transaction.initiated.v1']);
  });

  /**
   * The Gateway mints a fresh identifier per request and hands it back in the
   * `202`, so without the alias the retrying caller holds a receipt for a
   * transfer they cannot look up.
   */
  it("makes the retry's identifier resolve to the original transfer", async () => {
    const { request, repository } = world();

    await request.execute(transferRequest(), envelope());

    const retriedId = '77777777-7777-4777-8777-777777777777';
    await request.execute(transferRequest({ transactionId: retriedId }), envelope());

    await expect(repository.findById(retriedId)).resolves.toMatchObject({
      transactionId: TRANSACTION,
    });
  });

  it('refuses a different request wearing a used key (T-4)', async () => {
    const { request, publisher, repository } = world();

    await request.execute(transferRequest(), envelope());

    const outcome = await request.execute(
      transferRequest({
        transactionId: '77777777-7777-4777-8777-777777777777',
        amount: quetzales(999_999),
      }),
      envelope(),
    );

    expect(outcome).toEqual({ kind: 'REFUSED', reason: 'IDEMPOTENCY_KEY_CONFLICT' });
    expect(repository.transactions.size).toBe(1);
    expect(repository.transactions.get(TRANSACTION)!.amount).toEqual(quetzales(15_000));

    /**
     * And no alias: pointing the refused identifier at somebody else's transfer
     * would answer a lie to whoever followed it.
     */
    expect(repository.aliases.size).toBe(0);
    expect(publisher.typesOf('published')).toContain('transaction.failed.v1');
  });
});

describe('the happy path, end to end', () => {
  it('produces exactly the flow docs/events/examples/happy-path.json records', async () => {
    const { request, deliver, publisher, repository } = world();

    await request.execute(transferRequest(), envelope());
    await deliver('account.debited.v1', { kind: 'DEBITED' });
    await deliver(
      'payment.succeeded.v1',
      { kind: 'PAYMENT_SUCCEEDED' },
      {
        paymentId: PAYMENT,
        attempt: 1,
        succeededAt: '2026-08-26T12:00:03.000Z',
      },
    );
    await deliver('account.credited.v1', { kind: 'CREDITED' });

    expect([...publisher.typesOf('published'), ...publisher.typesOf('sent')].sort()).toEqual(
      [
        'account.credit.requested.v1',
        'account.debit.requested.v1',
        'payment.requested.v1',
        'transaction.completed.v1',
        'transaction.initiated.v1',
      ].sort(),
    );

    expect(repository.transactions.get(TRANSACTION)!.status).toBe('COMPLETED');
    expect(repository.transactions.get(TRANSACTION)!.completedAt).toEqual(NOW);
  });

  /** Criterion 6: COMPLETED happens only after the credit is confirmed. */
  it('does not complete on the payment alone', async () => {
    const { request, deliver, publisher, repository } = world();

    await request.execute(transferRequest(), envelope());
    await deliver('account.debited.v1', { kind: 'DEBITED' });
    await deliver('payment.succeeded.v1', { kind: 'PAYMENT_SUCCEEDED' });

    expect(repository.transactions.get(TRANSACTION)!.status).toBe('PAYMENT_PENDING');
    expect(publisher.typesOf('published')).not.toContain('transaction.completed.v1');
    expect(publisher.typesOf('sent')).toContain('account.credit.requested.v1');
  });

  it('orders the credit into the target account, not the source', async () => {
    const { request, deliver, publisher } = world();

    await request.execute(transferRequest(), envelope());
    await deliver('account.debited.v1', { kind: 'DEBITED' });
    await deliver('payment.succeeded.v1', { kind: 'PAYMENT_SUCCEEDED' });

    const credit = publisher.sent.find((m) => m.messageType === 'account.credit.requested.v1');

    expect(credit!.payload).toEqual({
      transactionId: TRANSACTION,
      accountId: TARGET,
      amount: quetzales(15_000),
    });
  });

  /**
   * The demonstration scenario travels the last leg of its journey. It is
   * carried, never obeyed: nothing in this service branches on the value.
   */
  it('carries the payment scenario to Payment Service untouched', async () => {
    const { request, deliver, publisher } = world();

    await request.execute(transferRequest({ paymentScenario: 'REJECT' }), envelope());
    await deliver('account.debited.v1', { kind: 'DEBITED' });

    const payment = publisher.sent.find((m) => m.messageType === 'payment.requested.v1');

    expect(payment!.payload).toEqual({
      paymentId: PAYMENT,
      transactionId: TRANSACTION,
      amount: quetzales(15_000),
      scenario: 'REJECT',
    });
  });

  it('omits the scenario entirely when nobody chose one', async () => {
    const { request, deliver, publisher } = world();

    await request.execute(transferRequest(), envelope());
    await deliver('account.debited.v1', { kind: 'DEBITED' });

    const payment = publisher.sent.find((m) => m.messageType === 'payment.requested.v1');

    expect(payment!.payload).not.toHaveProperty('scenario');
  });
});

describe('the rejected path', () => {
  /** Criterion 4: insufficient funds ends in FAILED, and no balance is touched here. */
  it('closes in FAILED and orders nothing further', async () => {
    const { request, deliver, publisher, repository } = world();

    await request.execute(transferRequest(), envelope());
    await deliver('account.debit.rejected.v1', {
      kind: 'DEBIT_REJECTED',
      reason: 'INSUFFICIENT_FUNDS',
    });

    expect(repository.transactions.get(TRANSACTION)!.status).toBe('FAILED');
    expect(repository.transactions.get(TRANSACTION)!.failureReason).toBe('INSUFFICIENT_FUNDS');

    expect(publisher.typesOf('sent')).toEqual(['account.debit.requested.v1']);
    expect(publisher.published.at(-1)).toEqual({
      messageType: 'transaction.failed.v1',
      payload: {
        transactionId: TRANSACTION,
        status: 'FAILED',
        reason: 'INSUFFICIENT_FUNDS',
        failedAt: NOW.toISOString(),
      },
    });
  });

  it('never orders a compensation for money that never left', async () => {
    const { request, deliver, publisher } = world();

    await request.execute(transferRequest(), envelope());
    await deliver('account.debit.rejected.v1', {
      kind: 'DEBIT_REJECTED',
      reason: 'ACCOUNT_INACTIVE',
    });

    expect(publisher.typesOf('sent')).not.toContain('account.debit.compensation.requested.v1');
  });
});

describe('the compensated path', () => {
  /** Criterion 5: a payment rejected after the debit ends in COMPENSATED. */
  it('orders the compensation and closes in COMPENSATED once it is confirmed', async () => {
    const { request, deliver, publisher, repository } = world();

    await request.execute(transferRequest(), envelope());
    await deliver('account.debited.v1', { kind: 'DEBITED' });
    await deliver(
      'payment.failed.v1',
      { kind: 'PAYMENT_FAILED', reason: 'PAYMENT_RETRIES_EXHAUSTED' },
      {
        paymentId: PAYMENT,
        attempt: 3,
        failureReason: 'PAYMENT_RETRIES_EXHAUSTED',
        failedAt: '2026-08-26T12:00:30.000Z',
      },
    );

    const compensation = publisher.sent.at(-1)!;

    expect(compensation).toEqual({
      messageType: 'account.debit.compensation.requested.v1',
      payload: {
        transactionId: TRANSACTION,
        // Back where it came from. A compensation is not a transfer.
        accountId: SOURCE,
        amount: quetzales(15_000),
        triggeredBy: 'PAYMENT_RETRIES_EXHAUSTED',
      },
    });

    // Not COMPENSATED yet: the money has not come back.
    expect(repository.transactions.get(TRANSACTION)!.status).toBe('PAYMENT_PENDING');

    await deliver('account.debit.compensated.v1', { kind: 'DEBIT_COMPENSATED' });

    expect(repository.transactions.get(TRANSACTION)!.status).toBe('COMPENSATED');
    expect(publisher.published.at(-1)).toEqual({
      messageType: 'transaction.compensated.v1',
      payload: {
        transactionId: TRANSACTION,
        status: 'COMPENSATED',
        reason: 'PAYMENT_RETRIES_EXHAUSTED',
        compensatedAt: NOW.toISOString(),
      },
    });
  });

  /**
   * T-7 as behaviour rather than as a unit test: a Saga that got as far as the
   * debit never announces `transaction.failed.v1`, whatever goes wrong after.
   */
  it('never announces FAILED once the money has moved (T-7)', async () => {
    const { request, deliver, publisher } = world();

    await request.execute(transferRequest(), envelope());
    await deliver('account.debited.v1', { kind: 'DEBITED' });
    await deliver('payment.failed.v1', { kind: 'PAYMENT_FAILED', reason: 'PAYMENT_DECLINED' });
    await deliver('account.debit.compensated.v1', { kind: 'DEBIT_COMPENSATED' });

    expect(publisher.typesOf('published')).not.toContain('transaction.failed.v1');
  });

  it('compensates a rejected credit by the same path', async () => {
    const { request, deliver, publisher } = world();

    await request.execute(transferRequest(), envelope());
    await deliver('account.debited.v1', { kind: 'DEBITED' });
    await deliver('payment.succeeded.v1', { kind: 'PAYMENT_SUCCEEDED' });
    await deliver('account.credit.rejected.v1', {
      kind: 'CREDIT_REJECTED',
      reason: 'ACCOUNT_NOT_FOUND',
    });

    expect(publisher.sent.at(-1)).toMatchObject({
      messageType: 'account.debit.compensation.requested.v1',
      payload: { triggeredBy: 'ACCOUNT_NOT_FOUND' },
    });
  });
});

describe('events that must change nothing', () => {
  /** T-5: a redelivery produces no second transition and no second command. */
  it('applies a redelivered event exactly once', async () => {
    const { request, deliver, publisher, repository } = world();

    await request.execute(transferRequest(), envelope());
    await deliver('account.debited.v1', { kind: 'DEBITED' }, {}, 'the-same-message');
    const second = await deliver('account.debited.v1', { kind: 'DEBITED' }, {}, 'the-same-message');

    expect(second.kind).toBe('DUPLICATE');
    expect(repository.transactions.get(TRANSACTION)!.status).toBe('PAYMENT_PENDING');
    expect(publisher.sent.filter((m) => m.messageType === 'payment.requested.v1')).toHaveLength(1);
  });

  /** T-6: an out-of-order event is discarded, recorded, and changes nothing. */
  it('discards an event that has no place in the current state, and records it', async () => {
    const { request, deliver, publisher, repository } = world();

    await request.execute(transferRequest(), envelope());

    const outcome = await deliver('account.credited.v1', { kind: 'CREDITED' });

    expect(outcome).toEqual({ kind: 'ILLEGAL', from: 'DEBITING', event: 'CREDITED' });
    expect(repository.transactions.get(TRANSACTION)!.status).toBe('DEBITING');
    expect(publisher.typesOf('published')).toEqual(['transaction.initiated.v1']);

    expect(repository.events.map((e) => e.messageType)).toContain('account.credited.v1#discarded');
  });

  it('ignores an event about a transaction it does not hold', async () => {
    const { deliver, publisher } = world();

    const outcome = await deliver('account.debited.v1', { kind: 'DEBITED' });

    expect(outcome).toEqual({ kind: 'UNKNOWN_TRANSACTION' });
    expect(publisher.everything).toEqual([]);
  });

  /**
   * The out-of-order case that would cost real money: a late
   * `account.credited.v1` after the transfer was already compensated.
   */
  it('refuses to complete a transfer that was already refunded', async () => {
    const { request, deliver, publisher, repository } = world();

    await request.execute(transferRequest(), envelope());
    await deliver('account.debited.v1', { kind: 'DEBITED' });
    await deliver('payment.failed.v1', { kind: 'PAYMENT_FAILED', reason: 'PAYMENT_DECLINED' });
    await deliver('account.debit.compensated.v1', { kind: 'DEBIT_COMPENSATED' });

    const late = await deliver('account.credited.v1', { kind: 'CREDITED' });

    expect(late).toMatchObject({ kind: 'ILLEGAL', from: 'COMPENSATED' });
    expect(repository.transactions.get(TRANSACTION)!.status).toBe('COMPENSATED');
    expect(publisher.typesOf('published')).not.toContain('transaction.completed.v1');
  });
});

describe('the status query', () => {
  /** Criterion 7: the answer carries the correlation the transfer was born in. */
  it("answers with the original correlation, not the question's", async () => {
    const { request, status, publisher } = world();

    await request.execute(transferRequest(), envelope());

    await status.execute({ transactionId: TRANSACTION });

    const reply = publisher.replies.at(-1)!;

    expect(transactionStatusRepliedV1.schema.safeParse(reply.payload).success).toBe(true);
    expect(reply.payload).toMatchObject({
      outcome: 'FOUND',
      transactionId: TRANSACTION,
      status: 'DEBITING',
      originCorrelationId: CORRELATION,
      reason: null,
    });
  });

  it('reports the payment step from its own trail', async () => {
    const { request, deliver, status, publisher } = world();

    await request.execute(transferRequest(), envelope());
    await deliver('account.debited.v1', { kind: 'DEBITED' });

    await status.execute({ transactionId: TRANSACTION });

    // Ordered and undecided is a real state, and a different statement from
    // "there is no payment".
    expect(publisher.replies.at(-1)!.payload).toMatchObject({
      payment: { paymentId: PAYMENT, status: 'PENDING', attempt: null, decidedAt: null },
    });

    await deliver(
      'payment.failed.v1',
      { kind: 'PAYMENT_FAILED', reason: 'PAYMENT_DECLINED' },
      {
        paymentId: PAYMENT,
        attempt: 2,
        failureReason: 'PAYMENT_DECLINED',
        failedAt: '2026-08-26T12:00:30.000Z',
      },
    );

    await status.execute({ transactionId: TRANSACTION });

    const reply = publisher.replies.at(-1)!;

    expect(transactionStatusRepliedV1.schema.safeParse(reply.payload).success).toBe(true);
    expect(reply.payload).toMatchObject({
      payment: {
        paymentId: PAYMENT,
        status: 'FAILED',
        attempt: 2,
        reason: 'PAYMENT_DECLINED',
        decidedAt: '2026-08-26T12:00:30.000Z',
      },
    });
  });

  it("answers a retry's identifier with the transfer it aliases", async () => {
    const { request, status, publisher } = world();

    await request.execute(transferRequest(), envelope());

    const retriedId = '77777777-7777-4777-8777-777777777777';
    await request.execute(transferRequest({ transactionId: retriedId }), envelope());

    await status.execute({ transactionId: retriedId });

    expect(publisher.replies.at(-1)!.payload).toMatchObject({
      outcome: 'FOUND',
      transactionId: TRANSACTION,
    });
  });

  it('finds a transfer by the correlation it was created under', async () => {
    const { request, status, publisher } = world();

    await request.execute(transferRequest(), envelope());

    await status.execute({ correlationId: CORRELATION });

    expect(publisher.replies.at(-1)!.payload).toMatchObject({ transactionId: TRANSACTION });
  });

  it('says NOT_FOUND rather than inventing a transfer', async () => {
    const { status, publisher } = world();

    await status.execute({ transactionId: TRANSACTION });

    expect(publisher.replies.at(-1)!.payload).toEqual({ outcome: 'NOT_FOUND' });
  });
});
