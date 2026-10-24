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
| List own accounts, read an account's movements | ✔ own accounts | ✔ any account | ✔ any account |
| List transfers | ✔ own only | ✔ all | ✔ all |
| List own service payments | ✔ own only | ✔ all | ✔ all |
| Read own notifications, mark them read | ✔ own only | ✔ own only | ✔ own only |
| Change own password | ✔ **own only** | ✔ own only | ✔ own only |
| Recover a password by email | ✔ anonymous | ✔ anonymous | ✔ anonymous |
| Register a deposit at a window | ✘ | ✔ | ✔ |
| Read the biller catalogue | ✔ | ✔ | ✔ |
| Read the dashboard counters | ✘ (own money instead) | ✔ own shift | ✔ system-wide |
| Send an interbank deposit | ✔ own source only | ✘ | ✘ |
| List/read interbank sends | ✔ own only | ✔ all | ✔ all |
| Read/update provider simulation | ✘ | ✘ | ✔ |
| Record identity/KYC verdict | ✘ | ✔ | ✔ |

The nine rows below the audit line were added after the Claude Design prototype
was implemented in full. Six of them close TD-027, TD-033, TD-035, TD-037 and
TD-041, which existed precisely because these operations were being enforced
against a rule that had never been written down. Three are new operations.

Two are worth reading twice.

**"Change own password" is `own only` for every role, an administrator
included** — and it is the only row in this table where staff have *less* reach
than they do elsewhere. Editing a customer's address is a service a teller
performs for somebody in front of them; replacing their credential is taking the
account. Staff helping somebody locked out use the recovery flow, whose link
goes to that customer's own inbox.

**"Read own notifications" is `own only` for every role too**, and it does not
contradict the audit row above it. Those are two different things over one
table: the audit row is the operational console, which carries the simulated
recipient of every delivery in the system; this is a person's inbox. An
administrator has both, and gets their own inbox from the second.

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
- May not read an access credential. Stored credential hashes never leave Customer; plaintext input travels only in the commands needed to authenticate or replace a credential,
  regardless of who is asking.

## What is deliberately not modelled

**Cash operations.** The implemented deposit window lets CAJERO_RECEPTOR and ADMINISTRADOR record a deposit; Account owns the credit. Cash withdrawal remains absent. The added deposit is already listed in the matrix; this revision does not add a withdrawal use case.

**Bank and monitoring actors.** A participating bank uses its API key on `/interbank/v1` and sees only operations it participates in. It is not a fourth customer role. The Grafana webhook uses its own secret and can submit an SLO notification, not order money movements. The official health endpoint is public.

**Endpoint-level authorization.** This document fixes the minimum the domain needs: who may
trigger which use case. How that is enforced — token scopes, guards, per-route rules — is
**T-15**, which consumes this matrix as its input.

> Corrected on 2026-08-24 (T-15). This line used to point at T-13, the sequence-diagram
> ticket. [ADR-010](../architecture/adr/ADR-010-authentication.md) was decided afterwards and
> assigns enforcement to the Gateway, which is T-15. The guards that implement this matrix
> live in `apps/gateway/src/interfaces/guards/`, and a test in `apps/web` fails if the
> frontend's copy of the matrix and the Gateway's ever disagree.

## Verification of scope (T-61)

The interbank send restriction is enforced by `@Roles('CLIENTE')` and Account ownership lookup; a foreign customer send returns 404 on detail as an unknown one does. Simulation is ADMINISTRADOR-only. These are current route/service rules, not broader permission implied by staff being able to read all accounts. The original D-06 approval history remains in README; this documentation records the implemented extensions.
