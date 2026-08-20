import { createEnvelope } from '../../src/envelope';
import { validateMessage } from '../../src/validation/validate-message';

const wrap = (messageType: string, payload: unknown) =>
  createEnvelope(payload, {
    messageType,
    producer: 'account-service',
    identity: null,
  });

const DEBITED = {
  transactionId: '33333333-3333-4333-8333-333333333333',
  accountId: '11111111-1111-4111-8111-111111111111',
  amount: { amountMinor: 15_000, currency: 'GTQ' },
  balanceAfter: { amountMinor: 85_000, currency: 'GTQ' },
  debitedAt: '2026-08-19T14:32:08.100Z',
};

describe('validateMessage', () => {
  it('accepts a well-formed message and returns the parsed envelope', () => {
    const result = validateMessage(wrap('account.debited.v1', DEBITED));

    expect(result.ok).toBe(true);
  });

  it('refuses a body that is not an envelope at all', () => {
    const result = validateMessage({ hello: 'world' });

    expect(result).toMatchObject({ ok: false, kind: 'malformed-envelope' });
  });

  it('refuses an envelope whose version field disagrees with its name', () => {
    const result = validateMessage({ ...wrap('account.debited.v1', DEBITED), messageVersion: 2 });

    expect(result).toMatchObject({ ok: false, kind: 'malformed-envelope' });
  });

  it('refuses a name nothing in the catalogue answers to', () => {
    const result = validateMessage(wrap('account.teleported.v1', {}));

    expect(result).toMatchObject({ ok: false, kind: 'unknown-type' });
  });

  it('refuses a payload that does not satisfy the contract it names', () => {
    const { debitedAt: _dropped, ...incomplete } = DEBITED;
    void _dropped;

    const result = validateMessage(wrap('account.debited.v1', incomplete));

    expect(result).toMatchObject({ ok: false, kind: 'invalid-payload' });
  });

  it('names the offending field, so an operator does not have to guess', () => {
    const result = validateMessage(wrap('account.debited.v1', { ...DEBITED, accountId: 'nope' }));

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain('payload.accountId');
    }
  });
});

describe('an unsupported version', () => {
  it('is refused explicitly rather than half-interpreted', () => {
    const result = validateMessage(wrap('account.debited.v2', DEBITED));

    expect(result.ok).toBe(false);
  });

  it('is told apart from a name nobody ever heard of', () => {
    const ahead = validateMessage(wrap('account.debited.v2', DEBITED));
    const unknown = validateMessage(wrap('account.teleported.v1', {}));

    expect(ahead).toMatchObject({ kind: 'unsupported-version' });
    expect(unknown).toMatchObject({ kind: 'unknown-type' });
  });

  it('says which version this consumer does know', () => {
    const result = validateMessage(wrap('account.debited.v2', DEBITED));

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain('account.debited.v1');
    }
  });
});

describe('a field the consumer does not know', () => {
  it('is tolerated, because otherwise every additive change is a lockstep deploy', () => {
    const result = validateMessage(
      wrap('account.debited.v1', { ...DEBITED, settlementHint: 'FAST' }),
    );

    expect(result.ok).toBe(true);
  });

  it('is stripped rather than passed on, so nothing unvalidated reaches the domain', () => {
    const result = validateMessage(
      wrap('account.debited.v1', { ...DEBITED, settlementHint: 'FAST' }),
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.envelope.payload).not.toHaveProperty('settlementHint');
    }
  });
});
