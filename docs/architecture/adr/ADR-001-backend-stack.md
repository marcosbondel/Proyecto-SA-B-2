# ADR-001: Build the backend in TypeScript with NestJS

- **Status**: Accepted
- **Date**: 2026-08-15
- **Deciders**: Bank USAC team (approved in the `feature/T-03` pull request)
- **Assignment reference**: §4.2 "Flexibilidad de diseño", page 13; §4.3 "Recursos y
  herramientas a utilizar", page 14 (revision 2026-08-13)

## Context

The assignment does not leave the backend stack open. It closes it to an explicit list, and the
2026-08-13 revision states it twice.

**Languages permitted** (§4.2, p. 13 — "Seleccionar el lenguaje de programación"), repeated in
the mandatory-resources table (§4.3, p. 14 — "Lenguaje: Java, TypeScript o Go"):

1. **Java**
2. **TypeScript**
3. **Go**

**Frameworks permitted** (§4.2, p. 13 — "Seleccionar frameworks"), repeated in the same table
(§4.3, p. 14 — "Framework: Spring Boot 4 o NestJS"):

1. **Spring Boot 4**
2. **NestJS**

Any choice outside these two lists is non-conforming regardless of its technical merit. The
lists are not a recommendation.

The Gateway and the five services must be written in one stack: seven applications with a
shared message envelope, shared lint rules and one CI path. The stack also has to carry the
architectural rules the constitution makes non-negotiable — asynchronous messaging only,
Clean Architecture inside each service, and a Gateway that routes and authenticates without
owning domain decisions.

## Decision

The backend is written in **TypeScript** on **NestJS**.

This covers the API Gateway (`apps/gateway`) and the five services under `apps/services/`. The
workspace pins NestJS 11.1.29 and TypeScript 6.0.3 through the pnpm catalog in
`pnpm-workspace.yaml`; the assignment constrains the framework, not its version.

The frontend is a separate decision — see [ADR-002](ADR-002-frontend-stack.md) — but sharing
TypeScript across both ends means one language, one type system and one toolchain across all
seven applications.

## Alternatives considered

### Java with Spring Boot 4

The other complete pairing the assignment allows, and a legitimate candidate: Spring Boot's
messaging, transaction and dependency-injection support is at least as mature as NestJS's, and
Spring's ecosystem for AMQP is excellent.

**Rejected because**: it would split the repository into two toolchains. The frontend must be
JavaScript or TypeScript regardless of this decision, so choosing Java means two languages, two
build systems, two dependency managers and two lint configurations for a team of three, plus a
JVM in every container image. The single-language monorepo lets the message envelope and its
types live in one shared package (`@bank/contracts`) that both the producer and the consumer
import — with Java, that contract would have to be duplicated and manually kept in sync across
the language boundary, which is exactly the drift the assignment penalises as "falta de eventos
claros" (p. 7).

### Go

Permitted as a language (§4.2 p. 13; §4.3 p. 14) and a strong fit for small concurrent
services.

**Rejected because**: the assignment's framework list contains **no Go framework** — only
Spring Boot 4 and NestJS. Choosing Go would mean either building the five services with no
framework at all, against a mandatory-resources table that lists "Framework" as
`Obligatorio`, or adopting a framework outside the permitted list. Both readings are
non-conforming, and the ambiguity itself is a delivery risk in a project graded against an
explicit rubric. This is a constraint of the assignment, not a judgement about Go.

## Consequences

**Easier.** One language across all seven applications and the three shared packages. The
message envelope is defined once in `@bank/contracts` and imported by every producer and
consumer, so a contract change is a compile error rather than a runtime surprise. NestJS
modules and providers map cleanly onto the Clean Architecture layers of
[ADR-008](ADR-008-service-internal-architecture.md), and its AMQP support fits the broker
chosen in [ADR-004](ADR-004-message-broker.md). Node images are small, which matters when six
workloads run on a local kind cluster ([ADR-007](ADR-007-local-orchestration.md)).

**Harder.** TypeScript's types are erased at runtime, so any message crossing the broker must
be validated explicitly on arrival — the compiler cannot help at the boundary. Numeric money
handling needs deliberate care: quetzal amounts carry exactly two decimals and are never
rounded (`docs/domain/entities.md`), and IEEE-754 doubles are the wrong representation for
that, so amounts need an integer or decimal representation chosen at implementation time.
Java's `BigDecimal` would have given this for free.

**Obligations created.**

- Every service and the Gateway validate inbound message payloads at the edge; the shape of
  those payloads is **T-05**.
- The money representation must be fixed when Account and Transaction Service are implemented
  (**T-16 to T-20**), and must satisfy the two-decimal invariant.
