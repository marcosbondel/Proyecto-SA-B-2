# ADR-009: Implement the transfer as a Saga by choreography

- **Status**: Accepted
- **Date**: 2026-08-15
- **Deciders**: Bank USAC team (approved in the `feature/T-03` pull request)
- **Assignment reference**: "Patrones esperados", page 7; §6 step 6, page 17; §8.1 requirements,
  page 20 (revision 2026-08-13)

## Context

The assignment makes the pattern mandatory and states a preference. "Patrones esperados" (p. 7)
lists **`Saga (obligatorio)`** and **`Choreography (recomendada)`**. §6 step 6 (p. 17) requires
the transfer to be designed as a Saga with a success path, failure handling and compensation
events. §8.1 (p. 20) grades "Implementación de Saga — se implementa un flujo distribuido basado
en Saga (coreografía)". Constitution principle VI restates it.

The reason it is mandatory is structural. A transfer spans Transaction, Account and Payment
Service, each owning a separate database ([ADR-005](ADR-005-persistence.md)) with no shared
transaction manager, and services communicate only asynchronously
([ADR-003](ADR-003-communication-model.md)). There is no way to make the debit and the credit
atomic across those boundaries, so the system needs a sequence of local transactions with
explicit compensation when a later step fails.

The flow itself is **already designed**: `docs/domain/use-cases.md` (T-02) defines the seven
steps, the failure paths and the two compensation routes, and `docs/domain/message-catalog.md`
names the commands and events. This ADR records the *pattern decision*; it does not restate the
flow.

One distinction from that model matters enough to name here: a failure **before** money moves
ends the transfer as `FAILED`, while a failure **after** the debit ends it as `COMPENSATED` —
money left and came back. Audit must be able to tell the two apart.

## Decision

Every operation spanning two or more services is a **Saga with explicit compensation steps**,
implemented by **choreography**: each service reacts to the previous event and publishes the
next, with no central coordinator.

Transaction Service owns the transfer's *state* — it records whether the transfer is pending,
completed, failed or compensated — but it does not command the sequence from a central
controller. Owning state is not orchestration.

Every step is idempotent, and a redelivered message produces one financial effect, never two.
`correlationId` is propagated across every message in the flow so the whole Saga is traceable
end to end.

## Alternatives considered

### Saga by orchestration

A dedicated coordinator drives the sequence, calling each participant and deciding the next step.
It is easier to read: the flow lives in one place instead of being distributed across event
handlers.

**Rejected because**: the assignment recommends choreography (p. 7) and §8.1 (p. 20) names
choreography explicitly in the graded requirement. Beyond that, a coordinator that knows every
participant, every step and every compensation is the "god object" the critical observations
penalise (p. 7) — it concentrates knowledge that the five-service split exists to distribute,
and every new step means changing the coordinator rather than adding a subscriber. The honest
cost of rejecting it is recorded below.

### A distributed transaction (two-phase commit)

The classic answer to atomicity across resources: a coordinator holds a prepare phase across all
participants and then commits.

**Rejected because**: it is technically impossible here and forbidden besides. The services own
separate PostgreSQL databases with no shared transaction manager and communicate asynchronously
over a broker, so there is no participant set to coordinate. 2PC also blocks — participants hold
locks while waiting for the coordinator's decision — which is unacceptable on account balances
and would make availability the product of every participant's availability. Constitution
principle VI forbids a blocking distributed transaction outright.

### Accepting eventual inconsistency with no compensation

Let a failed step simply fail, and reconcile later by hand or by a batch job.

**Rejected because**: it leaves money debited from a source account with no credit and no
reversal, which is a correctness defect rather than a degradation. It also violates constitution
principle VI, which requires compensation for every distributed operation, and it would make
SLO-4 (100 % of post-debit failures end in compensation or an explicit pending state)
unsatisfiable by construction.

## Consequences

**Easier.** No single point of failure and no coordinator to keep available. Adding a consumer
that reacts to a transfer event — audit, notification — requires no change to the services
already in the flow. Each service stays autonomous, which is exactly what the rubric evaluates.
Because every step is a local transaction, each one is individually testable.

**Harder.** The flow is not visible in any one file: understanding a transfer means reading
event handlers across three services plus the message catalogue, which is the real cost of
rejecting orchestration and the reason the sequence diagram of **T-13** matters so much.
Debugging depends entirely on `correlationId` propagation. Compensation logic is genuinely hard
to get right — a compensation that itself fails needs an explicit pending state rather than a
silent retry loop — and the system is eventually consistent, so a balance can be briefly
mid-flow.

**Obligations created.**

- **T-05** defines the payloads of the Saga's commands, events and compensation events.
- **T-13** draws the transfer sequence diagram, which is the readable view this pattern
  sacrifices.
- **T-16 to T-20** implement idempotent handlers; a duplicate command must produce exactly one
  financial effect (SLO-3).
- **T-23** validates the failure paths and the compensation routes, not just the happy path.
- **T-24** measures Saga duration (SLI-3) and the completion rate (SLI-2).
