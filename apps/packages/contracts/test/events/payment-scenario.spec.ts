import { transferRequestedV1 } from '../../src/events/transaction/transfer.requested.v1';
import { versionOf } from '../../src/schemas/primitives';

/**
 * `paymentScenario` was added to a contract that five blocked tickets already
 * build against, so the interesting assertions are not that the new field works
 * — they are that **nothing else changed**.
 *
 * An additive optional field is only additive if a message that omits it still
 * validates and the version does not move. Both are asserted here rather than
 * assumed, because getting either wrong turns a free change into a migration
 * for T-16 through T-20.
 */

/** A transfer as it was written before this feature existed. */
const asWrittenBefore = {
  transactionId: '3f2a1c04-9c2e-4a71-b8f5-2d6e7c0a1b93',
  sourceAccount: '8b7e5d21-9c2e-4a71-b8f5-2d6e7c0a1b93',
  targetAccount: '1d4c9f60-9c2e-4a71-b8f5-2d6e7c0a1b93',
  amount: { amountMinor: 125_000, currency: 'GTQ' },
};

describe('transfer.requested.v1 after the paymentScenario amendment', () => {
  describe('backwards compatibility', () => {
    it('still accepts a message written before the field existed', () => {
      expect(transferRequestedV1.schema.safeParse(asWrittenBefore).success).toBe(true);
    });

    it('leaves the field absent rather than inventing a default', () => {
      const parsed = transferRequestedV1.schema.parse(asWrittenBefore);

      expect(parsed).not.toHaveProperty('paymentScenario');
    });

    it('does not move the version, so no binding and no consumer had to change', () => {
      expect(transferRequestedV1.name).toBe('transfer.requested.v1');
      expect(versionOf(transferRequestedV1.name)).toBe(1);
    });

    it('keeps the two invariants the contract already enforced', () => {
      const notPositive = { ...asWrittenBefore, amount: { amountMinor: 0, currency: 'GTQ' } };
      const sameAccount = { ...asWrittenBefore, targetAccount: asWrittenBefore.sourceAccount };

      expect(transferRequestedV1.schema.safeParse(notPositive).success).toBe(false);
      expect(transferRequestedV1.schema.safeParse(sameAccount).success).toBe(false);
    });
  });

  describe('the field itself', () => {
    it.each(['APPROVE', 'REJECT', 'TRANSIENT_FAILURE'])('accepts %s', (scenario) => {
      const message = { ...asWrittenBefore, paymentScenario: scenario };

      expect(transferRequestedV1.schema.parse(message).paymentScenario).toBe(scenario);
    });

    /**
     * A fourth value has no meaning downstream, so letting it through would put
     * Transaction Service in the position of deciding what to do with a
     * scenario nobody defined.
     */
    it('refuses a value that is not one of the three', () => {
      const message = { ...asWrittenBefore, paymentScenario: 'MAYBE' };

      expect(transferRequestedV1.schema.safeParse(message).success).toBe(false);
    });

    it('refuses an explicit null, which is not the same statement as absence', () => {
      const message = { ...asWrittenBefore, paymentScenario: null };

      expect(transferRequestedV1.schema.safeParse(message).success).toBe(false);
    });
  });

  /**
   * The contract's own metadata has to keep saying that the Gateway is the one
   * that originates this message, because that is what makes it T-15's to
   * amend in the first place.
   */
  it('is still produced by the gateway and handled by exactly one service', () => {
    expect(transferRequestedV1.producer).toBe('gateway');
    expect(transferRequestedV1.category).toBe('command');
    expect(transferRequestedV1.consumers).toEqual(['transaction-service']);
  });
});
