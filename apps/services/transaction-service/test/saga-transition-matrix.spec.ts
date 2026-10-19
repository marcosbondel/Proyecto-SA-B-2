import {
  accountCreditRequestedV1,
  accountDebitCompensationRequestedV1,
  accountDebitRequestedV1,
  customerKycCheckRequestedV1,
  paymentRequestedV1,
  transactionCompensatedV1,
  transactionCompletedV1,
  transactionFailedV1,
} from '@bank/contracts';
import type { PaymentAttemptFailedV1 } from '@bank/contracts';

import { AdvanceSagaUseCase } from '../src/application/advance-saga.use-case';
import { RecordPaymentAttemptUseCase } from '../src/application/record-payment-attempt.use-case';
import { quetzales } from '../src/domain/money';
import type {
  FailureReason,
  SagaEvent,
  Transaction,
  TransactionStatus,
} from '../src/domain/transaction';
import {
  FixedClock,
  InMemoryTransactionRepository,
  RecordingPublisher,
  RecordingTransferTelemetry,
  SequentialIds,
} from './support/in-memory';

/**
 * A dedicated matrix over `AdvanceSagaUseCase`, distinct from
 * `domain.spec.ts`'s exhaustive table for `applyEvent` and from
 * `use-cases.spec.ts`'s narrative walk through the happy, rejected and
 * compensated paths.
 *
 * What this file adds that neither of those already proves: for **every**
 * legal transition, what the use case actually orders — which command, on
 * which contract, with what payload shape — and not merely which state it
 * lands in; plus the three properties that only the use case (not the pure
 * `applyEvent`) can demonstrate, because they depend on the repository's
 * deduplication and the publisher's recording: a redelivered event produces
 * no second transition and no second publish, an out-of-order event is
 * rejected rather than silently applied, and `payment.attempt.failed.v1`
 * never touches the state machine at all.
 */

const NOW = new Date('2026-09-25T09:00:00.000Z');
const SOURCE = '11111111-1111-4111-8111-111111111111';
const TARGET = '22222222-2222-4222-8222-222222222222';
const TRANSACTION = '33333333-3333-4333-8333-333333333333';
const CORRELATION = '55555555-5555-4555-8555-555555555555';
const CUSTOMER = '77777777-7777-4777-8777-777777777701';

/** Builds a transaction row directly in whatever status a test needs to start from. */
function seed(
  repository: InMemoryTransactionRepository,
  overrides: Partial<Transaction> = {},
): Transaction {
  const transaction: Transaction = {
    transactionId: TRANSACTION,
    sourceAccount: SOURCE,
    targetAccount: TARGET,
    amount: quetzales(10_000),
    status: 'PENDING',
    // Una transferencia interna: el dinero no sale de este banco (T-47).
    interbank: null,
    correlationId: CORRELATION,
    idempotencyKey: 'seed-key',
    customerId: CUSTOMER,
    reference: null,
    failureReason: null,
    paymentScenario: null,
    createdAt: NOW,
    updatedAt: NOW,
    completedAt: null,
    ...overrides,
  };

  repository.transactions.set(transaction.transactionId, transaction);

  return transaction;
}

function world() {
  const repository = new InMemoryTransactionRepository();
  const publisher = new RecordingPublisher();
  const clock = new FixedClock(NOW);
  const ids = new SequentialIds();
  const telemetry = new RecordingTransferTelemetry();
  const saga = new AdvanceSagaUseCase({ repository, publisher, clock, ids, telemetry });
  const attempts = new RecordPaymentAttemptUseCase({ repository, telemetry });

  return { repository, publisher, clock, ids, saga, attempts };
}

interface LegalCase {
  readonly name: string;
  readonly from: TransactionStatus;
  readonly event: SagaEvent;
  readonly expectedStatus: TransactionStatus;
  readonly expectedFailureReason: FailureReason | null;
  /** `null` when the transition orders no command. */
  readonly expectedCommand: string | null;
  /** `null` when the transition announces no ending. */
  readonly expectedAnnouncement: string | null;
  readonly overrides?: Partial<Transaction>;
  /** Extra fields the ordered command's payload must carry, when it matters. */
  readonly expectedCommandPayload?: Record<string, unknown>;
}

const LEGAL_CASES: readonly LegalCase[] = [
  {
    name: 'PENDING + KYC_CHECK_ORDERED stays PENDING and asks Customer Service',
    from: 'PENDING',
    event: { kind: 'KYC_CHECK_ORDERED' },
    expectedStatus: 'PENDING',
    expectedFailureReason: null,
    expectedCommand: customerKycCheckRequestedV1.name,
    expectedAnnouncement: null,
  },
  {
    name: 'PENDING + KYC_APPROVED moves to DEBITING and orders the debit',
    from: 'PENDING',
    event: { kind: 'KYC_APPROVED' },
    expectedStatus: 'DEBITING',
    expectedFailureReason: null,
    expectedCommand: accountDebitRequestedV1.name,
    expectedAnnouncement: null,
  },
  {
    name: 'PENDING + KYC_REJECTED closes FAILED and orders nothing',
    from: 'PENDING',
    event: { kind: 'KYC_REJECTED', reason: 'KYC_NOT_VERIFIED' },
    expectedStatus: 'FAILED',
    expectedFailureReason: 'KYC_NOT_VERIFIED',
    expectedCommand: null,
    expectedAnnouncement: transactionFailedV1.name,
  },
  {
    name: 'DEBITING + DEBITED moves to PAYMENT_PENDING and orders the payment',
    from: 'DEBITING',
    event: { kind: 'DEBITED' },
    expectedStatus: 'PAYMENT_PENDING',
    expectedFailureReason: null,
    expectedCommand: paymentRequestedV1.name,
    expectedAnnouncement: null,
    // The one identifier this service mints (`AdvanceSagaUseCase#effectsOf`):
    // a `SequentialIds` fake makes it predictable instead of a random UUID a
    // test could only assert exists, not what it is.
    expectedCommandPayload: { paymentId: '44444444-4444-4444-8444-444444444401' },
  },
  {
    name: 'DEBITING + DEBIT_REJECTED closes FAILED before any money moved (T-7)',
    from: 'DEBITING',
    event: { kind: 'DEBIT_REJECTED', reason: 'INSUFFICIENT_FUNDS' },
    expectedStatus: 'FAILED',
    expectedFailureReason: 'INSUFFICIENT_FUNDS',
    expectedCommand: null,
    expectedAnnouncement: transactionFailedV1.name,
  },
  {
    name: 'PAYMENT_PENDING + PAYMENT_SUCCEEDED stays and orders the credit',
    from: 'PAYMENT_PENDING',
    event: { kind: 'PAYMENT_SUCCEEDED' },
    expectedStatus: 'PAYMENT_PENDING',
    expectedFailureReason: null,
    expectedCommand: accountCreditRequestedV1.name,
    expectedAnnouncement: null,
  },
  {
    name: 'PAYMENT_PENDING + PAYMENT_FAILED stays and orders the compensation',
    from: 'PAYMENT_PENDING',
    event: { kind: 'PAYMENT_FAILED', reason: 'PAYMENT_DECLINED' },
    expectedStatus: 'PAYMENT_PENDING',
    expectedFailureReason: 'PAYMENT_DECLINED',
    expectedCommand: accountDebitCompensationRequestedV1.name,
    expectedAnnouncement: null,
    // `triggeredBy` is the reason the compensation was ordered for — the audit
    // record a refund must be able to explain (`#commandFor`'s COMPENSATION arm).
    expectedCommandPayload: { accountId: SOURCE, triggeredBy: 'PAYMENT_DECLINED' },
  },
  {
    name: 'PAYMENT_PENDING + CREDITED closes COMPLETED',
    from: 'PAYMENT_PENDING',
    event: { kind: 'CREDITED' },
    expectedStatus: 'COMPLETED',
    expectedFailureReason: null,
    expectedCommand: null,
    expectedAnnouncement: transactionCompletedV1.name,
  },
  {
    name: 'PAYMENT_PENDING + CREDIT_REJECTED orders a compensation too (T-7)',
    from: 'PAYMENT_PENDING',
    event: { kind: 'CREDIT_REJECTED', reason: 'ACCOUNT_NOT_FOUND' },
    expectedStatus: 'PAYMENT_PENDING',
    expectedFailureReason: 'ACCOUNT_NOT_FOUND',
    expectedCommand: accountDebitCompensationRequestedV1.name,
    expectedAnnouncement: null,
  },
  {
    name: 'PAYMENT_PENDING (compensation ordered) + DEBIT_COMPENSATED closes COMPENSATED',
    from: 'PAYMENT_PENDING',
    event: { kind: 'DEBIT_COMPENSATED' },
    expectedStatus: 'COMPENSATED',
    expectedFailureReason: 'PAYMENT_DECLINED',
    expectedCommand: null,
    expectedAnnouncement: transactionCompensatedV1.name,
    overrides: { failureReason: 'PAYMENT_DECLINED' },
  },
];

describe('the saga transition matrix (AdvanceSagaUseCase)', () => {
  it.each(LEGAL_CASES.map((testCase) => [testCase.name, testCase] as const))(
    '%s',
    async (_name, testCase) => {
      const { repository, publisher, saga } = world();
      seed(repository, { status: testCase.from, ...testCase.overrides });

      const outcome = await saga.execute({
        transactionId: TRANSACTION,
        event: testCase.event,
        messageId: `msg-${testCase.name}`,
        messageType: 'test.event',
        payload: {},
      });

      expect(outcome.kind).toBe('APPLIED');
      if (outcome.kind !== 'APPLIED') {
        return;
      }

      expect(outcome.transaction.status).toBe(testCase.expectedStatus);
      expect(outcome.transaction.failureReason).toBe(testCase.expectedFailureReason);

      const commandTypes = publisher.typesOf('sent');
      const announcementTypes = publisher.typesOf('published');

      if (testCase.expectedCommand === null) {
        expect(commandTypes).toEqual([]);
      } else {
        expect(commandTypes).toEqual([testCase.expectedCommand]);

        if (testCase.expectedCommandPayload !== undefined) {
          expect(publisher.sent[0]?.payload).toMatchObject(testCase.expectedCommandPayload);
        }
      }

      if (testCase.expectedAnnouncement === null) {
        expect(announcementTypes).toEqual([]);
      } else {
        expect(announcementTypes).toEqual([testCase.expectedAnnouncement]);
      }
    },
  );

  describe('redelivery: the same messageId arriving twice', () => {
    it.each([
      ['a move (KYC_APPROVED, PENDING -> DEBITING)', 'PENDING' as const, { kind: 'KYC_APPROVED' } as SagaEvent],
      [
        'a terminal close (DEBIT_COMPENSATED -> COMPENSATED)',
        'PAYMENT_PENDING' as const,
        { kind: 'DEBIT_COMPENSATED' } as SagaEvent,
      ],
    ])('redelivering %s produces exactly one transition and one publish burst', async (_name, from, event) => {
      const { repository, publisher, saga } = world();
      seed(repository, {
        status: from,
        failureReason: event.kind === 'DEBIT_COMPENSATED' ? 'PAYMENT_DECLINED' : null,
      });

      const messageId = 'redelivered-message-1';

      const first = await saga.execute({
        transactionId: TRANSACTION,
        event,
        messageId,
        messageType: 'test.event',
        payload: {},
      });
      const publishedAfterFirst = publisher.everything.length;
      const statusAfterFirst = repository.transactions.get(TRANSACTION)!.status;

      const second = await saga.execute({
        transactionId: TRANSACTION,
        event,
        messageId,
        messageType: 'test.event',
        payload: {},
      });

      expect(first.kind).toBe('APPLIED');
      expect(second.kind).toBe('DUPLICATE');
      // No second transition: the row is exactly where the first left it.
      expect(repository.transactions.get(TRANSACTION)!.status).toBe(statusAfterFirst);
      // No second publish burst: everything the publisher recorded came from
      // the one delivery that actually applied.
      expect(publisher.everything.length).toBe(publishedAfterFirst);
    });
  });

  describe('out-of-order events: no place in the diagram from where the row actually is', () => {
    it.each([
      [
        'DEBITED arrives before the debit was ever ordered (still PENDING)',
        'PENDING' as const,
        { kind: 'DEBITED' } as SagaEvent,
      ],
      [
        'CREDITED arrives before the debit confirmed (still DEBITING)',
        'DEBITING' as const,
        { kind: 'CREDITED' } as SagaEvent,
      ],
    ])('%s is rejected, not silently applied', async (_name, from, event) => {
      const { repository, publisher, saga } = world();
      seed(repository, { status: from });

      const outcome = await saga.execute({
        transactionId: TRANSACTION,
        event,
        messageId: 'out-of-order-1',
        messageType: 'test.event',
        payload: {},
      });

      expect(outcome.kind).toBe('ILLEGAL');
      if (outcome.kind === 'ILLEGAL') {
        expect(outcome.from).toBe(from);
        expect(outcome.event).toBe(event.kind);
      }
      // The row did not move, and nothing was ordered for a transition that
      // never happened.
      expect(repository.transactions.get(TRANSACTION)!.status).toBe(from);
      expect(publisher.everything).toEqual([]);
    });
  });

  it('an event about a transaction this replica holds no row for is UNKNOWN_TRANSACTION, not a crash', async () => {
    const { publisher, saga } = world();
    // Deliberately no `seed()`: this is the race between two replicas, not a
    // corrupted row.

    const outcome = await saga.execute({
      transactionId: 'no-such-transaction',
      event: { kind: 'KYC_APPROVED' },
      messageId: 'unknown-1',
      messageType: 'customer.kyc.checked.v1',
      payload: {},
    });

    expect(outcome.kind).toBe('UNKNOWN_TRANSACTION');
    expect(publisher.everything).toEqual([]);
  });

  describe('payment.attempt.failed.v1: a trail entry, never a transition', () => {
    function attemptPayload(overrides: Partial<PaymentAttemptFailedV1> = {}): PaymentAttemptFailedV1 {
      return {
        paymentId: '44444444-4444-4444-8444-444444444401',
        transactionId: TRANSACTION,
        attempt: 1,
        errorType: 'TRANSIENT',
        providerResult: 'FAILURE',
        willRetry: true,
        nextAttemptAt: '2026-09-25T09:00:01.000Z',
        failureReason: null,
        failedAt: '2026-09-25T09:00:01.000Z',
        ...overrides,
      };
    }

    it('leaves PAYMENT_PENDING exactly PAYMENT_PENDING, and a redelivery never doubles the trail (T-5)', async () => {
      const { repository, attempts } = world();
      seed(repository, { status: 'PAYMENT_PENDING' });

      const messageId = 'attempt-redelivered-1';
      const first = await attempts.execute(attemptPayload({ attempt: 2 }), {
        messageId,
        messageType: 'payment.attempt.failed.v1',
        correlationId: 'corr-attempt',
      });
      const second = await attempts.execute(attemptPayload({ attempt: 2 }), {
        messageId,
        messageType: 'payment.attempt.failed.v1',
        correlationId: 'corr-attempt',
      });

      expect(first.kind).toBe('RECORDED');
      expect(second.kind).toBe('DUPLICATE');
      // Unchanged, byte for byte: this is not `AdvanceSagaUseCase`, so there is
      // no `decide` call and no transition, even a self-transition, to record —
      // for either delivery, not only the second.
      expect(repository.transactions.get(TRANSACTION)!.status).toBe('PAYMENT_PENDING');
      expect(repository.transitions.get(TRANSACTION) ?? []).toEqual([]);
      expect(
        repository.events.filter((event) => event.messageType === 'payment.attempt.failed.v1'),
      ).toHaveLength(1);
    });
  });
});
