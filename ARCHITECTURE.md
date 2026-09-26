# Bank USAC Architecture

## System

Bank USAC is a distributed banking system for Software Avanzado, Section B,
Group 2. The system has one API Gateway, a Nuxt frontend, RabbitMQ messaging,
and exactly five independently owned microservices. Service-to-service
communication is asynchronous, and each service owns one PostgreSQL database
outside the local Kubernetes cluster.

The architecture is designed for independent service ownership, eventual
consistency, and auditable distributed operations. The transfer flow uses a
Saga implemented through event choreography rather than a distributed
transaction.

## Services

| Service | Responsibility | Owned data |
| --- | --- | --- |
| Customer Service | Register customers, authenticate them, activate them by email, validate identity, and manage customer details. | Customer identity, document, contact, birth date, address, username, access credential, role, identity status, and email verification. |
| Account Service | Create accounts, expose balances, update balances, and deactivate inactive low-balance accounts. | Accounts, customer references, balances, account state, account type, and last activity. |
| Transaction Service | Validate funds, coordinate transfers, and record transaction state. | Transaction id, source and target accounts, amount, status, idempotency key, and timestamps. |
| Payment Service | Process internal or external payments and validate payment operations. | Payment id, transaction reference, payment status, attempt number, and failure reason. |
| Notification & Audit Service | Publish notifications, record audit events, and provide distributed logging foundations. | Event id, event type, timestamp, payload, correlation id, origin, and notification delivery state. |

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
  cluster, released through a single Helm chart (`infra/k8s/helm/bank-usac`).
  The **same chart** installs on a local kind cluster —
  [ADR-007](docs/architecture/adr/ADR-007-local-orchestration.md) — and on GKE.
- **Service structure:** Clean Architecture inside each service —
  [ADR-008](docs/architecture/adr/ADR-008-service-internal-architecture.md).
- **Distributed workflows:** Saga by choreography —
  [ADR-009](docs/architecture/adr/ADR-009-distributed-transactions.md).
- **Diagrams:** versioned Mermaid and PlantUML sources, with Lucid optional —
  [ADR-013](docs/architecture/adr/ADR-013-diagramming-toolchain-revision.md).
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
- Databases stay outside Kubernetes; service and Gateway workloads run inside
  the local kind cluster.

## Current State

Verified against the workspace and the running deployment on 2026-09-26.

**The system is built and deployed.** All seven applications build, lint, typecheck
and test from a clean checkout, and the whole thing runs on Google Cloud Platform:
seven workloads in the GKE namespace `prod`, the frontend on Cloud Run, and the five
PostgreSQL databases on Compute Engine virtual machines outside the cluster.

- **The five domain services are implemented.** Customer, Account, Transaction,
  Payment and Notification & Audit each own a schema, their message handlers,
  idempotency enforced by a database constraint, and money as `NUMERIC(14,2)` that
  no float ever touches. The transfer's six-state machine is one pure function that
  refuses every transition outside the diagram.
- **The Gateway holds no business logic**, no database and no HTTP client towards
  any internal service — and a test asserts all three rather than asking to be
  believed. Two routes compose replies; none computes anything.
- **`apps/web` implements the whole prototype**, thirty-four screens, mapped route
  by route in [docs/FRONTEND.md](docs/FRONTEND.md).
- **The Saga runs end to end in all three shapes** — completed, compensated on the
  first refusal, and compensated after climbing the retry ladder — each asserted by
  `pnpm images:flow` as a fact about the money rather than a status somebody wrote
  down.
- **Phase II's five extensions are in** and integrated into the transfer flow in
  this order: KYC gate → account-type rule with its commission → history → external
  payment with its ladder → classified notification. Detail in
  [docs/TECHNICAL_DOCUMENT.md §12](docs/TECHNICAL_DOCUMENT.md#12-fase-ii--extensión-funcional-por-microservicio).
- **The pipeline is four GitHub Actions workflows**: Build / Test / Validación as
  three chained jobs, a reusable path filter, a release phase that publishes seven
  versioned images, and a deployment that rolls out to `dev` on `develop` and to
  `prod` on `main` — never building an image in production, never tagging `latest`,
  and rolling itself back when a deploy does not reach `Ready`.
  See [docs/operations/CI.md](docs/operations/CI.md).
- **The infrastructure is Terraform**, one module in `infra/terraform/gcp/`. See
  [docs/operations/CLOUD.md](docs/operations/CLOUD.md) for the procedure.

**What is not finished.** Three cloud resources are still created by hand — the
Artifact Registry repository, the Gateway's public `LoadBalancer` and the Cloud Run
revision that serves the frontend (TD-079, TD-080, TD-081) — and `dev` and `prod`
share the five databases, so environment isolation today covers compute and
messaging but not data (TD-070). The open correctness debts worth knowing before
touching the affected code are TD-074 (account opening has no KYC gate at the API),
TD-076 (the broker's retry path can kill a service process) and TD-078 (the Gateway
reports a registration timeout as `202`). All of them, with their proposed fixes,
are in [docs/TECH_DEBT.md](docs/TECH_DEBT.md).

The web dependency manifest carries `@artmizu/nuxt-prometheus`, retained as pending
debt for the observability ticket T-24 (TD-006).

## Commands

Run from the **repository root**, never from an application directory. Node
24.19.0 (`.nvmrc`) and pnpm 11.21.0 (`packageManager`) are enforced.

| Command | Purpose |
| --- | --- |
| `pnpm install` | Whole workspace, one lockfile |
| `pnpm build` | Shared packages first, then the seven applications |
| `pnpm lint` | Style **and** the executable architecture boundaries |
| `pnpm test` | Unit tests everywhere |
| `pnpm test:contract` | Contract tests over `@bank/contracts` |
| `pnpm format` | Formatting |
| `pnpm dev` | Local development |

Per application: `pnpm --filter <name> <command>`. In a fresh clone `pnpm build`
must precede testing a single application, because the shared packages are
consumed from `dist/`.

Deployment commands arrive with the tickets that create what they deploy:
`docker build` per workload in T-21, and `helm upgrade --install` against the
kind cluster in T-22 ([ADR-007](docs/architecture/adr/ADR-007-local-orchestration.md)).
Applying raw manifests by hand is not a supported path.

Two things worth knowing before claiming a check passed:

- **Lint enforces architecture.** The rules live in
  `apps/packages/tooling/eslint.base.mjs`. If one blocks a change, the design is
  wrong — an exception is not added to make it pass.
- **`apps/web` has no component test framework.** Its `test` script is a single
  `node --test` smoke test, not a Vue suite (TD-010). No work in this repository
  may claim component coverage for the web app.

## Related Docs

- [docs/architecture/adr/](docs/architecture/adr/README.md) - the sixteen decision
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
  deliverable, with the Phase II sections.
- [docs/operations/CLOUD.md](docs/operations/CLOUD.md) - the GCP deployment
  procedure.
- [docs/operations/CI.md](docs/operations/CI.md) - the four CI/CD workflows.
