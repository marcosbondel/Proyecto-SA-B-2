import { catalogByName } from '../../src/events';

const DEPOSIT_ID = '3a7d9e14-6b25-4f83-9c01-8e5a2d7b4f60';
const ACCOUNT_ID = '9f1c8b2a-4d63-4e57-8a90-1b2c3d4e5f60';

describe('the provisional incoming interbank conversation', () => {
  it('has one receiver, an account eligibility reply, a credit verdict and an audit outcome', () => {
    const expected = [
      ['payment.interbank.receive.v1', 'command', 'gateway', 'payment-service'],
      ['account.interbank.eligibility.query.v1', 'command', 'payment-service', 'account-service'],
      ['account.interbank.eligibility.replied.v1', 'reply', 'account-service', 'payment-service'],
      ['account.interbank.credit.requested.v1', 'command', 'payment-service', 'account-service'],
      ['account.interbank.credited.v1', 'event', 'account-service', 'payment-service'],
      ['account.interbank.credit.rejected.v1', 'event', 'account-service', 'payment-service'],
      ['payment.interbank.accepted.v1', 'event', 'payment-service', 'notification-audit-service'],
      ['payment.interbank.rejected.v1', 'event', 'payment-service', 'notification-audit-service'],
    ] as const;

    for (const [name, category, producer, consumer] of expected) {
      const contract = catalogByName.get(name);

      expect(contract).toMatchObject({ name, category, producer });
      expect(contract?.consumers).toContain(consumer);
    }
  });

  it('accepts an ISO currency for a business verdict but refuses fractional minor units', () => {
    const receive = catalogByName.get('payment.interbank.receive.v1');
    const valid = {
      depositId: DEPOSIT_ID,
      interbankTransferId: 'BANCO-A-123',
      idempotencyKey: 'origin-123',
      originBankCode: 'BANCO_A',
      destinationBankCode: 'BANK_USAC',
      accountId: ACCOUNT_ID,
      amount: { amountMinor: 101, currency: 'GTQ' },
      requestedAt: '2026-10-12T12:00:00.000Z',
    };

    expect(receive?.schema.safeParse(valid).success).toBe(true);
    expect(
      receive?.schema.safeParse({ ...valid, amount: { amountMinor: 101, currency: 'USD' } })
        .success,
    ).toBe(true);
    expect(
      receive?.schema.safeParse({ ...valid, amount: { amountMinor: 1.5, currency: 'GTQ' } })
        .success,
    ).toBe(false);
  });

  it('requires a rejection reason when account eligibility is false', () => {
    const replied = catalogByName.get('account.interbank.eligibility.replied.v1');
    const base = { depositId: DEPOSIT_ID, accountId: ACCOUNT_ID };

    expect(
      replied?.schema.safeParse({ ...base, eligible: false, reason: 'ACCOUNT_INACTIVE' }).success,
    ).toBe(true);
    expect(replied?.schema.safeParse({ ...base, eligible: false, reason: null }).success).toBe(
      false,
    );
    expect(replied?.schema.safeParse({ ...base, eligible: true, reason: null }).success).toBe(true);
  });
});
