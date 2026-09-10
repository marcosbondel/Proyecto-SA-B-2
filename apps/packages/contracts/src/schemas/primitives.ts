import { z } from 'zod';

/**
 * The value shapes that repeat across the 41 message contracts.
 *
 * They live here so that "a UUID" or "an amount of money" means exactly one
 * thing across seven applications. A contract that spells one of these by hand
 * is how two services end up disagreeing about what a valid identifier is.
 *
 * Every schema in this file is a *transport* rule: what may be written on the
 * wire. Whether a particular account may be debited is a domain rule and lives
 * in the service that owns the account.
 */

/** Identifier of anything the system creates. Version 4 specifically. */
export const uuidV4 = z.uuid({ version: 'v4' });

/**
 * A moment in time, ISO-8601 with an explicit UTC designator.
 *
 * A timestamp without a zone is ambiguous the moment it crosses a process
 * boundary, and every one of these does.
 */
export const isoTimestamp = z.iso.datetime();

/**
 * Amount in minor units — cents for GTQ and USD.
 *
 * Integer on purpose: floating-point money is a defect waiting for a
 * reconciliation report. Signedness is left to each contract, because a debit
 * and a compensation are not the same statement.
 */
export const amountMinor = z.int();

/** ISO-4217 alphabetic code, uppercase. */
export const currencyCode = z.string().regex(/^[A-Z]{3}$/, 'ISO-4217 alphabetic code, uppercase');

/** How an amount of money is written on the wire. */
export const money = z.object({
  amountMinor,
  currency: currencyCode,
});

/** The three roles the assignment defines (§4.1 NOTE, page 7). */
export const role = z.enum(['CLIENTE', 'CAJERO_RECEPTOR', 'ADMINISTRADOR']);

/** The two account types the assignment defines (§4.1 NOTE, page 7). */
export const accountType = z.enum(['MONETARIA', 'AHORRO']);

/**
 * Every application allowed to publish. Closed on purpose: an unknown producer
 * is either a misconfiguration or something that should not be on the broker.
 */
export const producer = z.enum([
  'gateway',
  'customer-service',
  'account-service',
  'transaction-service',
  'payment-service',
  'notification-audit-service',
]);

/**
 * Lets a consumer recognise a redelivery of work it already did.
 *
 * Equal keys mean "the same intention". Bounded at 128 characters so a client
 * cannot turn it into a payload of its own.
 */
export const idempotencyKey = z.string().min(1).max(128);

/**
 * A message name with its version suffix, which is also its routing key.
 *
 * The suffix is not decoration: it is what lets a consumer bound to `.v1`
 * never see a `.v2`.
 */
export const messageTypeName = z
  .string()
  .regex(/^[a-z][a-z0-9]*(\.[a-z0-9-]+)*\.v[0-9]+$/, 'name must end in a version suffix, e.g. .v1');

/** Lowercase hexadecimal SHA-256, as produced by every standard tool. */
export const sha256Hex = z
  .string()
  .regex(/^[0-9a-f]{64}$/, 'SHA-256 as 64 lowercase hexadecimal characters');

/** Reads the version out of a message name. Returns `null` if there is none. */
export function versionOf(messageType: string): number | null {
  const match = /\.v([0-9]+)$/.exec(messageType);
  if (match === null || match[1] === undefined) {
    return null;
  }

  return Number.parseInt(match[1], 10);
}

/**
 * The domain states that travel on the wire.
 *
 * They mirror `docs/domain/entities.md` exactly. Widening one of these is a
 * domain decision and belongs to the service that owns the entity, not here.
 */

/** `Customer.status` — one legal transition, driven by email verification. */
export const customerStatus = z.enum(['PENDING_ACTIVATION', 'ACTIVE']);

/** `Customer.identityStatus` — independent of activation (C-4 vs C-6). */
export const identityStatus = z.enum(['PENDING', 'VALIDATED', 'REJECTED']);

/**
 * `Customer.kycStatus` (Fase 2, §4.1 p. 4) — distinct from `identityStatus`:
 * the document-photo review and the KYC verdict are two different facts, C-8.
 */
export const kycStatus = z.enum(['PENDING', 'VERIFIED', 'REJECTED']);

/** `Account.status`. A credit to an INACTIVE account reactivates it (A-3). */
export const accountStatus = z.enum(['ACTIVE', 'INACTIVE']);

/**
 * `AccountOperation.type` — the three ways a balance moves.
 *
 * COMPENSATION is not a CREDIT with a different label. A credit is money
 * arriving; a compensation is money that never should have left coming back,
 * and a statement that showed them alike would make a failed transfer read as
 * an incoming payment.
 */
/* 'COMMISSION' added by T-27: the per-transaction fee `debit` charges
 * alongside a DEBIT, on account types that configure one, recorded as its own
 * ledger row rather than folded into the DEBIT amount. */
export const accountOperationType = z.enum(['DEBIT', 'CREDIT', 'COMPENSATION', 'COMMISSION']);

/**
 * `AccountOperation.status`.
 *
 * APPLIED is terminal for a credit and provisional for a debit: a debit stays
 * APPLIED until the Saga either completes or asks for it back, at which point
 * the original debit becomes COMPENSATED and a COMPENSATION row records the
 * return. Nothing is ever deleted — a ledger that forgets is not a ledger.
 */
export const accountOperationStatus = z.enum(['APPLIED', 'COMPENSATED']);

/**
 * `Transaction.status`. FAILED and COMPENSATED are not interchangeable:
 * FAILED means the money never left, COMPENSATED means it left and came back.
 */
export const transactionStatus = z.enum([
  'PENDING',
  'DEBITING',
  'PAYMENT_PENDING',
  'COMPLETED',
  'FAILED',
  'COMPENSATED',
]);

/** `Payment.status`. */
export const paymentStatus = z.enum(['PENDING', 'SUCCEEDED', 'FAILED']);

/**
 * Why a payment attempt did not succeed, in the only two kinds that change
 * what happens next.
 *
 * Added by T-19. The distinction is not descriptive, it is operational: a
 * `PERMANENT` failure is retried zero times because retrying it would produce
 * the same refusal, and a `TRANSIENT` one is retried up to `MAX_RETRIES` on the
 * ladder in `routing/topology.ts`. Payment Service's resilience policy is
 * exactly this enum plus that ladder, which is why the enum lives here and not
 * inside the service: the consumer that has to explain a compensated Saga needs
 * to be able to say *which kind* of failure caused it.
 *
 * It deliberately says nothing about the provider. `PERMANENT` does not mean
 * "the bank refused"; it means "asking again is pointless". A real provider
 * integration would map its own codes onto these two and change nothing else.
 */
export const paymentErrorType = z.enum(['TRANSIENT', 'PERMANENT']);

/**
 * How a simulated notification ended up.
 *
 * Added by T-20. Three values and not two, because "not sent yet" and "we
 * tried and it did not go" are different facts about the same row: the first
 * is a job still to do, the second is an incident. A boolean `sent` would
 * collapse them, and the collapse always resolves in the reassuring direction.
 *
 * Nothing in this system retries a `FAILED` notification. That is a property of
 * the simulated adapter rather than a policy: there is no mail server to be
 * temporarily unreachable.
 */
export const notificationStatus = z.enum(['PENDING', 'SENT', 'FAILED']);

/**
 * The one channel that exists. An enum rather than a string so that adding SMS
 * is a contract change somebody reviews, not a free-text value that appears in
 * production one day.
 */
export const notificationChannel = z.enum(['EMAIL']);

/**
 * What the audit service made of a message it consumed.
 *
 * `PROCESSED` is the ordinary case. `INVALID` means the envelope arrived but
 * its payload did not match the contract it claimed; `ERROR` means this service
 * failed while recording it. Both are written down rather than thrown away,
 * because criterion 3 of T-20 is precisely that a malformed message is visible
 * *and* costs the producer nothing — and a rejection nobody can see is
 * indistinguishable from a message that never arrived.
 */
export const auditProcessingStatus = z.enum(['PROCESSED', 'INVALID', 'ERROR']);

/**
 * The failure codes `docs/domain/entities.md` names as expected failures.
 *
 * Closed on purpose: a consumer that receives an unlisted code cannot know
 * whether to compensate, and guessing that is how money goes missing.
 */
export const failureCode = z.enum([
  // Customer
  'DOCUMENT_ALREADY_REGISTERED',
  'EMAIL_ALREADY_REGISTERED',
  'INVALID_BIRTH_DATE',
  'ROLE_NOT_ELIGIBLE',
  'ACTIVATION_TOKEN_INVALID',
  'ACTIVATION_TOKEN_EXPIRED',
  /*
   * Added for the password-recovery flow the prototype's `P-07` draws, which
   * T-05 had no message for at all. Safe in the way `FORBIDDEN_ACCOUNT_ACCESS`
   * was and TD-024's addition was not: no message T-05 closed narrows to either
   * code with `extract()`, so no closed contract changes shape — only the new
   * `customer.password-reset.rejected.v1` admits them.
   *
   * They are separate from the two activation codes rather than reused because
   * they are separate facts: a dead activation link should offer to resend the
   * activation, and a dead reset link should offer to start the reset again.
   */
  'RESET_TOKEN_INVALID',
  'RESET_TOKEN_EXPIRED',
  'INVALID_CREDENTIALS',
  'IDENTITY_DOCUMENT_UNREADABLE',
  'IDENTITY_OBJECT_NOT_FOUND',
  'IDENTITY_DIGEST_MISMATCH',
  'CUSTOMER_NOT_FOUND',
  // Account
  'INSUFFICIENT_FUNDS',
  'ACCOUNT_INACTIVE',
  'ACCOUNT_NOT_FOUND',
  'INVALID_AMOUNT_PRECISION',
  /*
   * Added by T-27. Distinct from INSUFFICIENT_FUNDS: a debit that would leave
   * a positive balance can still be refused when that balance falls below the
   * account type's floor (`account-type-rules.ts`) — a different fact from
   * "there is not enough money to move at all".
   */
  'MINIMUM_BALANCE_VIOLATION',
  /*
   * Added by T-17. `../domain/actors.md` names this refusal — "may not operate
   * on an account that is not theirs ... the expected result is
   * FORBIDDEN_ACCOUNT_ACCESS, a named rejection, never a silent no-op" — but
   * T-05 closed the enum without it, so nothing could say it.
   *
   * The addition is safe in the way TD-024's was not: no existing contract
   * narrows to this code with `extract()`, so no message T-05 closed changes
   * shape. Only the new `account.open.rejected.v1` admits it.
   */
  'FORBIDDEN_ACCOUNT_ACCESS',
  // Transaction
  'INVALID_AMOUNT',
  'SAME_ACCOUNT_TRANSFER',
  'IDEMPOTENCY_KEY_CONFLICT',
  'ILLEGAL_TRANSITION',
  // Payment
  'PAYMENT_DECLINED',
  'PAYMENT_RETRIES_EXHAUSTED',
]);

export type Money = z.infer<typeof money>;
export type Role = z.infer<typeof role>;
export type AccountType = z.infer<typeof accountType>;
export type Producer = z.infer<typeof producer>;
export type TransactionStatus = z.infer<typeof transactionStatus>;
export type FailureCode = z.infer<typeof failureCode>;
export type AccountStatus = z.infer<typeof accountStatus>;
export type AccountOperationType = z.infer<typeof accountOperationType>;
export type AccountOperationStatus = z.infer<typeof accountOperationStatus>;
export type PaymentStatus = z.infer<typeof paymentStatus>;
export type PaymentErrorType = z.infer<typeof paymentErrorType>;
export type NotificationStatus = z.infer<typeof notificationStatus>;
export type NotificationChannel = z.infer<typeof notificationChannel>;
export type AuditProcessingStatus = z.infer<typeof auditProcessingStatus>;
export type KycStatus = z.infer<typeof kycStatus>;
