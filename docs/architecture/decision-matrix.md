# Decision Matrix

Every technology and architecture decision in one view: what was chosen, what was rejected, the
cost accepted, and what it obliges. This table **indexes** the records in [`adr/`](adr/README.md);
the full reasoning lives in each ADR and is deliberately not repeated here, so the two can never
disagree.

Assignment references are to `docs/references/780_Proyecto_1_2S2026.pdf`, revision 2026-08-13.

## The eleven decisions

| Decision | ADR | Chosen | Rejected alternatives | Accepted trade-off | Operational consequence | Assignment rule |
| --- | --- | --- | --- | --- | --- | --- |
| Backend stack | [ADR-001](adr/ADR-001-backend-stack.md) | TypeScript + NestJS | Java + Spring Boot 4; Go (permitted language, but no permitted framework) | Types erase at runtime, so message boundaries need explicit validation; money needs a deliberate non-float representation | One language across seven apps; the envelope is shared through `@bank/contracts` | §4.2 p. 13; §4.3 p. 14 |
| Frontend stack | [ADR-002](adr/ADR-002-frontend-stack.md) | Vue + Nuxt 4 | React/Next; Angular; server-rendered from the Gateway | No component test framework in `apps/web` (TD-010) | Frontend correctness rests on review, not automated component coverage | Not constrained |
| Communication model | [ADR-003](adr/ADR-003-communication-model.md) | Events + async request/reply; never HTTP between services | Synchronous HTTP; hybrid with HTTP reads; pure pub/sub with no reply | Eventual consistency; debugging spans services; nothing fails fast | Every consumer must be idempotent and propagate `correlationId` | §4.2 pp. 8 and 13; p. 7; §6 step 3 p. 17 |
| Message broker | [ADR-004](adr/ADR-004-message-broker.md) | RabbitMQ | Kafka; NATS; gRPC async | **Less historical streaming and no replay from origin**; weaker horizontal scaling | Queues, ack, retries and DLQ are native, so SLI-5 is measurable from broker state | §4.2 p. 8; §4.3 p. 14 |
| Persistence | [ADR-005](adr/ADR-005-persistence.md) | PostgreSQL, one database per service, outside the cluster | Shared database; schema per service in one instance; polyglot engines; databases inside the cluster | **More instances to run, and no query may join across domains** | Isolation enforced by credentials, not discipline; transactions make balance consistency demonstrable | §4.2 pp. 8 and 13; §4.3 p. 14; §8.3 p. 27 |
| Containerization | [ADR-006](adr/ADR-006-containerization.md) | Docker | Podman; running apps on the host | pnpm workspace images must stage built shared packages; rebuild-and-load on every change | One artefact format for six workloads plus infrastructure containers | §4.3 p. 14; §8.1 p. 20 |
| Local orchestration | [ADR-007](adr/ADR-007-local-orchestration.md) | kind + one Helm chart | minikube; k3d; raw `kubectl apply`; databases inside the cluster | **Less production-like; pods must reach databases outside the cluster** | `helm upgrade --install` is one reproducible command; databases survive `kind delete cluster` | §4.2 p. 8; §4.3 p. 14; §8.3 p. 27 |
| Service internal architecture | [ADR-008](adr/ADR-008-service-internal-architecture.md) | Clean Architecture, four layers | NestJS default MVC layering; flat structure; hexagonal (same idea, different vocabulary) | **More files and indirection across five services** | Boundaries are executable: `pnpm lint` fails on a cross-layer or cross-service import | Not constrained (p. 7 penalises the failure mode) |
| Distributed transactions | [ADR-009](adr/ADR-009-distributed-transactions.md) | Saga by choreography | Orchestration; 2PC; no compensation | **The flow is not visible in one file**; compensation is hard to get right | Every step idempotent; `FAILED` and `COMPENSATED` are distinguishable states | p. 7; §6 step 6 p. 17; §8.1 p. 20 |
| Authentication | [ADR-010](adr/ADR-010-authentication.md) | JWT issued and validated in the Gateway, HS256, 1 h | Customer Service as issuer; RS256; per-service validation; stateful sessions | **No revocation before expiry**; services trust identity rather than verifying it | Identity costs no database lookup; the secret lives in exactly one component | §4.1 p. 5 |
| Diagramming toolchain | [ADR-011](adr/ADR-011-diagramming-toolchain.md) | Lucid + Mermaid, two artefacts per diagram | PlantUML as a third format; Lucid only; Mermaid only | **Sixteen artefacts to keep in sync** | Architecture changes are reviewable in pull requests via the `.mmd` diff | Not constrained (§4.2 p. 13 fixes the properties, not the tool) |
| Large-payload transport | [ADR-012](adr/ADR-012-object-storage.md) | Identity-document photos travel through S3-compatible object storage (MinIO); messages carry only a reference and a SHA-256 | Base64 bytes inside the command; a database owned by the Gateway; an HTTP upload endpoint on Customer Service | **One more component to provision, plus a failure mode that did not exist: a reference to a missing object** | Every message payload stays under 64 KB, so retry and dead-letter behaviour are uniform across all 42 contracts | §4.1 p. 5 constrains the requirement, not the mechanism |

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
| Inconsistency between diagrams and code | 25 % | [ADR-011](adr/ADR-011-diagramming-toolchain.md) |

All five are listed in §8.3, page 27.

## What these decisions oblige, by ticket

| Ticket | Obligation | From |
| --- | --- | --- |
| **T-05** | Payloads, exchange and routing-key naming, serialization, retry policy; **and the verified-identity field in the envelope** | ADR-003, ADR-004, ADR-009, ADR-010 |
| **T-06** | Compose stack: one PostgreSQL per service plus RabbitMQ, on a network the kind nodes can join | ADR-004, ADR-005, ADR-007 |
| **T-07 … T-14** | Two agreeing artefacts per diagram, Lucid link registered | ADR-011 |
| **T-15** | Gateway contract and per-endpoint authorization, using the actor matrix as input | ADR-010 |
| **T-16 … T-20** | Idempotent handlers, own migrations, `pnpm lint` passing with no added exceptions | ADR-003, ADR-005, ADR-008, ADR-009 |
| **T-21** | Dockerfiles for the six application workloads, with no baked secrets | ADR-006 |
| **T-22** | Helm chart, and the documented mechanism for pods reaching external databases | ADR-005, ADR-007 |
| **T-23** | Validate failure paths and compensation routes, not only the happy path | ADR-009 |
| **T-24** | Measure the SLI defined in [`../RELIABILITY.md`](../RELIABILITY.md) | ADR-004, ADR-009 |

## Changing a decision

These decisions are design constraints for every later specification. A change requires a **new
ADR** that marks the previous one as `Superseded`; the superseded text is never rewritten. The
governance rule is in [`adr/README.md`](adr/README.md).
