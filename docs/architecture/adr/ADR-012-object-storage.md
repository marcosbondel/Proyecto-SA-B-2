# ADR-012: Carry identity-document photos through object storage, never inside a message

- **Status**: Proposed
- **Date**: 2026-08-19
- **Deciders**: Bank USAC team (approved in the `feature/T-05` pull request)
- **Assignment reference**: §4.1 "Customer Service" — identity validation by photo of the
  identification document, page 5 (revision 2026-08-13). The *storage mechanism* is not
  constrained by the assignment; team decision.

## Context

Customer Service must validate identity from a photo of the identification document. The photo
originates at an external client, and the API Gateway is the only external entry point
(constitution V). It therefore has to travel from the Gateway to Customer Service.

Three facts collide:

1. **Services communicate only through events** (constitution IV). No HTTP call reaches a
   service from outside the Gateway, and no service calls another.
2. **The Gateway owns no data** (constitution V). It routes, authenticates and aggregates; it
   has no database in which to park a file.
3. **The photo is large.** T-05 caps it at 5 MB, which is roughly 6.7 MB once base64-encoded.
   Every other message in the system fits in 64 KB — two orders of magnitude smaller.

Without a decision, the photo has nowhere to travel and the identity-validation use case
cannot be implemented at all.

## Decision

Identity-document photos travel through an **S3-compatible object store**, provided locally by
**MinIO**, in a bucket named `customer-identity-documents`.

The Gateway writes the object and publishes the command carrying only a **reference**: the
object key, the content type, the size in bytes, and the SHA-256 of the content. Customer
Service reads the object, **recomputes the SHA-256 and compares it**, and only then persists
the bytes as `BYTEA` in its own database.

**No message in the system carries image bytes.** The object store is a transfer buffer: it
holds no business state, nobody queries it to make a decision, and the source of truth for the
photo remains Customer Service's own database.

## Alternatives considered

### The bytes inside the command, base64-encoded

The strictly conforming option, and the one that needs no new component: the photo becomes a
field of `customer.register` and travels the broker like everything else.

**Rejected because**: operational cost on a local demonstration. A 6.7 MB message forces
raising RabbitMQ's frame limit, and one such message parked in a dead-letter queue holds
broker memory for the whole demonstration. It also destroys the uniformity that makes the
delivery policy simple to reason about — retry and dead-lettering behave differently for a
message two orders of magnitude larger than every other.

### The Gateway stores the photo in a database of its own

The Gateway writes the bytes somewhere it controls and publishes a reference to that.

**Rejected because**: constitution V gives the Gateway no persistence and no domain. A Gateway
with a database is a sixth service wearing a different name, which also puts principle I at
risk.

### Customer Service exposes an HTTP upload endpoint

The client, or the Gateway, uploads directly to the service that needs the bytes.

**Rejected because**: constitution IV forbids HTTP into a service, and principle V makes the
Gateway the only external entry point. The assignment penalizes direct communication between
components explicitly (critical observations, page 7).

## Consequences

**Easier**: every message payload stays under 64 KB, so broker sizing, retry and dead-letter
behaviour are uniform across all 42 contracts. The delivery policy has no special case.

**Harder**: one more component to provision, with credentials to manage and an object lifecycle
that did not exist before. It introduces a failure mode the system did not have — a reference
that points at an object which is missing or whose hash does not match — and both cases have
to be contracted and answered distinctly.

**The boundary this decision depends on**: the object store is **not** the database of any
service, so principle II holds. It stores no business state, no service queries it to decide
anything, and the object is deleted after its retention window. If a later design starts
reading it to make a decision, this ADR no longer justifies it and principle II is violated.

**Obligations created**:

- **T-05** defines the reference contract — object key, content type, size, SHA-256 — and the
  rule that Customer Service verifies the hash before persisting.
- **T-06** provisions MinIO in the local stack, **outside the Kubernetes cluster** alongside
  the PostgreSQL instances, and defines the retention window.
- **T-11** shows the object store in the deployment diagram; a deployed component absent from
  the diagram breaks the consistency the methodology requires (§6 step 5, page 17).
- **T-15** and the Customer Service ticket implement the write and the verified read.
