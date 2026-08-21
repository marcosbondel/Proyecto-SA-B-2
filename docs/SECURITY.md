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

The architectural boundary is already fixed: external traffic enters through the
API Gateway, and a service never reads another service's database.

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

### Cross-service access policy

- A service may connect only to its own database. The credential isolation test
  in T-06 proves this: each PostgreSQL user authenticates against one database
  and is rejected by the other four.
- A service may publish and consume only through the broker using the
  application user (`bank_app`). The application user has no administrator tags
  and can declare/assert the objects it needs, but it cannot modify users,
  vhosts, or permissions.
- A service may not read another service's database, call another service's
  HTTP endpoint, or import another service's code.
- The Gateway may write identity-document photos to MinIO and publish the
  resulting reference. Customer Service reads and verifies the object, then
  persists it in its own database. No service queries MinIO to make a decision.

## Secret Handling

Real credentials, tokens, database passwords, and private keys MUST NOT be
committed. Required environment variables are documented with names and sample
placeholders only. Secrets belong to the local runtime or an approved secret
store; they do not belong in Markdown, source, logs, or generated artifacts.

### Local secret-loading mechanism

The local development stack loads secrets from `infra/docker/.env`, which is
created by copying `infra/docker/.env.example` and filling in local values.
`infra/docker/.env` is ignored by Git (see `.gitignore`). `validate-env.sh`
fails fast if any required variable is missing or empty, so no component starts
with a placeholder password.

For the kind cluster, secrets reach the pods through Helm values or
`--set-file` at release time (T-22). The chart's `secret.yaml` is a template;
real values live in the release command, never in the repository.

The JWT signing secret of
[ADR-010](architecture/adr/ADR-010-authentication.md) is a Kubernetes Secret
supplied through Helm values or `--set-file` at release time. It is never
committed — not in Markdown, not in a values file, not baked into an image.

> **Blocked**: The rotation policy and cluster secret-loading mechanism are part
> of the infrastructure decisions. Owner: Marcos Bonifasi. Arrives with: T-22.

## Verification

T-01 verifies the dependency cleanup with a successful web build. T-06 adds a
credential audit that confirms no real values are committed in `infra/docker/`
or the local evidence files. Security checks for authentication, authorization,
persistence, file uploads, exports, and event payload handling begin when those
surfaces exist.

## Review Triggers

Request a security review when a change adds or modifies:

- Authentication or authorization.
- Persistence schemas or database access.
- External integrations or message consumers.
- File upload, export, or user-generated content.
- Logging or telemetry that could contain customer or transaction data.
