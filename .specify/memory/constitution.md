<!--
Sync Impact Report
- Version change: template -> 1.0.0
- Modified principles: none; the eight principles are ratified for the first time.
- Added sections: eight non-negotiable architecture principles and executable governance.
- Removed sections: unused template placeholder sections.
- Templates requiring updates: reviewed; no project-specific principle copy exists in the generic Spec Kit templates.
- Follow-up TODOs: none.
-->

# Bank USAC Constitution

## Core Principles

### I. Exactly Five Microservices

The system MUST contain exactly five microservices: Customer, Account,
Transaction, Payment, and Notification & Audit. Their responsibilities MUST be
clearly delimited. A plan is non-conforming if it introduces a sixth deployable
service, merges two of these services, or assigns a service a responsibility
that belongs to another service.

Source: project assignment section 4.2, page 8. The assignment penalizes
mixed responsibilities and god-object services (critical observations, page 7).

### II. One Database Per Service With No Cross-Access

Each microservice MUST own its own database and MUST NOT access another
service's database. A plan is non-conforming if services share a schema or
instance, a service queries another service's tables, or a query joins data
from two domains. Data owned by another service MUST arrive through events.

Source: mandatory design rules, page 7.

### III. Databases Outside The Cluster

Service databases MUST run outside the Kubernetes cluster, as Docker
containers or local services. A plan is non-conforming if a Kubernetes
manifest deploys a database engine inside the cluster.

Source: project assignment section 4.2, page 8, and section 4.3, page 14.

### IV. Asynchronous Service Communication Only

Communication between services MUST be completely asynchronous. There MUST be
no HTTP calls between services and no direct coupling. A plan is non-conforming
if a service exposes or consumes another service's HTTP endpoint, imports
another service's code, or blocks while waiting for a synchronous response.
Asynchronous request/reply over the broker is allowed.

Source: project assignment section 4.2, page 8, and mandatory design rules,
page 7. The assignment penalizes direct communication and unclear events
(critical observations, page 7).

### V. Gateway-Only Entry With No Business Logic

The API Gateway MUST be the only external entry point and MUST NOT contain
business logic. It may route, authenticate, and aggregate responses, but
domain decisions MUST remain in the owning service. A plan is non-conforming if
an external client reaches a service directly or if the Gateway makes a domain
decision.

Source: project assignment section 4.2, page 8; the no-business-logic rule is
also a recorded team decision.

### VI. Saga For Distributed Operations

Every operation that spans two or more services MUST use a Saga with defined
compensation steps. A plan is non-conforming if it uses a blocking distributed
transaction or leaves a distributed operation without compensation. The
recommended implementation style is choreography.

Source: expected patterns, page 7.

### VII. Local Kubernetes Deployment

The system MUST be deployed locally in a Kubernetes cluster using Docker
containers. Kubernetes orchestration is mandatory. A plan is non-conforming if
it runs services directly on the host, uses only Docker Compose, or targets a
remote cluster.

Source: project assignment section 4.2, page 8, and section 4.3, page 14.

### VIII. SRE From Design

Every service design MUST address idempotency, retries, error handling,
eventual consistency, and propagation of a `correlationId`. A plan is
non-conforming if it omits how these concerns are guaranteed for the service.
The project also requires SLI, SLO, and SLA definitions and diagrams that show
the design clearly.

Source: project assignment section 4.2, page 8, mandatory SRE considerations,
page 7, and deliverables in section 4.4.

## Governance

- This constitution governs every spec, plan, task list, implementation, and
  review in the repository. When another document conflicts with it, this
  constitution wins.
- The eight principles are derived from mandatory project requirements and are
  not optional team preferences. Their conformance checks are part of every
  future planning gate.
- An amendment MUST record its reason, date, and affected principle. Semantic
  versioning applies: MAJOR changes remove or redefine a principle, MINOR adds
  a principle or materially expands governance, and PATCH clarifies wording
  without changing the rule.
- Every future spec and plan MUST state a verdict for each applicable
  principle. A non-conforming verdict blocks implementation until the artifact
  is corrected or the complexity is explicitly justified.
- The architecture description in `ARCHITECTURE.md` MUST retain the same eight
  constraints. Changes to either materialization MUST update the other in the
  same change.

**Version**: 1.0.0 | **Ratified**: 2026-08-11 | **Last Amended**: 2026-08-11
