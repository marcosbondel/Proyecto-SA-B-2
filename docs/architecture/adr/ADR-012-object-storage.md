# ADR-012: Carry identity-document photos through object storage, never inside a message

- **Status**: Accepted
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
behaviour are uniform across the whole message catalogue — 42 contracts when this was decided,
and it has grown since without the policy needing a special case.

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

## Addendum (2026-08-31): the read direction — a teller viewing a document already stored

Everything above covers the only trip the photo made when this ADR was written: the Gateway
writes it once, Customer Service reads it once and persists it. TD-023 left one piece of US6
open — "the document-image read route" — because the validation queue needs a second trip this
ADR's original context never considered: a teller opens a pending case, possibly days after
registration, and has to **see** the document Customer Service already persisted. By then MinIO's
own retention window (`MINIO_RETENTION_HOURS`, 24 hours locally) has long since expired whatever
object the Gateway originally wrote, so there is nothing left there to read.

### The bytes inside the reply, considered and rejected again

The obvious shape for a read is the request/reply pattern every other query in the catalogue
already uses — a tiny command in, a reply out, the reply carrying whatever was asked for. For
every other query that is a few kilobytes of JSON; here it would have been the photo itself.

**Rejected, for exactly the reason this ADR gives the write path, not a new one.**
`apps/packages/contracts/test/events/payload-size.spec.ts` (SC-009a) enforces
`MAX_PAYLOAD_BYTES = 64 * 1024` across the **entire** catalogue with no carve-out for a reply,
and its own comment names this ADR as the reason. `apps/packages/contracts/test/events/no-secrets.spec.ts`
separately refuses any field named like it could hold raw bytes
(`bytes|binary|base64|blob|imagedata|payloadcontent`). And the Decision above already says the
rule in the plainest terms it has: **"No message in the system carries image bytes."** That
sentence does not read "no *command* carries image bytes" — a reply that carried them would be
the same alternative rejected on 2026-08-19 ("The bytes inside the command, base64-encoded"),
arrived at again by a different door.

### Decision: the same transfer buffer, run in the opposite direction

Customer Service — the document's owner, and the only service that may read its own
`identity_documents` table — writes its own already-verified bytes **back into the same**
`customer-identity-documents` bucket, under a fresh key it mints for the occasion
(`identity-review/<uuid>`, never the key the Gateway originally wrote, which is long expired by
the time this runs). It replies with a `PhotoReference`: the same four-field shape — object key,
content type, size, SHA-256 — the write path already puts on the wire, comfortably under the
64 KB ceiling. The Gateway reads that one object and streams it to the browser with its real
`Content-Type`; it decides nothing about the image, exactly as constitution V already required.

This is not a second mechanism. It is the first one, run in reverse: whichever side currently
holds the bytes writes them into the buffer, and whichever side needs them next reads them back
out. The write path has the Gateway write and Customer Service read; the read path has Customer
Service write and the Gateway read. The invariant this ADR actually protects — **the broker
carries a reference, never the bytes** — is identical in both directions, which is what makes the
second direction an application of this decision rather than an exception to it.

Nothing about the boundary in **Consequences** above moves. The object store still holds no
business state: the staged copy is disposable, named by a UUID nobody but this one request will
ever ask for again, and nothing queries it to decide anything — the teller's verdict is still
recorded through `customer.set-identity-verdict.v1`, untouched by this addendum, and what happens
at the object store is a person looking at an image, not a service reaching a conclusion from one.
The bucket's existing lifecycle rule expires the staged copy exactly as it already expires every
upload; nothing new was built to clean it up, because nothing new needed to be.

**Obligation this creates**: any future read of a document a service already persisted follows
this same shape — the owner stages a disposable copy, the Gateway reads it once, the broker
carries only a reference — rather than reopening the "bytes in a reply" question this addendum
closes.
