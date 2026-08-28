# Contract Changes: Audit Remediation

The message contracts this feature adds or changes, in `@bank/contracts`. All are
async request/reply over the broker (Principle IV). Naming and versioning follow
the existing `<name>.vN` convention; the catalog and the exported `schema/` must
stay in sync (US10).

## New query contracts (US6)

Customer Service exposes **no queries today** (all five handlers are commands).
These introduce its first read path, each reading only its own tables.

| Contract | Category | Producer → Handler | Payload (in) | Reply (out) |
|----------|----------|--------------------|--------------|-------------|
| `customer.get.query.v1` | query | gateway → customer-service | `{ customerId }` + envelope `identity` | `customer.get.replied.v1` |
| `customer.get.replied.v1` | reply | customer-service → gateway | — | redacted customer view, shaped by caller identity |
| `customer.pending-validation.query.v1` | query | gateway → customer-service | `{ }` (staff) + envelope `identity` | `customer.pending-validation.replied.v1` |
| `customer.pending-validation.replied.v1` | reply | customer-service → gateway | — | list of customers awaiting identity validation (bounded, reports `omitted`) |
| `command.outcome.query.v1` (working name) | query | gateway → notification-audit | `{ correlationId }` + envelope `identity` | `command.outcome.replied.v1` |
| `command.outcome.replied.v1` | reply | notification-audit → gateway | — | outcome (`SUCCESS`/`BUSINESS_REJECTION`/`PENDING`) only for the caller's own correlation |

**Scoping rule**: `customer.get` and `command.outcome` MUST refuse or redact when
the caller is a `CLIENTE` asking about a subject/correlation that is not theirs —
the same identity check the money-path services already apply.

## Existing contract, missing consumer (US3 observability)

- `payment.attempt.failed.v1` — already defined and routed to `transaction.saga`,
  but **no handler consumes it**. Add the Transaction handler so the retry ladder
  is observable on the transfer screen (`errorType` / `attempt` become non-null in
  `transaction.status.replied.v1`).

## Changed contracts

- `customer.register.rejected.v1` — add `ROLE_NOT_ELIGIBLE` to its `extract` set
  so the domain can reject an elevated role at registration (US4). The
  `account.open.rejected.v1` contract already lists an equivalent code.
- `account.deactivated.v1` — carry the manual-deactivation `reason` (US9), which
  is currently required on the command but has nowhere to land on the event.

## Gateway route ↔ message additions (US6)

New rows in `apps/gateway/src/openapi/route-messages.ts` (and the OpenAPI doc):

| Route | Publishes | Awaits |
|-------|-----------|--------|
| `POST /api/customers/{customerId}/identity-validation` (multipart) | `customer.validate-identity.v1` (already exists) | — (accepted `202`) |
| `GET /api/customers/{customerId}` | `customer.get.query.v1` | `customer.get.replied.v1` |
| `GET /api/customers/pending-validation` | `customer.pending-validation.query.v1` | `customer.pending-validation.replied.v1` |
| `GET /api/commands/{correlationId}/outcome` (working shape) | `command.outcome.query.v1` | `command.outcome.replied.v1` |

## Invariants the contracts must preserve

- **No secrets in payloads**: the existing `no-secrets` contract test allowlist
  stays authoritative; the new customer read reply is **redacted** and must not
  reintroduce document, address, or credential fields into an un-allowlisted
  message.
- **Envelope republish**: the outbox stores and re-publishes the full envelope;
  `followUpEnvelope` still does not propagate `idempotencyKey`, so no contract
  change is needed there — the durability lives in the outbox, not the envelope.
- **Catalog + schema parity**: every new contract is added to the catalog and the
  regenerated `schema/`, with a drift test (US10).
