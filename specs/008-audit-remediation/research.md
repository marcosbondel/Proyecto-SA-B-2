# Research: Audit Remediation

Consolidated decisions for the technical approach, grounded in the current code.
Each decision cites the finding it resolves and the existing pieces to reuse.

## R1 — Local Kubernetes deployment (US1, FR-001/002)

**Decision**: One Helm chart at `infra/k8s/helm/bank-usac` deployed with
`helm upgrade --install` onto a **kind** single-node cluster, per ADR-007. The
five databases, RabbitMQ, and MinIO stay outside the cluster in the existing
Compose stack; the cluster reaches them through **selectorless Services backed by
explicit Endpoints** pointing at the containers on the shared Docker network
`bank-usac-local`, with `host.docker.internal` as the documented fallback.

**Rationale**: ADR-007 already fixed this exact mechanism (kind rejected
minikube/k3d/raw kubectl for reproducibility and the external-DB routing
constraint). The image tooling already loads images with `kind load docker-image`
and tags each image with the short commit — the value the chart's `image.tag`
must carry. Nothing new is invented; T-22 is the materialization ADR-007 deferred.

**Chart contents** (one `templates/<component>/` per workload):
- 7 Deployments (`replicas: 1`), image `bank-usac/<component>:<short-commit>`,
  `pullPolicy: IfNotPresent` (image is loaded to the node, never pulled).
- 5 ClusterIP Services (internal services); Gateway and web reached via
  `kubectl port-forward` (documented, no real load balancer).
- Selectorless Service + Endpoints per external dependency (5 Postgres, RabbitMQ,
  MinIO) so pods use stable in-cluster DNS names, never a host address.
- 1 ConfigMap (non-sensitive config) + 1 Secret (JWT, DB and RabbitMQ
  credentials, object-store keys) referenced by Gateway + 5 services; web
  references neither DB nor Secret. Secret values are never committed
  (`secret.yaml` is a template; values via `--set-file` or chart values).
- Probes exploit the T-21 split: **liveness `GET /health`** (loose, never fails on
  a downed dependency) and **readiness `GET /ready`** (strict, 503 while broker/DB
  unreachable). Ports: Gateway 3000, services 3001–3005, web 3010.
- A `kind` cluster config (`kind: Cluster`) that joins nodes to `bank-usac-local`.

**Alternatives considered**: minikube/k3d (rejected by ADR-007); per-service
charts (rejected — one chart with per-component templates is the recorded choice);
databases in-cluster (forbidden by Principle III).

**Env vars each workload needs at runtime** (from CONTAINERS.md): all services get
`NODE_ENV PORT DATABASE_URL RABBITMQ_URL`; customer + gateway also get
`OBJECT_STORAGE_*`; gateway gets `JWT_SECRET JWT_EXPIRES_IN` and **no**
`DATABASE_URL`; notification-audit gets the notification-channel vars. A malformed
var is fatal at boot, naming the offender.

## R2 — Durable event delivery / outbox (US3, FR-007)

**Decision**: Add a **transactional outbox** to Transaction and Payment, and a
**pending-notification sweeper** to Notification-Audit. The state change and the
outbox row are written in the **same DB transaction**; a relay (a scheduler,
modeled on Payment's existing `RetryScheduler`) publishes outbox rows after
commit and marks them dispatched. **The relay MUST re-publish the stored complete
envelope with its original `idempotencyKey`, never reconstruct it** — see R3.

**Rationale**: All services currently publish *after* commit, outside the
transaction, and the broker's retry ladder cannot recover a lost publish because
the inbound dedup (`processed_messages`, `ON CONFLICT (message_id) DO NOTHING`)
already marked the message processed, so the use-case returns `DUPLICATE` and
never re-publishes. Publishing is effectively at-most-once; a broker failure
between commit and publish loses compensation (Transaction) or the terminal event
(Payment) forever. This is the root of the two money-integrity criticals,
documented in code as TD-031.

**Reuse**:
- Transaction already writes `transaction_events` **inside** the state-change
  transaction — extend it with `dispatch_status` / `published_at` and the stored
  envelope, then add a relay scheduler.
- Payment's `RetryScheduler` + `due()` with `FOR UPDATE SKIP LOCKED` is the exact
  template for a relay; add a dispatch column to its tables.
- Notification-Audit already has `notifications.status = 'PENDING'` and
  `settleNotification`; it only lacks the sweeper.

**Alternatives considered**: publish inside the DB transaction (rejected — a
broker publish inside a DB tx couples two systems and can still fail after
commit); rely on broker persistence alone (rejected — inbound dedup defeats
redelivery recovery).

## R3 — Idempotency keyed on business identity (US3, FR-008/010)

**Decision**: (a) The outbox relay re-publishes the **persisted full envelope**
so the `idempotencyKey` is stable across republish. (b) Account's movement dedup
is additionally keyed on the **transfer/movement identity**: add a partial
`UNIQUE (transaction_id, type)` so a second movement for the same transfer cannot
move the balance twice even if it arrives under a fresh envelope. (c) Make
`PAYMENT_SUCCEEDED` idempotent in the Transaction state machine (the only
self-transition still legal the second time).

**Rationale**: `createEnvelope` mints a new `messageId`/`idempotencyKey` per
publish and `followUpEnvelope` does **not** propagate `idempotencyKey`. So a naive
outbox that rebuilds the envelope would reintroduce the double-credit: Account
dedups on `(idempotency_key, message_type)`, and a fresh key bypasses it. The
business-identity key is the durable guard; the stored-envelope republish keeps
the transport key stable. Two layers, because each covers a gap the other cannot.

**Compensation guard** (FR-009): the compensation `UPDATE ... WHERE type='DEBIT'`
must check its `rowCount`; a compensation for a never-debited transfer must not
credit and must be recorded as an anomaly rather than silently crediting.

## R4 — Bound error queue and INVALID recording (US5, FR-015/016/017)

**Decision**: Bind a durable queue to the `bank.errors` exchange and consume it
(a drainer in Notification-Audit that records each parked message as an audit
event), and route retry-exhausted messages there. Harden `isEnvelope` to be as
strict as `envelopeSchema` for the persisted fields, and have the audit
`RecordEventHandler` classify an unparseable/contract-violating envelope as
`INVALID` **before** touching typed columns, so the insert cannot crash into the
retry void.

**Rationale**: `bank.errors` is declared and passed as every service's
`errorExchange`, but **no queue binds to it**, so RabbitMQ discards parked
messages — across all seven components. The `.dlq` queues are declared but never
bound or consumed. `isEnvelope` is far laxer than `envelopeSchema` (doesn't
require `messageVersion`, `producer`, or UUID-shaped ids), so a malformed envelope
that passes it crashes the typed `INSERT`. Together they mean the system keeps no
evidence of what it could not process — defeating the audit service's purpose.

**Alternatives considered**: consume `.dlq` per family (more queues, same effect —
one bound error queue is simpler and matches the single `bank.errors` exchange).

## R5 — Access-control fixes (US4, FR-011/012/013/014)

**Decision** (all mirror the pattern Account already uses):
- **IDOR (FR-011)**: handler passes `envelope.identity` into
  `UpdateCustomerUseCase.execute`; a domain `mayUpdate(identity, subjectId)`
  refuses when `identity.role === 'CLIENTE' && identity.customerId !== subjectId`,
  recording the refusal without publishing a change event.
- **Role validation (FR-012)**: `registerCustomer` (domain) receives the identity
  and throws `ROLE_NOT_ELIGIBLE` (already declared, never thrown here) for a
  non-CLIENTE role without an ADMINISTRADOR actor; add it to the register-rejected
  contract's extract list.
- **Lost update (FR-013)**: add a `version` column to `customers`; read with
  `SELECT ... FOR UPDATE` in the same transaction as the `UPDATE` and include
  `version` in the `WHERE`.
- **Blank values (FR-014)**: trim before the contract length check (or reject
  post-trim empties) so whitespace-only name/document cannot be stored.

**Rationale**: The Gateway already puts verified `identity` in the envelope; the
owning service discards it. Account demonstrates the correct pattern
(`set-account-status` refuses a non-admin; `visibility` pins a CLIENTE to its own
id). "A permission enforced only at the edge holds until the second producer
appears."

## R6 — Customer read path (US6, FR-018/019/020)

**Decision**: Introduce Customer Service's **first query handlers** (async
request/reply, which the constitution allows):
- `customer.get.query.v1` / `.replied.v1` — a redacted customer read for a staff
  member, so the update form is not edited blind and the validation detail shows
  real data.
- `customer.pending-validation.query.v1` / `.replied.v1` — the teller's queue of
  customers awaiting identity validation.
- A **command-outcome** read scoped by caller identity, so a non-administrator can
  see how their own `202` resolved without opening the full audit trail. Cleanest
  as a new query to the Audit Service that receives `identity` and checks the root
  event's originator, or by recording the originating `customerId` in Audit.
- **Identity-validation route**: `POST /api/customers/{customerId}/identity-validation`
  (multipart, uploads to MinIO like registration, publishes the existing
  `customer.validate-identity.v1` with the teller's identity) + a `ROUTE_MESSAGES`
  row; then enable the built-but-disabled UI buttons.

**Rationale**: The identity-validation use-case and contract already exist but no
Gateway route publishes the command, and Customer Service exposes **zero**
queries today (all five handlers are commands) — so there is no read model for a
pending-validation queue or a customer record. This is the largest net-new piece
in the access cluster and must respect `test/isolation.spec.ts`.

**Constitution note**: query handlers over the broker are async request/reply,
explicitly allowed by Principle IV. No cross-database access is introduced — each
query reads only its own service's tables.

## R7 — Public-surface & delivery hardening (US7)

**Decision**: Add `@nestjs/throttler` with a global `ThrottlerGuard` and strict
limits on the three `@Public()` routes (especially registration, which uploads to
MinIO before publishing, so an anonymous loop can fill the bucket). Invalidate a
customer's prior live activation tokens inside the transaction that inserts a new
one. Add the notification sweeper (R2) to retry `PENDING`/`FAILED` deliveries.
Flip `REVEAL_ACTIVATION_LINKS` to default-off in the images compose.

## R8 — Config & docs hygiene (US8, US10)

**Decision**: Correct `.env.example` ports to the real published ports
(5673/15673/9002/9003); derive ports in `write-host-env.sh` from the single source
of truth; stop the RabbitMQ definitions file from importing a plaintext credential
that overrides the developer's; replace `eval "$line"` with `set -a; source` in
the four scripts that parse the env file (the safe form already exists in
`smoke-images.sh`). Regenerate the exported JSON schemas and add a test that fails
on drift; fix `DOC_INVENTORY.md`'s coverage claim; reconcile the diagram sources
and the ADR count; persist the manual-deactivation `reason`.

## R9 — Scheduler reliability (US9, FR-030/031)

**Decision**: Run the account deactivation job at startup (and/or catch up missed
runs by consulting `deactivation_runs`) instead of only on the interval. Fix the
retry sweeper's `FOR UPDATE SKIP LOCKED` to run inside a real transaction so the
lock actually holds across two replicas (today it runs in autocommit and both
sweepers read the same batch).

## Cross-cutting constraints

- Every change keeps communication 100% asynchronous, one DB per service, no
  cross-database access, Gateway free of business logic, and the executable
  `isolation.spec.ts` + lint architecture rules passing (NFR-001, NFR-003).
- New money-path behavior (outbox, dedup, compensation guard) needs integration
  tests against real PostgreSQL, including Payment, which has none today (NFR-002).
