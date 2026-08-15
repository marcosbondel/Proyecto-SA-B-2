# Bounded Contexts and Data Ownership

Which service owns which data, which service may only read it, and which data must never leave
the service that owns it. This is the boundary the other five documents presuppose.

Related: [entities.md](entities.md) · [use-cases.md](use-cases.md) · [message-catalog.md](message-catalog.md)

## The five contexts

Exactly five microservices, each with one responsibility. The assignment penalizes mixed
responsibilities and "god object" services (§4.1, critical observations, p. 7).

| Context | Single responsibility | Owns |
| --- | --- | --- |
| **Customer Service** | Customer identity: who a person is and whether they may sign in | `Customer` — personal data, document, username, credential, role, identity validation, email verification |
| **Account Service** | Bank accounts and balances | `Account` — balance, state, account type, last activity |
| **Transaction Service** | Orchestration of financial transactions | `Transaction` — source, target, amount, Saga state |
| **Payment Service** | Payment processing, including retries | `Payment` — transaction reference, status, attempt, failure reason |
| **Notification & Audit Service** | Notifications and the event record | `AuditEvent`, `Notification` |

### The API Gateway

The Gateway **owns no business entity and has no database** (§4.2, p. 8). It is the only
external entry point. It routes, authenticates and aggregates; it originates the
`correlationId` for every external flow and translates between the client's synchronous world
and the broker's asynchronous one.

It does **not** make domain decisions. Deciding whether a balance suffices, whether a customer
may be activated, or whether a transfer is legal belongs to the owning service. A Gateway that
decides is the "orchestrator Gateway" the rubric penalizes (§8.2, criterion 2.4, p. 23).

## Ownership versus reference

The two are not the same, and confusing them is how cross-service coupling starts.

- **Ownership** is the exclusive right to write an attribute. Exactly one service has it.
- **Reference** is holding another service's identifier as an opaque value.

`Account` holds a `customerId`. That is a reference: Account Service may store it, compare it
and publish it, but it owns nothing about that customer — not the name, not the document, not
the email. Holding the identifier confers no right to the entity behind it, and no right to go
looking for it.

The same applies to `Transaction` holding account identifiers and `Payment` holding a
transaction identifier. A referencing service treats the value as opaque: it never parses it,
never derives meaning from its shape, and never queries the owner's database with it.

## Data ownership matrix

One writer per attribute. Consumers receive data only through messaging — **no row in this
matrix is satisfied by reading another service's database.**

### Customer Service

| Attribute | Written by | Consumers | Transport |
| --- | --- | --- | --- |
| `customerId` | Customer | Account (opaque reference), Notification & Audit | Event |
| Full name | Customer | Notification & Audit | Event |
| Identity document | Customer | — | **Does not cross** |
| Email | Customer | Notification & Audit, as delivery recipient only | Event — bounded exception, see below |
| Date of birth | Customer | — | **Does not cross** |
| Address | Customer | — | **Does not cross** |
| `username` | Customer | Notification & Audit | Event |
| Identity-document photo reference | Customer | — | **Does not cross** |
| Access credential | Customer | — | **Never crosses** |
| `role` | Customer | Gateway, as a claim after login | Async request/reply |
| `identityStatus` | Customer | Notification & Audit | Event |
| `emailVerifiedAt` | Customer | Notification & Audit | Event |
| `status` | Customer | Notification & Audit | Event |

### Account Service

| Attribute | Written by | Consumers | Transport |
| --- | --- | --- | --- |
| `accountId` | Account | Transaction (opaque reference), Notification & Audit | Event |
| `customerId` (reference) | Account | Notification & Audit | Event |
| `balance` | **Account, and only Account** | Gateway, for the balance query | Async request/reply |
| `status` | Account | Notification & Audit | Event |
| `accountType` | Account | Notification & Audit | Event |
| `lastActivityAt` | Account | — | **Does not cross** |

> `balance` is the most sensitive attribute in the model. **Transaction Service never reads
> it.** It orders a debit and waits for the resulting event. If a later design needs to "check
> the balance before transferring" from Transaction Service, that design is wrong — the check
> belongs to the service that owns the number.

### Transaction Service

| Attribute | Written by | Consumers | Transport |
| --- | --- | --- | --- |
| `transactionId` | Transaction | Payment (opaque reference), Notification & Audit | Event |
| `sourceAccount`, `targetAccount` | Transaction | Account (as the target of an order), Notification & Audit | Event |
| `amount` | Transaction | Account, Payment, Notification & Audit | Event |
| `status` | Transaction | Notification & Audit | Event |
| `correlationId` | Originated by the Gateway, propagated by Transaction | All | Every message |
| `idempotencyKey` | Transaction | — | **Does not cross** |
| Timestamps | Transaction | Notification & Audit | Event |

### Payment Service

| Attribute | Written by | Consumers | Transport |
| --- | --- | --- | --- |
| `paymentId` | Payment | Notification & Audit | Event |
| `transactionId` (reference) | Payment | Transaction, Notification & Audit | Event |
| `status` | Payment | Transaction, Notification & Audit | Event |
| `attempt` | Payment | Notification & Audit | Event |
| `failureReason` | Payment | Transaction, Notification & Audit | Event |

### Notification & Audit Service

| Attribute | Written by | Consumers | Transport |
| --- | --- | --- | --- |
| `AuditEvent`: `eventId`, type, `timestamp`, `payload`, `correlationId`, origin | Notification & Audit | **None** | — |
| `Notification`: recipient, channel, type, status, attempts | Notification & Audit | **None** | — |

This service is **terminal by design**. It consumes a great deal and publishes nothing that
another service consumes in order to decide anything. The assignment describes it as highly
decoupled and as not affecting business logic (§4.1, p. 7).

## Data that must not cross service boundaries

| Data | Stays in | Why |
| --- | --- | --- |
| Access credential | Customer Service | Not even encrypted. An event carrying it is a leak, however internal the broker is. |
| Identity-document photo and its reference | Customer Service | The most sensitive personal data in the system, and no other context has a reason to see it. |
| Full identity document number | Customer Service | The audit record does not persist it. Where audit needs to identify a person, it uses `customerId`. |
| Date of birth, address | Customer Service | Profile, not operation. No flow needs them outside. |
| `balance` | Account Service | It leaves only as the answer to the Gateway's balance query. It never travels in Saga events. |
| `lastActivityAt` | Account Service | Internal input to the deactivation process. |
| `idempotencyKey` | Transaction Service | It is the defence against double movement; exposing it invites another service to reinterpret it. |
| Activation token | Customer Service generates and validates it | Notification & Audit only carries it inside the link. |

### The one bounded exception

The customer's **email address** reaches Notification & Audit inside
`customer.activation.requested`, because that service delivers the message and a delivery needs
a recipient.

It crosses as **delivery data, not profile data**. It does not authorize moving anything else,
and it is not persisted into the audit record alongside the rest of the customer file.

### Why Notification & Audit may send the activation email

This deserves stating plainly, because it looks at first like a contradiction of "does not
affect business logic".

Sending is an **effect**, not a decision. Notification & Audit does not decide whether the
customer is activated, does not generate the token, does not validate it, and publishes no
event that another service consumes to decide anything. Customer Service decides activation
when the token comes back through the Gateway.

The coupling the assignment forbids — business logic depending on this service — does not
occur: **if the email fails to send, the `Customer` stays in exactly the state it was in.**
The customer retries the login, a fresh token is issued, and the domain never noticed.

## No service reads another service's database

Every service owns its own database, no service accesses another's, and communication happens
only through events (§4.2, mandatory design rules, p. 7). Data owned elsewhere arrives as a
message or it does not arrive.

This is the most expensive rule in the project to break:

- A microservice querying a database that is not its own is **penalized with 50 % of the
  grade** (§4.2, architectural restrictions, p. 13).
- Using a single shared database is **penalized with 100 %** (§8.3, p. 26).

Concretely, in this model that means: Transaction Service does not read balances, Account
Service does not read customers, Payment Service knows nothing but a transaction identifier,
Notification & Audit reads nothing at all, and the Gateway has no database to read from.
