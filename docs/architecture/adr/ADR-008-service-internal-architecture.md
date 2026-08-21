# ADR-008: Structure every service with Clean Architecture

- **Status**: Proposed
- **Date**: 2026-08-15
- **Deciders**: Bank USAC team (approved in the `feature/T-03` pull request)
- **Assignment reference**: Not constrained by the assignment; team decision.

## Context

The assignment fixes what runs between services but says nothing about how a service is
organised inside. What it does grade is the *consequence* of that organisation: §8.2 criterion
1.2 rewards documentation "consistente con la implementación", and the critical observations
(p. 7) penalise "mezclar responsabilidades entre servicios" and "servicios god object".
Constitution principle I likewise forbids a service taking on a responsibility that belongs to
another.

Six applications need the same internal shape — the Gateway and five services — and the domain
model (T-02) already defines what belongs in each: entities with invariants, use cases, and the
commands and events each service handles. Without a stated internal structure, six applications
written by three people diverge, and the rule that a service must not depend on another's code
becomes a matter of vigilance rather than something checkable.

## Decision

Every service is structured with **Clean Architecture**, in four layers with dependencies
pointing inward:

| Layer | Holds |
| --- | --- |
| `interfaces` | Message consumers, asynchronous handlers, health endpoints |
| `application` | Use cases, workflow coordination, ports, transaction policies |
| `domain` | Entities, value objects, domain events, invariants, business rules |
| `infrastructure` | PostgreSQL repositories, RabbitMQ adapters, configuration, runtime wiring |

The `domain` layer imports no framework, no database driver and no broker client. The
`application` layer does not import `infrastructure`. No service imports another service's code.

**This is not a convention — it is executed by lint.** The rules live in
`apps/packages/tooling/eslint.base.mjs`, and `pnpm lint` fails on a cross-service import, a
framework import in `domain`, or an `infrastructure` import in `application`. If a rule blocks a
change, the design is wrong; an exception is not added to make lint pass.

The `domain` and `application` directories are currently empty by design — they hold a
`README.md` and nothing else — because the business logic arrives with **T-16 to T-20**.

## Alternatives considered

### NestJS default layering (controllers, services, modules)

The framework's own idiom: a module per feature, a controller for transport, a service for
logic. It is what NestJS documentation and generators produce.

**Rejected because**: nothing separates business rules from the framework, so entities end up
decorated with framework and ORM annotations and the invariants that protect money — a balance
that must not go negative, an amount with exactly two decimals — live in the same classes as
transport concerns. That makes a rule testable only by booting the framework, and it makes
"mezclar responsabilidades" (p. 7) easy to commit accidentally. It also cannot be enforced: there
is no import direction to check, so nothing detects the drift until review.

### A flat structure per service

One directory of files per service, organised by filename, with no layer boundaries.

**Rejected because**: at five services and twenty-two events it stops being navigable, and it
offers no boundary for lint to enforce. The concrete risk is the one the assignment names: a
service that quietly grows into a god object because nothing structural resists it.

### Hexagonal architecture (ports and adapters)

Very close in substance — an inner domain surrounded by adapters — and arguably a better fit for
a message-driven service, since consumers and repositories are symmetric adapters.

**Rejected because**: it is nearly the same decision under a different vocabulary, and the
repository already documents Clean Architecture's four layers in `ARCHITECTURE.md` with lint
rules written against those exact directory names. Renaming the layers now would mean rewriting
enforcement and documentation for a distinction with no practical effect here. The ports-and-
adapters idea is retained: `application` defines ports and `infrastructure` implements them.

## Consequences

**Easier.** Business rules are testable without a database, a broker or a running framework,
which is what makes the invariants in `docs/domain/entities.md` verifiable at all. Swapping an
adapter — a different repository, a different broker client — does not touch the domain. Six
applications share one shape, so a developer moving between services finds the same layout.
Because lint enforces the boundaries, an architectural violation fails CI instead of surviving
to the demonstration.

**Harder.** Considerably more files and indirection: a use case that would be three lines in a
NestJS service becomes a port, an adapter and a use case. Repeated five times, that is real
ceremony for a project of this size, and it is the accepted cost. The team must resist putting
logic in the layer that is easiest to reach.

**Obligations created.**

- **T-16 to T-20** fill `domain` and `application` for each service, and must keep `pnpm lint`
  passing without adding exceptions.
- The Gateway is bound by the same layering but holds **no domain rules** (constitution
  principle V); its `domain` layer stays empty on purpose.
