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
| [ADR-013](ADR-013-diagramming-toolchain-revision.md) | Require PlantUML alongside Mermaid; Lucid becomes optional | Superseded by ADR-022 | 2026-08-20 |
| [ADR-014](ADR-014-cloud-provider.md) | Deploy to Google Cloud Platform | Accepted | 2026-09-20 |
| [ADR-015](ADR-015-ci-cd-platform.md) | Run the pipeline on GitHub Actions, as four workflows | Accepted | 2026-09-12 |
| [ADR-016](ADR-016-cloud-infrastructure.md) | Provision the cloud with Terraform — GKE for the workloads, Compute Engine for the databases, Cloud Run for the frontend | Accepted | 2026-09-20 |
| [ADR-017](ADR-017-account-anomaly-reports-not-blocks.md) | An account anomaly is reported, not blocked — counted from the database, once per window | Accepted | 2026-10-04 |
| [ADR-018](ADR-018-observability-stack.md) | Collector, Prometheus, Tempo, Loki and Grafana in a chart of their own, with the subcharts vendored into the repository | Accepted | 2026-10-13 |
| [ADR-019](ADR-019-payment-http-egress.md) | No service calls another over HTTP; the two HTTP egresses that exist go to third parties, from one named file each | Accepted | 2026-10-15 |
| [ADR-020](ADR-020-slo-error-budgets.md) | SLO de 7 días, presupuestos y reglas desplegadas | Accepted | 2026-10-21 |
| [ADR-021](ADR-021-interbank-protocol-v1.md) | Contrato interbancario v1, reserva, timeout y reverso | Accepted | 2026-10-21 |
| [ADR-022](ADR-022-diagramming-sources-and-image-editing.md) | Fuentes y renders canónicos; alternativas del editor separadas | Partly superseded by ADR-024 | 2026-10-21 |
| [ADR-023](ADR-023-observability-evolution.md) | Collector, filelog, persistencia y webhook de alertas | Accepted | 2026-10-21 |
| [ADR-024](ADR-024-native-lucid-and-png-delivery.md) | UML nativo en Lucid, diagramas sólo PNG y ER como DBML | Accepted; export verification separate | 2026-10-22 |

The consolidated view — decision, rejected alternatives, accepted trade-off and consequence in
one table — is [`../decision-matrix.md`](../decision-matrix.md). It indexes these records; it
does not restate their reasoning.

## Estado de los registros

ADR-011 fue sustituido por ADR-013, y éste por ADR-022. La política gráfica de
ADR-022 fue sustituida parcialmente por ADR-024 a petición del solicitante;
no se reescribe el cuerpo histórico de la decisión. ADR-018 conserva su
decisión inicial; ADR-023 registra su evolución operativa sin reescribir la
historia. ADR-020 y ADR-021 documentan decisiones ya implementadas de Fase III;
su estado y evidencia están en cada registro. Una documentación actualizada no
equivale a aprobación de todos los riesgos o a cumplimiento de todos los SLO.
