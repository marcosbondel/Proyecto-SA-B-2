# Decision Matrix

Every technology and architecture decision in one view: what was chosen, what was rejected, the
cost accepted, and what it obliges. This table **indexes** the records in [`adr/`](adr/README.md);
the full reasoning lives in each ADR and is deliberately not repeated here, so the two can never
disagree.

Assignment references are to `docs/references/780_Proyecto_1_2S2026.pdf`, revision 2026-08-13,
for ADR-001 … ADR-013; to `docs/references/780_Proyecto_2_2S2026.pdf` (Fase II) for
ADR-014 … ADR-016 — the rows marked *(F2)*; and to
`docs/references/780_Proyecto_3_2S2026.pdf` (Fase III) for ADR-017 … ADR-019 — the rows marked
*(F3)*.

## The nineteen decisions

| Decision | ADR | Chosen | Rejected alternatives | Accepted trade-off | Operational consequence | Assignment rule |
| --- | --- | --- | --- | --- | --- | --- |
| Backend stack | [ADR-001](adr/ADR-001-backend-stack.md) | TypeScript + NestJS | Java + Spring Boot 4; Go (permitted language, but no permitted framework) | Types erase at runtime, so message boundaries need explicit validation; money needs a deliberate non-float representation | One language across seven apps; the envelope is shared through `@bank/contracts` | §4.2 p. 13; §4.3 p. 14 |
| Frontend stack | [ADR-002](adr/ADR-002-frontend-stack.md) | Vue + Nuxt 4 | React/Next; Angular; server-rendered from the Gateway | No component test framework in `apps/web` (TD-010) | No `.vue` file is covered by a test. Everything in the shell that *decides* something was pushed into `app/lib/` as a pure function so it could be tested anyway, and fifteen `node --test` suites cover it; the templates themselves rest on review | Not constrained |
| Communication model | [ADR-003](adr/ADR-003-communication-model.md) | Events + async request/reply; never HTTP between services | Synchronous HTTP; hybrid with HTTP reads; pure pub/sub with no reply | Eventual consistency; debugging spans services; nothing fails fast | Every consumer must be idempotent and propagate `correlationId` | §4.2 pp. 8 and 13; p. 7; §6 step 3 p. 17 |
| Message broker | [ADR-004](adr/ADR-004-message-broker.md) | RabbitMQ | Kafka; NATS; gRPC async | **Less historical streaming and no replay from origin**; weaker horizontal scaling | Queues, ack, retries and DLQ are native, so SLI-5 is measurable from broker state | §4.2 p. 8; §4.3 p. 14 |
| Persistence | [ADR-005](adr/ADR-005-persistence.md) | PostgreSQL, one database per service, outside the cluster | Shared database; schema per service in one instance; polyglot engines; databases inside the cluster | **More instances to run, and no query may join across domains** | Isolation enforced by credentials, not discipline; transactions make balance consistency demonstrable | §4.2 pp. 8 and 13; §4.3 p. 14; §8.3 p. 27 |
| Containerization | [ADR-006](adr/ADR-006-containerization.md) | Docker | Podman; running apps on the host | pnpm workspace images must stage built shared packages; rebuild-and-load on every change | One artefact format for seven workloads plus infrastructure containers — six at the time of the decision, plus the Nuxt frontend, which T-21 found needs one too | §4.3 p. 14; §8.1 p. 20 |
| Local orchestration | [ADR-007](adr/ADR-007-local-orchestration.md) | kind + one Helm chart | minikube; k3d; raw `kubectl apply`; databases inside the cluster | **Less production-like; pods must reach databases outside the cluster** | `helm upgrade --install` is one reproducible command; databases survive `kind delete cluster` | §4.2 p. 8; §4.3 p. 14; §8.3 p. 27 |
| Service internal architecture | [ADR-008](adr/ADR-008-service-internal-architecture.md) | Clean Architecture, four layers | NestJS default MVC layering; flat structure; hexagonal (same idea, different vocabulary) | **More files and indirection across five services** | Boundaries are executable: `pnpm lint` fails on a cross-layer or cross-service import | Not constrained (p. 7 penalises the failure mode) |
| Distributed transactions | [ADR-009](adr/ADR-009-distributed-transactions.md) | Saga by choreography | Orchestration; 2PC; no compensation | **The flow is not visible in one file**; compensation is hard to get right | Every step idempotent; `FAILED` and `COMPENSATED` are distinguishable states | p. 7; §6 step 6 p. 17; §8.1 p. 20 |
| Authentication | [ADR-010](adr/ADR-010-authentication.md) | JWT issued and validated in the Gateway, HS256, 1 h | Customer Service as issuer; RS256; per-service validation; stateful sessions | **No revocation before expiry**; services trust identity rather than verifying it | Identity costs no database lookup; the secret lives in exactly one component | §4.1 p. 5 |
| Diagramming toolchain (superseded) | [ADR-011](adr/ADR-011-diagramming-toolchain.md) | Lucid + Mermaid, two artefacts per diagram | PlantUML as a third format; Lucid only; Mermaid only | **Sixteen artefacts to keep in sync** | Architecture changes are reviewable in pull requests via the `.mmd` diff | Not constrained (§4.2 p. 13 fixes the properties, not the tool) |
| Large-payload transport | [ADR-012](adr/ADR-012-object-storage.md) | Identity-document photos travel through S3-compatible object storage (MinIO); messages carry only a reference and a SHA-256 | Base64 bytes inside the command; a database owned by the Gateway; an HTTP upload endpoint on Customer Service | **One more component to provision, plus a failure mode that did not exist: a reference to a missing object** | Every message payload stays under 64 KB, so retry and dead-letter behaviour are uniform across all 103 contracts in the catalogue | §4.1 p. 5 constrains the requirement, not the mechanism |
| Diagramming toolchain (current) | [ADR-013](adr/ADR-013-diagramming-toolchain-revision.md), supersedes ADR-011 | Mermaid + PlantUML required per diagram, Lucid optional | Lucid + PlantUML + Mermaid all required; PlantUML + Lucid without Mermaid; ADR-011's Lucid + Mermaid only | **Two required text sources to keep in sync, plus a PlantUML render toolchain (Java or a render server)** | Architecture changes are reviewable via both the `.mmd` and `.puml` diffs; PlantUML gives native UML use-case notation for the one diagram Mermaid can't express | Not constrained (§4.2 p. 13 fixes the properties, not the tool) |
| Cloud provider | [ADR-014](adr/ADR-014-cloud-provider.md) | Google Cloud Platform — GKE, Compute Engine, Cloud Run, Artifact Registry | AWS (EKS bills the control plane by the hour with no free-tier equivalent for the one zonal cluster deployed here); Azure (free AKS control plane, but Container Apps is not the service the statement names); splitting the system across two providers | **The organisation policy `constraints/iam.disableServiceAccountKeyCreation` rules out a downloadable CI key**, so the pipeline had to be built on Workload Identity Federation; a fixed credit balance caps the cluster at three nodes and puts both environments in it | The frontend gets a managed HTTPS origin for free, and the HPA needs no metrics-server install — it is a control-plane addon. Provider coupling is the Terraform module plus four repository variables; the chart, the images and the code are neutral | §4.3 p. 8 *(F2)*; §4.4 p. 9 *(F2)* |
| CI/CD platform | [ADR-015](adr/ADR-015-ci-cd-platform.md) | GitHub Actions, as four workflows (`ci`, `changes`, `release`, `cd`) | GitLab CI (would need the deliverable repository mirrored); Google Cloud Build (triggers live outside the repository, so *when* the pipeline runs stops being reviewable); Jenkins (a server to run and secure for four weeks) | **GitHub-hosted runners live outside the VPC**, so no workflow can reach a database VM — which is why TD-070's remedy waits on a person with IAP SSH | Build, Test and Validación are three jobs and therefore three checks, so "no phase was omitted" is visible rather than asserted; `needs` enforces the order and a matrix parallelises the seven images | §4.3 p. 8 *(F2)*; §4.1 pp. 6–8 *(F2)*; §8.3 p. 13 *(F2)* |
| Cloud infrastructure topology | [ADR-016](adr/ADR-016-cloud-infrastructure.md) | One Terraform module: VPC with two subnets, five Compute Engine VMs with no public IP, zonal GKE Standard (3 × e2-standard-2), Cloud Run, and **the same Helm chart as kind**, with `dev` and `prod` as two namespaces | Cloud SQL (better engineering, forbidden by §4.2); GKE Autopilot (no controllable ceiling on a fixed budget); RabbitMQ and MinIO on their own VMs; two clusters, one per environment; a second chart or a `values-cloud.yaml` | **Three resources are still created by hand** — the Artifact Registry repository, the Gateway's public LoadBalancer and the Cloud Run revision (TD-079 … TD-081) — and the two environments **share the five databases** (TD-070) | `terraform apply` produces the network, the provisioned machines and the cluster in one command; the chart never learned it was running somewhere else, so a change tested on kind deploys to GKE untranslated | §4.2 p. 8 *(F2)*; §4.3 pp. 8–9 *(F2)*; §4.1 pp. 7–8 *(F2)*; §8.3 p. 13 *(F2)* |
| An account anomaly is reported, not blocked | [ADR-017](adr/ADR-017-account-anomaly-reports-not-blocks.md) | More than N operations in a window emits `account.anomaly.detected.v1` and notifies; the operation **completes** | Blocking the account; rejecting the operation; a hold on the funds | **A real attack is not stopped** by this control — it is only recorded, so stopping it is a human decision made from the notification | Counted from the database and not from memory, so a restart cannot reset the window, and emitted **once per window** rather than once per operation | §4.1 *Monitoreo de actividad de cuentas* *(F3)* |
| Observability stack | [ADR-018](adr/ADR-018-observability-stack.md) | Collector (×2, gateway and log agent), Prometheus, Tempo, Loki and Grafana in **one chart of our own**, with the five subcharts vendored as `.tgz` | ELK (memory, a privileged DaemonSet for `vm.max_map_count`, and three components instead of one); Jaeger (its own UI, overlapping Grafana, and its own store); the community `kube-prometheus-stack` (brings an operator and CRDs for a three-node cluster) | **No node budget and one spare public IP**: the stack must fit in the three nodes that exist, and Grafana gets no public address — it is reached by `port-forward` | One `helm upgrade` from the pipeline, so §8.3's 25 % for a manually deployed stack cannot be charged; a repository outage upstream cannot fail a deploy, because the charts are in the repository | §4.2 *alcance obligatorio* and *Restricciones*; §4.3; §8.3 p. 13 *(F3)* |
| HTTP egress, and the rule it is an exception to | [ADR-019](adr/ADR-019-payment-http-egress.md) | **No service calls another service over HTTP.** The two egresses that exist go to third parties — the partner bank from `payment-service`, Resend from `notification-audit-service` — each from one named file, with the destination from configuration and `redirect: 'error'` | A new gateway service just for the egress (moves the exception instead of removing it, and splits the confirmation deadline across two processes); putting the egress in the Gateway (which has no `domain/` and no database, and a deposit waiting 30 s needs both); allowing HTTP for *reads* only | The count of calls is **pinned by hand** in `isolation.spec.ts` (`toHaveLength(2)`), so a third legitimate egress breaks the build on purpose; and the test checks the destination's **shape**, not its value — a wrong URL would still pass | Four services appear in one trace with no HTTP between them, because the W3C context travels in the AMQP properties; the `traceparent` crosses the one HTTP boundary in both directions, which is what gives a deposit the same `traceId` in both banks | §4.1 *Integración interbancaria*; §4.2; §8.3 *comunicación sincrónica entre microservicios* *(F3)* |

## The two database penalties are separate rules

The 2026-08-13 revision split what used to be documented as one rule. They are different
failures, and a design can avoid one while committing the other, so both are checked
independently.

| Rule | Penalty | Source | How [ADR-005](adr/ADR-005-persistence.md) avoids it |
| --- | --- | ---: | --- |
| A single shared database | **100 %** of the grade | §8.3, p. 27 — "Uso de una sola base de datos compartida" | One database *and* one credential per service |
| A microservice connected to multiple databases (antipattern) | **50 %** of the grade | §4.2, p. 13 — "microservicios conectados a múltiples bases de datos" | Each service opens a connection only to its own; foreign data arrives as events |

## Other penalties these decisions avoid

| Failure | Penalty | Decision that prevents it |
| --- | ---: | --- |
| Synchronous communication between microservices | 50 % | [ADR-003](adr/ADR-003-communication-model.md) |
| No real asynchrony | 50 % | [ADR-003](adr/ADR-003-communication-model.md), [ADR-004](adr/ADR-004-message-broker.md) |
| Disguised monolithic architecture | 100 % | [ADR-005](adr/ADR-005-persistence.md), [ADR-008](adr/ADR-008-service-internal-architecture.md) |
| No local Kubernetes deployment | 100 % | [ADR-006](adr/ADR-006-containerization.md), [ADR-007](adr/ADR-007-local-orchestration.md) |
| Inconsistency between diagrams and code | 25 % | [ADR-013](adr/ADR-013-diagramming-toolchain-revision.md) (supersedes ADR-011) |

All five are listed in §8.3, page 27, of the Fase I statement.

Fase II adds its own list (§8.3, page 13 of `780_Proyecto_2_2S2026.pdf`). These are the ones
these decisions bear on:

| Failure | Penalty | Decision that prevents it | Status |
| --- | ---: | --- | --- |
| No deploying the system on Kubernetes | 100 % | [ADR-016](adr/ADR-016-cloud-infrastructure.md) | Avoided — seven workloads in GKE, two namespaces |
| A non-functional CI/CD pipeline | 100 % | [ADR-015](adr/ADR-015-ci-cd-platform.md) | Avoided — four workflows, last runs green |
| Omitting a pipeline phase | 25 % | [ADR-015](adr/ADR-015-ci-cd-platform.md) | Avoided — three jobs chained by `needs` |
| Terraform not reproducible, or infrastructure created by hand | 50 % | [ADR-016](adr/ADR-016-cloud-infrastructure.md) | **Partly exposed** — three resources are still manual: TD-079, TD-080, TD-081 |
| A manual production deployment | 50 % | [ADR-015](adr/ADR-015-ci-cd-platform.md) | **Partly exposed** — the cluster is deployed by the pipeline, the Cloud Run frontend is not: TD-081 |
| Using unversioned (`latest`) images | 10 % | [ADR-015](adr/ADR-015-ci-cd-platform.md) | Avoided — `release.yml` tags `vX.Y.Z`, `cd.yml` tags `dev-<sha>`, and `helm-deploy.sh` refuses `latest` |
| Frontend on S3 or a service that is not allowed | 10 % | [ADR-014](adr/ADR-014-cloud-provider.md) | Avoided — Cloud Run, which §4.4 names |

## What these decisions oblige, by ticket

| Ticket | Obligation | From |
| --- | --- | --- |
| **T-05** | Payloads, exchange and routing-key naming, serialization, retry policy; **and the verified-identity field in the envelope** | ADR-003, ADR-004, ADR-009, ADR-010 |
| **T-06** | Compose stack: one PostgreSQL per service plus RabbitMQ, on a network the kind nodes can join | ADR-004, ADR-005, ADR-007 |
| **T-07 … T-14** | Agreeing Mermaid + PlantUML sources per diagram; Lucid document and link optional | ADR-013 |
| **T-15** | Gateway contract and per-endpoint authorization, using the actor matrix as input | ADR-010 |
| **T-16 … T-20** | Idempotent handlers, own migrations, `pnpm lint` passing with no added exceptions | ADR-003, ADR-005, ADR-008, ADR-009 |
| **T-21** | Dockerfiles for the application workloads, with no baked secrets — **discharged as seven images rather than the six ADR-006 anticipated** | ADR-006 |
| **T-22** | Helm chart, and the documented mechanism for pods reaching external databases | ADR-005, ADR-007 |
| **T-23** | Validate failure paths and compensation routes, not only the happy path | ADR-009 |
| **T-24** | Measure the SLI defined in [`../RELIABILITY.md`](../RELIABILITY.md) | ADR-004, ADR-009 |
| **T-32** | Build, Test and Validación as three chained jobs on a platform whose triggers live in the repository | ADR-015 |
| **T-33 … T-35** | Every cloud resource declared in `infra/terraform/gcp/`, or a debt row on the day it is created by hand | ADR-014, ADR-016 |

## Changing a decision

These decisions are design constraints for every later specification. A change requires a **new
ADR** that marks the previous one as `Superseded`; the superseded text is never rewritten. The
governance rule is in [`adr/README.md`](adr/README.md).
