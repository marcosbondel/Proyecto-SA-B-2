# Architecture Decision Records

The decisions that shape how Bank USAC is built and deployed, each with the alternatives that
were rejected and the technical reason for rejecting them.

Thirteen decisions. Ten were already made and scattered across `ARCHITECTURE.md`, the
constitution and the ticket board; what was missing was the written reasoning. The eleventh,
authentication, was decided on 2026-08-14. The twelfth, object storage for identity-document
photos, was decided on 2026-08-19 during T-05 and is the first record that does not come from
T-03. The thirteenth, decided on 2026-08-20, revises the eleventh: it requires PlantUML
alongside Mermaid and makes Lucid optional, superseding ADR-011.

Source tickets: T-03 (ADR-001 … ADR-011), T-05 (ADR-012), and the T-07 … T-14 diagram rework
(ADR-013). Assignment: `docs/references/780_Proyecto_1_2S2026.pdf`, revision 2026-08-13.

## Governance

**These decisions are design constraints for every later specification.** No later spec may
re-open the stack or introduce an exception to it. Changing an approved decision requires a
**new ADR** that marks the previous one as `Superseded` — never a silent edit of the original.
A superseded ADR keeps its original text; only the `Superseded by` field is added.

When an ADR and the [project constitution](../../../.specify/memory/constitution.md) disagree,
the constitution wins and the ADR is blocked until corrected.

### Status vocabulary

| Status | Meaning |
| --- | --- |
| `Proposed` | Written, not yet approved by the team |
| `Accepted` | Approved and currently binding |
| `Superseded` | Replaced by a later ADR. Terminal — the text is never rewritten |

Legal transitions: `Proposed → Accepted → Superseded`. An accepted decision never returns to
`Proposed`; it is replaced.

## Format

Every ADR carries the same sections, so the set can be audited as a whole:

- **Status**, **Date**, **Deciders**
- **Assignment reference** — section *and page* of the 2026-08-13 revision, or the explicit
  statement `Not constrained by the assignment; team decision.`
- **Context** — what forces the decision
- **Decision** — what is decided, in the present tense
- **Alternatives considered** — at least one, each with a `Rejected because` grounded in a
  technical criterion: local operational cost, support for a pattern the design needs, a cited
  assignment constraint or penalty, or a concrete delivery risk. Familiarity with a technology
  may appear as context; it is never the rejection reason.
- **Consequences** — what becomes easier, what becomes harder, and which other ticket is left
  obliged.

## Index

| ADR | Decision | Status | Date |
| --- | --- | --- | --- |
| [ADR-001](ADR-001-backend-stack.md) | Build the backend in TypeScript with NestJS | Proposed | 2026-08-15 |
| [ADR-002](ADR-002-frontend-stack.md) | Build the frontend in Vue with Nuxt 4 | Proposed | 2026-08-15 |
| [ADR-003](ADR-003-communication-model.md) | Communicate between services with events and asynchronous request/reply only | Proposed | 2026-08-15 |
| [ADR-004](ADR-004-message-broker.md) | Use RabbitMQ as the message broker | Proposed | 2026-08-15 |
| [ADR-005](ADR-005-persistence.md) | Give each service its own PostgreSQL database outside the cluster | Proposed | 2026-08-15 |
| [ADR-006](ADR-006-containerization.md) | Package every workload as a Docker container | Proposed | 2026-08-15 |
| [ADR-007](ADR-007-local-orchestration.md) | Run the local cluster on kind and release it with a Helm chart | Proposed | 2026-08-15 |
| [ADR-008](ADR-008-service-internal-architecture.md) | Structure every service with Clean Architecture | Proposed | 2026-08-15 |
| [ADR-009](ADR-009-distributed-transactions.md) | Implement the transfer as a Saga by choreography | Proposed | 2026-08-15 |
| [ADR-010](ADR-010-authentication.md) | Issue and validate the session JWT in the Gateway | Proposed | 2026-08-15 |
| [ADR-011](ADR-011-diagramming-toolchain.md) | Ship every diagram as a Lucid document and a Mermaid source | Superseded by ADR-013 | 2026-08-15 |
| [ADR-012](ADR-012-object-storage.md) | Carry identity-document photos through object storage, never inside a message | Proposed | 2026-08-19 |
| [ADR-013](ADR-013-diagramming-toolchain-revision.md) | Require PlantUML alongside Mermaid; Lucid becomes optional | Proposed | 2026-08-20 |

The consolidated view — decision, rejected alternatives, accepted trade-off and consequence in
one table — is [`../decision-matrix.md`](../decision-matrix.md). It indexes these records; it
does not restate their reasoning.

## Approval

> **Pending.** ADR-001 … ADR-010 and ADR-012 are `Proposed`; ADR-011 is `Superseded` by
> ADR-013; ADR-013 is `Proposed`. They are approved by three different pull requests.
>
> ADR-001 … ADR-011 become `Accepted` with the `feature/T-03` pull request, which is the
> recorded approval for both those decisions and the SLI/SLO/SLA definition in
> [`../../RELIABILITY.md`](../../RELIABILITY.md). ADR-011's acceptance carries forward to
> ADR-013, which replaces its decision.
>
> ADR-012 becomes `Accepted` with the `feature/T-05` pull request, together with the message
> contracts that depend on it.
>
> ADR-013 becomes `Accepted` with the pull request that lands the T-07 … T-14 diagram rework.
>
> Approved by: _pending_ · Date: _pending_
