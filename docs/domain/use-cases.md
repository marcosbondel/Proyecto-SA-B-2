# Business Use Cases

Six flows, each with its actor, input, observable result, the sequence of services that react,
and the failures that are expected rather than accidental. Message names refer to
[message-catalog.md](message-catalog.md).

Three of these are the use cases the assignment requires by name — open an account, query a
balance, transfer money (§4.2, use-case diagram). The other three are what makes them work.

**No synchronous call exists between services in any flow.** The only direct answer anywhere is
the Gateway's asynchronous request/reply.

Related: [actors.md](actors.md) · [entities.md](entities.md) · [bounded-contexts.md](bounded-contexts.md)

---

## 1. Register a customer

| | |
| --- | --- |
| **Actor** | Anonymous visitor, or `CAJERO_RECEPTOR` / `ADMINISTRADOR` on the client's behalf |
| **Preconditions** | None |
| **Input** | Full name, identity document, email, date of birth, address |
| **Result** | A `Customer` exists with a generated `username`, `status = PENDING_ACTIVATION`, `identityStatus = PENDING` |

**Sequence**

1. The Gateway publishes `customer.register`.
2. Customer Service validates uniqueness and coherence, generates the `username`, persists the
   `Customer`, and publishes `customer.registered`.
3. Notification & Audit records the event.

**Expected failures**

| Failure | Result |
| --- | --- |
| Document already registered | `DOCUMENT_ALREADY_REGISTERED` (C-1). No `Customer` created |
| Email already registered | `EMAIL_ALREADY_REGISTERED` (C-3) |
| Incoherent date of birth | `INVALID_BIRTH_DATE` (C-5) |
| Username collision | Not a failure — resolved by numeric suffix (C-2) |

---

## 2. Open an account

| | |
| --- | --- |
| **Actor** | `CLIENTE` for themselves, or `CAJERO_RECEPTOR` / `ADMINISTRADOR` for any client |
| **Preconditions** | The customer exists and has `role = CLIENTE` |
| **Input** | `customerId`, `accountType` (`MONETARIA` or `AHORRO`) |
| **Result** | An `Account` exists with `balance = 0.00`, `status = ACTIVE`, and the requested type |

**Sequence**

1. The Gateway publishes `account.create`, carrying `accountType`.
2. Account Service persists the account **without querying Customer Service's database** — it
   stores `customerId` as an opaque reference — and publishes `account.opened`.
3. Notification & Audit records the event.

**Expected failures**

| Failure | Result |
| --- | --- |
| The referenced customer does not exist | Detected downstream, never by reading Customer Service's data. The account is not created and the rejection is recorded |
| The customer is staff | `ROLE_NOT_ELIGIBLE` (C-6) |
| Account type missing or unrecognised | Rejected; the type is required at creation |

> Account Service cannot verify the customer exists, and must not try. That is the price of the
> boundary, and it is the intended design (§4.2, mandatory design rules, p. 7).

---

## 3. Query a balance

| | |
| --- | --- |
| **Actor** | `CLIENTE` on their own accounts; `CAJERO_RECEPTOR` and `ADMINISTRADOR` on any account |
| **Preconditions** | The requester is authenticated; the account exists |
| **Input** | `accountId` |
| **Result** | The current balance is returned to the caller |

**Sequence**

1. The Gateway issues an **asynchronous request/reply** to Account Service.
2. Account Service answers with the balance. **Nothing else reads it** — this is the only path
   by which `balance` leaves the service.

**Expected failures**

| Failure | Result |
| --- | --- |
| Account does not exist | `ACCOUNT_NOT_FOUND` |
| A client queries an account that is not theirs | `FORBIDDEN_ACCOUNT_ACCESS` |
| No reply within the timeout | The Gateway reports a timeout. It does **not** read the database as a fallback |

The query does **not** update `lastActivityAt`. Looking at an account is not activity (A-4).

---

## 4. Activate by email

Decision **D-03**. The assignment: "Se debe de activar el usuario por medio del primer logging
de cuentahabiente, se debe de enviar un correo con un link que valide al usuario y dejar la
cuenta en estado activo" (§4.1, p. 5).

| | |
| --- | --- |
| **Actor** | `CLIENTE` |
| **Preconditions** | The customer is registered with `status = PENDING_ACTIVATION` |
| **Input** | A first sign-in attempt (see flow 5), then the click on the emailed link |
| **Result** | `emailVerifiedAt` is set and `status` becomes `ACTIVE` |

**Sequence**

1. Customer Service **generates and signs** the activation token and publishes
   `customer.activation.requested`, carrying the recipient email and the signed link — and
   nothing else about the customer.
2. Notification & Audit **delivers** the email. It does not generate, read or validate the
   token; it carries it.
3. The client opens the link. The Gateway receives the token and publishes
   `customer.verify-email`.
4. Customer Service **validates** the token, sets `emailVerifiedAt`, moves `status` to `ACTIVE`,
   and publishes `customer.email.verified`.

The split is deliberate: the token is an identity decision, so it is generated and validated
where identity lives. Delivery is an effect, so it belongs to the service the assignment gives
notifications to.

**Token lifecycle**

The token lasts **24 hours** and is **single-use**. A sign-in retry before verification
**invalidates the previous token and issues a new one**, so no stale links accumulate in the
client's inbox.

**Expected failures**

| Failure | Result |
| --- | --- |
| Token expired | `ACTIVATION_TOKEN_INVALID`, distinguishable reason. No state change (C-7) |
| Token already used | `ACTIVATION_TOKEN_INVALID`. **No second activation and no second audit record of activation** |
| Token invalidated by a newer one | `ACTIVATION_TOKEN_INVALID` |
| The email fails to send | The `Customer` stays exactly as it was. The client retries the sign-in and a fresh token is issued. **No domain state depends on delivery** (N-1) |

---

## 5. Sign in

Decision **D-04**.

| | |
| --- | --- |
| **Actor** | `CLIENTE`, `CAJERO_RECEPTOR`, `ADMINISTRADOR` |
| **Preconditions** | The customer is registered |
| **Input** | Email and credential — the email is the login identifier, not the username (D-05) |
| **Result** | Customer Service returns the claims the Gateway needs; or a named rejection |

**Sequence**

1. The Gateway publishes `customer.authenticate` as an asynchronous request/reply.
2. Customer Service validates the credential and branches:
   - **Credential valid, `emailVerifiedAt` set** → replies with the claims (`customerId`,
     `role`, `status`) and publishes `customer.login.succeeded`.
   - **Credential valid, `emailVerifiedAt` null** → triggers flow 4, **denies access**, and
     publishes `customer.login.rejected` with a reason that is distinguishable from an invalid
     credential.
   - **Credential invalid** → denies access and publishes `customer.login.rejected`.
3. The Gateway turns the claims into a session.

> **Token issuance is out of scope here.** How the JWT is built, signed, scoped and expired is
> **T-03**. This flow ends at the claims.

**Expected failures**

| Failure | Result |
| --- | --- |
| Wrong credential | `INVALID_CREDENTIALS` — deliberately indistinct about which field was wrong |
| Correct credential, email not verified | `ACCOUNT_PENDING_ACTIVATION` — a **different** reason, so the interface can say "check your email" instead of "wrong password" |
| Repeated attempts before verifying | Each one invalidates the previous token and issues a new one. **No parallel valid links, no second activation audit record** |

---

## 6. Transfer money

The distributed flow. It spans four services, so it is a Saga with explicit compensation
(§4.2, expected patterns, p. 7), implemented as choreography.

| | |
| --- | --- |
| **Actor** | `CLIENTE` from their own accounts; `CAJERO_RECEPTOR` / `ADMINISTRADOR` at the counter |
| **Preconditions** | Both accounts exist; the source is `ACTIVE` and has sufficient funds |
| **Input** | `sourceAccount`, `targetAccount`, `amount`, `idempotencyKey` |
| **Result** | The amount moves from source to target, and the `Transaction` closes in `COMPLETED` |

### The seven steps

| # | Service | Reacts to | Does | Publishes |
| --- | --- | --- | --- | --- |
| 1 | Transaction | `transfer.requested` | Validates `amount > 0`, source ≠ target, idempotency. Creates the `Transaction` in `PENDING`, moves to `DEBITING` | `account.debit.requested` |
| 2 | Account | `account.debit.requested` | Checks the account exists, is `ACTIVE`, has funds. Debits, updates `lastActivityAt` | `account.debited` \| `account.debit.rejected` |
| 3 | Transaction | `account.debited` | Moves to `PAYMENT_PENDING` | `payment.requested` |
| 4 | Payment | `payment.requested` | Processes, retrying and counting `attempt` | `payment.succeeded` \| `payment.failed` |
| 5 | Transaction | `payment.succeeded` | Orders the credit | `account.credit.requested` |
| 6 | Account | `account.credit.requested` | Credits the target; reactivates it if it was `INACTIVE` (A-3) | `account.credited` \| `account.credit.rejected` |
| 7 | Transaction | `account.credited` | Closes in `COMPLETED` | `transaction.completed` |

### Compensation

Two different endings, and they are not interchangeable.

**Closes in `FAILED` — nothing to undo.** `account.debit.rejected` at step 2 means the money
never left. The `Transaction` moves `DEBITING` → `FAILED` and publishes `transaction.failed`.
No compensation runs, because there is no effect to reverse.

**Closes in `COMPENSATED` — it left and came back.** Either `payment.failed` at step 4 or
`account.credit.rejected` at step 6 triggers the same path:

1. Transaction Service publishes `account.debit.compensation.requested`.
2. Account Service returns the amount to the source account and publishes
   `account.debit.compensated`.
3. Transaction Service closes in `COMPENSATED` and publishes `transaction.compensated`.

Invariant T-7 states the guarantee: **any transaction that left `DEBITING` with the debit
applied ends in `COMPLETED` or `COMPENSATED`, never in `FAILED`.**

### Expected failures

| Failure | Where | Result |
| --- | --- | --- |
| `amount` is zero or negative | Step 1 | `INVALID_AMOUNT` (T-1). No transaction created |
| Source equals target | Step 1 | `SAME_ACCOUNT_TRANSFER` (T-2) |
| More than two decimals | Step 1 | `INVALID_AMOUNT_PRECISION` (A-6). Rejected, never rounded |
| Idempotency key reused, same content | Step 1 | The original transaction is returned. Balances do not move (T-3) |
| Idempotency key reused, different content | Step 1 | `IDEMPOTENCY_KEY_CONFLICT` (T-4). Answering with the original result would be a lie |
| Insufficient funds | Step 2 | `INSUFFICIENT_FUNDS` (A-1) → `FAILED` |
| Source account inactive | Step 2 | `ACCOUNT_INACTIVE` (A-2) → `FAILED` |
| Payment retries exhausted | Step 4 | `payment.failed` with `failureReason` → **compensation** → `COMPENSATED` |
| Target account not found | Step 6 | `account.credit.rejected` → **compensation** → `COMPENSATED` |
| Any event delivered twice | Any step | Discarded by `eventId`. No second transition, no second compensation (T-5, X-4) |
| An event arriving out of order | Any step | The illegal transition is discarded and recorded as `ILLEGAL_TRANSITION` (T-6). It is not applied |

Notification & Audit consumes every event above for the audit record, and notifies the client
at each of the three closings.

---

## Correlation

Every flow propagates a `correlationId` end to end. The assignment requires traceability by
correlation identifier across all flows (§4.2, SRE considerations, p. 7).

- **The Gateway originates it** when an external request arrives.
- **Every message carries it** — commands, events, replies, without exception.
- **Every `AuditEvent` records it** (E-1). An event without correlation is not auditable and is
  rejected.
- A transfer that touches four services produces one correlated trail, so the whole Saga can be
  reconstructed from the audit record.

**It is not a deduplication key.** Every message in one flow shares the same `correlationId`,
so using it to deduplicate would discard the flow itself. Deduplication is by `eventId`, and
transfer-level idempotency is by `idempotencyKey`. The three mechanisms are described in
[entities.md](entities.md).
