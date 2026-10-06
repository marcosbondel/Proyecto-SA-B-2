import { transactionStatusRepliedV1 } from '@bank/contracts';
import type { PaymentAttemptFailedV1 } from '@bank/contracts';

import { AdvanceSagaUseCase } from '../src/application/advance-saga.use-case';
import { GetTransactionStatusUseCase } from '../src/application/get-transaction-status.use-case';
import { RecordPaymentAttemptUseCase } from '../src/application/record-payment-attempt.use-case';
import { RequestTransferUseCase } from '../src/application/request-transfer.use-case';
import { quetzales } from '../src/domain/money';
import { openTransaction } from '../src/domain/transaction';
import type { SagaEvent } from '../src/domain/transaction';
import {
  FixedClock,
  InMemoryTransactionRepository,
  RecordingPublisher,
  RecordingTransferTelemetry,
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

/**
 * Whoever asked for the transfer. Recorded on the row and used to scope reads;
 * the other actors — staff, a stranger — live in `listing-and-scope.spec.ts`,
 * which is the suite about the scope itself.
 */
const OWNER = { customerId: '77777777-7777-4777-8777-777777777701', role: 'CLIENTE' as const };
const envelope = (overrides: Record<string, unknown> = {}) => ({
  messageId: '66666666-6666-4666-8666-666666666601',
  correlationId: CORRELATION,
  idempotencyKey: 'transfer-key-1',
  identity: OWNER,
  ...overrides,
});

/** One assembled service, wired the way `main.ts` wires it. */
function world() {
  const repository = new InMemoryTransactionRepository();
  const publisher = new RecordingPublisher();
  const clock = new FixedClock(NOW);
  const ids = new SequentialIds();

  const telemetry = new RecordingTransferTelemetry();
  const saga = new AdvanceSagaUseCase({ repository, publisher, clock, ids, telemetry });
  const attempts = new RecordPaymentAttemptUseCase({ repository, telemetry });

  return {
    repository,
    publisher,
    clock,
    saga,
    request: new RequestTransferUseCase({ repository, publisher, saga, clock, telemetry }),
    status: new GetTransactionStatusUseCase({ repository, publisher }),
    /**
     * The KYC gate's own answer, as `customer.kyc.checked.v1` would deliver it
     * — `allowed: true`, the common case every test below the request step
     * assumes unless it is testing the gate itself.
     */
    async approveKyc(messageId = 'customer.kyc.checked.v1') {
      return await saga.execute({
        transactionId: TRANSACTION,
        event: { kind: 'KYC_APPROVED' },
        messageId,
        messageType: 'customer.kyc.checked.v1',
        payload: {},
      });
    },
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
    /** One `payment.attempt.failed.v1`, as the interface layer would deliver it. */
    async deliverAttempt(overrides: Partial<PaymentAttemptFailedV1>, messageId: string) {
      const payload: PaymentAttemptFailedV1 = {
        paymentId: PAYMENT,
        transactionId: TRANSACTION,
        attempt: 1,
        errorType: 'TRANSIENT',
        providerResult: 'FAILURE',
        willRetry: true,
        nextAttemptAt: '2026-08-26T12:00:01.000Z',
        failureReason: null,
        failedAt: '2026-08-26T12:00:01.000Z',
        ...overrides,
      };

      return await attempts.execute(payload, {
        messageId,
        messageType: 'payment.attempt.failed.v1',
        correlationId: 'corr-attempt',
      });
    },
  };
}

describe('step 1: accepting a transfer', () => {
  it('creates the transaction, announces it in PENDING and asks the KYC gate (T-31)', async () => {
    const { request, publisher, repository } = world();

    const outcome = await request.execute(transferRequest(), envelope());

    expect(outcome.kind).toBe('STARTED');

    /**
     * The order is the audit trail. `transaction.initiated.v1` says PENDING
     * because that is genuinely where the transfer was when it was announced;
     * a first event already claiming DEBITING would leave no record of the
     * transfer having merely been accepted. `KYC_CHECK_ORDERED` is a
     * self-transition — the gate is asked before anything else, and the
     * transaction stays PENDING until it answers.
     */
    expect(publisher.typesOf('published')).toEqual(['transaction.initiated.v1']);
    expect(publisher.typesOf('sent')).toEqual(['customer.kyc.check.requested.v1']);
    expect(publisher.published[0]!.payload).toMatchObject({ status: 'PENDING' });
    expect(publisher.sent[0]!.payload).toEqual({
      transactionId: TRANSACTION,
      customerId: OWNER.customerId,
    });

    expect(repository.transactions.get(TRANSACTION)!.status).toBe('PENDING');
  });

  it('orders the debit once the KYC gate approves', async () => {
    const { request, approveKyc, publisher, repository } = world();

    await request.execute(transferRequest(), envelope());
    const outcome = await approveKyc();

    expect(outcome.kind).toBe('APPLIED');
    expect(publisher.typesOf('sent')).toEqual([
      'customer.kyc.check.requested.v1',
      'account.debit.requested.v1',
    ]);
    expect(publisher.sent[1]!.payload).toEqual({
      transactionId: TRANSACTION,
      accountId: SOURCE,
      amount: quetzales(15_000),
    });

    expect(repository.transactions.get(TRANSACTION)!.status).toBe('DEBITING');
  });

  it('closes in FAILED, orders no debit, when the KYC gate refuses (T-31)', async () => {
    const { request, deliver, publisher, repository } = world();

    await request.execute(transferRequest(), envelope());
    await deliver('customer.kyc.checked.v1', {
      kind: 'KYC_REJECTED',
      reason: 'KYC_NOT_VERIFIED',
    });

    expect(repository.transactions.get(TRANSACTION)!.status).toBe('FAILED');
    expect(repository.transactions.get(TRANSACTION)!.failureReason).toBe('KYC_NOT_VERIFIED');
    expect(publisher.typesOf('sent')).toEqual(['customer.kyc.check.requested.v1']);
    expect(publisher.published.at(-1)).toEqual({
      messageType: 'transaction.failed.v1',
      payload: {
        transactionId: TRANSACTION,
        customerId: OWNER.customerId,
        status: 'FAILED',
        reason: 'KYC_NOT_VERIFIED',
        failedAt: NOW.toISOString(),
      },
    });
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
  /**
   * Criterion 2: a duplicate request does not start a second Saga. It does,
   * harmlessly, re-ask the still-pending KYC gate: `KYC_CHECK_ORDERED` is a
   * self-transition, so the transaction is still `PENDING` when this second,
   * genuinely different delivery (`messageId` `...602`) arrives, and
   * `isPending` resumes it exactly as it would a crash. Asking a question
   * twice produces two identical answers, never two effects — the guarantee
   * this test actually protects is the one below: no second row.
   */
  it('honours the retry with the original and starts no second Saga (T-3)', async () => {
    const { request, publisher, repository } = world();

    await request.execute(transferRequest(), envelope());

    const retriedId = '77777777-7777-4777-8777-777777777777';
    const outcome = await request.execute(
      transferRequest({ transactionId: retriedId }),
      envelope({ messageId: '66666666-6666-4666-8666-666666666602' }),
    );

    expect(outcome.kind).toBe('DUPLICATE');
    expect(repository.transactions.size).toBe(1);

    expect(publisher.typesOf('sent')).toEqual([
      'customer.kyc.check.requested.v1',
      'customer.kyc.check.requested.v1',
    ]);
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

describe('a transfer request that crashed before its Saga started', () => {
  /**
   * `repository.start` commits the row and publishes `transaction.initiated.v1`
   * before `saga.execute` ever orders the KYC check — three steps that used to
   * be three separate moments with nothing guaranteeing the process stayed
   * alive between them. This reproduces the crash directly: the row exists, in
   * `PENDING`, with no KYC check ever ordered — exactly what a process death
   * right after `start` leaves behind.
   */
  const stuck = () =>
    openTransaction({
      transactionId: TRANSACTION,
      sourceAccount: SOURCE,
      targetAccount: TARGET,
      amount: quetzales(15_000),
      correlationId: CORRELATION,
      idempotencyKey: 'transfer-key-1',
      customerId: OWNER.customerId,
      reference: null,
      paymentScenario: null,
      now: NOW,
    });

  it('resumes the KYC check on the next delivery, and orders it exactly once', async () => {
    const { request, repository, publisher } = world();

    await repository.start({ transaction: stuck() });
    expect(repository.transactions.get(TRANSACTION)!.status).toBe('PENDING');

    // The broker redelivers the request that crashed.
    const outcome = await request.execute(transferRequest(), envelope());

    expect(outcome.kind).toBe('DUPLICATE');
    // A self-transition: the gate is asked, and nothing has answered yet.
    expect(repository.transactions.get(TRANSACTION)!.status).toBe('PENDING');
    expect(publisher.typesOf('sent')).toEqual(['customer.kyc.check.requested.v1']);
  });

  /** T-5 still holds for the resume: a second identical redelivery is a no-op. */
  it('does not order a second KYC check for a further redelivery of the same message', async () => {
    const { request, repository, publisher } = world();

    await repository.start({ transaction: stuck() });

    await request.execute(transferRequest(), envelope());
    await request.execute(transferRequest(), envelope()); // same messageId again

    expect(repository.transactions.get(TRANSACTION)!.status).toBe('PENDING');
    expect(publisher.typesOf('sent')).toEqual(['customer.kyc.check.requested.v1']);
  });

  /**
   * The other half of the fix: a transfer that already moved on must not be
   * resumed. This is T-3's existing guarantee, restated here so the two
   * branches of `#existing` are each demonstrated on their own. "Moved on" is
   * now the KYC gate's own answer, not the request step itself — the request
   * step alone is a self-transition, so a redelivery that arrives before the
   * gate answers still resumes (harmlessly, see the test above).
   */
  it('does nothing extra when the redelivery finds a transfer that already moved on', async () => {
    const { request, approveKyc, publisher } = world();

    await request.execute(transferRequest(), envelope());
    await approveKyc();
    await request.execute(
      transferRequest({ transactionId: '88888888-8888-4888-8888-888888888888' }),
      envelope({ messageId: '66666666-6666-4666-8666-666666666699' }),
    );

    expect(publisher.typesOf('sent')).toEqual([
      'customer.kyc.check.requested.v1',
      'account.debit.requested.v1',
    ]);
  });
});

describe('the happy path, end to end', () => {
  it('produces exactly the flow docs/events/examples/happy-path.json records', async () => {
    const { request, approveKyc, deliver, publisher, repository } = world();

    await request.execute(transferRequest(), envelope());
    await approveKyc();
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
        'customer.kyc.check.requested.v1',
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
    const { request, approveKyc, deliver, publisher, repository } = world();

    await request.execute(transferRequest(), envelope());
    await approveKyc();
    await deliver('account.debited.v1', { kind: 'DEBITED' });
    await deliver('payment.succeeded.v1', { kind: 'PAYMENT_SUCCEEDED' });

    expect(repository.transactions.get(TRANSACTION)!.status).toBe('PAYMENT_PENDING');
    expect(publisher.typesOf('published')).not.toContain('transaction.completed.v1');
    expect(publisher.typesOf('sent')).toContain('account.credit.requested.v1');
  });

  it('orders the credit into the target account, not the source', async () => {
    const { request, approveKyc, deliver, publisher } = world();

    await request.execute(transferRequest(), envelope());
    await approveKyc();
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
    const { request, approveKyc, deliver, publisher } = world();

    await request.execute(transferRequest({ paymentScenario: 'REJECT' }), envelope());
    await approveKyc();
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
    const { request, approveKyc, deliver, publisher } = world();

    await request.execute(transferRequest(), envelope());
    await approveKyc();
    await deliver('account.debited.v1', { kind: 'DEBITED' });

    const payment = publisher.sent.find((m) => m.messageType === 'payment.requested.v1');

    expect(payment!.payload).not.toHaveProperty('scenario');
  });
});

describe('the rejected path', () => {
  /** Criterion 4: insufficient funds ends in FAILED, and no balance is touched here. */
  it('closes in FAILED and orders nothing further', async () => {
    const { request, approveKyc, deliver, publisher, repository } = world();

    await request.execute(transferRequest(), envelope());
    await approveKyc();
    await deliver('account.debit.rejected.v1', {
      kind: 'DEBIT_REJECTED',
      reason: 'INSUFFICIENT_FUNDS',
    });

    expect(repository.transactions.get(TRANSACTION)!.status).toBe('FAILED');
    expect(repository.transactions.get(TRANSACTION)!.failureReason).toBe('INSUFFICIENT_FUNDS');

    expect(publisher.typesOf('sent')).toEqual([
      'customer.kyc.check.requested.v1',
      'account.debit.requested.v1',
    ]);
    expect(publisher.published.at(-1)).toEqual({
      messageType: 'transaction.failed.v1',
      payload: {
        transactionId: TRANSACTION,
        customerId: OWNER.customerId,
        status: 'FAILED',
        reason: 'INSUFFICIENT_FUNDS',
        failedAt: NOW.toISOString(),
      },
    });
  });

  it('never orders a compensation for money that never left', async () => {
    const { request, approveKyc, deliver, publisher } = world();

    await request.execute(transferRequest(), envelope());
    await approveKyc();
    await deliver('account.debit.rejected.v1', {
      kind: 'DEBIT_REJECTED',
      reason: 'ACCOUNT_INACTIVE',
    });

    expect(publisher.typesOf('sent')).not.toContain('account.debit.compensation.requested.v1');
  });
});

describe('the compensated path', () => {
  /**
   * Criterion 5: a payment rejected after the debit ends in COMPENSATED.
   *
   * The `customerId` in the final assertion is load-bearing and comes from the
   * **row**: nothing delivered here carries it, and `saga.execute` never sees
   * an envelope. That is the point. `PAYMENT_RETRIES_EXHAUSTED` is reached only
   * through Payment Service's retry sweeper, which republishes on a timer and
   * so has no session to inherit an identity from — so the event announcing
   * that the money came back used to reach Notification & Audit with nobody to
   * tell, and the one message a customer is actively waiting for was recorded
   * `FAILED`. This service is the last one that still knows whose transfer it
   * was.
   */
  it('orders the compensation and closes in COMPENSATED once it is confirmed', async () => {
    const { request, approveKyc, deliver, publisher, repository } = world();

    await request.execute(transferRequest(), envelope());
    await approveKyc();
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
        customerId: OWNER.customerId,
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
    const { request, approveKyc, deliver, publisher } = world();

    await request.execute(transferRequest(), envelope());
    await approveKyc();
    await deliver('account.debited.v1', { kind: 'DEBITED' });
    await deliver('payment.failed.v1', { kind: 'PAYMENT_FAILED', reason: 'PAYMENT_DECLINED' });
    await deliver('account.debit.compensated.v1', { kind: 'DEBIT_COMPENSATED' });

    expect(publisher.typesOf('published')).not.toContain('transaction.failed.v1');
  });

  it('compensates a rejected credit by the same path', async () => {
    const { request, approveKyc, deliver, publisher } = world();

    await request.execute(transferRequest(), envelope());
    await approveKyc();
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
    const { request, approveKyc, deliver, publisher, repository } = world();

    await request.execute(transferRequest(), envelope());
    await approveKyc();
    await deliver('account.debited.v1', { kind: 'DEBITED' }, {}, 'the-same-message');
    const second = await deliver('account.debited.v1', { kind: 'DEBITED' }, {}, 'the-same-message');

    expect(second.kind).toBe('DUPLICATE');
    expect(repository.transactions.get(TRANSACTION)!.status).toBe('PAYMENT_PENDING');
    expect(publisher.sent.filter((m) => m.messageType === 'payment.requested.v1')).toHaveLength(1);
  });

  /** T-6: an out-of-order event is discarded, recorded, and changes nothing. */
  it('discards an event that has no place in the current state, and records it', async () => {
    const { request, approveKyc, deliver, publisher, repository } = world();

    await request.execute(transferRequest(), envelope());
    await approveKyc();

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
    const { request, approveKyc, deliver, publisher, repository } = world();

    await request.execute(transferRequest(), envelope());
    await approveKyc();
    await deliver('account.debited.v1', { kind: 'DEBITED' });
    await deliver('payment.failed.v1', { kind: 'PAYMENT_FAILED', reason: 'PAYMENT_DECLINED' });
    await deliver('account.debit.compensated.v1', { kind: 'DEBIT_COMPENSATED' });

    const late = await deliver('account.credited.v1', { kind: 'CREDITED' });

    expect(late).toMatchObject({ kind: 'ILLEGAL', from: 'COMPENSATED' });
    expect(repository.transactions.get(TRANSACTION)!.status).toBe('COMPENSATED');
    expect(publisher.typesOf('published')).not.toContain('transaction.completed.v1');
  });
});

describe('recording one rung of the retry ladder', () => {
  /** Never a transition: the status the Saga sees is untouched either way. */
  it('records the attempt without moving the Saga', async () => {
    const { request, approveKyc, deliver, deliverAttempt, repository } = world();

    await request.execute(transferRequest(), envelope());
    await approveKyc();
    await deliver('account.debited.v1', { kind: 'DEBITED' });

    const outcome = await deliverAttempt({ attempt: 1 }, 'attempt-1');

    expect(outcome).toMatchObject({ kind: 'RECORDED' });
    expect(repository.transactions.get(TRANSACTION)!.status).toBe('PAYMENT_PENDING');
  });

  /** T-5: a redelivered attempt is not a second rung. */
  it('claims a redelivered attempt exactly once (T-5)', async () => {
    const { request, approveKyc, deliver, deliverAttempt } = world();

    await request.execute(transferRequest(), envelope());
    await approveKyc();
    await deliver('account.debited.v1', { kind: 'DEBITED' });

    const first = await deliverAttempt({ attempt: 1 }, 'the-same-attempt');
    const second = await deliverAttempt({ attempt: 1 }, 'the-same-attempt');

    expect(first).toMatchObject({ kind: 'RECORDED' });
    expect(second).toEqual({ kind: 'DUPLICATE' });
  });

  /**
   * The same race `applyEvent` already handles for every other Saga event: an
   * attempt for a transaction this replica has not committed yet is a race,
   * not a fault, and must record nothing rather than orphan a trail entry.
   */
  it('claims nothing for an attempt about a transaction it does not hold', async () => {
    const { deliverAttempt, repository } = world();

    const outcome = await deliverAttempt({ transactionId: '99999999-9999-4999-8999-999999999999' }, 'orphan-attempt');

    expect(outcome).toEqual({ kind: 'UNKNOWN_TRANSACTION' });
    expect(repository.events).toEqual([]);
  });
});

describe('the status query', () => {
  /** Criterion 7: the answer carries the correlation the transfer was born in. */
  it("answers with the original correlation, not the question's", async () => {
    const { request, status, publisher } = world();

    await request.execute(transferRequest(), envelope());

    await status.execute({ transactionId: TRANSACTION }, OWNER);

    const reply = publisher.replies.at(-1)!;

    expect(transactionStatusRepliedV1.schema.safeParse(reply.payload).success).toBe(true);
    expect(reply.payload).toMatchObject({
      outcome: 'FOUND',
      transactionId: TRANSACTION,
      // Right after acceptance, still awaiting the KYC gate's verdict (T-31).
      status: 'PENDING',
      originCorrelationId: CORRELATION,
      reason: null,
    });
  });

  it('reports the payment step from its own trail', async () => {
    const { request, approveKyc, deliver, status, publisher } = world();

    await request.execute(transferRequest(), envelope());
    await approveKyc();
    await deliver('account.debited.v1', { kind: 'DEBITED' });

    await status.execute({ transactionId: TRANSACTION }, OWNER);

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

    await status.execute({ transactionId: TRANSACTION }, OWNER);

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

  /**
   * The gap `payment.attempt.failed.v1` closes: before a verdict arrives, the
   * status query used to be able to say only "ordered and undecided" — it could
   * not tell a payment about to be tried for the first time apart from one on
   * its third rung with the money still debited. `attempt` and `errorType` now
   * climb while the payment is still `PENDING`.
   */
  it('shows the ladder being climbed before any verdict arrives', async () => {
    const { request, approveKyc, deliver, deliverAttempt, status, publisher } = world();

    await request.execute(transferRequest(), envelope());
    await approveKyc();
    await deliver('account.debited.v1', { kind: 'DEBITED' });

    await deliverAttempt({ attempt: 1, errorType: 'TRANSIENT' }, 'attempt-1');
    await status.execute({ transactionId: TRANSACTION }, OWNER);

    expect(publisher.replies.at(-1)!.payload).toMatchObject({
      status: 'PAYMENT_PENDING', // unaffected: this is a trail entry, not a transition
      payment: { paymentId: PAYMENT, status: 'PENDING', attempt: 1, errorType: 'TRANSIENT' },
    });

    await deliverAttempt({ attempt: 2, errorType: 'TRANSIENT' }, 'attempt-2');
    await status.execute({ transactionId: TRANSACTION }, OWNER);

    const reply = publisher.replies.at(-1)!;

    expect(transactionStatusRepliedV1.schema.safeParse(reply.payload).success).toBe(true);
    expect(reply.payload).toMatchObject({
      payment: { paymentId: PAYMENT, status: 'PENDING', attempt: 2, errorType: 'TRANSIENT' },
    });
  });

  it('does not let a late attempt row regress a payment that already has a verdict', async () => {
    const { request, approveKyc, deliver, deliverAttempt, status, publisher } = world();

    await request.execute(transferRequest(), envelope());
    await approveKyc();
    await deliver('account.debited.v1', { kind: 'DEBITED' });
    await deliver(
      'payment.succeeded.v1',
      { kind: 'PAYMENT_SUCCEEDED' },
      { paymentId: PAYMENT, attempt: 1, succeededAt: '2026-08-26T12:00:03.000Z' },
    );

    // A stray, out-of-order redelivery of an earlier rung's attempt row.
    await deliverAttempt({ attempt: 1, errorType: 'TRANSIENT' }, 'late-attempt-1');

    await status.execute({ transactionId: TRANSACTION }, OWNER);

    expect(publisher.replies.at(-1)!.payload).toMatchObject({
      payment: { paymentId: PAYMENT, status: 'SUCCEEDED' },
    });
  });

  it("answers a retry's identifier with the transfer it aliases", async () => {
    const { request, status, publisher } = world();

    await request.execute(transferRequest(), envelope());

    const retriedId = '77777777-7777-4777-8777-777777777777';
    await request.execute(transferRequest({ transactionId: retriedId }), envelope());

    await status.execute({ transactionId: retriedId }, OWNER);

    expect(publisher.replies.at(-1)!.payload).toMatchObject({
      outcome: 'FOUND',
      transactionId: TRANSACTION,
    });
  });

  it('finds a transfer by the correlation it was created under', async () => {
    const { request, status, publisher } = world();

    await request.execute(transferRequest(), envelope());

    await status.execute({ correlationId: CORRELATION }, OWNER);

    expect(publisher.replies.at(-1)!.payload).toMatchObject({ transactionId: TRANSACTION });
  });

  it('says NOT_FOUND rather than inventing a transfer', async () => {
    const { status, publisher } = world();

    await status.execute({ transactionId: TRANSACTION }, OWNER);

    expect(publisher.replies.at(-1)!.payload).toEqual({ outcome: 'NOT_FOUND' });
  });
});
