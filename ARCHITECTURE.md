# Bank USAC Architecture

## System

Bank USAC is a distributed banking system for Software Avanzado, Section B,
Group 2. The system has one API Gateway, a Nuxt frontend, RabbitMQ messaging,
and exactly five independently owned microservices. Service-to-service
communication is asynchronous, and each service owns one PostgreSQL database
outside Kubernetes, on host/Docker locally and Compute Engine VMs in GCP.

The architecture is designed for independent service ownership, eventual
consistency, and auditable distributed operations. The transfer flow uses a
Saga implemented through event choreography rather than a distributed
transaction.

## Services

| Service | Responsibility | Owned data |
| --- | --- | --- |
| Customer Service | Register customers, authenticate them, activate them by email, validate identity, and manage customer details. | Customer identity, document, contact, birth date, address, username, access credential, role, identity status, and email verification. |
| Account Service | Create accounts, expose balances, update balances, and deactivate inactive low-balance accounts. | Accounts, customer references, balances, account state, account type, and last activity. |
| Transaction Service | Coordinate the transfer Saga from account verdicts, and record history and state; it never decides funds. | Transaction id, source and target accounts, amount, status, idempotency key, and timestamps. |
| Payment Service | Process payment attempts, runtime simulation and interbank send/receive/reconciliation. | Payment id, transaction reference, payment status, attempt number, and failure reason. |
| Notification & Audit Service | Deliver notifications, persist redacted events and answer queries; ingest SLO alerts and never publish domain commands/events. | Event id, event type, timestamp, payload, correlation id, origin, and notification delivery state. |

The services exchange events and asynchronous request/reply messages through
RabbitMQ. No service reads another service's database. The API Gateway is the
only external entry point and does not make domain decisions.

The attribute-level ownership matrix, the entity states and invariants, the
actors, the business flows, and the command and event catalogue are the domain
model in [docs/domain/](docs/domain/README.md). This table is the summary; that
directory is the contract.

## Non-Negotiable Constraints

These constraints are the executable architecture contract in
[the project constitution](.specify/memory/constitution.md).

1. **Exactly five microservices.** Customer, Account, Transaction, Payment, and
   Notification & Audit are the only microservices. Mixing responsibilities or
   creating god-object services is prohibited. Source: assignment section 4.2,
   page 8, and critical observations, page 7.
2. **One database per service with no cross-access.** Every service owns a
   separate PostgreSQL database and no service queries another service's data.
   Source: mandatory design rules, page 7.
3. **Databases outside the cluster.** PostgreSQL instances run as Docker
   containers or local services outside Kubernetes. Source: assignment section
   4.2, page 8, and section 4.3, page 14.
4. **Asynchronous communication only.** Services communicate exclusively via
   RabbitMQ events or asynchronous request/reply. There are no HTTP calls or
   direct coupling between services. Source: assignment section 4.2, page 8,
   and mandatory design rules, page 7.
5. **Gateway-only entry point without business logic.** External clients enter
   through the API Gateway. It routes, authenticates, and aggregates, but does
   not own domain decisions. Source: assignment section 4.2, page 8, plus the
   team's recorded decision.
6. **Saga is mandatory.** Any operation spanning services has explicit
   compensation steps; choreography is the recommended style. Source: expected
   patterns, page 7.
7. **Local Kubernetes deployment.** Services and the Gateway are containerized
   with Docker and deployed to a local Kubernetes cluster using kind. Databases
   remain outside the cluster. The cluster is released through a Helm chart
   (`helm upgrade --install`), not by applying raw manifests by hand — Helm is
   listed as supporting material in the assignment and keeps the release
   reproducible and versioned. Source: assignment sections 4.2 and 4.3, pages
   8 and 14.
8. **SRE from design.** Each service addresses idempotency, retries, error
   handling, eventual consistency, and `correlationId` propagation. SLI, SLO,
   and SLA definitions are required deliverables. Source: assignment section
   4.2, page 8, SRE considerations, page 7, and section 4.4.

The assignment also penalizes direct service communication, unclear events, and
missing domain models. Those failure modes are reviewed together with the
eight constraints.

## Stack

Every entry links to the decision record that justifies it, with the rejected
alternatives and the accepted trade-off.

- **Backend:** TypeScript with NestJS — [ADR-001](docs/architecture/adr/ADR-001-backend-stack.md).
- **Frontend:** Vue with Nuxt 4 and `@nuxt/ui` —
  [ADR-002](docs/architecture/adr/ADR-002-frontend-stack.md); the current web app
  verifies Nuxt 4.5.2, `@nuxt/ui` 4.10.0, Tailwind CSS 4.3.3, and TypeScript
  6.0.3.
- **Messaging:** RabbitMQ with event-driven communication and asynchronous
  request/reply — [ADR-004](docs/architecture/adr/ADR-004-message-broker.md).
- **Persistence:** one PostgreSQL database per service, outside the cluster —
  [ADR-005](docs/architecture/adr/ADR-005-persistence.md).
- **Runtime:** Docker containers —
  [ADR-006](docs/architecture/adr/ADR-006-containerization.md) — in a Kubernetes
  cluster, released through the banking Helm chart (`infra/k8s/helm/bank-usac`);
  observability is a separate release/chart (`bank-observability`).
  The **same chart** installs on a local kind cluster —
  [ADR-007](docs/architecture/adr/ADR-007-local-orchestration.md) — and on GKE.
- **Service structure:** Clean Architecture inside each service —
  [ADR-008](docs/architecture/adr/ADR-008-service-internal-architecture.md).
- **Distributed workflows:** Saga by choreography —
  [ADR-009](docs/architecture/adr/ADR-009-distributed-transactions.md).
- **Diagrams:** versioned PlantUML, Structurizr DSL and DBML sources and their
  reviewed image artifacts. The [ADR index](docs/architecture/adr/README.md)
  records the historical toolchain and its T-61 revision.
- **Cloud:** Google Cloud Platform —
  [ADR-014](docs/architecture/adr/ADR-014-cloud-provider.md).
- **CI/CD:** GitHub Actions, four workflows —
  [ADR-015](docs/architecture/adr/ADR-015-ci-cd-platform.md).
- **Infrastructure as code:** Terraform, one module: VPC, five Compute Engine
  VMs for the databases, a zonal GKE cluster and Cloud Run for the frontend —
  [ADR-016](docs/architecture/adr/ADR-016-cloud-infrastructure.md).

These choices are constrained by the technologies allowed in assignment section
4.3 (page 14) and section 4.2 (page 13). The complete record, with alternatives
and trade-offs side by side, is the
[decision matrix](docs/architecture/decision-matrix.md).

## Layering

Each service follows Clean Architecture:

- **Interface:** message consumers, asynchronous handlers, and external-facing
  adapters owned by the service.
- **Application:** use cases, workflow coordination, ports, and transaction
  policies.
- **Domain:** entities, value objects, domain events, invariants, and business
  rules.
- **Infrastructure:** PostgreSQL repositories, RabbitMQ adapters, external
  clients, configuration, and runtime wiring.
- **Observability:** structured logs, metrics, traces, and correlation context;
  observability must not change domain outcomes.

Dependencies point inward. The domain does not import frameworks, databases,
RabbitMQ clients, or other services.

## Dependency Rules

- A client reaches the system only through the API Gateway.
- The Gateway may route, authenticate, and aggregate; it must not implement
  Customer, Account, Transaction, Payment, or Notification & Audit rules. It
  issues and validates the session JWT and propagates the verified identity into
  the message envelope —
  [ADR-010](docs/architecture/adr/ADR-010-authentication.md).
- Services communicate through events and asynchronous request/reply only —
  [ADR-003](docs/architecture/adr/ADR-003-communication-model.md).
- A service may depend on its own domain, application, and infrastructure
  adapters, but not on another service's code or database.
- Services exchange versioned events and asynchronous request/reply messages
  through RabbitMQ. HTTP between services is forbidden.
- Database schemas are private to their owning service. Cross-service data is
  represented by events or explicitly copied read models, never by direct SQL.
- Distributed operations use Saga steps and compensations. A handler must be
  idempotent and preserve `correlationId` across the flow.
- Databases stay outside Kubernetes; banking workloads use kind locally and
  GKE in cloud. Cloud Run additionally serves the public frontend.
- External HTTP egress belongs to Payment (partner bank) and Notification
  (Resend), with the constraints in ADR-019 and the operation runbooks.
- Trace context crosses AMQP and external HTTP; telemetry never changes a
  domain outcome. Label/cardinality rules live in the telemetry catalogue.

## Current State

Documented against source and the cloud inventory on **2026-10-21**.
Production's seven banking deployments and optional partner mock use
`v1.3.6`; the public frontend is on Cloud Run. The
[production inventory](docs/qa/load/2026-10-21-gke-prod-inventory.txt) records
images, readiness, Services, HPA and PVC at capture time, not permanent health.

Phase III adds customer lifecycle and account anomaly telemetry, transfer
duration/error measurements, runtime payment simulation, four audit filters,
trace identifiers/links, and interbank send/receive/reconciliation. The Saga's
six states and its Phase II projection remain distinct from the interbank
states. TIMEOUT interbank keeps reservation during reconciliation; released
without verification is an operational exception that is surfaced.

The cluster is in `us-central1-c`, with dev, prod and observability namespaces.
Five private VMs host separate production and `_dev` databases. Compute,
cluster and quotas remain shared failure domains. Dev has no partner mock and
its partner URL is empty; a mock experiment is not ready merely because dev
pods are Ready.

Terraform declares VPC/subnets/NAT, VM databases, GKE, Artifact Registry,
reserved Gateway IP and Cloud Run. Helm owns the application and observability
releases; GitHub Actions deploys versioned images and updates Cloud Run.
Resource imports and applied state still need verification for an existing
installation; source presence alone does not establish management history.

Nine dashboards and sixteen alert rules link to seven runbooks. The stack is
OpenTelemetry → Collector → Prometheus/Tempo, and pod logs → log agent → Loki,
queried through Grafana. Grafana currently has a public LoadBalancer and an
independent login. See [CLOUD](docs/operations/CLOUD.md),
[telemetry](docs/sre/telemetry-catalog.md) and [SLO](docs/sre/sli-slo-sla.md).

**Known differences:** no NetworkPolicy objects were observed in the three
namespaces despite Dataplane V2 and source policies; RabbitMQ live was
3.13-management versus desired 4.3.4. HPA objects are installed, but a live
scaling event must be supported by load evidence. These are not cleared by
updating documentation; follow [TECH_DEBT](docs/TECH_DEBT.md).

## Commands

Run from the **repository root**, never from an application directory. Node
24.19.0 (`.nvmrc`) and pnpm 11.21.0 (`packageManager`) are enforced.

| Command | Purpose |
| --- | --- |
| `pnpm install` | Whole workspace, one lockfile |
| `pnpm build` | Shared packages first, then the seven applications |
| `pnpm lint` | Style **and** the executable architecture boundaries |
| `pnpm test` | Unit and configured integration tests; inspect omitted suites |
| `pnpm test:contract` | Contract tests over `@bank/contracts` |
| `pnpm format` | Formatting |
| `pnpm dev` | Local development |

Per application: `pnpm --filter <name> <command>` runs only that command.
`pnpm exec turbo run <task> --filter=<name>` also resolves the declared
dependency builds, so a fresh checkout has the shared `dist/` it needs.

Local and cloud deployment procedures are in
[DEPLOYMENT](docs/operations/DEPLOYMENT.md) and [CLOUD](docs/operations/CLOUD.md).
Applying raw manifests by hand is not a supported release path.

Two things worth knowing before claiming a check passed:

- **Lint enforces architecture.** The rules live in
  `apps/packages/tooling/eslint.base.mjs`. If one blocks a change, the design is
  wrong — an exception is not added to make it pass.
- **Web verification has two layers.** Node test runner checks pure functions
  and static assertions; Vitest/Nuxt test-utils checks real Nitro processes,
  SSR, guards, proxy and selected Phase III screens against controlled
  upstreams. Neither proves an E2E bank run or complete component coverage.
  See [FRONTEND](docs/FRONTEND.md#verification).

## Related Docs

- [docs/architecture/adr/](docs/architecture/adr/README.md) - the decision
  records: what was chosen, what was rejected, and why. ADR-014 to ADR-016 are the
  Phase II ones — cloud provider, CI/CD platform and cloud infrastructure.
- [docs/architecture/decision-matrix.md](docs/architecture/decision-matrix.md) -
  decisions, alternatives, trade-offs and consequences in one table.
- [README.md](README.md) - project identity and entry points.
- [docs/DESIGN.md](docs/DESIGN.md) - visual and interaction source of truth.
- [docs/OWNERSHIP.md](docs/OWNERSHIP.md) - primary component owners.
- [docs/METHODOLOGY.md](docs/METHODOLOGY.md) - milestones and delivery rules.
- [docs/PRODUCT_SENSE.md](docs/PRODUCT_SENSE.md) - users and banking workflows.
- [docs/FRONTEND.md](docs/FRONTEND.md) - verified frontend conventions.
- [docs/SECURITY.md](docs/SECURITY.md) - data classes and security boundary.
- [docs/RELIABILITY.md](docs/RELIABILITY.md) - SRE requirements and targets.
- [docs/DOC_INVENTORY.md](docs/DOC_INVENTORY.md) - documentation classification.
- [docs/TECH_DEBT.md](docs/TECH_DEBT.md) - open and closed debt.
- [docs/TECHNICAL_DOCUMENT.md](docs/TECHNICAL_DOCUMENT.md) - the consolidated
  deliverable, including Phase II and III.
- [docs/operations/CLOUD.md](docs/operations/CLOUD.md) - the GCP deployment
  procedure.
- [docs/operations/CI.md](docs/operations/CI.md) - the four CI/CD workflows.
