# Message catalogue

The payload of every message the system can put on the broker. **Ninety-seven contracts** — 40
commands, 33 events and 24 replies: the thirty-five
[`../domain/message-catalog.md`](../domain/message-catalog.md) fixed, the thirteen recorded
there as an extension, and forty-nine added by the features that followed — the
password-recovery flow, the deposit window, the biller catalogue, the read paths the screens
needed, the customer's own inbox, the audit events listing, and the five dashboard counters.

By family: 37 `customer.*`, 27 `account.*`, 11 `transaction.*` (`transfer.requested.v1`
included), 10 `payment.*`, 6 `notification.*`, 6 `audit.*`.

**The executable definition is the code.** Each entry links to its contract in
[`../../apps/packages/contracts/src/events/`](../../apps/packages/contracts/src/events/), and
every field table here has been checked field by field against the Zod schema it describes. When
this document and a contract disagree, the contract is right and this file is the bug.

**This file is maintained by hand.** There is a generator —
`pnpm --filter @bank/contracts docs:catalog`, from `scripts/catalog-preamble.md`,
`scripts/catalog-prose.json` and the emitted JSON Schema — but its flow list and its prose file
were last updated when the catalogue held fifty-five contracts, so it now refuses to run rather
than emit a document missing a third of the messages. Until it is repaired, **adding a contract
means adding its entry here**, in the summary table and in the flow it belongs to. Regenerate
the machine-readable form with `pnpm --filter @bank/contracts schema:emit`.

## Rules that hold for every message

Stated once here instead of ninety-one times below.

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
| `customer.register.rejected.v1` | event | customer-service | notification-audit-service |
| `customer.authenticate.v1` | command | gateway | customer-service |
| `customer.authenticate.replied.v1` | reply | customer-service | gateway |
| `customer.login.succeeded.v1` | event | customer-service | notification-audit-service |
| `customer.login.rejected.v1` | event | customer-service | notification-audit-service |
| `customer.activation.requested.v1` | event | customer-service | notification-audit-service |
| `customer.verify-email.v1` | command | gateway | customer-service |
| `customer.email.verified.v1` | event | customer-service | notification-audit-service |
| `customer.email.verification.rejected.v1` | event | customer-service | notification-audit-service |
| `customer.password-reset.requested.v1` | command | gateway | customer-service |
| `customer.password-reset.issued.v1` | event | customer-service | notification-audit-service |
| `customer.password-reset.confirm.v1` | command | gateway | customer-service |
| `customer.password-reset.completed.v1` | event | customer-service | notification-audit-service |
| `customer.password-reset.rejected.v1` | event | customer-service | notification-audit-service |
| `customer.change-password.v1` | command | gateway | customer-service |
| `customer.password-changed.v1` | event | customer-service | notification-audit-service |
| `customer.password-change.rejected.v1` | event | customer-service | notification-audit-service |
| `customer.update.v1` | command | gateway | customer-service |
| `customer.updated.v1` | event | customer-service | notification-audit-service |
| `customer.get.query.v1` | command | gateway | customer-service |
| `customer.get.replied.v1` | reply | customer-service | gateway |
| `customer.names.query.v1` | command | gateway | customer-service |
| `customer.names.replied.v1` | reply | customer-service | gateway |
| `customer.list.query.v1` | command | gateway | customer-service |
| `customer.list.replied.v1` | reply | customer-service | gateway |
| `customer.identity-document.query.v1` | command | gateway | customer-service |
| `customer.identity-document.replied.v1` | reply | customer-service | gateway |
| `customer.validate-identity.v1` | command | gateway | customer-service |
| `customer.identity.validated.v1` | event | customer-service | notification-audit-service |
| `customer.identity.rejected.v1` | event | customer-service | notification-audit-service |
| `customer.pending-validation.query.v1` | command | gateway | customer-service |
| `customer.pending-validation.replied.v1` | reply | customer-service | gateway |
| `customer.set-identity-verdict.v1` | command | gateway | customer-service |
| `account.create.v1` | command | gateway | account-service |
| `account.opened.v1` | event | account-service | notification-audit-service |
| `account.open.rejected.v1` | event | account-service | notification-audit-service |
| `account.balance.query.v1` | command | gateway | account-service |
| `account.balance.replied.v1` | reply | account-service | gateway |
| `account.list.query.v1` | command | gateway | account-service |
| `account.list.replied.v1` | reply | account-service | gateway |
| `account.operations.query.v1` | command | gateway | account-service |
| `account.operations.replied.v1` | reply | account-service | gateway |
| `account.set-status.v1` | command | gateway | account-service |
| `account.deactivated.v1` | event | account-service | notification-audit-service |
| `account.reactivated.v1` | event | account-service | notification-audit-service |
| `account.deposit.v1` | command | gateway | account-service |
| `account.deposited.v1` | event | account-service | notification-audit-service |
| `account.deposit.rejected.v1` | event | account-service | notification-audit-service |
| `account.billers.query.v1` | command | gateway | account-service |
| `account.billers.replied.v1` | reply | account-service | gateway |
| `transfer.requested.v1` | command | gateway | transaction-service |
| `transaction.initiated.v1` | event | transaction-service | notification-audit-service |
| `account.debit.requested.v1` | command | transaction-service | account-service |
| `account.debited.v1` | event | account-service | transaction-service, notification-audit-service |
| `account.debit.rejected.v1` | event | account-service | transaction-service, notification-audit-service |
| `payment.requested.v1` | command | transaction-service | payment-service |
| `payment.attempt.failed.v1` | event | payment-service | transaction-service, notification-audit-service |
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
| `transaction.list.query.v1` | command | gateway | transaction-service |
| `transaction.list.replied.v1` | reply | transaction-service | gateway |
| `payment.status.query.v1` | command | gateway | payment-service |
| `payment.status.replied.v1` | reply | payment-service | gateway |
| `payment.list.query.v1` | command | gateway | payment-service |
| `payment.list.replied.v1` | reply | payment-service | gateway |
| `audit.query.requested.v1` | command | gateway | notification-audit-service |
| `audit.query.replied.v1` | reply | notification-audit-service | gateway |
| `audit.events.list.query.v1` | command | gateway | notification-audit-service |
| `audit.events.list.replied.v1` | reply | notification-audit-service | gateway |
| `notification.list.query.v1` | command | gateway | notification-audit-service |
| `notification.list.replied.v1` | reply | notification-audit-service | gateway |
| `notification.inbox.query.v1` | command | gateway | notification-audit-service |
| `notification.inbox.replied.v1` | reply | notification-audit-service | gateway |
| `notification.mark-read.v1` | command | gateway | notification-audit-service |
| `notification.read.replied.v1` | reply | notification-audit-service | gateway |
| `customer.stats.query.v1` | command | gateway | customer-service |
| `customer.stats.replied.v1` | reply | customer-service | gateway |
| `account.stats.query.v1` | command | gateway | account-service |
| `account.stats.replied.v1` | reply | account-service | gateway |
| `transaction.stats.query.v1` | command | gateway | transaction-service |
| `transaction.stats.replied.v1` | reply | transaction-service | gateway |
| `payment.stats.query.v1` | command | gateway | payment-service |
| `payment.stats.replied.v1` | reply | payment-service | gateway |
| `audit.stats.query.v1` | command | gateway | notification-audit-service |
| `audit.stats.replied.v1` | reply | notification-audit-service | gateway |


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

### `customer.register.rejected.v1`

| | |
| --- | --- |
| **Category** | event |
| **Producer** | customer-service |
| **Consumers** | notification-audit-service |
| **Exchange** | `bank.events` |
| **Routing key** | `customer.register.rejected.v1` |
| **Contract** | [`customer.register.rejected.v1.ts`](../../apps/packages/contracts/src/events/customer/customer.register.rejected.v1.ts) |

| Field | Type | Required |
| --- | --- | --- |
| `reason` | `DOCUMENT_ALREADY_REGISTERED` \| `EMAIL_ALREADY_REGISTERED` \| `INVALID_BIRTH_DATE` | yes |
| `rejectedAt` | ISO-8601 UTC | yes |

**Preconditions.** A `customer.register.v1` was refused by an invariant. No `Customer` exists, and no identity document was stored.

**Effects.** Notification & Audit records the refusal, which is how the caller finds out: the command was accepted with a `202` long before the invariant was evaluated.

**On error.** The consumer retries, then dead-letters. Nothing was created, so there is nothing to compensate.


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
| `activationToken` | string | no |

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

## Recover a forgotten password

### `customer.password-reset.requested.v1`

| | |
| --- | --- |
| **Category** | command |
| **Producer** | gateway |
| **Consumers** | customer-service |
| **Exchange** | `bank.commands` |
| **Routing key** | `customer.password-reset.requested.v1` |
| **Contract** | [`customer.password-reset.requested.v1.ts`](../../apps/packages/contracts/src/events/customer/customer.password-reset.requested.v1.ts) |

| Field | Type | Required |
| --- | --- | --- |
| `email` | email | yes |

**Preconditions.** None. An address that belongs to no account is a normal outcome.

**Effects.** If the address belongs to an account, a reset link is issued and `customer.password-reset.issued.v1` follows. If it does not, **nothing at all happens** — and the Gateway reports the same thing either way. A route that answered differently for a known and an unknown address would be an account-enumeration oracle open to the whole internet, the same reasoning that keeps the sign-in refusal generic.

**On error.** There is no reply and no rejection event for an unknown address. The interesting outcome is the email, or its absence.

### `customer.password-reset.issued.v1`

| | |
| --- | --- |
| **Category** | event |
| **Producer** | customer-service |
| **Consumers** | notification-audit-service |
| **Exchange** | `bank.events` |
| **Routing key** | `customer.password-reset.issued.v1` |
| **Contract** | [`customer.password-reset.issued.v1.ts`](../../apps/packages/contracts/src/events/customer/customer.password-reset.issued.v1.ts) |

| Field | Type | Required |
| --- | --- | --- |
| `customerId` | UUID v4 | yes |
| `email` | email | yes |
| `expiresAt` | ISO-8601 UTC | yes |
| `resetToken` | string, 16–512 | yes |

**Preconditions.** The address belongs to an account.

**Effects.** Notification & Audit sends the email carrying the link. This is the sibling of `customer.activation.requested.v1` and carries the clear token for the same reason: Customer Service stores only a digest, so this is the one message where the usable value travels. The redaction drops it before the audit insert. The link expires sooner than an activation link — one hour by default — because this one changes a credential.

**On error.** Retry, then dead-letter. No password has changed; the customer may ask again.

### `customer.password-reset.confirm.v1`

| | |
| --- | --- |
| **Category** | command |
| **Producer** | gateway |
| **Consumers** | customer-service |
| **Exchange** | `bank.commands` |
| **Routing key** | `customer.password-reset.confirm.v1` |
| **Contract** | [`customer.password-reset.confirm.v1.ts`](../../apps/packages/contracts/src/events/customer/customer.password-reset.confirm.v1.ts) |

| Field | Type | Required |
| --- | --- | --- |
| `resetToken` | string, 16–512 | yes |
| `credential` | string, 8–256 | yes |

**Preconditions.** The link was opened and the token is unexpired and unused.

**Effects.** The token is looked up **by digest**, exactly as an activation token is, so a dump of the table hands nobody a usable link. The credential is hashed with the same scrypt parameters registration uses and the clear value is never stored. Its bounds are the ones `customer.register.v1` puts on a credential: a password chosen here and one chosen at sign-up must be equally acceptable, or the reset becomes a way to set a password the sign-up would have refused.

**On error.** `RESET_TOKEN_EXPIRED` or `RESET_TOKEN_INVALID`, published as `customer.password-reset.rejected.v1`. Nothing changes.

### `customer.password-reset.completed.v1`

| | |
| --- | --- |
| **Category** | event |
| **Producer** | customer-service |
| **Consumers** | notification-audit-service |
| **Exchange** | `bank.events` |
| **Routing key** | `customer.password-reset.completed.v1` |
| **Contract** | [`customer.password-reset.completed.v1.ts`](../../apps/packages/contracts/src/events/customer/customer.password-reset.completed.v1.ts) |

| Field | Type | Required |
| --- | --- | --- |
| `customerId` | UUID v4 | yes |
| `changedAt` | ISO-8601 UTC | yes |

**Preconditions.** The password was changed and every reset link for that account is now dead.

**Effects.** Audited, and the customer is told their password changed — a message that matters precisely when the person reading it did not ask for the change. The Gateway also **observes** it to answer whoever is holding the HTTP connection open, the way it correlates `customer.email.verified.v1`; overhearing an event on a topic exchange takes nothing from its declared consumer. No credential and no token appear here: the event says that it happened, not what was chosen.

**On error.** Retry, then dead-letter. The password already changed.

### `customer.password-reset.rejected.v1`

| | |
| --- | --- |
| **Category** | event |
| **Producer** | customer-service |
| **Consumers** | notification-audit-service |
| **Exchange** | `bank.events` |
| **Routing key** | `customer.password-reset.rejected.v1` |
| **Contract** | [`customer.password-reset.rejected.v1.ts`](../../apps/packages/contracts/src/events/customer/customer.password-reset.rejected.v1.ts) |

| Field | Type | Required |
| --- | --- | --- |
| `reason` | `RESET_TOKEN_EXPIRED` \| `RESET_TOKEN_INVALID` | yes |
| `occurredAt` | ISO-8601 UTC | yes |

**Preconditions.** A reset token was presented and refused.

**Effects.** Audited. Expired and invalid are separate codes for the reason `customer.email.verification.rejected.v1` separates them — the trail has to tell a link that timed out from one that was never issued. What the person is told collapses both into one sentence, which the Gateway does, because distinguishing them in a browser would confirm that a link was once issued for an address. Carries no `customerId`: naming one would say the token belonged to somebody.

**On error.** Retry, then dead-letter.


---

## Change a password from inside a session

### `customer.change-password.v1`

| | |
| --- | --- |
| **Category** | command |
| **Producer** | gateway |
| **Consumers** | customer-service |
| **Exchange** | `bank.commands` |
| **Routing key** | `customer.change-password.v1` |
| **Contract** | [`customer.change-password.v1.ts`](../../apps/packages/contracts/src/events/customer/customer.change-password.v1.ts) |

| Field | Type | Required |
| --- | --- | --- |
| `customerId` | UUID v4 | yes |
| `currentCredential` | string, 1–256 | yes |
| `newCredential` | string, 8–256 | yes |

**Preconditions.** The customer exists. The sibling of `customer.password-reset.confirm.v1`, and the difference is the credential that authorises it: a reset is authorised by a token emailed to an address, this by **knowing the current password**. A session alone is not enough — a borrowed unlocked laptop is the case this defends against, and it is the common one.

**Effects.** `currentCredential` is verified by the owning service before anything changes, then the new one is hashed. `customerId` is the subject; whether the envelope's actor may change *this* subject's password is Customer Service's decision, not the Gateway's, which has no customer table and could not answer it.

**On error.** `INVALID_CREDENTIALS` or `FORBIDDEN_ACCOUNT_ACCESS`, published as `customer.password-change.rejected.v1`. Neither credential is ever logged.

### `customer.password-changed.v1`

| | |
| --- | --- |
| **Category** | event |
| **Producer** | customer-service |
| **Consumers** | notification-audit-service |
| **Exchange** | `bank.events` |
| **Routing key** | `customer.password-changed.v1` |
| **Contract** | [`customer.password-changed.v1.ts`](../../apps/packages/contracts/src/events/customer/customer.password-changed.v1.ts) |

| Field | Type | Required |
| --- | --- | --- |
| `customerId` | UUID v4 | yes |
| `changedAt` | ISO-8601 UTC | yes |

**Preconditions.** A signed-in customer changed their own password.

**Effects.** Audited, and observed by the Gateway to answer the caller. Deliberately **separate from `customer.password-reset.completed.v1`** even though both end with a new credential stored: they answer different questions in the trail — "somebody who could not sign in proved control of the inbox" against "somebody already signed in knew the old password" — and an investigation into a compromised account cares a great deal which happened.

**On error.** Retry, then dead-letter.

### `customer.password-change.rejected.v1`

| | |
| --- | --- |
| **Category** | event |
| **Producer** | customer-service |
| **Consumers** | notification-audit-service |
| **Exchange** | `bank.events` |
| **Routing key** | `customer.password-change.rejected.v1` |
| **Contract** | [`customer.password-change.rejected.v1.ts`](../../apps/packages/contracts/src/events/customer/customer.password-change.rejected.v1.ts) |

| Field | Type | Required |
| --- | --- | --- |
| `customerId` | UUID v4 | yes |
| `reason` | `INVALID_CREDENTIALS` \| `FORBIDDEN_ACCOUNT_ACCESS` | yes |
| `occurredAt` | ISO-8601 UTC | yes |

**Preconditions.** The password was not changed.

**Effects.** Audited. Unlike the reset family these two reasons are safe to tell apart in a browser: nobody reaches this without a session, so neither answer reveals whether an account exists. `customerId` is the **subject** that was asked about, so the trail can answer "who was targeted" — which is the interesting question when `FORBIDDEN_ACCOUNT_ACCESS` appears more than once.

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

## Read a customer's record

### `customer.get.query.v1`

| | |
| --- | --- |
| **Category** | command |
| **Producer** | gateway |
| **Consumers** | customer-service |
| **Exchange** | `bank.commands` |
| **Routing key** | `customer.get.query.v1` |
| **Contract** | [`customer.get.query.v1.ts`](../../apps/packages/contracts/src/events/customer/customer.get.query.v1.ts) |

| Field | Type | Required |
| --- | --- | --- |
| `customerId` | UUID v4 | yes |

**Preconditions.** None. Customer Service's first read path.

**Effects.** Nothing changes. Who may see whom is the owning service's decision, made from the envelope identity: a `CLIENTE` may read only their own record, staff may read anyone.

**On error.** A record the caller may not see is answered `NOT_FOUND`, never "forbidden", so the query cannot be turned into a way to discover which customer ids exist.

### `customer.get.replied.v1`

| | |
| --- | --- |
| **Category** | reply |
| **Producer** | customer-service |
| **Consumers** | gateway |
| **Exchange** | `bank.replies` |
| **Routing key** | `customer.get.replied.v1` |
| **Contract** | [`customer.get.replied.v1.ts`](../../apps/packages/contracts/src/events/customer/customer.get.replied.v1.ts) |

**When outcome = `FOUND`**

| Field | Type | Required |
| --- | --- | --- |
| `outcome` | `FOUND` | yes |
| `customerId` | UUID v4 | yes |
| `fullName` | string | yes |
| `identityDocument` | string | yes |
| `email` | email | yes |
| `dateOfBirth` | ISO-8601 date | yes |
| `address` | string | yes |
| `username` | string | yes |
| `role` | `CLIENTE` \| `CAJERO_RECEPTOR` \| `ADMINISTRADOR` | yes |
| `status` | `PENDING_ACTIVATION` \| `ACTIVE` | yes |
| `identityStatus` | `PENDING` \| `VALIDATED` \| `REJECTED` | yes |

**When outcome = `NOT_FOUND`**

| Field | Type | Required |
| --- | --- | --- |
| `outcome` | `NOT_FOUND` | yes |
| `reason` | `CUSTOMER_NOT_FOUND` | yes |

**Preconditions.** A `customer.get.query.v1` was handled.

**Effects.** The Gateway answers the caller. The personal fields here are not the leak the redaction rules guard against: a reply goes only to the gateway and is never published to the audit exchanges. The credential and the activation token are **not** here and never leave the service.

**On error.** An unauthorised id and an unknown one are both `NOT_FOUND`, indistinguishable on purpose.

### `customer.names.query.v1`

| | |
| --- | --- |
| **Category** | command |
| **Producer** | gateway |
| **Consumers** | customer-service |
| **Exchange** | `bank.commands` |
| **Routing key** | `customer.names.query.v1` |
| **Contract** | [`customer.names.query.v1.ts`](../../apps/packages/contracts/src/events/customer/customer.names.query.v1.ts) |

| Field | Type | Required |
| --- | --- | --- |
| `customerIds` | array of UUID v4, 1–100 | yes |

**Preconditions.** None. This is what closes TD-026: the account tables show a `customerId` where the prototype shows the holder's name, and Account Service holds only the opaque reference — resolving it there would mean reading Customer Service's database, which §8.2 (2.3) forbids outright.

**Effects.** Nothing changes. **A batch rather than one query per row:** a listing of forty accounts would otherwise be forty request/reply round trips, each with a five-second ceiling, to build one table; one question with forty ids is two round trips in total. The Gateway composes the two replies, which is aggregation and not computation.

**On error.** On timeout the Gateway stops waiting. Nothing was changed.

### `customer.names.replied.v1`

| | |
| --- | --- |
| **Category** | reply |
| **Producer** | customer-service |
| **Consumers** | gateway |
| **Exchange** | `bank.replies` |
| **Routing key** | `customer.names.replied.v1` |
| **Contract** | [`customer.names.replied.v1.ts`](../../apps/packages/contracts/src/events/customer/customer.names.replied.v1.ts) |

| Field | Type | Required |
| --- | --- | --- |
| `names` | array of object | yes |
| `names[].customerId` | UUID v4 | yes |
| `names[].fullName` | string | yes |

**Preconditions.** A `customer.names.query.v1` was handled.

**Effects.** The Gateway joins the pairs onto the rows it already has. It carries **only the name**: a screen that needs the document, the address or the email asks `customer.get.query.v1` for one customer, where the authorisation is per-record.

**On error.** **Staff only, and an id nobody may see simply does not come back** — no `NOT_FOUND` entry, no count of what was withheld. An absent id is therefore ambiguous between "no such customer" and "not yours", the same refusal `customer.get.replied.v1` makes. A `CLIENTE` asking gets an empty list, whatever they asked about.

### `customer.list.query.v1`

| | |
| --- | --- |
| **Category** | command |
| **Producer** | gateway |
| **Consumers** | customer-service |
| **Exchange** | `bank.commands` |
| **Routing key** | `customer.list.query.v1` |
| **Contract** | [`customer.list.query.v1.ts`](../../apps/packages/contracts/src/events/customer/customer.list.query.v1.ts) |

| Field | Type | Required |
| --- | --- | --- |
| `limit` | integer, 1–100 (default 50) | no |

**Preconditions.** None. Restricted to staff (`CAJERO_RECEPTOR`, `ADMINISTRADOR`).

**Effects.** Customer Service returns the summary listing of registered users across all roles, ordered newest first.

**On error.** A non-staff caller receives an empty list.

### `customer.list.replied.v1`

| | |
| --- | --- |
| **Category** | reply |
| **Producer** | customer-service |
| **Consumers** | gateway |
| **Exchange** | `bank.replies` |
| **Routing key** | `customer.list.replied.v1` |
| **Contract** | [`customer.list.replied.v1.ts`](../../apps/packages/contracts/src/events/customer/customer.list.replied.v1.ts) |

| Field | Type | Required |
| --- | --- | --- |
| `customers` | array of object | yes |
| `customers[].customerId` | UUID v4 | yes |
| `customers[].fullName` | string | yes |
| `customers[].email` | string | yes |
| `customers[].username` | string | yes |
| `customers[].documentNumber` | string | yes |
| `customers[].identityStatus` | string | yes |
| `customers[].role` | string | yes |
| `customers[].status` | string | yes |
| `customers[].registeredAt` | ISO-8601 UTC | yes |
| `omitted` | integer ≥ 0 | yes |

**Preconditions.** A `customer.list.query.v1` was handled.

**Effects.** The Gateway answers the staff caller.

**On error.** On timeout the Gateway stops waiting. Nothing was changed.


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


### `customer.pending-validation.query.v1`

| | |
| --- | --- |
| **Category** | command |
| **Producer** | gateway |
| **Consumers** | customer-service |
| **Exchange** | `bank.commands` |
| **Routing key** | `customer.pending-validation.query.v1` |
| **Contract** | [`customer.pending-validation.query.v1.ts`](../../apps/packages/contracts/src/events/customer/customer.pending-validation.query.v1.ts) |

The payload is an empty object. There is nothing to narrow: the question is the whole queue.

**Preconditions.** None.

**Effects.** Nothing changes. The reply lists everyone with `identityStatus = PENDING`, so a `CAJERO_RECEPTOR` has a queue to work through. Who may ask is the owning service's decision, made from the envelope identity.

**On error.** A `CLIENTE` gets an empty list, which means the same thing whether nothing is pending or nothing is visible.

### `customer.pending-validation.replied.v1`

| | |
| --- | --- |
| **Category** | reply |
| **Producer** | customer-service |
| **Consumers** | gateway |
| **Exchange** | `bank.replies` |
| **Routing key** | `customer.pending-validation.replied.v1` |
| **Contract** | [`customer.pending-validation.replied.v1.ts`](../../apps/packages/contracts/src/events/customer/customer.pending-validation.replied.v1.ts) |

| Field | Type | Required |
| --- | --- | --- |
| `customers` | array of object | yes |
| `customers[].customerId` | UUID v4 | yes |
| `customers[].fullName` | string | yes |
| `customers[].email` | email | yes |
| `customers[].registeredAt` | ISO-8601 UTC | yes |
| `omitted` | integer ≥ 0 | yes |

**Preconditions.** A `customer.pending-validation.query.v1` was handled.

**Effects.** The Gateway answers the caller. A bounded list — `omitted` says how many more were left out — so one very large queue cannot produce a reply that blows the request/reply ceiling. The summary carries only what a teller needs to pick the next case; the full record and the document are read separately.

**On error.** On timeout the Gateway stops waiting. Nothing was changed.

### `customer.identity-document.query.v1`

| | |
| --- | --- |
| **Category** | command |
| **Producer** | gateway |
| **Consumers** | customer-service |
| **Exchange** | `bank.commands` |
| **Routing key** | `customer.identity-document.query.v1` |
| **Contract** | [`customer.identity-document.query.v1.ts`](../../apps/packages/contracts/src/events/customer/customer.identity-document.query.v1.ts) |

| Field | Type | Required |
| --- | --- | --- |
| `customerId` | UUID v4 | yes |

**Preconditions.** Staff only (`CAJERO_RECEPTOR`, `ADMINISTRADOR`).

**Effects.** Ask to view a customer's identity-document photo.

**On error.** An unauthorized caller or nonexistent customer yields `NOT_FOUND`, indistinguishable.

### `customer.identity-document.replied.v1`

| | |
| --- | --- |
| **Category** | reply |
| **Producer** | customer-service |
| **Consumers** | gateway |
| **Exchange** | `bank.replies` |
| **Routing key** | `customer.identity-document.replied.v1` |
| **Contract** | [`customer.identity-document.replied.v1.ts`](../../apps/packages/contracts/src/events/customer/customer.identity-document.replied.v1.ts) |

**When outcome = `FOUND`**

| Field | Type | Required |
| --- | --- | --- |
| `outcome` | `FOUND` | yes |
| `photo` | object (`PhotoReference`) | yes |

**When outcome = `NOT_FOUND`**

| Field | Type | Required |
| --- | --- | --- |
| `outcome` | `NOT_FOUND` | yes |
| `reason` | `CUSTOMER_NOT_FOUND` \| `IDENTITY_OBJECT_NOT_FOUND` | yes |

**Preconditions.** A `customer.identity-document.query.v1` was handled.

**Effects.** Carries a `PhotoReference` staged in MinIO, never raw image bytes over the broker.

### `customer.set-identity-verdict.v1`

| | |
| --- | --- |
| **Category** | command |
| **Producer** | gateway |
| **Consumers** | customer-service |
| **Exchange** | `bank.commands` |
| **Routing key** | `customer.set-identity-verdict.v1` |
| **Contract** | [`customer.set-identity-verdict.v1.ts`](../../apps/packages/contracts/src/events/customer/customer.set-identity-verdict.v1.ts) |

| Field | Type | Required |
| --- | --- | --- |
| `customerId` | UUID v4 | yes |
| `verdict` | `VALIDATED` \| `REJECTED` | yes |

**Preconditions.** The caller is staff. A `CAJERO_RECEPTOR` has reviewed the document photo the customer uploaded — a **human decision**, not the automatic digest/type/size check that runs when the photo is first submitted by `customer.validate-identity.v1`. Authorisation is the owning service's, made from the envelope identity; the Gateway also guards the route.

**Effects.** `identityStatus` becomes the verdict, and `customer.identity.validated.v1` or `customer.identity.rejected.v1` follows.

**On error.** `VALIDATED` is terminal — the domain refuses to re-open an already-validated identity — so a second approval is a no-op rather than a way to swap in a different accepted document.


---

## Register a KYC verdict (Fase 2, T-26)

Distinct from "Validate identity" above: that flow is Fase 1's review of the document photo.
This is the broader KYC compliance decision (§4.1, p. 4) that C-8 ties to initiating a
transaction — a `CLIENTE` with `kycStatus != VERIFIED` may not start one. Enforcing that inside
the transfer Saga is **T-31**'s job; this service only owns the state, the transitions and the
events T-31 will consume.

### `customer.set-kyc-status.v1`

| | |
| --- | --- |
| **Category** | command |
| **Producer** | gateway |
| **Consumers** | customer-service |
| **Exchange** | `bank.commands` |
| **Routing key** | `customer.set-kyc-status.v1` |
| **Contract** | [`customer.set-kyc-status.v1.ts`](../../apps/packages/contracts/src/events/customer/customer.set-kyc-status.v1.ts) |

| Field | Type | Required |
| --- | --- | --- |
| `customerId` | UUID v4 | yes |
| `status` | `VERIFIED` \| `REJECTED` | yes |

**Preconditions.** The caller is staff (`CAJERO_RECEPTOR` or `ADMINISTRADOR`) — checked here and not only at the Gateway, the same reason `customer.set-identity-verdict.v1` re-checks.

**Effects.** `kycStatus` becomes the verdict, and `customer.kyc.verified.v1` or `customer.kyc.rejected.v1` follows.

**On error.** `VERIFIED` is terminal — the domain refuses to re-open an already-verified customer — so a second approval is a no-op rather than a way to swap in a different verdict.

### `customer.kyc.verified.v1`

| | |
| --- | --- |
| **Category** | event |
| **Producer** | customer-service |
| **Consumers** | notification-audit-service |
| **Exchange** | `bank.events` |
| **Routing key** | `customer.kyc.verified.v1` |
| **Contract** | [`customer.kyc.verified.v1.ts`](../../apps/packages/contracts/src/events/customer/customer.kyc.verified.v1.ts) |

| Field | Type | Required |
| --- | --- | --- |
| `customerId` | UUID v4 | yes |
| `kycStatus` | `VERIFIED` | yes |
| `verifiedAt` | ISO-8601 timestamp | yes |

### `customer.kyc.rejected.v1`

| | |
| --- | --- |
| **Category** | event |
| **Producer** | customer-service |
| **Consumers** | notification-audit-service |
| **Exchange** | `bank.events` |
| **Routing key** | `customer.kyc.rejected.v1` |
| **Contract** | [`customer.kyc.rejected.v1.ts`](../../apps/packages/contracts/src/events/customer/customer.kyc.rejected.v1.ts) |

| Field | Type | Required |
| --- | --- | --- |
| `customerId` | UUID v4 | yes |
| `kycStatus` | `REJECTED` | yes |
| `rejectedAt` | ISO-8601 timestamp | yes |

`REJECTED → PENDING` remains legal, so this event may be followed by a later
`customer.kyc.verified.v1` for the same customer — unlike `VERIFIED`, this status is not
terminal.


---

## The AHORRO commission and minimum opening deposit (Fase 2, T-27)

`AHORRO` and `MONETARIA` each carry a rule now (`account-type-rules.ts`), applying at different
moments in the account's life: `AHORRO` requires a Q100.00 minimum deposit to **open** — see
"Open an account" below, `account.open.rejected.v1`'s new `MINIMUM_BALANCE_VIOLATION` reason —
and, once open, a Q3.00 commission on every debit for as long as the account exists. `MONETARIA`
has neither. The minimum is checked once, at opening; it is never a floor `debit` re-enforces
afterward, so an `AHORRO` account may be emptied to Q0.00 by ordinary transfers.

### `account.commission.charged.v1`

| | |
| --- | --- |
| **Category** | event |
| **Producer** | account-service |
| **Consumers** | notification-audit-service |
| **Exchange** | `bank.events` |
| **Routing key** | `account.commission.charged.v1` |
| **Contract** | [`account.commission.charged.v1.ts`](../../apps/packages/contracts/src/events/account/account.commission.charged.v1.ts) |

| Field | Type | Required |
| --- | --- | --- |
| `accountId` | UUID v4 | yes |
| `transactionId` | UUID v4 | yes |
| `amount` | Money | yes |
| `balanceAfter` | Money | yes |
| `chargedAt` | ISO-8601 timestamp | yes |

**Preconditions.** A `DEBIT` was just applied to an account whose type has a commission
configured (`AHORRO`, as of this ticket — `MONETARIA` has none). Never published for a type with
no commission, which is what makes the commission "opcional" a fact about whether this event
exists at all rather than a field that is sometimes zero.

**Effects.** None of its own — it narrates a fact `applyMovement` already committed in the same
database transaction as the debit, as a second `account_operations` row (`type = 'COMMISSION'`).

**On error.** There is none to have: this event is only ever published after the movement it
describes has already succeeded. A debit still fails on `INSUFFICIENT_FUNDS` when the balance
cannot cover the amount plus the commission together — see "Debit a source account" below — and
produces no commission and no `DEBIT` either.

**Why `amount` on `account.debited.v1` never grows by the commission.** Transaction Service
compares that field against the amount its own Saga asked to move (`account.debit.requested.v1`),
and a payload that silently grew by a fee it never asked about would break that equality. The
commission is a fact about Account Service's own account-type rule, not about the transfer, so it
travels as a separate statement.


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
| `initialDeposit` | Money | no |

**Preconditions.** The customer exists and has `role = CLIENTE` (C-6). `AHORRO` requires
`initialDeposit` to reach its type's minimum (T-27, Fase 2 §4.1 p. 6) — absent or below it, the
opening is refused. `initialDeposit` absent on `MONETARIA` opens at Q0.00, exactly as before T-27.

**Effects.** An account is opened `ACTIVE` with `initialDeposit` (or Q0.00, when absent) as its
balance, and the requested `accountType`.

**On error.** `ROLE_NOT_ELIGIBLE` when the customer is staff, `MINIMUM_BALANCE_VIOLATION` (T-27)
when an `AHORRO` opening's deposit does not reach the minimum. No account is created either way.

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

### `account.open.rejected.v1`

| | |
| --- | --- |
| **Category** | event |
| **Producer** | account-service |
| **Consumers** | notification-audit-service |
| **Exchange** | `bank.events` |
| **Routing key** | `account.open.rejected.v1` |
| **Contract** | [`account.open.rejected.v1.ts`](../../apps/packages/contracts/src/events/account/account.open.rejected.v1.ts) |

| Field | Type | Required |
| --- | --- | --- |
| `accountId` | UUID v4 | yes |
| `customerId` | UUID v4 | yes |
| `reason` | `ROLE_NOT_ELIGIBLE` \| `FORBIDDEN_ACCOUNT_ACCESS` \| `MINIMUM_BALANCE_VIOLATION` | yes |
| `rejectedAt` | ISO-8601 UTC | yes |

**Preconditions.** An `account.create.v1` was refused before any row was written.

**Effects.** No account exists. Audited, and the caller learns the reason through the audit trail.

**On error.** Retry, then dead-letter. The rejection is a fact; failing to record it does not un-reject the request.


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

## List accounts

### `account.list.query.v1`

| | |
| --- | --- |
| **Category** | command |
| **Producer** | gateway |
| **Consumers** | account-service |
| **Exchange** | `bank.commands` |
| **Routing key** | `account.list.query.v1` |
| **Contract** | [`account.list.query.v1.ts`](../../apps/packages/contracts/src/events/account/account.list.query.v1.ts) |

| Field | Type | Required |
| --- | --- | --- |
| `customerId` | UUID v4 | no |
| `status` | `ACTIVE` \| `INACTIVE` | no |
| `accountType` | `MONETARIA` \| `AHORRO` | no |

**Preconditions.** Somebody with a session asked which accounts they may see.

**Effects.** Nothing changes. Account Service intersects the filters with what D-06 allows the envelope's identity.

**On error.** On timeout the Gateway stops waiting. Nothing was changed, so there is nothing to reconcile.

### `account.list.replied.v1`

| | |
| --- | --- |
| **Category** | reply |
| **Producer** | account-service |
| **Consumers** | gateway |
| **Exchange** | `bank.replies` |
| **Routing key** | `account.list.replied.v1` |
| **Contract** | [`account.list.replied.v1.ts`](../../apps/packages/contracts/src/events/account/account.list.replied.v1.ts) |

| Field | Type | Required |
| --- | --- | --- |
| `accounts` | array of object | yes |

**Preconditions.** An `account.list.query.v1` was handled.

**Effects.** The Gateway answers the caller. An empty array means "nothing you may see", which is deliberately indistinguishable from "nothing exists".

**On error.** On timeout the Gateway stops waiting. Nothing was changed, so there is nothing to reconcile.


---

## Read the movements of an account

### `account.operations.query.v1`

| | |
| --- | --- |
| **Category** | command |
| **Producer** | gateway |
| **Consumers** | account-service |
| **Exchange** | `bank.commands` |
| **Routing key** | `account.operations.query.v1` |
| **Contract** | [`account.operations.query.v1.ts`](../../apps/packages/contracts/src/events/account/account.operations.query.v1.ts) |

| Field | Type | Required |
| --- | --- | --- |
| `accountId` | UUID v4 | yes |

**Preconditions.** Somebody asked for the movements of one account.

**Effects.** Nothing changes. Whether this identity may read this account is Account Service's decision.

**On error.** On timeout the Gateway stops waiting. Nothing was changed, so there is nothing to reconcile.

### `account.operations.replied.v1`

| | |
| --- | --- |
| **Category** | reply |
| **Producer** | account-service |
| **Consumers** | gateway |
| **Exchange** | `bank.replies` |
| **Routing key** | `account.operations.replied.v1` |
| **Contract** | [`account.operations.replied.v1.ts`](../../apps/packages/contracts/src/events/account/account.operations.replied.v1.ts) |

**When outcome = `FOUND`**

| Field | Type | Required |
| --- | --- | --- |
| `outcome` | `FOUND` | yes |
| `accountId` | UUID v4 | yes |
| `operations` | array of object | yes |

**When outcome = `NOT_FOUND`**

| Field | Type | Required |
| --- | --- | --- |
| `outcome` | `NOT_FOUND` | yes |
| `reason` | `ACCOUNT_NOT_FOUND` | yes |

**Preconditions.** An `account.operations.query.v1` was handled.

**Effects.** The Gateway answers the caller. `balanceAfter` is what the ledger recorded at the time, never recomputed by the reader.

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
| `reason` | string, ≤ 300 \| null | yes |

**Preconditions.** An account went inactive, either by the automatic sweep or by an administrator.

**Effects.** Audited, and the customer is notified. The automatic process is idempotent: an already inactive account does not transition again nor emit a second event (A-5). `reason` is why an administrator did it — required on the command and carried here so the trail keeps it — and `null` for the automatic sweep, which has no human reason: its cause *is* the inactivity rule.

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

## Deposit at a window

### `account.deposit.v1`

| | |
| --- | --- |
| **Category** | command |
| **Producer** | gateway |
| **Consumers** | account-service |
| **Exchange** | `bank.commands` |
| **Routing key** | `account.deposit.v1` |
| **Contract** | [`account.deposit.v1.ts`](../../apps/packages/contracts/src/events/account/account.deposit.v1.ts) |

| Field | Type | Required |
| --- | --- | --- |
| `depositId` | UUID v4 | yes |
| `accountId` | UUID v4 | yes |
| `amount` | object | yes |
| `description` | string, 1–140 | no |

**Preconditions.** The caller is staff. The account exists.

**Effects.** The account is credited. This is the one movement in the system with **no counterparty**: a transfer moves money between two accounts and needs a Saga to keep both sides consistent, but a deposit adds money that arrived from outside the bank, so there is nothing to debit, nothing to compensate, and no second service that has to agree. Routing it through Transaction Service would mean a transfer with a null source account and a state machine with a path that never fails — which is how an orchestrator becomes the "god object" §4.1 penalises. `depositId` is minted by the Gateway so the receipt a teller is handed names something that exists even when the command is redelivered.

**On error.** `ACCOUNT_NOT_FOUND`, `INVALID_AMOUNT_PRECISION` or `FORBIDDEN_ACCOUNT_ACCESS`, published as `account.deposit.rejected.v1`. `description` is free text the trail does not redact — it redacts by field name and this field is not on that list — so it is **never a place for a name or a document number**, and the interface says so.

### `account.deposited.v1`

| | |
| --- | --- |
| **Category** | event |
| **Producer** | account-service |
| **Consumers** | notification-audit-service |
| **Exchange** | `bank.events` |
| **Routing key** | `account.deposited.v1` |
| **Contract** | [`account.deposited.v1.ts`](../../apps/packages/contracts/src/events/account/account.deposited.v1.ts) |

| Field | Type | Required |
| --- | --- | --- |
| `depositId` | UUID v4 | yes |
| `accountId` | UUID v4 | yes |
| `operationId` | UUID v4 | yes |
| `amount` | object | yes |
| `balanceAfter` | object | yes |
| `reactivated` | boolean | yes |
| `occurredAt` | ISO-8601 UTC | yes |

**Preconditions.** The money is in the account.

**Effects.** Audited, and observed by the Gateway to answer the person standing at the window — a teller is in front of somebody who just handed over cash, and "202, check the audit trail" is not an answer either of them can act on. `balanceAfter` travels because the receipt shows it, and recomputing it anywhere else would be a second opinion about a number the ledger already settled. A deposit into an idle account wakes it up, like any other credit (A-3), which `reactivated` records.

**On error.** Retry, then dead-letter. The money is already in the account.

### `account.deposit.rejected.v1`

| | |
| --- | --- |
| **Category** | event |
| **Producer** | account-service |
| **Consumers** | notification-audit-service |
| **Exchange** | `bank.events` |
| **Routing key** | `account.deposit.rejected.v1` |
| **Contract** | [`account.deposit.rejected.v1.ts`](../../apps/packages/contracts/src/events/account/account.deposit.rejected.v1.ts) |

| Field | Type | Required |
| --- | --- | --- |
| `depositId` | UUID v4 | yes |
| `reason` | `ACCOUNT_NOT_FOUND` \| `INVALID_AMOUNT_PRECISION` \| `FORBIDDEN_ACCOUNT_ACCESS` | yes |
| `occurredAt` | ISO-8601 UTC | yes |

**Preconditions.** The deposit did not happen.

**Effects.** Audited, and observed by the Gateway so the teller is told. Three reasons and no more. There is deliberately **no `ACCOUNT_INACTIVE`**: a deposit into a dormant account is the one thing that should still work, and it reactivates it (A-3). Refusing it would mean telling somebody that the money they are holding cannot go into their own account until they first put money into it.

**On error.** Retry, then dead-letter. Nothing moved.


---

## The biller catalogue

### `account.billers.query.v1`

| | |
| --- | --- |
| **Category** | command |
| **Producer** | gateway |
| **Consumers** | account-service |
| **Exchange** | `bank.commands` |
| **Routing key** | `account.billers.query.v1` |
| **Contract** | [`account.billers.query.v1.ts`](../../apps/packages/contracts/src/events/account/account.billers.query.v1.ts) |

The payload is an empty object.

**Preconditions.** None.

**Effects.** Nothing changes. A question with no arguments, which is unusual enough to say out loud: the catalogue is the same for everybody, it is not scoped by identity, and there is nothing to narrow. It is asked rather than hard-coded in the frontend because the biller's **collection account id** is what a payment is actually sent to, and an account id compiled into a browser bundle is an account id that is wrong the first time anything is reseeded.

**On error.** On timeout the Gateway stops waiting. Nothing was changed.

### `account.billers.replied.v1`

| | |
| --- | --- |
| **Category** | reply |
| **Producer** | account-service |
| **Consumers** | gateway |
| **Exchange** | `bank.replies` |
| **Routing key** | `account.billers.replied.v1` |
| **Contract** | [`account.billers.replied.v1.ts`](../../apps/packages/contracts/src/events/account/account.billers.replied.v1.ts) |

| Field | Type | Required |
| --- | --- | --- |
| `billers` | array of object | yes |
| `billers[].code` | string, 1–20 | yes |
| `billers[].name` | string, 1–60 | yes |
| `billers[].accountId` | UUID v4 | yes |

**Preconditions.** An `account.billers.query.v1` was handled.

**Effects.** The Gateway answers the caller. Each entry carries the biller's **collection account**, because that is what a service payment is a transfer to. No balance travels: what a biller has collected is none of a paying customer's business, and this reply is read by the screen that lets anyone pay one.

**On error.** On timeout the Gateway stops waiting. Nothing was changed.


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
| `paymentScenario` | `APPROVE` \| `REJECT` \| `TRANSIENT_FAILURE` \| `TIMEOUT` | no |
| `reference` | string, 1–60 | no |

**Preconditions.** Both accounts exist, the source is `ACTIVE` and has funds. Only the first two are checkable here; the rest belongs to Account Service.

**Effects.** Step 1 of the Saga. A `Transaction` is created `PENDING` and moves to `DEBITING`; `account.debit.requested.v1` follows.

`reference` is what the payment is *for* when the target is a biller's collection account — a contract number, a meter number, a phone line. It is the whole difference between a transfer and a **service payment**, which is a transfer to an account the biller holds at this bank rather than a second kind of money movement with its own state machine. Free text on purpose: a contract number's shape is the biller's business, not this bank's, and a format rule here would refuse a valid one the day a biller changed theirs. Added optionally for the prototype's `G-01`, the same additive shape T-15 used for `paymentScenario`, so the version did not move and no consumer broke.

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

**Preconditions.** The debit did not happen. `INSUFFICIENT_FUNDS` (T-27) is checked against the
amount *and* the account type's commission together, when the account's type charges one — a
balance that covers the amount alone but not the amount plus the commission is still refused.

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
| `scenario` | `APPROVE` \| `REJECT` \| `TRANSIENT_FAILURE` \| `TIMEOUT` | no |

**Preconditions.** The debit succeeded and the transaction is in `PAYMENT_PENDING`.

**Effects.** Step 4. Payment Service processes the payment, retrying internally and counting `attempt`. It reacts to this command and **not** to `account.debited.v1` directly — that is what `../domain/use-cases.md` §6 fixed.

**On error.** `payment.failed.v1` once its own retries are spent.

### `payment.attempt.failed.v1`

| | |
| --- | --- |
| **Category** | event |
| **Producer** | payment-service |
| **Consumers** | transaction-service, notification-audit-service |
| **Exchange** | `bank.events` |
| **Routing key** | `payment.attempt.failed.v1` |
| **Contract** | [`payment.attempt.failed.v1.ts`](../../apps/packages/contracts/src/events/payment/payment.attempt.failed.v1.ts) |

| Field | Type | Required |
| --- | --- | --- |
| `paymentId` | UUID v4 | yes |
| `transactionId` | UUID v4 | yes |
| `attempt` | integer ≥ 1 | yes |
| `errorType` | `TRANSIENT` \| `PERMANENT` | yes |
| `providerResult` | `FAILURE` \| `TIMEOUT` | yes |
| `willRetry` | boolean | yes |
| `nextAttemptAt` | ISO-8601 UTC \| null | yes |
| `failureReason` | `PAYMENT_DECLINED` \| `PAYMENT_RETRIES_EXHAUSTED` \| null | yes |
| `failedAt` | ISO-8601 UTC | yes |

**Preconditions.** One attempt at the payment failed. Whether that ends the payment is `willRetry`.

**Effects.** This is the message that makes the **middle of the retry ladder observable**. Before it, the catalogue described a payment as a thing that succeeds or fails once, at the end, so a ladder of three retries at 1s, 5s and 30s was invisible to everyone but Payment Service's own logs — a screen could report that a payment had taken four attempts only after it had stopped taking them. It is emitted once per failed attempt, **including the last**, so the count a consumer holds never skips a rung.

**It does not close the Saga.** `payment.failed.v1` is still the only event that means "the payment is over", and it still arrives afterwards when the retries are spent. Transaction Service records the attempt and the error kind onto the transaction it already owns and changes no state: `PAYMENT_PENDING` stays `PAYMENT_PENDING`. A consumer that treated this as terminal would compensate a payment about to succeed on its second attempt.

`willRetry` is a field rather than something a consumer derives. A reader could compare `attempt` against the ladder's length and guess, but the decision belongs to the retry policy in Payment Service's domain, and a consumer that re-derives it is a second implementation of that policy waiting to disagree with the first — a `PERMANENT` error stops at attempt 1 no matter what the ladder allows. `nextAttemptAt` is `null` exactly when `willRetry` is `false`.

`providerResult` (T-29) is what the simulated provider itself answered — `FAILURE` or `TIMEOUT`, never `SUCCESS`, since a successful attempt does not publish this event. `errorType` alone cannot distinguish the two: a `TRANSIENT_FAILURE` scenario and a `TIMEOUT` scenario both produce `errorType: 'TRANSIENT'` and climb the same ladder, so `providerResult` is the only field that tells a reader which one actually happened.

`failureReason` is nullable because a transient failure — a timeout, a socket the provider closed — has no place in the closed failure-code enum, and inventing one would put transport noise into the vocabulary services use to decide whether to compensate.

**On error.** Retry, then dead-letter. The payment carries on regardless: this event reports the ladder, it does not drive it.

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
| `customerId` | UUID v4 \| `null` | yes |
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
| `customerId` | UUID v4 \| `null` | yes |
| `status` | `FAILED` | yes |
| `reason` | `INSUFFICIENT_FUNDS` \| `ACCOUNT_INACTIVE` \| `ACCOUNT_NOT_FOUND` \| `INVALID_AMOUNT` \| `INVALID_AMOUNT_PRECISION` \| `SAME_ACCOUNT_TRANSFER` \| `IDEMPOTENCY_KEY_CONFLICT` \| `MINIMUM_BALANCE_VIOLATION` | yes |
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
| `customerId` | UUID v4 \| `null` | yes |
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
| `reason` | the full `failureCode` enum (`../../apps/packages/contracts/src/schemas/primitives.ts`), unrestricted \| null | yes |
| `createdAt` | ISO-8601 UTC | yes |
| `updatedAt` | ISO-8601 UTC | yes |
| `originCorrelationId` | UUID v4 | no |
| `payment` | object | no |
| `payment.paymentId` | UUID v4 | yes |
| `payment.status` | `PENDING` \| `SUCCEEDED` \| `FAILED` | yes |
| `payment.attempt` | integer ≥ 1 \| null | yes |
| `payment.reason` | `PAYMENT_DECLINED` \| `PAYMENT_RETRIES_EXHAUSTED` \| null | yes |
| `payment.errorType` | `TRANSIENT` \| `PERMANENT` \| null | no |
| `payment.decidedAt` | ISO-8601 UTC \| null | yes |
| `phaseStatus` | `PENDING` \| `APPROVED` \| `FAILED` | no |
| `transitions` | array of object | no |
| `transitions[].from` | the six-state enum \| null | yes |
| `transitions[].to` | the six-state enum | yes |
| `transitions[].event` | string, ≤ 120 chars | yes |
| `transitions[].reason` | failure code \| null | yes |
| `transitions[].occurredAt` | ISO-8601 UTC | yes |

**When outcome = `NOT_FOUND`**

| Field | Type | Required |
| --- | --- | --- |
| `outcome` | `NOT_FOUND` | yes |

**Preconditions.** A `transaction.status.requested.v1` was handled.

**Effects.** The Gateway answers the client. `reason` is present exactly when the transfer did not complete, and always from the closed failure set — this is the most likely thing a customer sees after a timeout, so it is the last place that should leak an internal detail.

The `payment` block is a **copy of what `payment.succeeded.v1` or `payment.failed.v1` said, not a second opinion**: Transaction Service processes no payments and reads no other service's database, so it repeats the event it received. `payment.status = PENDING` means the payment was ordered and nothing has come back yet, which is a different statement from "there is no payment" and a screen has to tell them apart. `payment.errorType` is not derivable from `payment.reason` — the two look related, but that mapping is Payment Service's policy rather than a law, and it says something while the payment is still `PENDING`, where `reason` is `null` and the kind of the last failed attempt is the only signal that a retry is under way. For the per-attempt evidence, ask `payment.status.query.v1`, which is the owner answering about its own row.

`phaseStatus` and `transitions` were added by **T-28** as additive-optional fields — a reply that omits either validates exactly as before, so this contract stays at `v1`. `phaseStatus` is Fase 2's three-state vocabulary (`PENDING` \| `APPROVED` \| `FAILED`), computed from `status` by `phaseStatusOf` in the domain and never stored: `PENDING`/`DEBITING`/`PAYMENT_PENDING` read as `PENDING`, `COMPLETED` as `APPROVED`, `FAILED`/`COMPENSATED` as `FAILED`. `transitions` is the real history, oldest first — one row per legal state change `applyEvent` actually applied (self-transitions on `PAYMENT_PENDING` included, since those are the ones that order the payment, the credit and the compensation), plus the opening row `start()` writes with `from: null`. `undefined` on a reply from before this field existed and `[]` on a transfer this service's migration `008_transaction_transitions` predates read the same to a caller: no trace to show.

**On error.** On timeout the Gateway stops waiting; the caller may ask again.


---

## List transfers

### `transaction.list.query.v1`

| | |
| --- | --- |
| **Category** | command |
| **Producer** | gateway |
| **Consumers** | transaction-service |
| **Exchange** | `bank.commands` |
| **Routing key** | `transaction.list.query.v1` |
| **Contract** | [`transaction.list.query.v1.ts`](../../apps/packages/contracts/src/events/transaction/transaction.list.query.v1.ts) |

| Field | Type | Required |
| --- | --- | --- |
| `customerId` | UUID v4 | no |
| `accountId` | UUID v4 | no |
| `status` | `PENDING` \| `DEBITING` \| `PAYMENT_PENDING` \| `COMPLETED` \| `FAILED` \| `COMPENSATED` | no |
| `phaseStatus` | `PENDING` \| `APPROVED` \| `FAILED` | no |
| `from` | ISO-8601 UTC | no |
| `to` | ISO-8601 UTC | no |
| `limit` | integer, 1–100 | no |

**Preconditions.** None. This closes TD-033: `transaction.status.requested.v1` has answered "how did this one end" since T-18, and nothing answered "which transfers are mine". `phaseStatus`, `from` and `to` were added by **T-28**, additive-optional, so the contract stays at `v1`.

**Effects.** Nothing changes. **Every filter is a request, not a permission.** Who may see which transfers is Transaction Service's decision, made from the envelope identity against the `customer_id` it records at request time. `accountId` narrows to transfers that touched one account on either side. `phaseStatus` is a **separate field from `status`**, not a widened version of it — naming both narrows to their overlap, which is empty rather than one filter silently overriding the other. `from`/`to` are both inclusive and apply to `createdAt` — when the transfer was requested, not when it last moved.

**On error.** A `CLIENTE` naming somebody else's `customerId` gets an empty list rather than a `403`, for the reason the account listing does the same: a distinguishable refusal is a way to discover which customers exist. `to` earlier than `from` is refused by the contract's own `refine`, before Transaction Service acts on it; the Gateway catches the same case at the edge and answers `400` rather than forwarding a request the contract would reject.

### `transaction.list.replied.v1`

| | |
| --- | --- |
| **Category** | reply |
| **Producer** | transaction-service |
| **Consumers** | gateway |
| **Exchange** | `bank.replies` |
| **Routing key** | `transaction.list.replied.v1` |
| **Contract** | [`transaction.list.replied.v1.ts`](../../apps/packages/contracts/src/events/transaction/transaction.list.replied.v1.ts) |

| Field | Type | Required |
| --- | --- | --- |
| `transactions` | array of object | yes |
| `transactions[].transactionId` | UUID v4 | yes |
| `transactions[].sourceAccount` | UUID v4 | yes |
| `transactions[].targetAccount` | UUID v4 | yes |
| `transactions[].amount` | object | yes |
| `transactions[].status` | `PENDING` \| `DEBITING` \| `PAYMENT_PENDING` \| `COMPLETED` \| `FAILED` \| `COMPENSATED` | yes |
| `transactions[].phaseStatus` | `PENDING` \| `APPROVED` \| `FAILED` | no |
| `transactions[].reason` | failure code \| null | yes |
| `transactions[].createdAt` | ISO-8601 UTC | yes |
| `transactions[].completedAt` | ISO-8601 UTC \| null | yes |
| `total` | integer ≥ 0 | yes |

`phaseStatus` was added by **T-28**, additive-optional, so the contract stays at `v1` — see `transaction.status.replied.v1` above for what it means and how it is computed.

**Preconditions.** A `transaction.list.query.v1` was handled.

**Effects.** The Gateway answers the caller. A row is deliberately **thinner than `transaction.status.replied.v1`** — no payment outcome, no Saga trace — because a list is scanned, and a hundred rows each carrying a nested payment object is a large reply to render four columns from. The screen links to the single-transfer route for the rest, which is also where the ownership check is applied per row rather than per page. `total` is the full count **before** the limit, so a screen can say "showing 100 of 340" rather than implying 100 is all there is; it counts what the asker is entitled to see, not what exists.

**On error.** On timeout the Gateway stops waiting. Nothing was changed.


---

## Consult a payment

### `payment.status.query.v1`

| | |
| --- | --- |
| **Category** | command |
| **Producer** | gateway |
| **Consumers** | payment-service |
| **Exchange** | `bank.commands` |
| **Routing key** | `payment.status.query.v1` |
| **Contract** | [`payment.status.query.v1.ts`](../../apps/packages/contracts/src/events/payment/payment.status.query.v1.ts) |

| Field | Type | Required |
| --- | --- | --- |
| `paymentId` | UUID v4 | yes |

**Preconditions.** None. `paymentId` is an identifier the screen already has: it arrives on the transfer's status reply, so following the link from a transfer to its payment costs no lookup.

**Effects.** Nothing changes. This does **not** replace the payment half of `transaction.status.replied.v1`. That one is Transaction Service repeating an event it received; this is Payment Service answering about its own row, and it is the only source of the per-attempt evidence. Two questions, two owners, and the second is the one to ask when the first disagrees with itself.

**On error.** An unknown payment is answered `NOT_FOUND`, not dead-lettered.

### `payment.status.replied.v1`

| | |
| --- | --- |
| **Category** | reply |
| **Producer** | payment-service |
| **Consumers** | gateway |
| **Exchange** | `bank.replies` |
| **Routing key** | `payment.status.replied.v1` |
| **Contract** | [`payment.status.replied.v1.ts`](../../apps/packages/contracts/src/events/payment/payment.status.replied.v1.ts) |

**When outcome = `FOUND`**

| Field | Type | Required |
| --- | --- | --- |
| `outcome` | `FOUND` | yes |
| `payment` | object | yes |
| `payment.paymentId` | UUID v4 | yes |
| `payment.transactionId` | UUID v4 | yes |
| `payment.status` | `PENDING` \| `SUCCEEDED` \| `FAILED` | yes |
| `payment.amount` | object | yes |
| `payment.attempt` | integer ≥ 1 \| null | yes |
| `payment.errorType` | `TRANSIENT` \| `PERMANENT` \| null | yes |
| `payment.failureReason` | `PAYMENT_DECLINED` \| `PAYMENT_RETRIES_EXHAUSTED` \| null | yes |
| `payment.providerReference` | string, ≤ 100 \| null | yes |
| `payment.scenario` | `APPROVE` \| `REJECT` \| `TRANSIENT_FAILURE` \| `TIMEOUT` \| null | yes |
| `payment.originCorrelationId` | UUID v4 \| null | yes |
| `payment.createdAt` | ISO-8601 UTC | yes |
| `payment.updatedAt` | ISO-8601 UTC | yes |
| `payment.decidedAt` | ISO-8601 UTC \| null | yes |
| `attempts` | array of object | yes |
| `attempts[].attemptNumber` | integer ≥ 1 | yes |
| `attempts[].result` | `SUCCEEDED` \| `FAILED` | yes |
| `attempts[].errorType` | `TRANSIENT` \| `PERMANENT` \| null | yes |
| `attempts[].failureReason` | `PAYMENT_DECLINED` \| `PAYMENT_RETRIES_EXHAUSTED` \| null | yes |
| `attempts[].providerResult` | `SUCCESS` \| `FAILURE` \| `TIMEOUT` \| null | yes |
| `attempts[].occurredAt` | ISO-8601 UTC | yes |

**When outcome = `NOT_FOUND`**

| Field | Type | Required |
| --- | --- | --- |
| `outcome` | `NOT_FOUND` | yes |

**Preconditions.** A `payment.status.query.v1` was handled.

**Effects.** The Gateway answers the caller. `attempts` is the retry ladder **as evidence rather than as narrative**: "it was retried three times" is something anyone can check afterwards instead of something the service asserts. It is oldest rung first, and it is present even when it holds a single successful rung, because "approved on the first try" and "approved on the third" are different operational stories and a screen that could only show the second would make the first look like missing data. `providerReference` is opaque on purpose — a string to quote back to a provider, not a value any consumer may parse — and `scenario` is echoed so a screen can say *why* a payment was rejected on purpose instead of leaving a rehearsal looking like a real refusal. `attempts[].providerResult` (T-29) is what the simulated provider itself answered on that rung — `null` only for an attempt recorded before the field existed — and is the only value that tells a `TIMEOUT` rung apart from an ordinary `TRANSIENT_FAILURE` one, since both share the same `errorType` and the same ladder.

**On error.** `NOT_FOUND` carries no failure code. Every code in the catalogue is a reason something was *refused*, and a payment that does not exist was not refused — it is a question about nothing. The Gateway supplies the nearest catalogue code when it has to render an HTTP status, in one place rather than letting each service invent a vocabulary for absence.

### `payment.list.query.v1`

| | |
| --- | --- |
| **Category** | command |
| **Producer** | gateway |
| **Consumers** | payment-service |
| **Exchange** | `bank.commands` |
| **Routing key** | `payment.list.query.v1` |
| **Contract** | [`payment.list.query.v1.ts`](../../apps/packages/contracts/src/events/payment/payment.list.query.v1.ts) |

| Field | Type | Required |
| --- | --- | --- |
| `transactionId` | UUID v4 | no |
| `status` | `PENDING` \| `SUCCEEDED` \| `FAILED` | no |
| `errorType` | `TRANSIENT` \| `PERMANENT` | no |

**Preconditions.** The caller is staff. Every filter is a request, not a permission, exactly as in `account.list.query.v1`.

**Effects.** Nothing changes. Unlike accounts, Payment Service **cannot narrow this by customer**, and pretending otherwise would be worse than admitting it: a payment row holds a `transactionId` and nothing else that identifies a person, and resolving it to an owner means reading Transaction Service's or Account Service's tables, which §8.2 (2.3) forbids outright. That is why the Gateway restricts the route to staff instead of asking this service for a scope it has no way to compute — the same shape of gap as TD-035, refused in the same direction. `transactionId` is the only scope this service owns.

**On error.** On timeout the Gateway stops waiting. Nothing was changed.

### `payment.list.replied.v1`

| | |
| --- | --- |
| **Category** | reply |
| **Producer** | payment-service |
| **Consumers** | gateway |
| **Exchange** | `bank.replies` |
| **Routing key** | `payment.list.replied.v1` |
| **Contract** | [`payment.list.replied.v1.ts`](../../apps/packages/contracts/src/events/payment/payment.list.replied.v1.ts) |

| Field | Type | Required |
| --- | --- | --- |
| `payments` | array of object | yes |

Each entry has the same shape as `payment` on `payment.status.replied.v1`, sharing one definition so a monitoring table and a detail screen cannot come to disagree about what `attempt` counts — two screens that would eventually be used to contradict each other in an incident.

**Preconditions.** A `payment.list.query.v1` was handled.

**Effects.** The Gateway answers the caller. Most recently updated first, and the ordering is **part of the contract** rather than left to the caller, because this list is read during incidents and "the three that failed in the last hour" is the question being asked — a screen that had to sort a truncated page would show the wrong three.

**On error.** There is no `NOT_FOUND` outcome, for the reason `account.list.replied.v1` gives: an empty list is the whole answer, and it must mean the same thing whether nothing matched or nothing exists.


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
| `events[].processingStatus` | `PROCESSED` \| `INVALID` \| `ERROR` | no |
| `events[].payload` | object, redacted | no |
| `notifications` | array of object | yes |

**Preconditions.** An `audit.query.requested.v1` was handled.

**Effects.** The Gateway answers with the ordered events and the notifications of that flow. Returns **metadata and a redacted payload, never the payload as published**: echoing every payload back verbatim would recreate, in one reply, the data the per-service databases exist to keep apart.

The two optional fields were added by T-20 and are additive — a reply that omits them validates exactly as before (TD-039). `processingStatus` exists so that a message this service could not parse is visible rather than absent; `payload` exists because the interface has to show *something* of what happened, and the redaction is computed by the service that owns the record, never by the consumer. What survives redaction is decided in one place: `redactPayload` in the service's domain.

**On error.** On timeout the Gateway stops waiting.

### `audit.events.list.query.v1`

| | |
| --- | --- |
| **Category** | command |
| **Producer** | gateway |
| **Consumers** | notification-audit-service |
| **Exchange** | `bank.commands` |
| **Routing key** | `audit.events.list.query.v1` |
| **Contract** | [`audit.events.list.query.v1.ts`](../../apps/packages/contracts/src/events/audit/audit.events.list.query.v1.ts) |

| Field | Type | Required |
| --- | --- | --- |
| `limit` | integer, 1–100 (default 10) | no |
| `page` | integer ≥ 1 (default 1) | no |

**Preconditions.** Restricted to `ADMINISTRADOR`.

**Effects.** Paginated raw audit events query across all event families.

**On error.** On timeout the Gateway stops waiting.

### `audit.events.list.replied.v1`

| | |
| --- | --- |
| **Category** | reply |
| **Producer** | notification-audit-service |
| **Consumers** | gateway |
| **Exchange** | `bank.replies` |
| **Routing key** | `audit.events.list.replied.v1` |
| **Contract** | [`audit.events.list.replied.v1.ts`](../../apps/packages/contracts/src/events/audit/audit.events.list.replied.v1.ts) |

| Field | Type | Required |
| --- | --- | --- |
| `events` | array of object | yes |
| `events[].eventId` | UUID v4 | yes |
| `events[].messageType` | string | yes |
| `events[].producer` | string | yes |
| `events[].occurredAt` | ISO-8601 UTC | yes |
| `events[].correlationId` | UUID v4 | yes |
| `events[].processingStatus` | string | yes |
| `events[].consumer` | string | yes |
| `events[].payload` | object, redacted | yes |
| `total` | integer ≥ 0 | yes |
| `page` | integer ≥ 1 | yes |
| `limit` | integer ≥ 1 | yes |

**Preconditions.** An `audit.events.list.query.v1` was handled.

**Effects.** Returns the paginated list of audited events with redacted payloads.

## Consult the notifications console

### `notification.list.query.v1`

| | |
| --- | --- |
| **Category** | command |
| **Producer** | gateway |
| **Consumers** | notification-audit-service |
| **Exchange** | `bank.commands` |
| **Routing key** | `notification.list.query.v1` |
| **Contract** | [`notification.list.query.v1.ts`](../../apps/packages/contracts/src/events/notification/notification.list.query.v1.ts) |

| Field | Type | Required |
| --- | --- | --- |
| `correlationId` | UUID v4 | no |
| `status` | `PENDING` \| `SENT` \| `FAILED` | no |
| `type` | string, ≤ 50 | no |
| `limit` | integer, 1–200 | no |

**Preconditions.** None. Every filter is a request, not a permission.

**Effects.** The notifications this service sent are read, newest first. Restricted to `ADMINISTRADOR` at the Gateway, because a notification row carries a simulated recipient and this service cannot narrow the list to one customer without reading another service's tables (§8.2, 2.3) — the same shape of gap as TD-037.

**On error.** No rows is an empty list, not an error.

### `notification.list.replied.v1`

| | |
| --- | --- |
| **Category** | reply |
| **Producer** | notification-audit-service |
| **Consumers** | gateway |
| **Exchange** | `bank.replies` |
| **Routing key** | `notification.list.replied.v1` |
| **Contract** | [`notification.list.replied.v1.ts`](../../apps/packages/contracts/src/events/notification/notification.list.replied.v1.ts) |

| Field | Type | Required |
| --- | --- | --- |
| `notifications` | array of object | yes |
| `notifications[].notificationId` | UUID v4 | yes |
| `notifications[].type` | string, 1–50 | yes |
| `notifications[].channel` | `EMAIL` | yes |
| `notifications[].recipient` | string, 1–200 \| null | yes |
| `notifications[].referenceId` | UUID v4 \| null | yes |
| `notifications[].subject` | string, 1–200 | yes |
| `notifications[].status` | `PENDING` \| `SENT` \| `FAILED` | yes |
| `notifications[].correlationId` | UUID v4 | yes |
| `notifications[].createdAt` | ISO-8601 UTC | yes |
| `notifications[].processedAt` | ISO-8601 UTC \| null | yes |
| `omitted` | integer ≥ 0 | yes |

**Preconditions.** A `notification.list.query.v1` was handled.

**Effects.** The Gateway answers with the page, newest first, and with how many rows were left out, so a console can say "200 of 4,318" instead of implying it is showing everything. The ordering is part of the contract rather than left to the caller: this list is read while something is going wrong, and a screen that had to sort a truncated page would show the wrong rows.

`recipient` is a **simulated address** — no mail leaves this system (§4.1, notificaciones simuladas) — and it is here because a console that lists deliveries without saying who they were for cannot be used to investigate one. It must not travel on any reply a customer can read, which is why the customer's own inbox is a separate message with a separate shape rather than this one with a filter.

**On error.** On timeout the Gateway stops waiting.


---

## The customer's own inbox

### `notification.inbox.query.v1`

| | |
| --- | --- |
| **Category** | command |
| **Producer** | gateway |
| **Consumers** | notification-audit-service |
| **Exchange** | `bank.commands` |
| **Routing key** | `notification.inbox.query.v1` |
| **Contract** | [`notification.inbox.query.v1.ts`](../../apps/packages/contracts/src/events/notification/notification.inbox.query.v1.ts) |

| Field | Type | Required |
| --- | --- | --- |
| `limit` | integer, 1–100 | no |

**Preconditions.** None. This closes TD-041.

**Effects.** Nothing changes. Deliberately different from `notification.list.query.v1`, which is the staff console and answers "what has the bank been sending"; this answers "what has the bank told me". The difference is not the filter: the console carries the simulated recipient of every delivery in the system and is restricted to `ADMINISTRADOR` for exactly that reason, so making one query serve both would mean one reply shape carrying a field a customer must never see.

**On error.** **There is no `customerId` field.** The scope is the envelope's identity and nothing else, so the query cannot be pointed at somebody else's inbox by asking — which is the failure mode a filter would have introduced.

### `notification.inbox.replied.v1`

| | |
| --- | --- |
| **Category** | reply |
| **Producer** | notification-audit-service |
| **Consumers** | gateway |
| **Exchange** | `bank.replies` |
| **Routing key** | `notification.inbox.replied.v1` |
| **Contract** | [`notification.inbox.replied.v1.ts`](../../apps/packages/contracts/src/events/notification/notification.inbox.replied.v1.ts) |

| Field | Type | Required |
| --- | --- | --- |
| `notifications` | array of object | yes |
| `notifications[].notificationId` | UUID v4 | yes |
| `notifications[].type` | string, 1–50 | yes |
| `notifications[].subject` | string, 1–200 | yes |
| `notifications[].referenceId` | UUID v4 \| null | yes |
| `notifications[].correlationId` | UUID v4 | yes |
| `notifications[].createdAt` | ISO-8601 UTC | yes |
| `notifications[].readAt` | ISO-8601 UTC \| null | yes |
| `unread` | integer ≥ 0 | yes |

**Preconditions.** A `notification.inbox.query.v1` was handled.

**Effects.** The Gateway answers the caller. **No `recipient` field**, and that is the whole reason this is a separate shape from the console's row: that one carries the simulated address of every delivery in the system, and this one is read by the person the notification is about, who does not need to be told their own address and must not be handed a field that would carry somebody else's if a scope were ever wrong. **No `status` either** — `PENDING` and `FAILED` are facts about the bank's mail plumbing, and the customer is reading the notification right now, so its delivery status is not a thing they can act on. `unread` is counted over the **whole** inbox rather than over the page, so a badge does not shrink when somebody scrolls.

**On error.** On timeout the Gateway stops waiting. Nothing was changed.

### `notification.mark-read.v1`

| | |
| --- | --- |
| **Category** | command |
| **Producer** | gateway |
| **Consumers** | notification-audit-service |
| **Exchange** | `bank.commands` |
| **Routing key** | `notification.mark-read.v1` |
| **Contract** | [`notification.mark-read.v1.ts`](../../apps/packages/contracts/src/events/notification/notification.mark-read.v1.ts) |

| Field | Type | Required |
| --- | --- | --- |
| `notificationIds` | array of UUID v4, 1–100 | no |

**Preconditions.** None. The **first write this service accepts from outside a flow**, and the reason `N-01` needed a new message rather than a query: nothing anywhere recorded that somebody had read something (TD-041).

**Effects.** The named notifications are marked read. `notificationIds` absent means **all of them**, which is the prototype's "marcar todas como leídas" and by far the common case; naming ids is for the one a person actually opened.

**On error.** The scope is the envelope's identity. An id belonging to somebody else matches no row and changes nothing — a no-op rather than a refusal, because a refusal would confirm that the id exists.

### `notification.read.replied.v1`

| | |
| --- | --- |
| **Category** | reply |
| **Producer** | notification-audit-service |
| **Consumers** | gateway |
| **Exchange** | `bank.replies` |
| **Routing key** | `notification.read.replied.v1` |
| **Contract** | [`notification.read.replied.v1.ts`](../../apps/packages/contracts/src/events/notification/notification.read.replied.v1.ts) |

| Field | Type | Required |
| --- | --- | --- |
| `changed` | integer ≥ 0 | yes |
| `unread` | integer ≥ 0 | yes |

**Preconditions.** A `notification.mark-read.v1` was handled.

**Effects.** The Gateway answers the caller. It carries the new unread count rather than a bare acknowledgement, because the one thing the screen does next is redraw the badge, and a second query to learn a number the write already knew would be a round trip for nothing.

**On error.** `changed` is how many rows actually moved, and **zero is a normal answer**: marking an already-read notification read again changes nothing, and so does naming an id that is not yours.


---

## The dashboards' counters

Five questions with the same shape, one per service, and each answered by the only component that has the rows. One query with no arguments per service rather than a dashboard that counts rows it happened to fetch — and the difference is not efficiency: a count over one page of a listing, drawn as a bank-wide total, is a number nobody can reproduce and everybody will quote.

They are **staff only**, enforced by each owning service. The counts say nothing about any individual, but "how many customers does this bank have" is not a number a customer is owed either. A caller who may not see them gets **zeroes rather than a refusal**: the dashboard composes several of these, and one refusal should narrow the screen, not break it.

None of these replies carries a name, an id or a sample row. A dashboard that showed the newest customer's name would put personal data on a screen whose whole purpose is to be left open on a monitor.

### `customer.stats.query.v1`

| | |
| --- | --- |
| **Category** | command |
| **Producer** | gateway |
| **Consumers** | customer-service |
| **Exchange** | `bank.commands` |
| **Routing key** | `customer.stats.query.v1` |
| **Contract** | [`customer.stats.query.v1.ts`](../../apps/packages/contracts/src/events/customer/customer.stats.query.v1.ts) |

The payload is an empty object.

### `customer.stats.replied.v1`

| | |
| --- | --- |
| **Category** | reply |
| **Producer** | customer-service |
| **Consumers** | gateway |
| **Exchange** | `bank.replies` |
| **Routing key** | `customer.stats.replied.v1` |
| **Contract** | [`customer.stats.replied.v1.ts`](../../apps/packages/contracts/src/events/customer/customer.stats.replied.v1.ts) |

| Field | Type | Required |
| --- | --- | --- |
| `registered` | integer ≥ 0 | yes |
| `pendingValidation` | integer ≥ 0 | yes |
| `activatedToday` | integer ≥ 0 | yes |

`pendingValidation` is what is awaiting a teller's verdict — the teller's own queue length, and the same set `customer.pending-validation.query.v1` lists.

### `account.stats.query.v1`

| | |
| --- | --- |
| **Category** | command |
| **Producer** | gateway |
| **Consumers** | account-service |
| **Exchange** | `bank.commands` |
| **Routing key** | `account.stats.query.v1` |
| **Contract** | [`account.stats.query.v1.ts`](../../apps/packages/contracts/src/events/account/account.stats.query.v1.ts) |

The payload is an empty object.

### `account.stats.replied.v1`

| | |
| --- | --- |
| **Category** | reply |
| **Producer** | account-service |
| **Consumers** | gateway |
| **Exchange** | `bank.replies` |
| **Routing key** | `account.stats.replied.v1` |
| **Contract** | [`account.stats.replied.v1.ts`](../../apps/packages/contracts/src/events/account/account.stats.replied.v1.ts) |

| Field | Type | Required |
| --- | --- | --- |
| `active` | integer ≥ 0 | yes |
| `inactive` | integer ≥ 0 | yes |
| `openedToday` | integer ≥ 0 | yes |
| `depositsToday` | integer ≥ 0 | yes |
| `depositedToday` | object | yes |

`openedToday` and `depositedToday` are the two numbers `D-01` shows a teller, because they are what measures a shift. `depositedToday` is `money` rather than a bare integer: an amount without a currency is exactly the kind of number that gets added to another one that meant something else. Billers' collection accounts are excluded from every count here for the reason they are excluded from every listing — they are accounts and they are not somebody's account.

### `transaction.stats.query.v1`

| | |
| --- | --- |
| **Category** | command |
| **Producer** | gateway |
| **Consumers** | transaction-service |
| **Exchange** | `bank.commands` |
| **Routing key** | `transaction.stats.query.v1` |
| **Contract** | [`transaction.stats.query.v1.ts`](../../apps/packages/contracts/src/events/transaction/transaction.stats.query.v1.ts) |

The payload is an empty object.

### `transaction.stats.replied.v1`

| | |
| --- | --- |
| **Category** | reply |
| **Producer** | transaction-service |
| **Consumers** | gateway |
| **Exchange** | `bank.replies` |
| **Routing key** | `transaction.stats.replied.v1` |
| **Contract** | [`transaction.stats.replied.v1.ts`](../../apps/packages/contracts/src/events/transaction/transaction.stats.replied.v1.ts) |

| Field | Type | Required |
| --- | --- | --- |
| `today` | integer ≥ 0 | yes |
| `completedToday` | integer ≥ 0 | yes |
| `failedToday` | integer ≥ 0 | yes |
| `compensatedToday` | integer ≥ 0 | yes |
| `inFlight` | integer ≥ 0 | yes |

`inFlight` is counted over **all** transfers rather than over today's, and that is the one deliberate asymmetry here. A transfer stuck in `PAYMENT_PENDING` since yesterday is more alarming than one stuck since this morning, and a dashboard that reset the count at midnight would hide exactly the case worth seeing.

### `payment.stats.query.v1`

| | |
| --- | --- |
| **Category** | command |
| **Producer** | gateway |
| **Consumers** | payment-service |
| **Exchange** | `bank.commands` |
| **Routing key** | `payment.stats.query.v1` |
| **Contract** | [`payment.stats.query.v1.ts`](../../apps/packages/contracts/src/events/payment/payment.stats.query.v1.ts) |

The payload is an empty object.

### `payment.stats.replied.v1`

| | |
| --- | --- |
| **Category** | reply |
| **Producer** | payment-service |
| **Consumers** | gateway |
| **Exchange** | `bank.replies` |
| **Routing key** | `payment.stats.replied.v1` |
| **Contract** | [`payment.stats.replied.v1.ts`](../../apps/packages/contracts/src/events/payment/payment.stats.replied.v1.ts) |

| Field | Type | Required |
| --- | --- | --- |
| `today` | integer ≥ 0 | yes |
| `succeededToday` | integer ≥ 0 | yes |
| `failedToday` | integer ≥ 0 | yes |
| `retrying` | integer ≥ 0 | yes |

`retrying` — payments that have failed at least once and are still due another attempt — is what makes the retry ladder visible from outside this service, and it is the operational number here: `failedToday` is history, `retrying` is a thing that is happening. Not scoped to today.

### `audit.stats.query.v1`

| | |
| --- | --- |
| **Category** | command |
| **Producer** | gateway |
| **Consumers** | notification-audit-service |
| **Exchange** | `bank.commands` |
| **Routing key** | `audit.stats.query.v1` |
| **Contract** | [`audit.stats.query.v1.ts`](../../apps/packages/contracts/src/events/audit/audit.stats.query.v1.ts) |

The payload is an empty object. `ADMINISTRADOR` only.

### `audit.stats.replied.v1`

| | |
| --- | --- |
| **Category** | reply |
| **Producer** | notification-audit-service |
| **Consumers** | gateway |
| **Exchange** | `bank.replies` |
| **Routing key** | `audit.stats.replied.v1` |
| **Contract** | [`audit.stats.replied.v1.ts`](../../apps/packages/contracts/src/events/audit/audit.stats.replied.v1.ts) |

| Field | Type | Required |
| --- | --- | --- |
| `eventsToday` | integer ≥ 0 | yes |
| `invalidToday` | integer ≥ 0 | yes |
| `notificationsToday` | integer ≥ 0 | yes |
| `lastEventType` | string, ≤ 120 \| null | yes |
| `lastEventAt` | ISO-8601 UTC \| null | yes |

`invalidToday` is the number worth having on a screen and the one a trail that counted only successes would hide: a message this service could not parse is recorded `INVALID` rather than parked, precisely so somebody can see that it happened.

`lastEventType` is a **message name, never a payload**. It says the system is alive and what it was last doing, and it carries nothing about anyone — which is the rule for this database in general, and for a screen left open on a monitor in particular.
