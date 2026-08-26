# Actors and Minimum Permissions

> **These permissions are a decision of this team, not a requirement of the assignment.** The
> assignment names the three actor types and defines no permission for any of them (§4.1, note
> on p. 7). Everything below is decision **D-06** and carries the same approval as the rest of
> the model.

Related: [entities.md](entities.md) · [use-cases.md](use-cases.md)

## The three actors

The assignment states: "Existe 3 tipos de usuarios en el sistema, Administrador, Cajero
Receptor, Cliente" (§4.1, p. 7).

| Actor | `role` | Who they are |
| --- | --- | --- |
| Client | `CLIENTE` | An account holder. Operates on their own accounts. |
| Receiving teller | `CAJERO_RECEPTOR` | Bank staff at the counter. Serves clients who are physically present. |
| Administrator | `ADMINISTRADOR` | Bank staff with oversight over customers, accounts and the audit record. |

## How staff are modelled

Decision **D-01**: `ADMINISTRADOR` and `CAJERO_RECEPTOR` are `Customer` records with an
elevated `role`. There is no separate staff entity, and there is no sixth service.

This keeps one authentication flow and preserves what `customerId` means in `Account`. It does
mean the `Customer` aggregate holds two kinds of person, so the model states plainly which
rules apply to which:

| Rule | Applies to |
| --- | --- |
| Uniqueness of document, email and username | **Every** `Customer`, whatever the role |
| Email verification before operating | **Every** `Customer` |
| Identity-document photo validation | **Only** `role = CLIENTE` |
| Holding bank accounts | **Only** `role = CLIENTE` |

Two consequences worth stating, because code will otherwise assume otherwise:

- An `ADMINISTRADOR` or a `CAJERO_RECEPTOR` may exist with **no `Account` at all**. Any path
  that assumes "a customer has at least one account" does not hold for staff.
- `Account.customerId` always refers to a `Customer` whose role is `CLIENTE`. Opening an
  account for staff fails with `ROLE_NOT_ELIGIBLE` (invariant C-6).

## Permission matrix

| Use case | `CLIENTE` | `CAJERO_RECEPTOR` | `ADMINISTRADOR` |
| --- | :---: | :---: | :---: |
| Register (self-service) | ✔ anonymous | ✔ on the client's behalf | ✔ |
| Verify own email | ✔ own only | ✘ | ✘ |
| Sign in | ✔ | ✔ | ✔ |
| Open an account | ✔ own only | ✔ for any client | ✔ |
| Query a balance | ✔ own accounts | ✔ any account | ✔ any account |
| Transfer money | ✔ from own accounts | ✔ at the counter | ✔ |
| Update customer data | ✔ own only | ✔ | ✔ |
| Validate an identity-document photo | ✘ uploads it only | ✔ | ✔ |
| Deactivate or reactivate an account manually | ✘ | ✘ | ✔ |
| Assign roles | ✘ | ✘ | ✔ |
| Read the audit record and notifications | ✘ | ✘ | ✔ |

## Explicit boundaries

What each role **may not** do matters as much as what it may.

**`CLIENTE`**

- May not operate on an account that is not theirs — not query it, not transfer from it, not
  update it. The expected result is `FORBIDDEN_ACCOUNT_ACCESS`, a named rejection, never a
  silent no-op.
- May not validate their own identity photo. They upload it; someone else reviews it.
- May not change their own `role`.

**`CAJERO_RECEPTOR`**

- May not assign or change roles.
- May not deactivate or reactivate accounts by hand — that is the automatic process, or an
  administrator.
- May not read the audit record.

**`ADMINISTRADOR`**

- May not alter an `AuditEvent`. The record is append-only and immutable **for everyone**
  (invariant E-3). An administrator who can rewrite the audit trail makes the audit trail
  worthless.
- May not read an access credential. Credentials never leave Customer Service in readable form,
  regardless of who is asking.

## What is deliberately not modelled

**Cash deposit and withdrawal.** The assignment names the receiving teller but describes no
cash operation anywhere, and this model does not invent one. The teller is given the operations
that do exist in the assignment: registering clients, opening accounts, querying balances and
transferring at the counter. If the team decides to add deposits and withdrawals, they are new
use cases against Account Service and a model change requiring a new approval.

**Endpoint-level authorization.** This document fixes the minimum the domain needs: who may
trigger which use case. How that is enforced — token scopes, guards, per-route rules — is
**T-15**, which consumes this matrix as its input.

> Corrected on 2026-08-24 (T-15). This line used to point at T-13, the sequence-diagram
> ticket. [ADR-010](../architecture/adr/ADR-010-authentication.md) was decided afterwards and
> assigns enforcement to the Gateway, which is T-15. The guards that implement this matrix
> live in `apps/gateway/src/interfaces/guards/`, and a test in `apps/web` fails if the
> frontend's copy of the matrix and the Gateway's ever disagree.
