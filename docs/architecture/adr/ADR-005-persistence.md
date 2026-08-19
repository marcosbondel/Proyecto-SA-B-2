# ADR-005: Give each service its own PostgreSQL database outside the cluster

- **Status**: Proposed
- **Date**: 2026-08-15
- **Deciders**: Bank USAC team (approved in the `feature/T-03` pull request)
- **Assignment reference**: §4.2 "Restricciones arquitectónicas", page 13; §4.2 "Alcance del
  proyecto", page 8; §4.3 "Recursos y herramientas a utilizar", page 14; "Reglas de diseño
  obligatorias", page 7; §8.3 "Comentarios Generales", page 27 (revision 2026-08-13)

## Context

Persistence is the area where the assignment attaches the heaviest penalties in the entire
document, and the 2026-08-13 revision separated them into **two distinct rules**:

| Rule | Penalty | Source |
| --- | --- | --- |
| Using a single shared database | **100 %** of the grade | §8.3, p. 27 — "Uso de una sola base de datos compartida" |
| A microservice connected to multiple databases (antipattern) | **50 %** of the grade | §4.2, p. 13 — "No se permite antipatrones de microservicios. Tales como microservicios conectados a múltiples bases de datos" |

They are different failures. The first is one database serving everyone. The second is one
service reaching into databases that are not its own — §4.2 (p. 13) spells it out: "ningún
microservicio puede consultar bases de datos que no sean la correspondiente". A design can
avoid one and still commit the other, so both must be checked independently.

Two further constraints are fixed: each microservice must own its database (p. 7, §4.2 p. 13),
and databases must live **outside** the Kubernetes cluster, as Docker containers or local
services (§4.2 p. 8; §4.3 p. 14 — "Base de datos: Externa al cluster").

The domain adds a requirement the engine must satisfy. Money amounts are quetzales with exactly
two decimals and are never rounded, balances must not go negative on a debit, and the transfer
Saga depends on a debit being atomic and observable (`docs/domain/entities.md`,
`docs/domain/use-cases.md`).

## Decision

Every service owns **one PostgreSQL database**, isolated by its own database, its own
credentials and its own migrations. No service opens a connection to any database but its own.

The databases run **outside the Kubernetes cluster**, as Docker containers defined in
`infra/docker/` — the workspace already pins `postgres:18.4`.

Data owned by another service is never read with SQL. It arrives as an event and, where a local
copy is genuinely needed, is stored as an explicitly maintained read model owned by the
consuming service.

## Alternatives considered

### One shared database for all five services

The simplest thing to operate: one instance, one connection string, one migration history, and
joins across domains come for free.

**Rejected because**: it is the single most heavily penalised choice in the assignment —
**100 %** of the grade (§8.3, p. 27). Independently of the penalty, it destroys service
autonomy: a schema change becomes a cross-team negotiation, and any service can silently depend
on another's table, which is the coupling the whole architecture exists to prevent.

### One instance with a schema per service

A common middle ground: separate schemas provide namespacing while keeping one engine to run.

**Rejected because**: it is a shared database wearing a different name. The services share a
connection endpoint, a credential surface and a failure domain, and nothing but convention stops
a query from crossing schemas — which would be the **50 %** antipattern (§4.2, p. 13) with no
mechanism to detect it. Separate databases with separate credentials make the boundary
enforceable rather than aspirational.

### A different engine per service, chosen per domain

Polyglot persistence — for instance a document store for audit events and a relational database
for balances.

**Rejected because**: it multiplies the operational surface of a local demonstration by the
number of engines, for a benefit no service in this domain actually needs. It also weakens the
strongest reason to choose PostgreSQL: demonstrating balance consistency is far easier when
every money-moving service offers the same transactional and locking semantics.

### Databases inside the Kubernetes cluster

Deploy PostgreSQL as a StatefulSet so the whole system comes up with one release.

**Rejected because**: it is explicitly forbidden — §4.2 (p. 8) requires "bases de datos
externas al cluster (contenedores Docker o servicios locales)" and §4.3 (p. 14) repeats "Base de
datos: Externa al cluster". Constitution principle III restates it.

## Consequences

**Easier.** Each service can migrate its schema without coordinating with anyone. Transactions
and row-level locking make the debit path — check balance, subtract, record — demonstrably
correct, which is what SLI-6 (functional consistency) compares against. The isolation is
enforced by credentials, not by discipline, so the 50 % antipattern is structurally hard to
commit. Databases surviving outside the cluster means `kind delete cluster` does not destroy the
data, which shortens the demonstration loop.

**Harder.** More instances to run and back up, and **no query may join across domains** — any
view that spans services must be assembled from events or by the Gateway aggregating separate
answers. Cross-service consistency is eventual, and reconciling it is the application's job.
Pods must reach a database outside the cluster, which is a networking concern that does not
exist when everything runs in one namespace; the mechanism is fixed in
[ADR-007](ADR-007-local-orchestration.md).

**Obligations created.**

- **T-06** writes the Compose stack: one PostgreSQL container per service, each with its own
  database and credentials, plus the broker.
- **T-16 to T-20** own their migrations; no service ships a migration touching another's
  database.
- The money representation must preserve exactly two decimals without rounding
  (see [ADR-001](ADR-001-backend-stack.md)).
- **T-22** must document how pods resolve and reach these external databases.
