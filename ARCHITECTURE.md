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

- **Backend:** TypeScript with NestJS.
- **Frontend:** Vue with Nuxt 4 and `@nuxt/ui`; the current web app verifies
  Nuxt 4.5.2, `@nuxt/ui` 4.10.0, Tailwind CSS 4.3.3, and TypeScript 6.0.3.
- **Messaging:** RabbitMQ with event-driven communication and asynchronous
  request/reply.
- **Persistence:** one PostgreSQL database per service, outside the cluster.
- **Runtime:** Docker containers in a local kind Kubernetes cluster, released
  through a single Helm chart (`infra/k8s/helm/bank-usac`).
- **Service structure:** Clean Architecture inside each service.
- **Distributed workflows:** Saga by choreography.

These choices come from the Bank USAC team decision record and the technologies
allowed by assignment section 4.3. No backend service has been implemented in
this repository yet.

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
  Customer, Account, Transaction, Payment, or Notification & Audit rules.
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

- The repository contains the documentation and Spec Kit foundation for Bank
  USAC.
- `apps/web/` is still the Nuxt starter surface; it has no Bank USAC screens,
  routes, backend, or business logic.
- The web dependency manifest contains only the currently justified frontend
  stack plus `@artmizu/nuxt-prometheus`, which is retained as pending debt for
  the observability ticket T-24.
- The backend services, Gateway, RabbitMQ topology, PostgreSQL databases,
  Docker images, the Kubernetes Helm chart, and Saga implementation are future
  work. They are not presented as existing here.

## Related Docs

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
