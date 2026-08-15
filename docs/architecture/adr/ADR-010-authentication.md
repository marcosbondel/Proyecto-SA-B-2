# ADR-010: Issue and validate the session JWT in the Gateway

- **Status**: Proposed
- **Date**: 2026-08-15
- **Deciders**: Bank USAC team (decided 2026-08-14; approved in the `feature/T-03` pull request)
- **Assignment reference**: §4.1 "Customer Service", page 5 (revision 2026-08-13)

## Two different tokens

This system has **two** tokens. They are easy to confuse — both expire, both appear in Customer
Service flows — and confusing them breaks either sign-in or account activation. This ADR decides
only the first.

| | **Session JWT** *(this ADR)* | **Email activation token** *(already decided in T-02)* |
| --- | --- | --- |
| Purpose | Authenticate subsequent requests | Verify the email address once, activating the account |
| Signed by | The **Gateway** | **Customer Service** |
| Validated by | The **Gateway** | **Customer Service** |
| Lifetime | 1 hour | 24 hours, single-use |
| Decided in | T-03 | T-02 — `docs/domain/use-cases.md` |

The asymmetry is deliberate. Activation is an identity decision inside Customer Service's own
domain, so that service generates and validates its token. Authenticating inbound requests is
the Gateway's job (constitution principle V), so the session token is its own.

**This ADR does not redefine the activation token.** Its 24-hour lifetime, single use, and the
rule that a sign-in retry invalidates the previous one all remain exactly as T-02 recorded them.

## Context

§4.1 (p. 5) requires JWT: *"Para autenticar y validar al usuario debe de hacer uso de JWT."* It
says nothing about who issues the token, how it is signed, how long it lives, or where it is
validated. Those four gaps had to be closed before Customer Service and the Gateway could be
built, because they determine the sign-in flow, the Gateway's security configuration and how
identity travels in messages.

T-02 had already drawn part of the line and explicitly deferred the rest to this ticket
(`docs/domain/README.md` records "JWT issuance, signing, expiry → T-03"). It also fixed the
shape of sign-in: `customer.authenticate` is an asynchronous request/reply that **"replies with
claims, not a token"** (`docs/domain/message-catalog.md`), and *"the Gateway turns the claims
into a session"* (`docs/domain/use-cases.md`). This ADR is decided inside that frame.

The Gateway has **no database of its own** (constitution principle V), so it cannot look up a
session on each request. That is the constraint that makes a stateless token the natural fit.

## Decision

### The five answers

| Question | Decision |
| --- | --- |
| **Library** | `@nestjs/jwt` for signing and verification. `passport-jwt` is required **only in the Gateway**, since no other component validates tokens |
| **Algorithm** | **HS256**, symmetric, with a shared secret |
| **Expiry** | **1 hour**, with **no refresh token** |
| **Issued by** | The **Gateway**, from the claims Customer Service returns via `customer.authenticate` |
| **Validated by** | The **Gateway only**. Verified identity then travels to services inside the message envelope |

### The flow

1. The client posts credentials to the Gateway.
2. The Gateway publishes `customer.authenticate` as an asynchronous request/reply.
3. Customer Service validates the credential and replies with **claims** (`customerId`, `role`,
   and whether the account is verified) — or a named rejection. It does not mint a token.
4. The Gateway signs those claims into a JWT and returns it to the client.
5. On each later request the Gateway verifies signature and expiry, then places the **verified
   identity** (`customerId`, `role`) into the message envelope alongside `correlationId`,
   `causationId` and `idempotencyKey`.

Why HS256 is defensible here: the Gateway is **both the only signer and the only validator**, so
the secret never leaves it. The usual argument for asymmetric signing — that a component which
validates should not be able to forge — has nothing to bite on when signing and validation are
the same component.

**Revocation is out of scope for this phase.** There is no mechanism to invalidate a token
before it expires. A compromised token stays valid for at most one hour. This is accepted, not
overlooked, and it is the main reason the lifetime is short.

### Verdict against the constitution

- **Principle IV (asynchronous communication only): conforms.** Sign-in uses the existing
  asynchronous request/reply over the broker. Validating a token in the Gateway is local
  signature arithmetic — it calls no service, so it introduces no synchronous hop. Had each
  service validated instead, that would still have been local, but it would have coupled five
  services to the auth decision for no gain.
- **Principle V (Gateway is the entry point and holds no business logic): conforms.** Signing a
  token over claims another service decided is authentication, not a domain decision — the
  Gateway never determines *whether* the credential is valid, only packages the verdict. It
  gains no database and no banking rule.

## Alternatives considered

### Customer Service issues the token

The service that owns customer identity mints the JWT and returns it in the reply; the Gateway
just forwards it.

**Rejected because**: it contradicts a decision T-02 already recorded and implemented in the
message catalogue — `customer.authenticate` "replies with claims, not a token" — so adopting it
would require amending `docs/domain/message-catalog.md` and `docs/domain/use-cases.md` in the
same change. It buys nothing in return: the Gateway would still have to validate the token on
every subsequent request, so the signing key would end up in two components instead of one,
strictly widening the surface that can forge a token.

### RS256 with an asymmetric key pair

Customer Service or the Gateway signs with a private key; anything that needs to validate holds
only the public key.

**Rejected because**: its central benefit — a validator that cannot forge — does not exist in
this design, since the single validator is also the single signer. What remains is pure cost:
generating a key pair, distributing it into the cluster, mounting it, and rotating it, for a
local academic deployment. RS256 becomes the right answer the moment validation is distributed;
that is recorded here as the condition that would supersede this ADR.

### Each protected service validates the token itself

The full JWT travels in the envelope and every service verifies signature and expiry before
executing its use case — defence in depth, so a message injected straight into the broker with
no valid token is refused.

**Rejected because**: it replicates verification configuration and the signing secret across
five services, so a single compromised service can mint tokens for the whole system, and
rotating the secret becomes a six-component coordination. It couples every service's domain
layer to the authentication decision, which
[ADR-008](ADR-008-service-internal-architecture.md) exists to prevent, and it would force RS256
to contain the forgery risk — trading real complexity for a threat the trust boundary below
already addresses.

### Stateful sessions in a shared store

A session identifier in a cookie, with server-side state in Redis or a database. Revocation
becomes trivial: delete the session.

**Rejected because**: the Gateway has no database (constitution principle V), so this would mean
introducing a shared session store that every request depends on — a new runtime dependency and
a new single point of failure, in a system whose whole design avoids shared state. The
assignment also names JWT specifically (§4.1, p. 5). The capability it would buy is exactly the
one consciously deferred: revocation.

## Consequences

**Easier.** The Gateway authenticates every request without a database lookup and without asking
any service, so identity costs nothing per request. Services receive an already-verified
identity and never parse a token, keeping authentication out of five domain layers. The signing
secret exists in exactly one component, so rotating it touches one deployment.

**Harder.** A token cannot be invalidated before it expires — a compromised credential or a
revoked user stays valid for up to an hour. Services **trust** the identity in the envelope
rather than verifying it, which is only sound while the boundary below holds. The Gateway
becomes a component whose compromise is total: it can mint any identity.

**Obligations created.**

1. **The envelope gains a verified-identity field**, carrying at least `customerId` and `role`
   alongside `correlationId`, `causationId` and `idempotencyKey`. **T-05 defines its exact
   shape** — this ADR fixes that it must exist, not how it is serialised.
2. **The trust model assumes no producer publishes to the broker without passing through the
   Gateway.** This assumption is what makes single-point validation safe, and it must hold in
   the deployed topology: the broker is not exposed outside the local environment, and only the
   Gateway and the services hold its credentials. **T-06** and **T-22** must not break it. If it
   ever stops holding, this ADR must be superseded by per-service validation with RS256.
3. **The signing secret is a Kubernetes Secret**, supplied through chart values or `--set-file`
   at release time. It is **never committed** — not in Markdown, not in a values file, not in an
   image ([ADR-006](ADR-006-containerization.md), `docs/SECURITY.md`).
4. **T-15** defines per-endpoint authorization — which role may trigger which use case — using
   the actor matrix in `docs/domain/actors.md` as input. This ADR settles *authentication*
   (who you are), not *authorization* (what you may do).
