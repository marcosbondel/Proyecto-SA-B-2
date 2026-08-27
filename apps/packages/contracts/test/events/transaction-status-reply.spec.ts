import { transactionStatusRepliedV1 } from '../../src/events/transaction/transaction.status.replied.v1';
import { versionOf } from '../../src/schemas/primitives';

/**
 * T-18 added two optional fields to the status reply, and both exist to answer
 * a question the screen asking it could not otherwise answer honestly.
 *
 * As with T-15's `paymentScenario`, the interesting assertions are not that the
 * new fields work — they are that **nothing else changed**. An additive
 * optional field is only additive if a reply that omits it still validates and
 * the version stays where it was.
 */

/** A reply as it was written before this amendment. */
const asWrittenBefore = {
  outcome: 'FOUND',
  transactionId: '33333333-3333-4333-8333-333333333333',
  status: 'PAYMENT_PENDING',
  amount: { amountMinor: 15_000, currency: 'GTQ' },
  reason: null,
  createdAt: '2026-08-19T14:32:07.482Z',
  updatedAt: '2026-08-19T14:32:08.100Z',
};

describe('backwards compatibility', () => {
  it('still accepts a reply written before the two fields existed', () => {
    expect(transactionStatusRepliedV1.schema.safeParse(asWrittenBefore).success).toBe(true);
  });

  it('leaves both absent rather than inventing defaults', () => {
    const parsed = transactionStatusRepliedV1.schema.parse(asWrittenBefore);

    expect(parsed).not.toHaveProperty('originCorrelationId');
    expect(parsed).not.toHaveProperty('payment');
  });

  it('does not move the version', () => {
    expect(transactionStatusRepliedV1.name).toBe('transaction.status.replied.v1');
    expect(versionOf(transactionStatusRepliedV1.name)).toBe(1);
  });

  it('leaves NOT_FOUND alone: it carries nothing and still carries nothing', () => {
    const parsed = transactionStatusRepliedV1.schema.parse({ outcome: 'NOT_FOUND' });

    expect(parsed).toEqual({ outcome: 'NOT_FOUND' });
  });
});

describe('originCorrelationId', () => {
  it('accepts the correlation the transfer was created under', () => {
    const reply = {
      ...asWrittenBefore,
      originCorrelationId: '7c9e6f10-1a2b-4c3d-8e4f-5a6b7c8d9e0f',
    };

    expect(transactionStatusRepliedV1.schema.parse(reply)).toHaveProperty(
      'originCorrelationId',
      '7c9e6f10-1a2b-4c3d-8e4f-5a6b7c8d9e0f',
    );
  });

  /**
   * It is a correlation identifier, which is a UUID everywhere else in this
   * system. A free-form string here would be a value nobody could search the
   * audit record with.
   */
  it('refuses anything that is not a UUID v4', () => {
    const reply = { ...asWrittenBefore, originCorrelationId: 'the-original-one' };

    expect(transactionStatusRepliedV1.schema.safeParse(reply).success).toBe(false);
  });
});

describe('the payment outcome', () => {
  const payment = {
    paymentId: '44444444-4444-4444-8444-444444444444',
    status: 'SUCCEEDED',
    attempt: 1,
    reason: null,
    decidedAt: '2026-08-19T14:32:08.900Z',
  };

  it('carries what the payment event said', () => {
    const parsed = transactionStatusRepliedV1.schema.parse({ ...asWrittenBefore, payment });

    expect(parsed).toHaveProperty('payment', payment);
  });

  /**
   * "Ordered, nothing back yet" is a real state and a different statement from
   * "there is no payment". A screen that could not tell them apart would show a
   * transfer as decided while its payment was still in flight.
   */
  it('admits a payment that has been ordered and not yet decided', () => {
    const pending = {
      ...asWrittenBefore,
      payment: {
        paymentId: '44444444-4444-4444-8444-444444444444',
        status: 'PENDING',
        attempt: null,
        reason: null,
        decidedAt: null,
      },
    };

    expect(transactionStatusRepliedV1.schema.safeParse(pending).success).toBe(true);
  });

  it('admits only the two reasons a payment can fail with', () => {
    const declined = { ...payment, status: 'FAILED', reason: 'PAYMENT_DECLINED' };
    const foreign = { ...payment, status: 'FAILED', reason: 'INSUFFICIENT_FUNDS' };

    expect(
      transactionStatusRepliedV1.schema.safeParse({ ...asWrittenBefore, payment: declined })
        .success,
    ).toBe(true);
    /**
     * `INSUFFICIENT_FUNDS` is a real code, and it is Account Service's. A
     * payment that reported it would mean Transaction Service had copied a
     * verdict from the wrong service into the payment field.
     */
    expect(
      transactionStatusRepliedV1.schema.safeParse({ ...asWrittenBefore, payment: foreign }).success,
    ).toBe(false);
  });

  it('refuses an attempt counter that counts from zero or backwards', () => {
    for (const attempt of [0, -1]) {
      const reply = { ...asWrittenBefore, payment: { ...payment, attempt } };

      expect(transactionStatusRepliedV1.schema.safeParse(reply).success).toBe(false);
    }
  });
});
