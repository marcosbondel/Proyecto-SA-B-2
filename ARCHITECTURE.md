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
  [ADR-006](docs/architecture/adr/ADR-006-containerization.md) — in a local kind
  Kubernetes cluster, released through a single Helm chart
  (`infra/k8s/helm/bank-usac`) —
  [ADR-007](docs/architecture/adr/ADR-007-local-orchestration.md).
- **Service structure:** Clean Architecture inside each service —
  [ADR-008](docs/architecture/adr/ADR-008-service-internal-architecture.md).
- **Distributed workflows:** Saga by choreography —
  [ADR-009](docs/architecture/adr/ADR-009-distributed-transactions.md).
- **Diagrams:** versioned Mermaid and PlantUML sources, with Lucid optional —
  [ADR-013](docs/architecture/adr/ADR-013-diagramming-toolchain-revision.md).

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

Verified against the workspace on 2026-08-15.

**What exists.** A pnpm workspace with every unit of code under `apps/`: the
Gateway (`apps/gateway`) and the frontend (`apps/web`) at the top level, the five
domain services under `apps/services/`, and `@bank/contracts`, `@bank/messaging`
and `@bank/tooling` under `apps/packages/`. Seven applications, all building,
linting and testing.

The contents are **scaffolding**: health and readiness endpoints, environment
validation at boot, the shared message envelope, and a broker adapter. The
`domain` and `application` layers of every service hold a `README.md` and nothing
else — they are empty **on purpose**, because the business logic arrives with
T-16 to T-20. The architecture boundaries are already executable: `pnpm lint`
fails on a cross-service import, a framework import in `domain`, or an
`infrastructure` import in `application`.

**What does not exist yet.** No business logic, no domain entity and no use case
in any service. `apps/web` has no Bank USAC screens or routes. The runtime
integration is still future work: `infra/docker/` contains the local Compose
stack for development, while `infra/k8s/` documents the intended Helm layout
without the final chart. The Docker images (T-21), the Saga implementation
(T-16 to T-20, T-23) and rendered exports for the newly added diagram sources
remain future work; the versioned diagram sources are now present.

The web dependency manifest carries `@artmizu/nuxt-prometheus`, retained as
pending debt for the observability ticket T-24 (TD-006).

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

- [docs/architecture/adr/](docs/architecture/adr/README.md) - the eleven decision
  records: what was chosen, what was rejected, and why.
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
