# Data Model & Contract Changes: Audit Remediation

Schema and contract deltas per user story. Each service owns its own tables
(Principle II); nothing here reads another domain's data.

## Transaction Service — outbox (US3)

**`transaction_events` (extend, already written inside the state-change tx)**
- `dispatch_status` — `PENDING | DISPATCHED` (default `PENDING`).
- `published_at` — timestamp, nullable, set when the relay publishes.
- `envelope` — the **complete serialized envelope** to republish (JSONB), so the
  relay re-emits with the original `idempotencyKey` (never rebuilt).
- Partial index on `(dispatch_status)` where `PENDING`, for the relay sweep.

**State machine**: `PAYMENT_SUCCEEDED` becomes idempotent — a second occurrence
for a transfer already past `PAYMENT_PENDING` is a no-op, not a second
`account.credit.requested.v1`.

**Relay**: a new scheduler (modeled on Payment's `RetryScheduler`) that selects
`PENDING` outbox rows `FOR UPDATE SKIP LOCKED` inside a transaction, publishes the
stored envelope, and marks `DISPATCHED`.

## Payment Service — outbox + sweeper fix (US3)

**`payments` / `payment_attempts` (extend)**
- Dispatch column(s) for the terminal event and each `attempt.failed`, mirroring
  the Transaction outbox: `dispatch_status`, `published_at`, stored `envelope`.
- The `open()` path must not `return` on `EXISTS` without ensuring the terminal
  event is (or will be) dispatched — the outbox row is the durable record.

**Sweeper**: `due()` runs inside a real transaction so `FOR UPDATE SKIP LOCKED`
actually holds across replicas (today it is autocommit and both sweepers read the
same batch).

**Second unique index**: `open()` uses `ON CONFLICT (payment_id)`; a second
`paymentId` for the same `transaction_id` currently crashes the unbound unique
`(transaction_id)` into the DLQ. Handle the conflict gracefully (treat as
already-open for that transfer).

## Account Service — business-identity dedup + compensation guard (US3)

- **`account_operations` (add constraint)**: partial `UNIQUE (transaction_id,
  type)` so a movement for a transfer cannot apply twice even under a fresh
  envelope. The transport `(idempotency_key, message_type)` dedup stays as the
  first line; the business key is the durable guard.
- **Compensation guard**: the compensation `UPDATE ... WHERE type='DEBIT'` checks
  `rowCount`; if no debit row matched, do **not** credit — record the anomaly
  (a rejected/ignored outcome) instead of silently creating funds.
- **Deactivation `reason` (US9)**: persist the manual-deactivation reason and
  carry it on `account.deactivated.v1` so the audit trail shows why.

## Customer Service — access control + read model (US4, US6)

- **`customers` (add column)**: `version` (integer, default 0) for optimistic
  concurrency; the update reads `SELECT ... FOR UPDATE` in the same transaction
  and includes `version` in the `WHERE`.
- **Blank-value rejection**: trim before the length check so a whitespace-only
  `full_name` or `document_number` is rejected, not stored (the empty document
  otherwise takes the UNIQUE slot and blocks all later registrations).
- **Activation token invalidation (US7)**: `saveActivationToken` marks the
  customer's prior unused tokens consumed (`UPDATE ... SET used_at = now() WHERE
  customer_id = $ AND used_at IS NULL`) inside the same transaction as the insert.
- **Read model (US6)**: no new table required — the existing `customers` table
  backs the new query handlers, returning a **redacted** view shaped by the
  caller's identity.

## Notification-Audit Service — durability (US5, US7)

- **`notifications.status` sweeper (US7)**: a new scheduler retries `PENDING` /
  `FAILED` rows (the column and `settleNotification` already exist).
- **`bank.errors` drainer (US5)**: a consumer records each parked message as an
  audit event with `processing_status = 'INVALID'` (or a dedicated parked status),
  so nothing published to the error exchange is discarded.
- **INVALID classification**: the `RecordEventHandler` classifies an unparseable
  or contract-violating envelope as `INVALID` before touching typed columns.

## Shared packages

**`@bank/messaging`**
- Bind a durable queue to `EXCHANGES.errors` (`bank.errors`) and route
  retry-exhausted / parked messages to it; ensure it is consumed.
- Harden `isEnvelope` to match `envelopeSchema` for persisted fields
  (`messageVersion`, `producer`, UUID-shaped ids).

**`@bank/contracts` (new contracts, US6)**
- `customer.get.query.v1` / `customer.get.replied.v1` — redacted customer read,
  scoped by identity.
- `customer.pending-validation.query.v1` / `customer.pending-validation.replied.v1`
  — the teller's queue of customers awaiting identity validation.
- A scoped **command-outcome** query (new query to the Audit Service that receives
  `identity` and returns only outcomes for the caller's own correlations, or the
  originating `customerId` recorded in Audit) — so a non-administrator sees how
  their own `202` resolved without opening the full audit trail.
- `payment.attempt.failed.v1` gains a **consumer** in Transaction so the retry
  ladder becomes observable on the transfer screen (the contract already exists
  and is routed; only the handler is missing).
- **Schema export (US10)**: regenerate `schema/*.json` to match the 55-contract
  catalog and add a test that fails on drift.

**`envelope.ts` invariant to preserve**: `followUpEnvelope` still does not
propagate `idempotencyKey` by design; the outbox relay must therefore persist and
republish the **full original envelope**, never rebuild it — otherwise Account's
transport dedup is bypassed and the double-credit returns.

## Deployment artifacts (US1) — not database entities, but the feature's new data

- **Helm chart** `infra/k8s/helm/bank-usac`: `Chart.yaml`, `values.yaml`
  (`image.repository`, `image.tag = <short-commit>`, `pullPolicy: IfNotPresent`,
  `replicaCount: 1`), `templates/<component>/{deployment,service}.yaml` ×7,
  selectorless `Service` + `Endpoints` per external dependency, `configmap.yaml`,
  `secret.yaml` (template, values uncommitted), probes wired to `/health` and
  `/ready` on each component's port.
- **kind cluster config** `infra/k8s/kind/`: a `kind: Cluster` config whose nodes
  join the `bank-usac-local` Docker network so pods reach the external
  dependencies.
