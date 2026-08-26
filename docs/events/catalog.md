# Message catalogue

The payload of every message the system can put on the broker. Forty-two contracts: the
thirty-five [`../domain/message-catalog.md`](../domain/message-catalog.md) fixed, plus the
seven recorded there as an extension.

**The executable definition is the code.** Each entry links to its contract in
[`../../apps/packages/contracts/src/events/`](../../apps/packages/contracts/src/events/), and
the field tables below are generated from those contracts so the two cannot drift. Regenerate
the machine-readable form with `pnpm --filter @bank/contracts schema:emit`.

## Rules that hold for every message

Stated once here instead of forty-two times below.

**Envelope.** Every payload travels inside the envelope described in
[`envelope.md`](envelope.md). Field tables below describe the `payload` only.

**Routing.** The routing key **is** the message name, version suffix included. The exchange
follows from the category: commands and requests on `bank.commands`, events on `bank.events`,
replies on `bank.replies`. See [`topology.md`](topology.md).

**Idempotency.** Every consumer recognises a redelivery through the envelope's
`idempotencyKey` and produces at most one domain effect per intention. Where a message names a
different key, the entry says so.

**Compatibility.** Inside `v1` only optional fields may be added. Removing a field, renaming
one, narrowing a type or making an optional field required requires `v2`, and the producer
publishes both until every consumer has moved. Consumers tolerate fields they do not know.

**Validation.** The envelope and the payload are validated before any domain logic runs. An
unknown name, an unsupported version or a non-conforming payload is refused and dead-lettered
without a retry — retrying a malformed message never repairs it.

**Error vocabulary.** Failure reasons are drawn from a closed set, mirroring the expected
failures of [`../domain/entities.md`](../domain/entities.md). No free text, no internal
messages, nothing that reveals whether an account or an email exists.


| Message | Category | Producer | Consumers |
| --- | --- | --- | --- |
| `customer.register.v1` | command | gateway | customer-service |
| `customer.registered.v1` | event | customer-service | notification-audit-service |
| `customer.authenticate.v1` | command | gateway | customer-service |
| `customer.authenticate.replied.v1` | reply | customer-service | gateway |
| `customer.login.succeeded.v1` | event | customer-service | notification-audit-service |
| `customer.login.rejected.v1` | event | customer-service | notification-audit-service |
| `customer.activation.requested.v1` | event | customer-service | notification-audit-service |
| `customer.verify-email.v1` | command | gateway | customer-service |
| `customer.email.verified.v1` | event | customer-service | notification-audit-service |
| `customer.email.verification.rejected.v1` | event | customer-service | notification-audit-service |
| `customer.update.v1` | command | gateway | customer-service |
| `customer.updated.v1` | event | customer-service | notification-audit-service |
| `customer.validate-identity.v1` | command | gateway | customer-service |
| `customer.identity.validated.v1` | event | customer-service | notification-audit-service |
| `customer.identity.rejected.v1` | event | customer-service | notification-audit-service |
| `account.create.v1` | command | gateway | account-service |
| `account.opened.v1` | event | account-service | notification-audit-service |
| `account.balance.query.v1` | command | gateway | account-service |
| `account.balance.replied.v1` | reply | account-service | gateway |
| `account.set-status.v1` | command | gateway | account-service |
| `account.deactivated.v1` | event | account-service | notification-audit-service |
| `account.reactivated.v1` | event | account-service | notification-audit-service |
| `transfer.requested.v1` | command | gateway | transaction-service |
| `transaction.initiated.v1` | event | transaction-service | notification-audit-service |
| `account.debit.requested.v1` | command | transaction-service | account-service |
| `account.debited.v1` | event | account-service | transaction-service, notification-audit-service |
| `account.debit.rejected.v1` | event | account-service | transaction-service, notification-audit-service |
| `payment.requested.v1` | command | transaction-service | payment-service |
| `payment.succeeded.v1` | event | payment-service | transaction-service, notification-audit-service |
| `payment.failed.v1` | event | payment-service | transaction-service, notification-audit-service |
| `account.credit.requested.v1` | command | transaction-service | account-service |
| `account.credited.v1` | event | account-service | transaction-service, notification-audit-service |
| `account.credit.rejected.v1` | event | account-service | transaction-service, notification-audit-service |
| `account.debit.compensation.requested.v1` | command | transaction-service | account-service |
| `account.debit.compensated.v1` | event | account-service | transaction-service, notification-audit-service |
| `transaction.completed.v1` | event | transaction-service | notification-audit-service |
| `transaction.failed.v1` | event | transaction-service | notification-audit-service |
| `transaction.compensated.v1` | event | transaction-service | notification-audit-service |
| `transaction.status.requested.v1` | command | gateway | transaction-service |
| `transaction.status.replied.v1` | reply | transaction-service | gateway |
| `audit.query.requested.v1` | command | gateway | notification-audit-service |
| `audit.query.replied.v1` | reply | notification-audit-service | gateway |


---

## Register a customer

### `customer.register.v1`

| | |
| --- | --- |
| **Category** | command |
| **Producer** | gateway |
| **Consumers** | customer-service |
| **Exchange** | `bank.commands` |
| **Routing key** | `customer.register.v1` |
| **Contract** | [`customer.register.v1.ts`](../../apps/packages/contracts/src/events/customer/customer.register.v1.ts) |

| Field | Type | Required |
| --- | --- | --- |
| `customerId` | UUID v4 | yes |
| `fullName` | string | yes |
| `identityDocument` | string | yes |
| `email` | email | yes |
| `dateOfBirth` | ISO-8601 date | yes |
| `address` | string | yes |
| `role` | `CLIENTE` \| `CAJERO_RECEPTOR` \| `ADMINISTRADOR` | yes |
| `credential` | string | yes |
| `photo` | object \| null | yes |

**Preconditions.** None. This is where a customer begins to exist.

**Effects.** A `Customer` is created in `PENDING_ACTIVATION` with `identityStatus = PENDING`. The credential is hashed on receipt and the plaintext is discarded; a `username` is generated from the full name and made unique by numeric suffix (C-2).

**On error.** `DOCUMENT_ALREADY_REGISTERED` (C-1), `EMAIL_ALREADY_REGISTERED` (C-3) or `INVALID_BIRTH_DATE` (C-5). No customer is created and no event is published.

### `customer.registered.v1`

| | |
| --- | --- |
| **Category** | event |
| **Producer** | customer-service |
| **Consumers** | notification-audit-service |
| **Exchange** | `bank.events` |
| **Routing key** | `customer.registered.v1` |
| **Contract** | [`customer.registered.v1.ts`](../../apps/packages/contracts/src/events/customer/customer.registered.v1.ts) |

| Field | Type | Required |
| --- | --- | --- |
| `customerId` | UUID v4 | yes |
| `username` | string | yes |
| `email` | email | yes |
| `role` | `CLIENTE` \| `CAJERO_RECEPTOR` \| `ADMINISTRADOR` | yes |
| `status` | `PENDING_ACTIVATION` \| `ACTIVE` | yes |
| `identityStatus` | `PENDING` \| `VALIDATED` \| `REJECTED` | yes |
| `registeredAt` | ISO-8601 UTC | yes |

**Preconditions.** A `Customer` was created.

**Effects.** Notification & Audit records the registration. Nobody else reacts.

**On error.** The consumer retries, then dead-letters. The customer still exists: the audit record is what is missing, and it is recoverable from the dead-letter queue.


---

## Sign in

### `customer.authenticate.v1`

| | |
| --- | --- |
| **Category** | command |
| **Producer** | gateway |
| **Consumers** | customer-service |
| **Exchange** | `bank.commands` |
| **Routing key** | `customer.authenticate.v1` |
| **Contract** | [`customer.authenticate.v1.ts`](../../apps/packages/contracts/src/events/customer/customer.authenticate.v1.ts) |

| Field | Type | Required |
| --- | --- | --- |
| `email` | email | yes |
| `credential` | string | yes |

**Preconditions.** None. An unknown email is a normal outcome, not an error.

**Effects.** Credentials are checked. On the first successful sign-in, `customer.activation.requested.v1` follows (§4.1, page 5).

**On error.** Never dead-lettered for wrong credentials — that is an answer, not a failure. The reply carries the refusal.

### `customer.authenticate.replied.v1`

| | |
| --- | --- |
| **Category** | reply |
| **Producer** | customer-service |
| **Consumers** | gateway |
| **Exchange** | `bank.replies` |
| **Routing key** | `customer.authenticate.replied.v1` |
| **Contract** | [`customer.authenticate.replied.v1.ts`](../../apps/packages/contracts/src/events/customer/customer.authenticate.replied.v1.ts) |

**When outcome = `APPROVED`**

| Field | Type | Required |
| --- | --- | --- |
| `outcome` | `APPROVED` | yes |
| `claims` | object | yes |
| `activationPending` | boolean | yes |

**When outcome = `REJECTED`**

| Field | Type | Required |
| --- | --- | --- |
| `outcome` | `REJECTED` | yes |
| `reason` | `INVALID_CREDENTIALS` | yes |

**Preconditions.** A `customer.authenticate.v1` was handled.

**Effects.** The Gateway mints the session JWT from the claims. It receives claims, never a token: signing lives in exactly one component (ADR-010).

**On error.** If it does not arrive within five seconds the Gateway stops waiting and answers the client that the attempt could not be completed. Nothing is cancelled; there is nothing to cancel.

### `customer.login.succeeded.v1`

| | |
| --- | --- |
| **Category** | event |
| **Producer** | customer-service |
| **Consumers** | notification-audit-service |
| **Exchange** | `bank.events` |
| **Routing key** | `customer.login.succeeded.v1` |
| **Contract** | [`customer.login.succeeded.v1.ts`](../../apps/packages/contracts/src/events/customer/customer.login.succeeded.v1.ts) |

| Field | Type | Required |
| --- | --- | --- |
| `customerId` | UUID v4 | yes |
| `firstLogin` | boolean | yes |
| `occurredAt` | ISO-8601 UTC | yes |

**Preconditions.** Credentials were accepted.

**Effects.** Audited. `firstLogin` tells Notification & Audit that an activation email is on its way.

**On error.** Retry, then dead-letter. The sign-in already happened; only its record is missing.

### `customer.login.rejected.v1`

| | |
| --- | --- |
| **Category** | event |
| **Producer** | customer-service |
| **Consumers** | notification-audit-service |
| **Exchange** | `bank.events` |
| **Routing key** | `customer.login.rejected.v1` |
| **Contract** | [`customer.login.rejected.v1.ts`](../../apps/packages/contracts/src/events/customer/customer.login.rejected.v1.ts) |

| Field | Type | Required |
| --- | --- | --- |
| `reason` | `INVALID_CREDENTIALS` | yes |
| `occurredAt` | ISO-8601 UTC | yes |

**Preconditions.** Credentials were refused.

**Effects.** Audited as a failed attempt. Carries no `customerId` on purpose: naming the customer would confirm the email exists, which is exactly what the reply refuses to reveal.

**On error.** Retry, then dead-letter.


---

## Activate by email

### `customer.activation.requested.v1`

| | |
| --- | --- |
| **Category** | event |
| **Producer** | customer-service |
| **Consumers** | notification-audit-service |
| **Exchange** | `bank.events` |
| **Routing key** | `customer.activation.requested.v1` |
| **Contract** | [`customer.activation.requested.v1.ts`](../../apps/packages/contracts/src/events/customer/customer.activation.requested.v1.ts) |

| Field | Type | Required |
| --- | --- | --- |
| `customerId` | UUID v4 | yes |
| `email` | email | yes |
| `expiresAt` | ISO-8601 UTC | yes |

**Preconditions.** A customer signed in for the first time and is still `PENDING_ACTIVATION`.

**Effects.** Notification & Audit sends the email containing the activation link. The email address is the single exception to the "does not cross" list (check M-5): a message cannot be delivered without an address.

**On error.** Retry, then dead-letter. The customer stays `PENDING_ACTIVATION` and a later sign-in requests the email again.

### `customer.verify-email.v1`

| | |
| --- | --- |
| **Category** | command |
| **Producer** | gateway |
| **Consumers** | customer-service |
| **Exchange** | `bank.commands` |
| **Routing key** | `customer.verify-email.v1` |
| **Contract** | [`customer.verify-email.v1.ts`](../../apps/packages/contracts/src/events/customer/customer.verify-email.v1.ts) |

| Field | Type | Required |
| --- | --- | --- |
| `activationToken` | string | yes |

**Preconditions.** The customer opened the link. The token must be unexpired, unused and not invalidated (C-7).

**Effects.** `emailVerifiedAt` is set and `status` becomes `ACTIVE`. The token is consumed and cannot be reused.

**On error.** `ACTIVATION_TOKEN_EXPIRED` or `ACTIVATION_TOKEN_INVALID`, published as `customer.email.verification.rejected.v1`. No state changes (C-7).

### `customer.email.verified.v1`

| | |
| --- | --- |
| **Category** | event |
| **Producer** | customer-service |
| **Consumers** | notification-audit-service |
| **Exchange** | `bank.events` |
| **Routing key** | `customer.email.verified.v1` |
| **Contract** | [`customer.email.verified.v1.ts`](../../apps/packages/contracts/src/events/customer/customer.email.verified.v1.ts) |

| Field | Type | Required |
| --- | --- | --- |
| `customerId` | UUID v4 | yes |
| `emailVerifiedAt` | ISO-8601 UTC | yes |
| `status` | `ACTIVE` | yes |

**Preconditions.** The token was valid and the account is now active.

**Effects.** Audited, and the customer is notified. `status` and `emailVerifiedAt` are both carried because invariant C-4 ties them: the redundancy makes a violation visible instead of inferable.

**On error.** Retry, then dead-letter. The account is already active.

### `customer.email.verification.rejected.v1`

| | |
| --- | --- |
| **Category** | event |
| **Producer** | customer-service |
| **Consumers** | notification-audit-service |
| **Exchange** | `bank.events` |
| **Routing key** | `customer.email.verification.rejected.v1` |
| **Contract** | [`customer.email.verification.rejected.v1.ts`](../../apps/packages/contracts/src/events/customer/customer.email.verification.rejected.v1.ts) |

| Field | Type | Required |
| --- | --- | --- |
| `reason` | `ACTIVATION_TOKEN_EXPIRED` \| `ACTIVATION_TOKEN_INVALID` | yes |
| `occurredAt` | ISO-8601 UTC | yes |

**Preconditions.** A token was presented and refused.

**Effects.** Audited. Expired and invalid are separate codes because they deserve different answers: an expired link should offer to resend, an invalid one should not admit a token was ever issued.

**On error.** Retry, then dead-letter.


---

## Update customer data

### `customer.update.v1`

| | |
| --- | --- |
| **Category** | command |
| **Producer** | gateway |
| **Consumers** | customer-service |
| **Exchange** | `bank.commands` |
| **Routing key** | `customer.update.v1` |
| **Contract** | [`customer.update.v1.ts`](../../apps/packages/contracts/src/events/customer/customer.update.v1.ts) |

| Field | Type | Required |
| --- | --- | --- |
| `customerId` | UUID v4 | yes |
| `fullName` | string | no |
| `address` | string | no |
| `dateOfBirth` | ISO-8601 date | no |

**Preconditions.** The customer exists. At least one field must change — an update that changes nothing is refused rather than emitting an event that says nothing happened.

**Effects.** The named fields are updated. Email, document, role and credential are not updatable here; each has its own invariant and its own use case.

**On error.** Refused if the customer does not exist, or if no field was supplied.

### `customer.updated.v1`

| | |
| --- | --- |
| **Category** | event |
| **Producer** | customer-service |
| **Consumers** | notification-audit-service |
| **Exchange** | `bank.events` |
| **Routing key** | `customer.updated.v1` |
| **Contract** | [`customer.updated.v1.ts`](../../apps/packages/contracts/src/events/customer/customer.updated.v1.ts) |

| Field | Type | Required |
| --- | --- | --- |
| `customerId` | UUID v4 | yes |
| `changedFields` | array of `fullName` \| `address` \| `dateOfBirth` | yes |
| `updatedAt` | ISO-8601 UTC | yes |

**Preconditions.** A customer's data changed.

**Effects.** Audited. Carries the **names** of the changed fields, not their values: copying an address into an event would put personal data in a second store for no decision that depends on it.

**On error.** Retry, then dead-letter.


---

## Validate identity

### `customer.validate-identity.v1`

| | |
| --- | --- |
| **Category** | command |
| **Producer** | gateway |
| **Consumers** | customer-service |
| **Exchange** | `bank.commands` |
| **Routing key** | `customer.validate-identity.v1` |
| **Contract** | [`customer.validate-identity.v1.ts`](../../apps/packages/contracts/src/events/customer/customer.validate-identity.v1.ts) |

| Field | Type | Required |
| --- | --- | --- |
| `customerId` | UUID v4 | yes |
| `photo` | object | yes |

**Preconditions.** The customer exists and the referenced object is in the bucket. Only `role = CLIENTE` requires validation (C-6).

**Effects.** Customer Service fetches the object, **recomputes the SHA-256 and compares it**, and only then persists the bytes as `BYTEA` in its own database.

**On error.** `IDENTITY_OBJECT_NOT_FOUND` when the reference points at nothing, `IDENTITY_DIGEST_MISMATCH` when the object is not what the command claimed, `IDENTITY_DOCUMENT_UNREADABLE` when it is unusable. The three are different situations and only the last is the customer's problem.

### `customer.identity.validated.v1`

| | |
| --- | --- |
| **Category** | event |
| **Producer** | customer-service |
| **Consumers** | notification-audit-service |
| **Exchange** | `bank.events` |
| **Routing key** | `customer.identity.validated.v1` |
| **Contract** | [`customer.identity.validated.v1.ts`](../../apps/packages/contracts/src/events/customer/customer.identity.validated.v1.ts) |

| Field | Type | Required |
| --- | --- | --- |
| `customerId` | UUID v4 | yes |
| `identityStatus` | `VALIDATED` | yes |
| `validatedAt` | ISO-8601 UTC | yes |

**Preconditions.** The document was accepted.

**Effects.** Audited. Independent of email activation: a customer may be `ACTIVE` with `identityStatus = PENDING`, and the reverse.

**On error.** Retry, then dead-letter.

### `customer.identity.rejected.v1`

| | |
| --- | --- |
| **Category** | event |
| **Producer** | customer-service |
| **Consumers** | notification-audit-service |
| **Exchange** | `bank.events` |
| **Routing key** | `customer.identity.rejected.v1` |
| **Contract** | [`customer.identity.rejected.v1.ts`](../../apps/packages/contracts/src/events/customer/customer.identity.rejected.v1.ts) |

| Field | Type | Required |
| --- | --- | --- |
| `customerId` | UUID v4 | yes |
| `identityStatus` | `REJECTED` | yes |
| `reason` | `IDENTITY_DOCUMENT_UNREADABLE` \| `IDENTITY_OBJECT_NOT_FOUND` \| `IDENTITY_DIGEST_MISMATCH` | yes |
| `rejectedAt` | ISO-8601 UTC | yes |

**Preconditions.** The document was refused.

**Effects.** Audited, and the customer is notified. `identityStatus` returns to `PENDING` when a new document is submitted.

**On error.** Retry, then dead-letter.


---

## Open an account

### `account.create.v1`

| | |
| --- | --- |
| **Category** | command |
| **Producer** | gateway |
| **Consumers** | account-service |
| **Exchange** | `bank.commands` |
| **Routing key** | `account.create.v1` |
| **Contract** | [`account.create.v1.ts`](../../apps/packages/contracts/src/events/account/account.create.v1.ts) |

| Field | Type | Required |
| --- | --- | --- |
| `accountId` | UUID v4 | yes |
| `customerId` | UUID v4 | yes |
| `accountType` | `MONETARIA` \| `AHORRO` | yes |

**Preconditions.** The customer exists and has `role = CLIENTE` (C-6).

**Effects.** An account is opened `ACTIVE` with a zero balance and the requested `accountType`.

**On error.** `ROLE_NOT_ELIGIBLE` when the customer is staff. No account is created.

### `account.opened.v1`

| | |
| --- | --- |
| **Category** | event |
| **Producer** | account-service |
| **Consumers** | notification-audit-service |
| **Exchange** | `bank.events` |
| **Routing key** | `account.opened.v1` |
| **Contract** | [`account.opened.v1.ts`](../../apps/packages/contracts/src/events/account/account.opened.v1.ts) |

| Field | Type | Required |
| --- | --- | --- |
| `accountId` | UUID v4 | yes |
| `customerId` | UUID v4 | yes |
| `accountType` | `MONETARIA` \| `AHORRO` | yes |
| `status` | `ACTIVE` | yes |
| `balance` | object | yes |
| `openedAt` | ISO-8601 UTC | yes |

**Preconditions.** An account was opened.

**Effects.** Audited, and the customer is notified.

**On error.** Retry, then dead-letter.


---

## Query a balance

### `account.balance.query.v1`

| | |
| --- | --- |
| **Category** | command |
| **Producer** | gateway |
| **Consumers** | account-service |
| **Exchange** | `bank.commands` |
| **Routing key** | `account.balance.query.v1` |
| **Contract** | [`account.balance.query.v1.ts`](../../apps/packages/contracts/src/events/account/account.balance.query.v1.ts) |

| Field | Type | Required |
| --- | --- | --- |
| `accountId` | UUID v4 | yes |

**Preconditions.** None. An unknown account is an answer, not a failure.

**Effects.** The balance is read. **`lastActivityAt` is not touched** (A-4): a customer who only checks their balance still drifts toward automatic deactivation.

**On error.** An unknown account is answered with `NOT_FOUND`, not dead-lettered.

### `account.balance.replied.v1`

| | |
| --- | --- |
| **Category** | reply |
| **Producer** | account-service |
| **Consumers** | gateway |
| **Exchange** | `bank.replies` |
| **Routing key** | `account.balance.replied.v1` |
| **Contract** | [`account.balance.replied.v1.ts`](../../apps/packages/contracts/src/events/account/account.balance.replied.v1.ts) |

**When outcome = `FOUND`**

| Field | Type | Required |
| --- | --- | --- |
| `outcome` | `FOUND` | yes |
| `accountId` | UUID v4 | yes |
| `balance` | object | yes |
| `status` | `ACTIVE` \| `INACTIVE` | yes |
| `lastActivityAt` | ISO-8601 UTC \| null | yes |

**When outcome = `NOT_FOUND`**

| Field | Type | Required |
| --- | --- | --- |
| `outcome` | `NOT_FOUND` | yes |
| `reason` | `ACCOUNT_NOT_FOUND` | yes |

**Preconditions.** An `account.balance.query.v1` was handled.

**Effects.** The Gateway answers the client.

**On error.** On timeout the Gateway stops waiting. Nothing was changed, so there is nothing to reconcile.


---

## Account status

### `account.set-status.v1`

| | |
| --- | --- |
| **Category** | command |
| **Producer** | gateway |
| **Consumers** | account-service |
| **Exchange** | `bank.commands` |
| **Routing key** | `account.set-status.v1` |
| **Contract** | [`account.set-status.v1.ts`](../../apps/packages/contracts/src/events/account/account.set-status.v1.ts) |

| Field | Type | Required |
| --- | --- | --- |
| `accountId` | UUID v4 | yes |
| `status` | `ACTIVE` \| `INACTIVE` | yes |
| `reason` | string | yes |

**Preconditions.** The caller is `ADMINISTRADOR`. The Gateway holds the verified role and makes that decision; this contract only carries the intent.

**Effects.** The account changes status and the matching event is published.

**On error.** `ACCOUNT_NOT_FOUND`. Setting the status it already has is a no-op and emits nothing (A-5).

### `account.deactivated.v1`

| | |
| --- | --- |
| **Category** | event |
| **Producer** | account-service |
| **Consumers** | notification-audit-service |
| **Exchange** | `bank.events` |
| **Routing key** | `account.deactivated.v1` |
| **Contract** | [`account.deactivated.v1.ts`](../../apps/packages/contracts/src/events/account/account.deactivated.v1.ts) |

| Field | Type | Required |
| --- | --- | --- |
| `accountId` | UUID v4 | yes |
| `cause` | `AUTOMATIC_INACTIVITY` \| `ADMINISTRATOR` | yes |
| `balanceAtDeactivation` | object | yes |
| `lastActivityAt` | ISO-8601 UTC \| null | yes |
| `deactivatedAt` | ISO-8601 UTC | yes |

**Preconditions.** An account went inactive, either by the automatic sweep or by an administrator.

**Effects.** Audited, and the customer is notified. The automatic process is idempotent: an already inactive account does not transition again nor emit a second event (A-5).

**On error.** Retry, then dead-letter.

### `account.reactivated.v1`

| | |
| --- | --- |
| **Category** | event |
| **Producer** | account-service |
| **Consumers** | notification-audit-service |
| **Exchange** | `bank.events` |
| **Routing key** | `account.reactivated.v1` |
| **Contract** | [`account.reactivated.v1.ts`](../../apps/packages/contracts/src/events/account/account.reactivated.v1.ts) |

| Field | Type | Required |
| --- | --- | --- |
| `accountId` | UUID v4 | yes |
| `cause` | `CREDIT_RECEIVED` \| `ADMINISTRATOR` | yes |
| `reactivatedAt` | ISO-8601 UTC | yes |

**Preconditions.** An account came back, either because a credit arrived (A-3) or because an administrator said so.

**Effects.** Audited.

**On error.** Retry, then dead-letter.


---

## Transfer — the Saga

### `transfer.requested.v1`

| | |
| --- | --- |
| **Category** | command |
| **Producer** | gateway |
| **Consumers** | transaction-service |
| **Exchange** | `bank.commands` |
| **Routing key** | `transfer.requested.v1` |
| **Contract** | [`transfer.requested.v1.ts`](../../apps/packages/contracts/src/events/transaction/transfer.requested.v1.ts) |

| Field | Type | Required |
| --- | --- | --- |
| `transactionId` | UUID v4 | yes |
| `sourceAccount` | UUID v4 | yes |
| `targetAccount` | UUID v4 | yes |
| `amount` | object | yes |
| `paymentScenario` | `APPROVE` \| `REJECT` \| `TRANSIENT_FAILURE` | no |

**Amended by T-15 (2026-08-24), additively.** `paymentScenario` was added as an
**optional** field, which is why the version stayed at `v1`: a message that
omits it validates exactly as it did before, so no consumer had to change and
no binding had to move. Its absence is the normal path.

It exists because the Saga is only interesting when it can be shown failing and
compensating on demand, and a real external provider cannot be asked to decline
to order. **The Gateway validates the value against the three names and never
acts on it** — obeying it is Transaction Service's business, and deciding
anything from it in the Gateway would be the domain logic constitution V keeps
out of the entry point.

**Preconditions.** Both accounts exist, the source is `ACTIVE` and has funds. Only the first two are checkable here; the rest belongs to Account Service.

**Effects.** Step 1 of the Saga. A `Transaction` is created `PENDING` and moves to `DEBITING`; `account.debit.requested.v1` follows.

**On error.** `INVALID_AMOUNT` (T-1), `SAME_ACCOUNT_TRANSFER` (T-2) or `INVALID_AMOUNT_PRECISION` (A-6) — refused before a transaction exists. A reused `idempotencyKey` with identical content returns the original transaction without moving balances (T-3); with different content it is `IDEMPOTENCY_KEY_CONFLICT` (T-4), because answering with the original result would be a lie.

### `transaction.initiated.v1`

| | |
| --- | --- |
| **Category** | event |
| **Producer** | transaction-service |
| **Consumers** | notification-audit-service |
| **Exchange** | `bank.events` |
| **Routing key** | `transaction.initiated.v1` |
| **Contract** | [`transaction.initiated.v1.ts`](../../apps/packages/contracts/src/events/transaction/transaction.initiated.v1.ts) |

| Field | Type | Required |
| --- | --- | --- |
| `transactionId` | UUID v4 | yes |
| `sourceAccount` | UUID v4 | yes |
| `targetAccount` | UUID v4 | yes |
| `amount` | object | yes |
| `status` | `PENDING` | yes |
| `createdAt` | ISO-8601 UTC | yes |

**Preconditions.** The Saga opened.

**Effects.** Audited. Everything after this has something to reconcile against.

**On error.** Retry, then dead-letter.

### `account.debit.requested.v1`

| | |
| --- | --- |
| **Category** | command |
| **Producer** | transaction-service |
| **Consumers** | account-service |
| **Exchange** | `bank.commands` |
| **Routing key** | `account.debit.requested.v1` |
| **Contract** | [`account.debit.requested.v1.ts`](../../apps/packages/contracts/src/events/account/account.debit.requested.v1.ts) |

| Field | Type | Required |
| --- | --- | --- |
| `transactionId` | UUID v4 | yes |
| `accountId` | UUID v4 | yes |
| `amount` | object | yes |

**Preconditions.** The transaction is in `DEBITING`.

**Effects.** Step 2. The source account is locked, funds are checked, the amount is debited and `lastActivityAt` is updated.

**On error.** `account.debit.rejected.v1`. Nothing is partially applied: a debit either happens or does not (A-1).

### `account.debited.v1`

| | |
| --- | --- |
| **Category** | event |
| **Producer** | account-service |
| **Consumers** | transaction-service, notification-audit-service |
| **Exchange** | `bank.events` |
| **Routing key** | `account.debited.v1` |
| **Contract** | [`account.debited.v1.ts`](../../apps/packages/contracts/src/events/account/account.debited.v1.ts) |

| Field | Type | Required |
| --- | --- | --- |
| `transactionId` | UUID v4 | yes |
| `accountId` | UUID v4 | yes |
| `amount` | object | yes |
| `balanceAfter` | object | yes |
| `debitedAt` | ISO-8601 UTC | yes |

**Preconditions.** The money left the source account.

**Effects.** Step 2 succeeded. Transaction Service moves to `PAYMENT_PENDING`. **From here the Saga can no longer end in `FAILED`** (T-7): there is an effect to undo, so every later failure compensates instead.

**On error.** Retry, then dead-letter. The money has moved and the Saga is stalled — this is the case T-23's stalled-Saga procedure exists for.

### `account.debit.rejected.v1`

| | |
| --- | --- |
| **Category** | event |
| **Producer** | account-service |
| **Consumers** | transaction-service, notification-audit-service |
| **Exchange** | `bank.events` |
| **Routing key** | `account.debit.rejected.v1` |
| **Contract** | [`account.debit.rejected.v1.ts`](../../apps/packages/contracts/src/events/account/account.debit.rejected.v1.ts) |

| Field | Type | Required |
| --- | --- | --- |
| `transactionId` | UUID v4 | yes |
| `accountId` | UUID v4 | yes |
| `reason` | `INSUFFICIENT_FUNDS` \| `ACCOUNT_INACTIVE` \| `ACCOUNT_NOT_FOUND` \| `INVALID_AMOUNT_PRECISION` | yes |

**Preconditions.** The debit did not happen.

**Effects.** The transaction closes in `FAILED`. **No compensation runs**, because there is no effect to reverse.

**On error.** Retry, then dead-letter.

### `payment.requested.v1`

| | |
| --- | --- |
| **Category** | command |
| **Producer** | transaction-service |
| **Consumers** | payment-service |
| **Exchange** | `bank.commands` |
| **Routing key** | `payment.requested.v1` |
| **Contract** | [`payment.requested.v1.ts`](../../apps/packages/contracts/src/events/payment/payment.requested.v1.ts) |

| Field | Type | Required |
| --- | --- | --- |
| `paymentId` | UUID v4 | yes |
| `transactionId` | UUID v4 | yes |
| `amount` | object | yes |

**Preconditions.** The debit succeeded and the transaction is in `PAYMENT_PENDING`.

**Effects.** Step 4. Payment Service processes the payment, retrying internally and counting `attempt`. It reacts to this command and **not** to `account.debited.v1` directly — that is what `../domain/use-cases.md` §6 fixed.

**On error.** `payment.failed.v1` once its own retries are spent.

### `payment.succeeded.v1`

| | |
| --- | --- |
| **Category** | event |
| **Producer** | payment-service |
| **Consumers** | transaction-service, notification-audit-service |
| **Exchange** | `bank.events` |
| **Routing key** | `payment.succeeded.v1` |
| **Contract** | [`payment.succeeded.v1.ts`](../../apps/packages/contracts/src/events/payment/payment.succeeded.v1.ts) |

| Field | Type | Required |
| --- | --- | --- |
| `paymentId` | UUID v4 | yes |
| `transactionId` | UUID v4 | yes |
| `status` | `SUCCEEDED` | yes |
| `attempt` | integer | yes |
| `succeededAt` | ISO-8601 UTC | yes |

**Preconditions.** The payment went through.

**Effects.** Transaction Service orders the credit. `attempt` records how many tries it took; a success on the third attempt is a different operational story from one on the first.

**On error.** Retry, then dead-letter.

### `payment.failed.v1`

| | |
| --- | --- |
| **Category** | event |
| **Producer** | payment-service |
| **Consumers** | transaction-service, notification-audit-service |
| **Exchange** | `bank.events` |
| **Routing key** | `payment.failed.v1` |
| **Contract** | [`payment.failed.v1.ts`](../../apps/packages/contracts/src/events/payment/payment.failed.v1.ts) |

| Field | Type | Required |
| --- | --- | --- |
| `paymentId` | UUID v4 | yes |
| `transactionId` | UUID v4 | yes |
| `status` | `FAILED` | yes |
| `attempt` | integer | yes |
| `failureReason` | `PAYMENT_DECLINED` \| `PAYMENT_RETRIES_EXHAUSTED` | yes |
| `failedAt` | ISO-8601 UTC | yes |

**Preconditions.** The payment failed and Payment Service's retries are spent.

**Effects.** Compensation begins. `failureReason` is required here even though the entity allows it to be null, because a compensation with no recorded cause explains nothing.

**On error.** Retry, then dead-letter. The debit stands until the compensation runs.

### `account.credit.requested.v1`

| | |
| --- | --- |
| **Category** | command |
| **Producer** | transaction-service |
| **Consumers** | account-service |
| **Exchange** | `bank.commands` |
| **Routing key** | `account.credit.requested.v1` |
| **Contract** | [`account.credit.requested.v1.ts`](../../apps/packages/contracts/src/events/account/account.credit.requested.v1.ts) |

| Field | Type | Required |
| --- | --- | --- |
| `transactionId` | UUID v4 | yes |
| `accountId` | UUID v4 | yes |
| `amount` | object | yes |

**Preconditions.** The payment succeeded.

**Effects.** Step 6. The target account is credited. Crediting an `INACTIVE` account is legal and reactivates it (A-3).

**On error.** `account.credit.rejected.v1`, which triggers compensation.

### `account.credited.v1`

| | |
| --- | --- |
| **Category** | event |
| **Producer** | account-service |
| **Consumers** | transaction-service, notification-audit-service |
| **Exchange** | `bank.events` |
| **Routing key** | `account.credited.v1` |
| **Contract** | [`account.credited.v1.ts`](../../apps/packages/contracts/src/events/account/account.credited.v1.ts) |

| Field | Type | Required |
| --- | --- | --- |
| `transactionId` | UUID v4 | yes |
| `accountId` | UUID v4 | yes |
| `amount` | object | yes |
| `balanceAfter` | object | yes |
| `reactivated` | boolean | yes |
| `creditedAt` | ISO-8601 UTC | yes |

**Preconditions.** The money arrived in the target account.

**Effects.** The transaction closes in `COMPLETED`. `reactivated` records that the credit brought an inactive account back, so the audit trail shows the state changed as a side effect of a transfer rather than by an administrator.

**On error.** Retry, then dead-letter.

### `account.credit.rejected.v1`

| | |
| --- | --- |
| **Category** | event |
| **Producer** | account-service |
| **Consumers** | transaction-service, notification-audit-service |
| **Exchange** | `bank.events` |
| **Routing key** | `account.credit.rejected.v1` |
| **Contract** | [`account.credit.rejected.v1.ts`](../../apps/packages/contracts/src/events/account/account.credit.rejected.v1.ts) |

| Field | Type | Required |
| --- | --- | --- |
| `transactionId` | UUID v4 | yes |
| `accountId` | UUID v4 | yes |
| `reason` | `ACCOUNT_NOT_FOUND` \| `INVALID_AMOUNT_PRECISION` | yes |

**Preconditions.** The credit could not be applied.

**Effects.** Compensation begins. `ACCOUNT_INACTIVE` is deliberately not a possible reason: crediting an inactive account is legal (A-3).

**On error.** Retry, then dead-letter.

### `account.debit.compensation.requested.v1`

| | |
| --- | --- |
| **Category** | command |
| **Producer** | transaction-service |
| **Consumers** | account-service |
| **Exchange** | `bank.commands` |
| **Routing key** | `account.debit.compensation.requested.v1` |
| **Contract** | [`account.debit.compensation.requested.v1.ts`](../../apps/packages/contracts/src/events/account/account.debit.compensation.requested.v1.ts) |

| Field | Type | Required |
| --- | --- | --- |
| `transactionId` | UUID v4 | yes |
| `accountId` | UUID v4 | yes |
| `amount` | object | yes |
| `triggeredBy` | `PAYMENT_DECLINED` \| `PAYMENT_RETRIES_EXHAUSTED` \| `ACCOUNT_NOT_FOUND` \| `INVALID_AMOUNT_PRECISION` | yes |

**Preconditions.** The debit was applied and a later step failed.

**Effects.** The amount returns to the source account. `triggeredBy` records which of the two failures caused it, because the audit record has to explain why money moved twice.

**On error.** Retry, then dead-letter. This is the most serious dead-letter in the system: money is out of the source account and has not come back.

### `account.debit.compensated.v1`

| | |
| --- | --- |
| **Category** | event |
| **Producer** | account-service |
| **Consumers** | transaction-service, notification-audit-service |
| **Exchange** | `bank.events` |
| **Routing key** | `account.debit.compensated.v1` |
| **Contract** | [`account.debit.compensated.v1.ts`](../../apps/packages/contracts/src/events/account/account.debit.compensated.v1.ts) |

| Field | Type | Required |
| --- | --- | --- |
| `transactionId` | UUID v4 | yes |
| `accountId` | UUID v4 | yes |
| `amount` | object | yes |
| `balanceAfter` | object | yes |
| `compensatedAt` | ISO-8601 UTC | yes |

**Preconditions.** The money is back in the source account.

**Effects.** The transaction closes in `COMPENSATED`.

**On error.** Retry, then dead-letter.

### `transaction.completed.v1`

| | |
| --- | --- |
| **Category** | event |
| **Producer** | transaction-service |
| **Consumers** | notification-audit-service |
| **Exchange** | `bank.events` |
| **Routing key** | `transaction.completed.v1` |
| **Contract** | [`transaction.completed.v1.ts`](../../apps/packages/contracts/src/events/transaction/transaction.completed.v1.ts) |

| Field | Type | Required |
| --- | --- | --- |
| `transactionId` | UUID v4 | yes |
| `sourceAccount` | UUID v4 | yes |
| `targetAccount` | UUID v4 | yes |
| `amount` | object | yes |
| `status` | `COMPLETED` | yes |
| `completedAt` | ISO-8601 UTC | yes |

**Preconditions.** The credit was confirmed.

**Effects.** Audited, and the customer is notified. Terminal.

**On error.** Retry, then dead-letter.

### `transaction.failed.v1`

| | |
| --- | --- |
| **Category** | event |
| **Producer** | transaction-service |
| **Consumers** | notification-audit-service |
| **Exchange** | `bank.events` |
| **Routing key** | `transaction.failed.v1` |
| **Contract** | [`transaction.failed.v1.ts`](../../apps/packages/contracts/src/events/transaction/transaction.failed.v1.ts) |

| Field | Type | Required |
| --- | --- | --- |
| `transactionId` | UUID v4 | yes |
| `status` | `FAILED` | yes |
| `reason` | `INSUFFICIENT_FUNDS` \| `ACCOUNT_INACTIVE` \| `ACCOUNT_NOT_FOUND` \| `INVALID_AMOUNT` \| `INVALID_AMOUNT_PRECISION` \| `SAME_ACCOUNT_TRANSFER` \| `IDEMPOTENCY_KEY_CONFLICT` | yes |
| `failedAt` | ISO-8601 UTC | yes |

**Preconditions.** The debit was rejected.

**Effects.** Audited, and the customer is notified. Terminal. **Not interchangeable with `COMPENSATED`**: this means the money never left.

**On error.** Retry, then dead-letter.

### `transaction.compensated.v1`

| | |
| --- | --- |
| **Category** | event |
| **Producer** | transaction-service |
| **Consumers** | notification-audit-service |
| **Exchange** | `bank.events` |
| **Routing key** | `transaction.compensated.v1` |
| **Contract** | [`transaction.compensated.v1.ts`](../../apps/packages/contracts/src/events/transaction/transaction.compensated.v1.ts) |

| Field | Type | Required |
| --- | --- | --- |
| `transactionId` | UUID v4 | yes |
| `status` | `COMPENSATED` | yes |
| `reason` | `PAYMENT_DECLINED` \| `PAYMENT_RETRIES_EXHAUSTED` \| `ACCOUNT_NOT_FOUND` \| `INVALID_AMOUNT_PRECISION` | yes |
| `compensatedAt` | ISO-8601 UTC | yes |

**Preconditions.** The compensation completed.

**Effects.** Audited, and the customer is notified. Terminal. This means the money left and came back — two movements, not none.

**On error.** Retry, then dead-letter.


---

## Consult a transfer

### `transaction.status.requested.v1`

| | |
| --- | --- |
| **Category** | command |
| **Producer** | gateway |
| **Consumers** | transaction-service |
| **Exchange** | `bank.commands` |
| **Routing key** | `transaction.status.requested.v1` |
| **Contract** | [`transaction.status.requested.v1.ts`](../../apps/packages/contracts/src/events/transaction/transaction.status.requested.v1.ts) |

| Field | Type | Required |
| --- | --- | --- |
| `transactionId` | UUID v4 | no |
| `correlationId` | UUID v4 | no |

**Preconditions.** None. One of `transactionId` or `correlationId` must be supplied.

**Effects.** The transfer's current state is read. This is what makes the five-second reply timeout survivable: the Gateway stopped waiting, the Saga did not stop running, and this is how the caller finds out how it ended.

**On error.** An unknown transfer is answered with `NOT_FOUND`, not dead-lettered.

### `transaction.status.replied.v1`

| | |
| --- | --- |
| **Category** | reply |
| **Producer** | transaction-service |
| **Consumers** | gateway |
| **Exchange** | `bank.replies` |
| **Routing key** | `transaction.status.replied.v1` |
| **Contract** | [`transaction.status.replied.v1.ts`](../../apps/packages/contracts/src/events/transaction/transaction.status.replied.v1.ts) |

**When outcome = `FOUND`**

| Field | Type | Required |
| --- | --- | --- |
| `outcome` | `FOUND` | yes |
| `transactionId` | UUID v4 | yes |
| `status` | `PENDING` \| `DEBITING` \| `PAYMENT_PENDING` \| `COMPLETED` \| `FAILED` \| `COMPENSATED` | yes |
| `amount` | object | yes |
| `reason` | `DOCUMENT_ALREADY_REGISTERED` \| `EMAIL_ALREADY_REGISTERED` \| `INVALID_BIRTH_DATE` \| `ROLE_NOT_ELIGIBLE` \| `ACTIVATION_TOKEN_INVALID` \| `ACTIVATION_TOKEN_EXPIRED` \| `INVALID_CREDENTIALS` \| `IDENTITY_DOCUMENT_UNREADABLE` \| `IDENTITY_OBJECT_NOT_FOUND` \| `IDENTITY_DIGEST_MISMATCH` \| `INSUFFICIENT_FUNDS` \| `ACCOUNT_INACTIVE` \| `ACCOUNT_NOT_FOUND` \| `INVALID_AMOUNT_PRECISION` \| `INVALID_AMOUNT` \| `SAME_ACCOUNT_TRANSFER` \| `IDEMPOTENCY_KEY_CONFLICT` \| `ILLEGAL_TRANSITION` \| `PAYMENT_DECLINED` \| `PAYMENT_RETRIES_EXHAUSTED` \| null | yes |
| `createdAt` | ISO-8601 UTC | yes |
| `updatedAt` | ISO-8601 UTC | yes |

**When outcome = `NOT_FOUND`**

| Field | Type | Required |
| --- | --- | --- |
| `outcome` | `NOT_FOUND` | yes |

**Preconditions.** A `transaction.status.requested.v1` was handled.

**Effects.** The Gateway answers the client. `reason` is present exactly when the transfer did not complete, and always from the closed failure set — this is the most likely thing a customer sees after a timeout, so it is the last place that should leak an internal detail.

**On error.** On timeout the Gateway stops waiting; the caller may ask again.


---

## Consult the audit trail

### `audit.query.requested.v1`

| | |
| --- | --- |
| **Category** | command |
| **Producer** | gateway |
| **Consumers** | notification-audit-service |
| **Exchange** | `bank.commands` |
| **Routing key** | `audit.query.requested.v1` |
| **Contract** | [`audit.query.requested.v1.ts`](../../apps/packages/contracts/src/events/audit/audit.query.requested.v1.ts) |

| Field | Type | Required |
| --- | --- | --- |
| `correlationId` | UUID v4 | yes |

**Preconditions.** None.

**Effects.** The audit trail of one flow is read, keyed by `correlationId` because that is the only identifier every message of a flow shares.

**On error.** A `correlationId` with no records returns empty lists, not an error.

### `audit.query.replied.v1`

| | |
| --- | --- |
| **Category** | reply |
| **Producer** | notification-audit-service |
| **Consumers** | gateway |
| **Exchange** | `bank.replies` |
| **Routing key** | `audit.query.replied.v1` |
| **Contract** | [`audit.query.replied.v1.ts`](../../apps/packages/contracts/src/events/audit/audit.query.replied.v1.ts) |

| Field | Type | Required |
| --- | --- | --- |
| `correlationId` | UUID v4 | yes |
| `events` | array of object | yes |
| `notifications` | array of object | yes |

**Preconditions.** An `audit.query.requested.v1` was handled.

**Effects.** The Gateway answers with the ordered events and the notifications of that flow. Returns **metadata, not payloads**: echoing every payload back would recreate, in one reply, the data the per-service databases exist to keep apart.

**On error.** On timeout the Gateway stops waiting.
