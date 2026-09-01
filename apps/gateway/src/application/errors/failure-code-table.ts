import type { FailureCode } from '@bank/contracts';

import type { GatewayErrorType } from './gateway-error';

/**
 * Which HTTP status stands for each of the catalogue's twenty-four failure codes.
 *
 * **A table, not a chain of conditionals**, and the difference is not
 * stylistic. Translating a verdict someone else reached is routing; deciding
 * one is domain logic, and constitution V keeps that out of the gateway. A
 * lookup cannot accidentally grow a rule — a conditional can, and that is the
 * realistic way this ticket loses criterion 2.4: not bad faith, just one
 * `if` too many written on a Friday.
 *
 * The catalogue's own code travels through to the response body untouched
 * (FR-030), so nothing here reinterprets what a service said. This only chooses
 * the envelope it arrives in.
 *
 * A test walks `failureCode` and fails if any value is missing from this table.
 * Without it a newly catalogued code would silently fall through to a generic
 * status and nobody would notice.
 */
export const FAILURE_CODE_STATUS: Readonly<Record<FailureCode, number>> = {
  // Not found — the subject of the request does not exist.
  ACCOUNT_NOT_FOUND: 404,
  CUSTOMER_NOT_FOUND: 404,
  IDENTITY_OBJECT_NOT_FOUND: 404,

  // Conflict — the request collides with a state that already exists.
  DOCUMENT_ALREADY_REGISTERED: 409,
  EMAIL_ALREADY_REGISTERED: 409,
  IDEMPOTENCY_KEY_CONFLICT: 409,
  ACTIVATION_TOKEN_INVALID: 409,
  ACTIVATION_TOKEN_EXPIRED: 409,
  /*
   * The password-recovery pair, `409` for the same reason its activation
   * siblings are: the link is well-formed and the request is fine — the token
   * has simply already been spent or has run out of time, which is a collision
   * with state rather than something to correct in the request. Both collapse
   * into one sentence before they reach a browser; the distinction lives here
   * and in the audit record.
   */
  RESET_TOKEN_INVALID: 409,
  RESET_TOKEN_EXPIRED: 409,
  ILLEGAL_TRANSITION: 409,
  ACCOUNT_INACTIVE: 409,

  // Unprocessable — well-formed, but the domain refuses it.
  INVALID_BIRTH_DATE: 422,
  ROLE_NOT_ELIGIBLE: 422,
  INVALID_AMOUNT: 422,
  INVALID_AMOUNT_PRECISION: 422,
  SAME_ACCOUNT_TRANSFER: 422,
  INSUFFICIENT_FUNDS: 422,
  IDENTITY_DOCUMENT_UNREADABLE: 422,
  IDENTITY_DIGEST_MISMATCH: 422,
  PAYMENT_DECLINED: 422,
  PAYMENT_RETRIES_EXHAUSTED: 422,

  /*
   * Forbidden — the request is well-formed and the actor is authenticated, but
   * the account is not theirs. `403` rather than `422`: nothing about the
   * request needs fixing, and the difference between "this cannot be done" and
   * "you cannot do this" is the difference between retrying and not.
   *
   * It reaches this table only where the owning service already decided to say
   * so. Both read paths — a balance, a statement — answer `ACCOUNT_NOT_FOUND`
   * instead, because a distinguishable refusal on a read is a way to discover
   * which accounts exist.
   */
  FORBIDDEN_ACCOUNT_ACCESS: 403,

  // The one credential-shaped code. It is answered with the same generic
  // rejection as every other sign-in failure, so it never distinguishes an
  // unknown account from a wrong password.
  INVALID_CREDENTIALS: 401,
};

/** The status for each failure type that is not a business rejection. */
export const ERROR_TYPE_STATUS: Readonly<Record<Exclude<GatewayErrorType, 'BUSINESS_REJECTION'>, number>> = {
  VALIDATION_ERROR: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  // The caller stopped waiting. Nothing was cancelled.
  REPLY_TIMEOUT: 504,
  // The request was never accepted, so nothing happened.
  BROKER_UNAVAILABLE: 503,
  INTERNAL_ERROR: 500,
};

/** The status a failure should be reported with. */
export function statusFor(type: GatewayErrorType, failureCode: FailureCode | undefined): number {
  if (type !== 'BUSINESS_REJECTION') {
    return ERROR_TYPE_STATUS[type];
  }

  // A rejection whose code is not in the table is a defect in this table, not
  // in the caller's request — 422 says "the domain refused it" without
  // inventing a more specific claim.
  return failureCode === undefined ? 422 : (FAILURE_CODE_STATUS[failureCode] ?? 422);
}
