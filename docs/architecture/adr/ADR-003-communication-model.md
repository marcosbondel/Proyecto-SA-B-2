# ADR-003: Communicate between services with events and asynchronous request/reply only

- **Status**: Proposed
- **Date**: 2026-08-15
- **Deciders**: Bank USAC team (approved in the `feature/T-03` pull request)
- **Assignment reference**: §4.2 "Alcance del proyecto", page 8; §4.2 "Restricciones
  arquitectónicas" and "Flexibilidad de diseño", page 13; "Reglas de diseño obligatorias",
  page 7; §6 step 3, page 17 (revision 2026-08-13)

## Context

The assignment does not treat the communication model as a preference. It states the rule four
separate times:

- §4.2 (p. 8): "Implementación de un modelo de comunicación **completamente asíncrono** entre
  microservicios".
- "Reglas de diseño obligatorias" (p. 7): "No existe: Llamadas HTTP entre servicios,
  Acoplamiento directo". Each service "se comunica solo por eventos".
- §4.2 "Restricciones arquitectónicas" (p. 13): "No se permite comunicación síncrona (HTTP u
  otros protocolos similares) entre microservicios".
- §8.3 (p. 27): synchronous communication between microservices costs **50 %** of the grade, and
  "falta de asincronía real" another **50 %**.

What the assignment *does* leave open is which asynchronous pattern to use. §4.2 "Flexibilidad
de diseño" (p. 13) permits asynchronous request/reply, publish/subscribe, event-driven
architecture, or a hybrid of them, and §6 step 3 (p. 17) requires the choice to be justified
"en términos de desacoplamiento y resiliencia".

The domain model (T-02) already shows what the system actually needs: thirteen commands with
exactly one handler each, and twenty-two events with one or more consumers
(`docs/domain/message-catalog.md`). Two of those commands — `customer.authenticate` and
`account.balance.query` — need an answer back to the caller, which is why "events only" is not
sufficient on its own.

## Decision

Services communicate through **domain events** for anything that has already happened, and
**asynchronous request/reply over the broker** for the two cases where the Gateway needs an
answer. There are **no HTTP calls between services**, and no service imports another service's
code or reads its database.

Health and readiness endpoints are HTTP, and that is not a violation: they are operational
probes for Kubernetes, not business communication between services.

Every message carries `correlationId`, `causationId` and `idempotencyKey` in a shared envelope
(`@bank/contracts`), so a distributed flow can be traced end to end and a redelivered message
can be recognised.

The distinction the model rests on:

- A **command** expresses an intention aimed at one service and has exactly one handler.
- An **event** narrates something that already happened and may have many consumers.

Asynchronous request/reply does not make the system synchronous. The caller does not hold a
connection open waiting for a service to answer; the reply arrives as another message.

## Alternatives considered

### Synchronous HTTP between services

The default in most tutorials, and the simplest thing to write: Transaction Service calls
Account Service and reads the answer from the response body.

**Rejected because**: it is explicitly forbidden by the assignment in four places and penalised
at **50 %** of the grade (§8.3, p. 27). Beyond the rule, it breaks the property the design
depends on: a synchronous chain makes the transfer only as available as its least available
participant, and a failure mid-chain leaves the caller holding a half-finished operation with
no compensation path — which is exactly what the Saga in
[ADR-009](ADR-009-distributed-transactions.md) exists to avoid.

### A hybrid model with occasional HTTP for queries

Events for state changes, but a direct HTTP call for read-only queries such as fetching a
balance — superficially harmless, since a query mutates nothing.

**Rejected because**: the assignment's prohibition is not scoped to writes; §4.2 (p. 13) bans
synchronous communication between microservices outright, and "falta de asincronía real"
(p. 27) is aimed precisely at designs that are asynchronous on paper and synchronous where it
matters. It also reintroduces the coupling the rule exists to prevent: an HTTP read means
Transaction Service must know Account Service's address, availability and response schema, and
must decide what to do when it times out.

### Pure publish/subscribe with no request/reply

Emit events only, never expect an answer; the Gateway would subscribe to a result event and
correlate it back to the waiting client.

**Rejected because**: it is achievable but it pushes correlation and timeout handling into the
Gateway for every read, and it turns two naturally request-shaped interactions —
authenticating a user and querying a balance — into multi-step conversations with no single
owner. The assignment explicitly permits asynchronous request/reply (§4.2, p. 13), so paying
that complexity buys nothing.

## Consequences

**Easier.** Services stay decoupled in time and in deployment: a consumer can be down when an
event is published and still process it on recovery, because the broker holds the message. Each
service can be developed, deployed and restarted independently. New consumers can subscribe to
an existing event without changing the producer, which is what keeps Notification & Audit from
becoming a dependency of everything it observes.

**Harder.** The system is eventually consistent, and every read-your-own-write expectation in
the UI must be designed for explicitly. Debugging spans several services, which is why
`correlationId` propagation is not optional. Every consumer must be idempotent, because at-least
once delivery means a message can arrive twice. Nothing fails fast: a message sent to a service
that never answers surfaces as a timeout in the caller's own logic, not as a connection error.

**Obligations created.**

- **T-05** defines the payload of every command and event, the exchange and routing-key naming,
  the serialization format and the broker retry policy. This ADR fixes *that* the conversation
  is asynchronous, not *how* each message is shaped.
- **T-05** also defines the verified-identity field that
  [ADR-010](ADR-010-authentication.md) requires in the envelope.
- Every consumer implemented in **T-16 to T-20** must be idempotent and must preserve
  `correlationId`.
- **T-23** validates the failure and resilience behaviour this model implies.
