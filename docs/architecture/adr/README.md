# Architecture Decision Records

The decisions that shape how Bank USAC is built and deployed, each with the alternatives that
were rejected and the technical reason for rejecting them.

Sixteen decisions. Ten were already made and scattered across `ARCHITECTURE.md`, the
constitution and the ticket board; what was missing was the written reasoning. The eleventh,
authentication, was decided on 2026-08-14. The twelfth, object storage for identity-document
photos, was decided on 2026-08-19 during T-05 and is the first record that does not come from
T-03. The thirteenth, decided on 2026-08-20, revises the eleventh: it requires PlantUML
alongside Mermaid and makes Lucid optional, superseding ADR-011.

**ADR-014, ADR-015 and ADR-016 are the Fase II decisions** — the cloud provider, the CI/CD
platform and the cloud infrastructure topology. They were taken and implemented between
2026-09-12 and 2026-09-20 and **written down on 2026-09-26**, when an audit against the Fase II
grading sheet found that the three things §8.2 asks to see justified with trade-offs had never
been recorded anywhere. Each carries a `Recorded` line saying so: the reasoning is the argument
the team actually made, checked against what the repository contains, not a decision taken
after the fact.

Source tickets: T-03 (ADR-001 … ADR-011), T-05 (ADR-012), the T-07 … T-14 diagram rework
(ADR-013), and T-32 plus the cloud provisioning work (ADR-014 … ADR-016). Assignments:
`docs/references/780_Proyecto_1_2S2026.pdf`, revision 2026-08-13, and
`docs/references/780_Proyecto_2_2S2026.pdf` for Fase II.

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
| [ADR-001](ADR-001-backend-stack.md) | Build the backend in TypeScript with NestJS | Accepted | 2026-08-15 |
| [ADR-002](ADR-002-frontend-stack.md) | Build the frontend in Vue with Nuxt 4 | Accepted | 2026-08-15 |
| [ADR-003](ADR-003-communication-model.md) | Communicate between services with events and asynchronous request/reply only | Accepted | 2026-08-15 |
| [ADR-004](ADR-004-message-broker.md) | Use RabbitMQ as the message broker | Accepted | 2026-08-15 |
| [ADR-005](ADR-005-persistence.md) | Give each service its own PostgreSQL database outside the cluster | Accepted | 2026-08-15 |
| [ADR-006](ADR-006-containerization.md) | Package every workload as a Docker container | Accepted | 2026-08-15 |
| [ADR-007](ADR-007-local-orchestration.md) | Run the local cluster on kind and release it with a Helm chart | Accepted | 2026-08-15 |
| [ADR-008](ADR-008-service-internal-architecture.md) | Structure every service with Clean Architecture | Accepted | 2026-08-15 |
| [ADR-009](ADR-009-distributed-transactions.md) | Implement the transfer as a Saga by choreography | Accepted | 2026-08-15 |
| [ADR-010](ADR-010-authentication.md) | Issue and validate the session JWT in the Gateway | Accepted | 2026-08-15 |
| [ADR-011](ADR-011-diagramming-toolchain.md) | Ship every diagram as a Lucid document and a Mermaid source | Superseded by ADR-013 | 2026-08-15 |
| [ADR-012](ADR-012-object-storage.md) | Carry identity-document photos through object storage, never inside a message | Accepted | 2026-08-19 |
| [ADR-013](ADR-013-diagramming-toolchain-revision.md) | Require PlantUML alongside Mermaid; Lucid becomes optional | Accepted | 2026-08-20 |
| [ADR-014](ADR-014-cloud-provider.md) | Deploy to Google Cloud Platform | Accepted | 2026-09-20 |
| [ADR-015](ADR-015-ci-cd-platform.md) | Run the pipeline on GitHub Actions, as four workflows | Accepted | 2026-09-12 |
| [ADR-016](ADR-016-cloud-infrastructure.md) | Provision the cloud with Terraform — GKE for the workloads, Compute Engine for the databases, Cloud Run for the frontend | Accepted | 2026-09-20 |
| [ADR-017](ADR-017-account-anomaly-reports-not-blocks.md) | An account anomaly is reported, not blocked — counted from the database, once per window | Accepted | 2026-10-04 |

The consolidated view — decision, rejected alternatives, accepted trade-off and consequence in
one table — is [`../decision-matrix.md`](../decision-matrix.md). It indexes these records; it
does not restate their reasoning.

## Approval

**Done.** Fifteen records are `Accepted` and ADR-011 is `Superseded` by ADR-013. The pull
requests that carried the approvals have all landed, and each decision has been implemented
since — which is the reason the statuses were corrected rather than left at `Proposed`: a
record marked "written, not yet approved" while the code it describes has been running for
weeks tells a reader the opposite of the truth. The same rule is what makes ADR-014 … ADR-016
`Accepted` on the day they were written: the infrastructure they describe has been serving
traffic since 2026-09-25.

- **ADR-001 … ADR-011** — the `feature/T-03` pull request, landed 2026-08-15. It is the
  recorded approval for both those decisions and the SLI/SLO/SLA definition in
  [`../../RELIABILITY.md`](../../RELIABILITY.md). ADR-011's acceptance carries forward to
  ADR-013, which replaces its decision.
- **ADR-012** — the `feature/T-05` pull request, landed 2026-08-20, together with the message
  contracts that depend on it.
- **ADR-013** — the T-07 … T-14 diagram rework, landed by 2026-08-27. All eight diagrams
  now ship the two agreeing sources it requires.
- **ADR-014 … ADR-016** — no single pull request approved them, because they were recorded
  after the work rather than before it. What stands in for an approval is the work itself,
  merged and running: `70e98dc` (the Terraform module and the HPA templates, 2026-09-20),
  `e0360b7` (the CI pipeline, 2026-09-12) and `2811e89` (the release and deployment workflows,
  2026-09-21). Their **Deciders** line names the team and their `Recorded` line names the date
  the reasoning was written, so nobody reads them as decisions taken on 2026-09-26.

Each record's **Deciders** line names the pull request that approved it, where one exists; the
`Date` field is still the date the decision was taken, not the date it was accepted or written.

**What "accepted" was checked against.** Each decision was compared with the repository before
its status was moved: seven NestJS-and-Nuxt applications (ADR-001, ADR-002); no HTTP call and
no cross-database read between services, with a `test/isolation.spec.ts` per service failing
the build if one appears (ADR-003, ADR-005, ADR-008); RabbitMQ as the only medium, with the
retry ladder and the error drain in `@bank/messaging` (ADR-004); five PostgreSQL instances and
the selectorless Services that reach them from outside the cluster (ADR-005, ADR-007); seven
Dockerfiles and a Helm chart installed on a real kind cluster (ADR-006, ADR-007); the
six-state machine and its compensation, exercised in all three Saga shapes by
`pnpm images:flow` (ADR-009); HS256 signed and verified only in the Gateway, one hour
(ADR-010); the photo reference — object key, content type, size, SHA-256 — travelling instead
of the bytes (ADR-012); and both a `.mmd` and a `.puml` source for each of the eight diagrams
(ADR-013).

The three Fase II records were checked the same way, against the deployment rather than the
source: a GKE cluster, five Compute Engine machines with no external address and a Cloud Run
service, all declared in `infra/terraform/gcp/` and all answering (ADR-014, ADR-016); four
workflows whose last runs are green, with the three phases reporting as three separate checks
(ADR-015); seven HPAs at `80%` and a production rolling update that logged 41 requests and zero
non-200 responses (ADR-016). The three resources ADR-016 admits Terraform does **not** own were
found by the same pass and are recorded as TD-079, TD-080 and TD-081 rather than glossed.
