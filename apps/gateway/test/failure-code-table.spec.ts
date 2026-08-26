import { failureCode } from '@bank/contracts';
import type { FailureCode } from '@bank/contracts';

import {
  ERROR_TYPE_STATUS,
  FAILURE_CODE_STATUS,
  statusFor,
} from '../src/application/errors/failure-code-table';
import { ASYNC_FAILURE_TYPES } from '../src/application/errors/gateway-error';

/**
 * The table is the mitigation for the biggest risk this ticket carries: that a
 * status-code decision quietly becomes a business decision.
 *
 * These tests exist so the mitigation cannot rot. The important one is the
 * first: it walks the catalogue's own enum, so a code added to T-05 six weeks
 * from now fails **here**, loudly, instead of falling into a generic status
 * that nobody notices is wrong.
 */
describe('the failure-code table', () => {
  const codes = failureCode.options as readonly FailureCode[];

  it('covers every code the catalogue defines — no more, no fewer', () => {
    expect(Object.keys(FAILURE_CODE_STATUS).sort()).toEqual([...codes].sort());
  });

  it('maps each one to a status a client can act on', () => {
    for (const code of codes) {
      const status = FAILURE_CODE_STATUS[code];

      expect(status).toBeGreaterThanOrEqual(400);
      expect(status).toBeLessThan(500);
    }
  });

  it('is a lookup, not a decision: the same code always answers the same way', () => {
    for (const code of codes) {
      expect(statusFor('BUSINESS_REJECTION', code)).toBe(statusFor('BUSINESS_REJECTION', code));
      expect(statusFor('BUSINESS_REJECTION', code)).toBe(FAILURE_CODE_STATUS[code]);
    }
  });

  describe('the specific choices worth pinning down', () => {
    it.each([
      ['ACCOUNT_NOT_FOUND', 404],
      ['IDENTITY_OBJECT_NOT_FOUND', 404],
      ['EMAIL_ALREADY_REGISTERED', 409],
      ['IDEMPOTENCY_KEY_CONFLICT', 409],
      ['INSUFFICIENT_FUNDS', 422],
      ['SAME_ACCOUNT_TRANSFER', 422],
    ] as const)('reports %s as %i', (code, status) => {
      expect(FAILURE_CODE_STATUS[code]).toBe(status);
    });

    /**
     * The one credential-shaped code. It answers `401` so it collapses into the
     * same generic rejection as every other sign-in failure and never
     * distinguishes an unknown account from a wrong password.
     */
    it('reports INVALID_CREDENTIALS as 401, not as a business rejection body', () => {
      expect(FAILURE_CODE_STATUS.INVALID_CREDENTIALS).toBe(401);
    });
  });

  /**
   * A code the table has never heard of still has to produce something. `422`
   * says "the domain refused it" without inventing a more specific claim.
   */
  it('falls back to 422 rather than 500 for an unknown code', () => {
    expect(statusFor('BUSINESS_REJECTION', 'NOT_A_REAL_CODE' as FailureCode)).toBe(422);
    expect(statusFor('BUSINESS_REJECTION', undefined)).toBe(422);
  });
});

describe('the six non-business failure types', () => {
  it.each([
    ['VALIDATION_ERROR', 400],
    ['UNAUTHENTICATED', 401],
    ['FORBIDDEN', 403],
    ['REPLY_TIMEOUT', 504],
    ['BROKER_UNAVAILABLE', 503],
    ['INTERNAL_ERROR', 500],
  ] as const)('reports %s as %i', (type, status) => {
    expect(statusFor(type, undefined)).toBe(status);
    expect(ERROR_TYPE_STATUS[type]).toBe(status);
  });

  /**
   * `504` and `503` are not interchangeable. One means the request was accepted
   * and is still running; the other means nothing happened at all. A client
   * that confused them would either retry a transfer that succeeded or give up
   * on one that never started.
   */
  it('keeps timeout and unavailability distinct', () => {
    expect(statusFor('REPLY_TIMEOUT', undefined)).not.toBe(
      statusFor('BROKER_UNAVAILABLE', undefined),
    );
  });
});

describe('the five the frontend renders', () => {
  it('excludes the two the session layer intercepts', () => {
    expect(ASYNC_FAILURE_TYPES).toHaveLength(5);
    expect(ASYNC_FAILURE_TYPES).not.toContain('UNAUTHENTICATED');
    expect(ASYNC_FAILURE_TYPES).not.toContain('FORBIDDEN');
  });

  it('are all real types with a status of their own', () => {
    for (const type of ASYNC_FAILURE_TYPES) {
      expect(statusFor(type, undefined)).toBeGreaterThanOrEqual(400);
    }
  });
});
