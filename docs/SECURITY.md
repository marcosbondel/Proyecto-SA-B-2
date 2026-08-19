# Security

## Data Classes

The project assignment names these data classes as part of the service domain:

- Customer identification and identity-document images.
- Full customer name, username, email, address, and date of birth.
- Customer, account, and transaction identifiers.
- Account balances and account state.
- Payment identifiers, transaction references, and payment status.
- Audit event identifiers, event types, timestamps, and payloads.

These classes require deliberate access and logging decisions before the
services are implemented.

## Access Model

The architectural boundary is already fixed: external traffic enters through
the API Gateway, and a service never reads another service's database.

**Authentication is decided** —
[ADR-010](architecture/adr/ADR-010-authentication.md). The Gateway issues the
session JWT from the claims Customer Service returns, signs it with HS256, and is
the **only** component that validates it. Verified identity (`customerId`, `role`)
then travels to services inside the message envelope. Tokens live one hour and
there is no refresh token.

Two properties of that decision matter for security review:

- **Revocation before expiry is out of scope in this phase.** A compromised token
  stays valid for at most one hour. This is an accepted limitation, not an
  oversight.
- **Services trust the identity in the envelope rather than verifying it.** That
  is only sound while nothing publishes to the broker without passing through the
  Gateway. If that assumption ever stops holding, ADR-010 must be superseded by
  per-service validation with an asymmetric algorithm.

The three roles — `ADMINISTRADOR`, `CAJERO_RECEPTOR`, `CLIENTE` — and which use
case each may trigger are recorded in [`domain/actors.md`](domain/actors.md).

> **Blocked**: Per-endpoint authorization — how the actor matrix is enforced
> through token scopes, guards and per-route rules — is not defined. Owner:
> Marcos Bonifasi. Arrives with: T-15, the Gateway contract.
>
> **Blocked**: The cross-service access policy and the concrete local
> secret-loading mechanism are not defined. Owner: Marcos Bonifasi. Arrives
> with: T-06.

## Secret Handling

Real credentials, tokens, database passwords, and private keys MUST NOT be
committed. Required environment variables are documented with names and sample
placeholders only. Secrets belong to the local runtime or an approved secret
store; they do not belong in Markdown, source, logs, or generated artifacts.

The JWT signing secret of
[ADR-010](architecture/adr/ADR-010-authentication.md) is a Kubernetes Secret
supplied through Helm values or `--set-file` at release time. It is never
committed — not in Markdown, not in a values file, not baked into an image.

> **Blocked**: The concrete local secret-loading mechanism and the rotation
> policy are part of the infrastructure decisions. Owner: Marcos Bonifasi.
> Arrives with: T-06, and T-22 for the cluster side.

## Verification

T-01 verifies the dependency cleanup with a successful web build. Security
checks for authentication, authorization, persistence, file uploads, exports,
and event payload handling begin when those surfaces exist.

## Review Triggers

Request a security review when a change adds or modifies:

- Authentication or authorization.
- Persistence schemas or database access.
- External integrations or message consumers.
- File upload, export, or user-generated content.
- Logging or telemetry that could contain customer or transaction data.
