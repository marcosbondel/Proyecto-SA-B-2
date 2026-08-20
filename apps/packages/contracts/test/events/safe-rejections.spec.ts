import {
  customerAuthenticateRepliedV1,
  customerEmailVerificationRejectedV1,
  customerLoginRejectedV1,
} from '../../src/events';

/**
 * FR-019 and FR-020 are security properties, so they are tested rather than
 * asserted: a later change that widens one of these enums fails here.
 */
describe('a refused sign-in reveals nothing (FR-019)', () => {
  const rejection = { outcome: 'REJECTED', reason: 'INVALID_CREDENTIALS' };

  it('has exactly one reason, so it cannot distinguish unknown from wrong', () => {
    expect(customerAuthenticateRepliedV1.schema.safeParse(rejection).success).toBe(true);

    for (const reason of ['EMAIL_ALREADY_REGISTERED', 'ACCOUNT_NOT_FOUND', 'ROLE_NOT_ELIGIBLE']) {
      expect(customerAuthenticateRepliedV1.schema.safeParse({ ...rejection, reason }).success).toBe(
        false,
      );
    }
  });

  it('returns claims and never a token, because only the gateway signs', () => {
    const approved = {
      outcome: 'APPROVED',
      claims: {
        customerId: '55555555-5555-4555-8555-555555555555',
        username: 'mbonifasi',
        role: 'CLIENTE',
      },
      activationPending: false,
    };

    const result = customerAuthenticateRepliedV1.schema.safeParse(approved);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(JSON.stringify(result.data)).not.toMatch(/token/i);
    }
  });

  it('names no customer in the audit event either, or the reply would leak by another route', () => {
    const parsed = customerLoginRejectedV1.schema.safeParse({
      reason: 'INVALID_CREDENTIALS',
      occurredAt: '2026-08-19T14:32:07.482Z',
    });

    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data).not.toHaveProperty('customerId');
    }
  });
});

describe('a refused activation says which kind of refusal it is (FR-020)', () => {
  const at = { occurredAt: '2026-08-19T14:32:07.482Z' };

  it('tells an expired link from an invalid one', () => {
    expect(
      customerEmailVerificationRejectedV1.schema.safeParse({
        ...at,
        reason: 'ACTIVATION_TOKEN_EXPIRED',
      }).success,
    ).toBe(true);

    expect(
      customerEmailVerificationRejectedV1.schema.safeParse({
        ...at,
        reason: 'ACTIVATION_TOKEN_INVALID',
      }).success,
    ).toBe(true);
  });

  it('admits no third reason, so the distinction stays meaningful', () => {
    expect(
      customerEmailVerificationRejectedV1.schema.safeParse({ ...at, reason: 'ACCOUNT_NOT_FOUND' })
        .success,
    ).toBe(false);
  });

  it('never carries the token it refused', () => {
    const parsed = customerEmailVerificationRejectedV1.schema.safeParse({
      ...at,
      reason: 'ACTIVATION_TOKEN_EXPIRED',
    });

    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(JSON.stringify(parsed.data)).not.toMatch(/token[^_]/i);
    }
  });
});
