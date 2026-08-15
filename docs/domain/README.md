# Bank USAC Domain Model

## What this is

The domain model as a **functional contract**: which service owns which data, which
invariants it protects, which commands it accepts, and which events it publishes or consumes.
It is the agreement the five services implement separately, so it has to be true before any of
them is written.

## What this is not

It does not prescribe classes, tables, database schemas, message payloads or technologies.
Those belong elsewhere and are deliberately excluded:

| Not here | Where it belongs |
| --- | --- |
| JWT issuance, signing, expiry | T-03 |
| Message payload shape, versioning, topic naming | T-05 |
| Databases, cluster, deployment | T-06 |
| C4 and UML diagrams | T-07 |
| Endpoint-level authorization | T-13 |

## Index

| Document | Read it when |
| --- | --- |
| [bounded-contexts.md](bounded-contexts.md) | You need to know which service may write a given piece of data, and which data must never cross a boundary. |
| [entities.md](entities.md) | You are implementing a service and need its entities, states, legal transitions and invariants. |
| [actors.md](actors.md) | You need to know which role may trigger a given operation. |
| [use-cases.md](use-cases.md) | You are building or diagramming a business flow and need its actor, input, result, failures and compensation. |
| [message-catalog.md](message-catalog.md) | You are designing events or wiring the broker and need who produces and who consumes each message. |

## Ubiquitous language

The prose here is English and the assignment's literal enumerations stay in Spanish. Both
vocabularies name the same things, and this table is the only place the equivalence is
recorded.

| Term (model) | Assignment (Spanish) | What it is |
| --- | --- | --- |
| Customer | Cliente / cuentahabiente | A registered person, whether an account holder or bank staff (D-01) |
| Account | Cuenta | A bank account belonging to a client |
| Transaction | Transacción / transferencia | An attempt to move money between two accounts, together with its Saga |
| Payment | Pago | The processing of the payment attached to a transaction |
| AuditEvent | Evento de auditoría | An immutable record that something happened |
| Notification | Notificación | A message delivered to a person |
| Activation | Activación | Email verification that enables a client to operate |
| Identity validation | Validación de identidad | Review of the identity-document photo. **Distinct from activation** |
| Compensation | Compensación | The step that undoes an applied effect when a Saga cannot complete |
| Bounded context | Límite de contexto | The scope of one service: its data, its commands, its events |

Enumeration literals keep the assignment's Spanish because they come from the document the
project is graded against: `MONETARIA`, `AHORRO`, `ADMINISTRADOR`, `CAJERO_RECEPTOR`,
`CLIENTE`. Translating them would create two names for one thing.

## Team decisions

The assignment leaves these open. They are decisions of this team, not requirements of the
assignment, and they are recorded as such so nobody later mistakes one for the other.

| # | Decision | Discarded alternative |
| --- | --- | --- |
| **D-01** | `ADMINISTRADOR` and `CAJERO_RECEPTOR` are `Customer` records with an elevated `role`, not a separate staff entity. Account-holder invariants apply only when `role = CLIENTE`. | A separate `StaffUser` aggregate, which would have duplicated the authentication flow and changed what `customerId` means in `Account`. |
| **D-02** | `accountType` is pure classification in Phase 1: `MONETARIA` and `AHORRO` change no invariant, no state and no flow. | Differentiated rules (exemption from automatic deactivation, minimum opening balance), which would add banking rules the assignment never asks for. |
| **D-03** | Customer Service generates, signs and validates the activation link; Notification & Audit Service delivers the email. | Customer Service sending the email itself, which would take from Notification & Audit the function the assignment assigns to it; or Notification & Audit generating the token, which would move an identity decision out of its context. |
| **D-04** | A first login with correct credentials and an unverified email triggers the activation email and **denies access**, with a reason distinguishable from invalid credentials. | Sending the email at registration and simply rejecting the login, which drifts from the assignment's wording "se debe de activar el usuario por medio del primer logging". |
| **D-05** | Derived domain rules: email is the login identifier; the generated username disambiguates by numeric suffix; only confirmed money movement counts as account activity; deactivation requires low balance **and** six months of inactivity; `INACTIVE` blocks debits but accepts credits and reactivates; an idempotency key reused with different content is rejected; amounts are quetzales with exactly two decimals and are never rounded; the activation token lasts 24 hours, is single-use, and a retry invalidates the previous one. | Recorded per rule in the feature's research notes; each alternative is listed there. |
| **D-06** | Minimum permissions per actor, with an explicit boundary of what each role may not do. See [actors.md](actors.md). | No alternative: the assignment names the three actors and defines no permission at all, so something had to be proposed. |

D-05 and D-06 introduce domain rules the assignment does not fix. Nothing is implemented on
them before the approval below.

## Changing this model

This model is the contract five services implement separately, so it does not change quietly.

1. A change requires a new approval from all three members, recorded below.
2. Every dependent ticket must be reviewed: T-03, T-05, T-06 and every service ticket consume
   this model as input.
3. A change that moves a context boundary is the expensive kind. It cascades into
   `bounded-contexts.md` first and from there into the other five documents.

Traceability rule: every statement here traces to the assignment (with section and page), to a
recorded team decision, or to the approval below. Nothing is asserted without one of the three.

## Approval

> **Deferred by the coordinator on 2026-08-14.** The model is written and verified, and
> dependent work proceeds on it. The three-member sign-off has not been collected yet.

| Member | Role in this decision | Date | Approved version |
| --- | --- | --- | --- |
| Marcos Daniel Bonifasi de Leon (202202410) | Coordinator | — | — |
| Enner Esai Mendizabal Castro (202302220) | Customer & Account Service owner | — | — |
| David Estuardo Barrios Ramirez (202300769) | Transaction & Payment Service owner | — | — |

Approval was requested in
[issue #9](https://github.com/marcosbondel/Proyecto-SA-B-2/issues/9#issuecomment-5299551281)
and remains open there. The approved version is identified by commit.

**What deferring costs.** Two things, stated so the decision is made with open eyes rather than
discovered later:

1. Decisions **D-05** and **D-06** are domain rules the assignment does not fix. If one of them
   is wrong, it propagates into all five services, and the correction lands on
   [bounded-contexts.md](bounded-contexts.md) first and cascades from there.
2. Rubric criterion 1.1 (§8.2, p. 21) grades evidence of distributed responsibility and team
   method. The approval thread is that evidence for this ticket.

Neither cost is incurred by deferring — only by never collecting it. Gathering the two remaining
comments on issue #9 closes both.
