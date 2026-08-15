# Message Catalogue

Which conversations exist between services: the name of each message, who produces it, who
consumes it, and which flow it belongs to.

**This catalogue does not define payloads.** Field shapes, versioning, exchange and routing-key
naming, serialization format and broker retry policy are **T-05**. The line between the two is
exactly the line between *what conversation exists* and *how it is serialized*.

Related: [use-cases.md](use-cases.md) · [bounded-contexts.md](bounded-contexts.md) · [`docs/events/`](../events/README.md)

## Command or event

- A **command** expresses an intention aimed at one service. It has **exactly one** handler.
- An **event** narrates something that already happened. It may have **many** consumers.

Choreography does not remove commands. Transaction Service *orders* the debit, it does not hint
at it. What choreography avoids is a service blocking while it waits for another to answer —
and no message here does that.

Two rules this catalogue makes checkable:

- Every command has exactly one handling service.
- Every event has at least one consumer. **No orphan events.**

## Commands

| Command | Sent by | Handled by | Flow |
| --- | --- | --- | --- |
| `customer.register` | Gateway | Customer | Register a customer |
| `customer.authenticate` | Gateway | Customer | Sign in — async request/reply; replies with claims, not a token |
| `customer.verify-email` | Gateway | Customer | Activate by email — carries the token Customer Service signed |
| `customer.update` | Gateway | Customer | Update customer data |
| `customer.validate-identity` | Gateway | Customer | Identity validation — independent of activation |
| `account.create` | Gateway | Account | Open an account — carries `accountType` |
| `account.balance.query` | Gateway | Account | Query a balance — async request/reply |
| `account.set-status` | Gateway | Account | Manual deactivation or reactivation — `ADMINISTRADOR` only |
| `transfer.requested` | Gateway | Transaction | Transfer — carries the caller's `idempotencyKey` |
| `account.debit.requested` | Transaction | Account | Transfer — step 2 |
| `payment.requested` | Transaction | Payment | Transfer — step 4 |
| `account.credit.requested` | Transaction | Account | Transfer — step 6 |
| `account.debit.compensation.requested` | Transaction | Account | Transfer — compensation; returns the money to the source |

Thirteen commands, thirteen single handlers.

## Events

### Produced by Customer Service

| Event | Consumers | Flow |
| --- | --- | --- |
| `customer.registered` | Notification & Audit | Register a customer |
| `customer.activation.requested` | Notification & Audit | Activate by email — triggers delivery |
| `customer.email.verified` | Notification & Audit | Activate by email — closing |
| `customer.updated` | Notification & Audit | Update customer data |
| `customer.identity.validated` | Notification & Audit | Identity validation |
| `customer.identity.rejected` | Notification & Audit | Identity validation |
| `customer.login.succeeded` | Notification & Audit | Sign in |
| `customer.login.rejected` | Notification & Audit | Sign in — carries the distinguishable reason of D-04 |

### Produced by Account Service

| Event | Consumers | Flow |
| --- | --- | --- |
| `account.opened` | Notification & Audit | Open an account |
| `account.debited` | Transaction, Notification & Audit | Transfer — step 2 succeeded |
| `account.debit.rejected` | Transaction, Notification & Audit | Transfer — closes in `FAILED` |
| `account.credited` | Transaction, Notification & Audit | Transfer — step 6 succeeded |
| `account.credit.rejected` | Transaction, Notification & Audit | Transfer — triggers compensation |
| `account.debit.compensated` | Transaction, Notification & Audit | Transfer — closes in `COMPENSATED` |
| `account.deactivated` | Notification & Audit | Automatic or manual deactivation |
| `account.reactivated` | Notification & Audit | Reactivation by credit or by administrator |

### Produced by Transaction Service

| Event | Consumers | Flow |
| --- | --- | --- |
| `transaction.initiated` | Notification & Audit | Transfer — Saga opens |
| `transaction.completed` | Notification & Audit | Transfer — successful closing |
| `transaction.failed` | Notification & Audit | Transfer — money never left |
| `transaction.compensated` | Notification & Audit | Transfer — money left and came back |

### Produced by Payment Service

| Event | Consumers | Flow |
| --- | --- | --- |
| `payment.succeeded` | Transaction, Notification & Audit | Transfer — step 4 succeeded |
| `payment.failed` | Transaction, Notification & Audit | Transfer — retries exhausted |

Twenty-two events, every one with a consumer.

### Produced by Notification & Audit Service

**None.** This service is terminal by design: it consumes everything above for the audit record
and for notifications, and **no service depends on it to decide anything**. The assignment
describes it as highly decoupled and as not affecting business logic (§4.1, p. 7).

If a later design needs this service to publish an event that another service consumes in order
to make a business decision, that design contradicts the assignment and this catalogue.

## What belongs to T-05

| Defined here | Defined in T-05 |
| --- | --- |
| Message name | Payload fields and types |
| Producing service | Schema versioning and compatibility |
| Consuming services | Exchange, queue and routing-key naming |
| The flow it belongs to | Serialization format |
| Which command carries the idempotency key | Broker retry and dead-letter policy |

The executable shapes will live in
[`apps/packages/contracts/src/events/`](../../apps/packages/contracts/src/events/) and are
documented in [`docs/events/`](../events/README.md). Neither exists yet, and neither is created
by this model.

## Coherence checks

Verifiable against the tables above without reading any code.

| # | Check | Expected |
| --- | --- | --- |
| M-1 | Every command has exactly one handling service | 13 of 13 |
| M-2 | Every event has at least one consumer | 22 of 22, zero orphans |
| M-3 | Notification & Audit produces no events | The section is empty by design |
| M-4 | Every transfer step that can fail after the debit has a compensation path | `payment.failed` and `account.credit.rejected` both lead to `account.debit.compensation.requested` |
| M-5 | No message carries data from the "does not cross" list | The single exception is the email in `customer.activation.requested` |
| M-6 | Every message propagates `correlationId` | Cross-cutting invariant X-3, no exceptions |
