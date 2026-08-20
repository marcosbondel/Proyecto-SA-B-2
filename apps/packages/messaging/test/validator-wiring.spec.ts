import { createEnvelope, messageValidator } from '@bank/contracts';

import type { MessageValidator } from '../src';

/**
 * The adapter never imports the catalogue: it takes a validator as a parameter.
 * This checks the two halves actually fit, which is the only thing that can be
 * verified without a live broker — `subscribe` needs a connection, and that
 * arrives with T-06.
 */
describe('the catalogue validator fits the adapter', () => {
  const validate: MessageValidator = messageValidator;

  const debited = createEnvelope(
    {
      transactionId: '33333333-3333-4333-8333-333333333333',
      accountId: '11111111-1111-4111-8111-111111111111',
      amount: { amountMinor: 15_000, currency: 'GTQ' },
      balanceAfter: { amountMinor: 85_000, currency: 'GTQ' },
      debitedAt: '2026-08-19T14:32:08.100Z',
    },
    { messageType: 'account.debited.v1', producer: 'account-service', identity: null },
  );

  it('passes a message the catalogue recognises', () => {
    expect(validate(debited)).toEqual({ ok: true });
  });

  it('refuses one it does not, with a reason short enough for a header', () => {
    const verdict = validate({ ...debited, messageType: 'account.teleported.v1' });

    expect(verdict.ok).toBe(false);
    if (!verdict.ok) {
      expect(verdict.reason).toMatch(/^unknown-type:/);
    }
  });

  it('refuses a payload that does not match its own contract', () => {
    const verdict = validate({ ...debited, payload: {} });

    expect(verdict.ok).toBe(false);
    if (!verdict.ok) {
      expect(verdict.reason).toMatch(/^invalid-payload:/);
    }
  });
});
