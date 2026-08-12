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

> **Blocked**: The service roles, authentication model, authorization rules,
> and cross-service access policy have not been approved. Owner: Marcos
> Bonifasi. Arrives with: T-03 and T-06.

The architectural boundary is already fixed: external traffic enters through
the API Gateway, and a service never reads another service's database.

## Secret Handling

Real credentials, tokens, database passwords, and private keys MUST NOT be
committed. Required environment variables are documented with names and sample
placeholders only. Secrets belong to the local runtime or an approved secret
store; they do not belong in Markdown, source, logs, or generated artifacts.

> **Blocked**: The concrete local secret-loading mechanism and rotation policy
> are part of the infrastructure and access decisions. Owner: Marcos Bonifasi.
> Arrives with: T-03 and T-06.

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
