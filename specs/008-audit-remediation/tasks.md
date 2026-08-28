---
description: "Task list for Audit Remediation"
---

# Tasks: Audit Remediation

**Input**: Design documents from `specs/008-audit-remediation/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/README.md, quickstart.md

**Tests**: Included only where the spec requires them (NFR-002: money-path
integration tests including Payment; new contract tests; the schema drift test).
This is not blanket TDD — most remediation tasks are edits verified by the
existing suites plus the targeted tests below.

**Fidelity to the statement**: Every task maps to a spec requirement that maps to
an audit finding that maps to the project statement
(`docs/references/780_Proyecto_1_2S2026.pdf`) or its rubric. The few tasks that go
**beyond** the literal statement (pure security hardening the PDF never asks for)
are tagged `[fuera-de-enunciado]` so they stay visible. Nothing else is invented.

**Delivery**: One branch, three phases by priority. `[Phase P1]` = grade/money,
`[Phase P2]` = durability/coverage/surface, `[Phase P3]` = hygiene/jobs/docs.
Stop and validate at any story checkpoint.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files/services, no dependency on an incomplete task)
- **[Story]**: US1–US10 from spec.md
- Exact file paths are given; services live under `apps/services/<name>/src/{domain,application,infrastructure,interfaces}/`

---

## Phase 1: Setup (Shared Prerequisites)

**Purpose**: Detect regressions and make the P1 deployment work runnable.

- [ ] T001 Capture a green baseline: run `pnpm lint`, `pnpm test`, `pnpm test:contract`, `pnpm typecheck` and record the passing state, so any regression introduced by this feature is attributable.
- [ ] T002 [P] Document `kind` and `helm` as local prerequisites and verify both are installed (add to `docs/operations/CONTAINERS.md` prerequisites; no version pin beyond "kind + helm present").
- [ ] T003 [P] Verify the image build+load path end to end: `pnpm images:build -- --kind bank-usac` builds the seven images and loads them into a throwaway kind node (confirms US1's assumptions before writing the chart).

**Checkpoint**: Baseline green, deployment tooling confirmed.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Shared conventions every later phase depends on. Kept minimal — this
is remediation of a mature codebase, so most work is independent per story.

- [ ] T004 Confirm the money-path integration-test convention (specs gated on `DATABASE_URL`, skipped without it) and ensure a real PostgreSQL is available for US3 verification; document the command in `specs/008-audit-remediation/quickstart.md` if the gating differs from what is written.
- [ ] T005 Establish the invariant guard for the whole feature: `apps/services/*/test/isolation.spec.ts`, `pnpm lint` architecture rules, and the `@bank/contracts` catalog/no-secrets tests MUST stay green after every task; no task may introduce a synchronous inter-service call or cross-database access (NFR-001, NFR-003).

**Checkpoint**: Conventions fixed — user stories can begin.

---

## Phase 3: User Story 1 — Local Kubernetes deployment (Priority: P1) 🎯 MVP `[Phase P1]`

**Goal**: The whole system deploys to a local kind cluster from the repo's own
Helm chart, with all databases, the broker, and the object store outside the
cluster; a transfer completes end to end on the cluster.

**Independent Test**: `kind create cluster --config infra/k8s/kind/cluster.yaml`,
`pnpm images:build -- --kind bank-usac`, `helm upgrade --install ...`; all seven
pods reach Ready; a transfer completes through the forwarded Gateway; stopping a
database leaves its pod Running-not-Ready (never CrashLoopBackOff).

**Statement anchor**: §4.2/§4.3 mandatory Kubernetes deployment; rubric §8.3 (−100% if absent); Constitution Principle VII.

- [ ] T006 [US1] Create the kind cluster config at `infra/k8s/kind/cluster.yaml` whose node(s) join the existing `bank-usac-local` Docker network so pods can reach the external dependencies (per ADR-007).
- [ ] T007 [US1] Scaffold the Helm chart at `infra/k8s/helm/bank-usac/`: `Chart.yaml`, `values.yaml` (`image.repository: bank-usac/<component>`, `image.tag: <short-commit>`, `pullPolicy: IfNotPresent`, `replicaCount: 1`), and `templates/_helpers.tpl`.
- [ ] T008 [P] [US1] Add Deployment + Service templates for the five internal services under `infra/k8s/helm/bank-usac/templates/{customer,account,transaction,payment,notification-audit}/` — ClusterIP Services, ports 3001–3005, liveness `GET /health` and readiness `GET /ready` probes wired to each port.
- [ ] T009 [P] [US1] Add Deployment + Service templates for `gateway` (port 3000) and `web` (port 3010) under `templates/{gateway,web}/`, reached via `kubectl port-forward` (no real load balancer).
- [ ] T010 [P] [US1] Add selectorless `Service` + explicit `Endpoints` templates for each external dependency (5 PostgreSQL, RabbitMQ, MinIO) under `templates/external/`, resolving to the containers on `bank-usac-local`, with `host.docker.internal` as the documented fallback.
- [ ] T011 [US1] Add `templates/configmap.yaml` (non-sensitive runtime config: PORT, NODE_ENV, in-cluster DNS names for dependencies, CORS origin) referenced by all seven pods.
- [ ] T012 [US1] Add `templates/secret.yaml` as a **template only** (JWT secret, per-service `DATABASE_URL`, `RABBITMQ_URL`, `OBJECT_STORAGE_*` keys), values supplied via `--set-file`/chart values and never committed; wire env from ConfigMap + Secret into every workload per the CONTAINERS.md variable matrix (Gateway gets no `DATABASE_URL`).
- [ ] T013 [US1] Add `templates/NOTES.txt` with the `kubectl port-forward` commands for Gateway (3000) and web (3010) and the readiness-check hints.
- [ ] T014 [US1] Validate `helm upgrade --install bank-usac infra/k8s/helm/bank-usac --namespace bank-usac --create-namespace`: all seven pods reach Ready, `docker ps` shows the five DBs/broker/MinIO outside the cluster, and a register→open-accounts→transfer flow completes through the forwarded Gateway (record evidence in quickstart.md).
- [ ] T015 [US1] Verify the degraded case: stop one PostgreSQL container and confirm its pod stays Running but not Ready (readiness 503), never CrashLoopBackOff (exploits the T-21 port-before-migrations behavior).

**Checkpoint**: US1 deployable and demonstrable on kind. Constitution VII conforming.

---

## Phase 4: User Story 2 — Grading deliverables (Priority: P1) `[Phase P1]`

**Goal**: Every required deliverable present, every mandatory diagram complete and
consistent with the code.

**Independent Test**: The user manual exists; the C4 context diagram shows the
Gateway; the deployment diagram's paths all resolve; the two source forms agree;
an integrator doc maps each §4.4 deliverable to its file.

**Statement anchor**: §4.4 deliverables (user manual, diagrams, C4+UML); rubric §8.2 (documentation 10 pts), §8.3 (−25% diagram/code inconsistency).

- [ ] T016 [P] [US2] Write the user manual at `docs/manual/README.md` (+ per-role sections): how ADMINISTRADOR, CAJERO_RECEPTOR, and CLIENTE each use every functionality (registration, activation, login, accounts, transfers, payments, audit). User-facing language, not developer setup.
- [ ] T017 [P] [US2] Add the API Gateway to the C4 context diagram in both sources: `docs/architecture/diagrams/02-c4-contexto.puml` and `02-c4-contexto.mmd`, as the system's entry point, with interactions labeled technology/protocol/synchronicity.
- [ ] T018 [P] [US2] Reconcile the two source forms of the context diagram so `02-c4-contexto.puml` and `.mmd` agree on every relation label (the repo's own "if the sources disagree, the diagram is not done" rule).
- [ ] T019 [P] [US2] Add the required technology/protocol labels to the sequence diagrams `docs/architecture/diagrams/06-uml-secuencia-crear-cuenta.puml` and `07-uml-secuencia-transferencia.puml` (remove the "no technology names" headers) and reconcile their `.mmd` forms.
- [ ] T020 [US2] Update the deployment diagram `docs/architecture/diagrams/05-uml-despliegue.puml` so every artifact it depicts resolves to a real path — the Helm chart now exists at `infra/k8s/helm/bank-usac` (built in US1); confirm the topology matches the chart (what runs in-cluster vs. external).
- [ ] T021 [US2] Write the integrator technical document at `docs/TECHNICAL_DOCUMENT.md` mapping each §4.4 deliverable (technical doc, diagrams, SLI/SLO/SLA, use cases, decision justification, user manual) to its file in the repo.
- [ ] T022 [US2] Re-render all touched diagrams (PlantUML + Mermaid) and confirm no source/export drift; link the rendered evidence.

**Checkpoint**: Deliverables complete and consistent.

---

## Phase 5: User Story 3 — Money cannot be created, lost, or frozen (Priority: P1) `[Phase P1]`

**Goal**: Across broker failures, redeliveries, and concurrent messages, a
transfer completes or compensates; money is never debited without a matching
credit/refund and never credited twice.

**Independent Test**: Inject a broker publish failure at the commit/publish
boundary for compensation (Transaction) and terminal event (Payment); both are
eventually delivered and the Saga reaches a terminal state with correct balances.
A duplicate success → exactly one credit. A compensation for a never-debited
transfer → zero credit.

**Statement anchor**: §4.2 Saga obligatorio (éxito, fallo, compensación); SRE obligatorias (idempotencia, retries, manejo de errores, garantía de no duplicidad); Constitution VI/VIII.

### Transaction Service — transactional outbox

- [ ] T023 [US3] Migration in `apps/services/transaction-service/src/infrastructure/persistence/migrations.ts`: extend `transaction_events` with `dispatch_status` (`PENDING|DISPATCHED`, default `PENDING`), `published_at` (nullable), and `envelope` (JSONB — the complete serialized envelope), plus a partial index on `dispatch_status` where `PENDING`.
- [ ] T024 [US3] In `postgres-transaction.repository.ts`, write the outbox row (state change + `transaction_events` with the full envelope) **inside the same transaction** as the state change; store the envelope so the relay republishes it verbatim (stable `idempotencyKey` — never rebuilt via `followUpEnvelope`).
- [ ] T025 [US3] Add an outbox relay scheduler at `apps/services/transaction-service/src/infrastructure/scheduler/outbox.scheduler.ts` (modeled on Payment's `RetryScheduler`): select `PENDING` rows `FOR UPDATE SKIP LOCKED` inside a transaction, publish the stored envelope, mark `DISPATCHED`; start it from `main.ts` after the broker.
- [ ] T026 [US3] Make `PAYMENT_SUCCEEDED` idempotent in `apps/services/transaction-service/src/domain/transaction.ts` — a second occurrence for a transfer already past `PAYMENT_PENDING` is a no-op, not a second `account.credit.requested.v1`.
- [ ] T027 [US3] Add the missing consumer for `payment.attempt.failed.v1` in `apps/services/transaction-service/src/interfaces/message-handlers.ts` so the retry ladder becomes observable (`errorType`/`attempt` populated in `transaction.status.replied.v1`).

### Payment Service — outbox + terminal-event durability

- [ ] T028 [US3] Migration in `apps/services/payment-service/src/infrastructure/persistence/migrations.ts`: add dispatch columns (`dispatch_status`, `published_at`, stored `envelope`) for the terminal event and each `attempt.failed`.
- [ ] T029 [US3] In `postgres-payment.repository.ts` + `process-payment.use-case.ts`, write the terminal/attempt event to the outbox inside the state transaction; fix the `open()` → `EXISTS` → `return` path so a redelivery ensures the terminal event is (or will be) dispatched rather than ACKed away; remove the incorrect `messageId`-dedup comment.
- [ ] T030 [US3] Add the Payment outbox relay scheduler (or extend `retry.scheduler.ts`) to publish `PENDING` outbox rows and mark them dispatched.
- [ ] T031 [US3] Handle the second unique index gracefully: in `open()`, treat a `(transaction_id)` conflict as already-open for that transfer instead of crashing into the DLQ.

### Account Service — business-identity dedup + compensation guard

- [X] T032 [US3] Migration in `apps/services/account-service/src/infrastructure/persistence/migrations.ts`: add a partial `UNIQUE (transaction_id, type)` on `account_operations` so a movement for a transfer cannot apply twice even under a fresh envelope (durable guard behind the existing transport dedup).
- [X] T033 [US3] In `postgres-account.repository.ts`, make compensation check the `rowCount` of the `UPDATE ... WHERE type='DEBIT'`: if no debit matched, do **not** credit — record the anomaly (rejected/ignored outcome) instead of silently creating funds (FR-009).

### Tests (required by NFR-002)

- [ ] T034 [P] [US3] Transaction integration tests (real PostgreSQL) in `apps/services/transaction-service/test/`: outbox row written in the state tx; relay publishes exactly once; broker-failure-then-recovery delivers the compensation; `PAYMENT_SUCCEEDED` twice → one credit ordered.
- [ ] T035 [P] [US3] **New** Payment integration tests in `apps/services/payment-service/test/repository.integration.spec.ts` (the service has none today): `FOR UPDATE` serialization, the four coherence CHECKs, both unique indexes, `due()`, and terminal-event durability under a dropped publish.
- [ ] T036 [P] [US3] Account integration tests in `apps/services/account-service/test/`: the `UNIQUE (transaction_id, type)` blocks a double credit under a fresh envelope; compensation for a never-debited transfer credits zero and records the anomaly.

**Checkpoint**: Money integrity holds under failure. Constitution VI restored.

---

## Phase 6: User Story 4 — Act only within your own authority (Priority: P1) `[Phase P1]`

**Goal**: A client updates only their own record; no message path creates a
privileged account; concurrent updates don't silently overwrite.

**Independent Test**: As a client, update another client's record → refused; a
register command with an elevated role on the broker → rejected; two concurrent
updates → neither field lost.

**Statement anchor**: §4.1 three roles + JWT; Customer SRE nota "protección contra condiciones de carrera"; "complementar funcionalidad faltante para cumplir el flujo".

- [X] T037 [US4] Pass `envelope.identity` into the use-case: change `apps/services/customer-service/src/interfaces/message-handlers.ts` so the update handler forwards `envelope.identity`, and change `UpdateCustomerUseCase.execute(command, identity, idempotencyKey)` in `application/update-customer.use-case.ts`.
- [X] T038 [US4] Add a domain `mayUpdate(identity, subjectId)` in `apps/services/customer-service/src/domain/customer.ts` (mirror of Account's `openingRefusal`) and refuse in the use-case when `identity.role === 'CLIENTE' && identity.customerId !== command.customerId` — record the refusal, publish no change event (FR-011).
- [X] T039 [US4] Migration: add a `version` column (integer default 0) to `customers` in `apps/services/customer-service/src/infrastructure/persistence/migrations.ts`.
- [X] T040 [US4] In `postgres-customer.repository.ts` `saveUpdate`, read with `SELECT ... FOR UPDATE` in the same transaction as the `UPDATE` and include `version = version + 1 ... WHERE customer_id = $ AND version = $` (mirror Account's optimistic guard) so concurrent updates cannot lose a field (FR-013).
- [X] T041 [US4] Validate the role at the domain on registration: `registerCustomer` in `domain/customer.ts` receives the identity and throws `ROLE_NOT_ELIGIBLE` (already declared, never thrown here) for a non-CLIENTE role without an ADMINISTRADOR actor; wire it through `register-customer.use-case.ts` (FR-012).
- [X] T042 [US4] Add `ROLE_NOT_ELIGIBLE` to the `extract` set of `apps/packages/contracts/src/events/customer/customer.register.rejected.v1.ts` so the domain rejection maps to the rejected event.
- [X] T043 [US4] Reject blank-after-trim values: trim before the contract length check (or reject post-trim empties) in `domain/customer.ts` for `full_name` and `document_number`, so a whitespace-only document cannot take the UNIQUE slot and block later registrations (FR-014).
- [X] T044 [P] [US4] Tests in `apps/services/customer-service/test/`: a CLIENTE updating another customer is refused; a register with `role: ADMINISTRADOR` and no admin identity is rejected; two concurrent updates keep both fields (integration, real PostgreSQL); a whitespace-only document is rejected.

**Checkpoint**: Access control correct. IDOR closed. **End of Phase P1 — validate and demo.**

---

## Phase 7: User Story 5 — Audit keeps what it could not process (Priority: P2) `[Phase P2]`

**Goal**: Every message that fails to parse or process is retained — recorded
INVALID or in a bound, consumed error queue — never discarded.

**Independent Test**: Publish a malformed envelope → recorded INVALID; force a
retry-ladder exhaustion → lands in the bound error queue and is recorded.

**Statement anchor**: Notification & Audit responsabilidad "registro de eventos"; SRE "manejo de errores"; §4.2 "auditoría del sistema".

- [ ] T045 [US5] In `apps/packages/messaging/src/broker.ts` + topology, bind a durable queue to the `bank.errors` exchange and route retry-exhausted / parked messages to it (today nothing binds, so RabbitMQ discards them across all seven components).
- [ ] T046 [US5] Harden `isEnvelope` in `apps/packages/messaging/src/broker.ts` to match `envelopeSchema` for the persisted fields (`messageVersion`, `producer`, UUID-shaped ids), so a malformed envelope cannot pass the lax check and crash the typed insert.
- [ ] T047 [US5] Add a `bank.errors` drainer consumer in `apps/services/notification-audit-service/` that records each parked message as an audit event with an `INVALID`/parked `processing_status`.
- [ ] T048 [US5] In `notification-audit-service/src/interfaces/message-handlers.ts`, classify an unparseable or contract-violating envelope as `INVALID` **before** touching typed columns, so the insert cannot crash into the retry void (FR-016/017).
- [ ] T049 [P] [US5] Tests: a malformed envelope is recorded INVALID (not parked/lost); a retry-exhausted message lands in the bound queue and is recorded.

**Checkpoint**: Audit trail durable.

---

## Phase 8: User Story 6 — Every function exercisable from the UI (Priority: P2) `[Phase P2]`

**Goal**: Drive every named functionality from the UI, including identity
validation, and see a command's outcome regardless of role.

**Independent Test**: As a teller, approve/reject a pending identity validation →
verdict takes effect; as a client, register and watch the confirmation resolve to
a definitive outcome; open a customer and see real stored data.

**Statement anchor**: §4.4 "diseñar una interfaz para la validación de las funcionalidades de cada microservicio"; Customer function "validación de identidad".

### New read contracts (Customer Service's first queries)

- [ ] T050 [P] [US6] Add contracts `customer.get.query.v1` / `customer.get.replied.v1` in `apps/packages/contracts/src/events/customer/` (redacted customer view, scoped by identity) and register them in the catalog.
- [ ] T051 [P] [US6] Add contracts `customer.pending-validation.query.v1` / `.replied.v1` (teller's queue of customers awaiting identity validation, bounded, reports `omitted`) and register them.
- [ ] T052 [P] [US6] Add the scoped command-outcome query contracts `command.outcome.query.v1` / `.replied.v1` (returns only outcomes for the caller's own correlation) and register them.
- [ ] T053 [P] [US6] Contract tests for the four new query/reply pairs, including no-secrets allowlist coverage (the customer read reply must stay redacted).

### Service handlers (respect isolation)

- [ ] T054 [US6] Implement the `customer.get` and `customer.pending-validation` query handlers in `apps/services/customer-service/src/` reading only Customer's own tables, redacting by caller identity; keep `test/isolation.spec.ts` green (these are the service's first queries — all handlers today are commands).
- [ ] T055 [US6] Implement the scoped command-outcome handler in `apps/services/notification-audit-service/` (receives `identity`, returns the outcome only if the root event's originator matches — record the originating `customerId` if needed).

### Gateway routes

- [ ] T056 [US6] Add `POST /api/customers/{customerId}/identity-validation` (multipart) in `apps/gateway/src/interfaces/customers.controller.ts`: upload the photo to MinIO like registration and publish the existing `customer.validate-identity.v1` with the teller's identity; add the `ROUTE_MESSAGES` row and OpenAPI entry.
- [ ] T057 [P] [US6] Add `GET /api/customers/{customerId}`, `GET /api/customers/pending-validation`, and the scoped outcome route in the Gateway, wired to the new query contracts, with `route-messages.ts` rows and OpenAPI entries.

### Frontend (design gate applies)

- [ ] T058 [US6] Inspect the Claude Design reference (`docs/DESIGN.md` → `bonking.dc.html`, `support.js`) and confirm the pending→submitting→confirmed/failed states for the identity-validation and command-outcome surfaces before editing (frontend design gate).
- [ ] T059 [US6] Enable the identity-validation UI: wire the approve/reject actions and the submit-with-photo in `apps/web/app/pages/clientes/validaciones/index.vue` and `[id].vue` (remove the `disabled` buttons), populate the queue from `customer.pending-validation` and the detail from `customer.get`.
- [ ] T060 [US6] Make a non-administrator see their own command outcome: in `apps/web/app/composables/useCommandOutcome.ts`, watch the scoped outcome endpoint instead of gating on `role === 'ADMINISTRADOR'`, so registration/account-opening resolve to a definitive state for every role.
- [ ] T061 [US6] Populate the customer update form (`apps/web/app/components/customer/CustomerUpdateForm.vue`) from the new read path so it is no longer edited blind.
- [ ] T062 [P] [US6] Capture UI evidence (screenshots/notes via the `/run` skill) of the enabled validation flow and a non-admin outcome resolving; link it from the feature design notes (frontend verification gate).

**Checkpoint**: Full functional coverage from the UI.

---

## Phase 9: User Story 7 — Public surface & delivery hardening (Priority: P2) `[Phase P2]`

**Goal**: Anonymous entry points resist abuse; activation tokens have a bounded
lifecycle; a transient delivery failure does not strand a signup.

**Independent Test**: Hammer public routes → throttled; request activation
repeatedly → only the latest token validates; drop the delivery channel → the
notification retries and delivers.

**Statement anchor**: notification retry serves the stated activation flow ("activar por primer login enviando un correo con un link"); the rest is audit hardening beyond the PDF.

- [ ] T063 [US7] Add the notification retry sweeper in `apps/services/notification-audit-service/src/infrastructure/scheduler/` that retries `PENDING`/`FAILED` rows (the `notifications.status` column and `settleNotification` already exist) so a transient delivery failure does not permanently strand an activation email (FR-024, **flujo del enunciado**).
- [ ] T064 [US7] Set `REVEAL_ACTIVATION_LINKS` to default-off in `infra/docker/docker-compose.images.yml` (production-style stack should not print activation links to logs) (FR-025, higiene).
- [ ] T065 [US7] `[fuera-de-enunciado]` Add `@nestjs/throttler` to the Gateway with a global `ThrottlerGuard` and strict limits on the three `@Public()` routes (`/api/auth/login`, `POST /api/customers`, `GET /api/customers/verify-email`) in `apps/gateway/` (FR-021).
- [ ] T066 [US7] `[fuera-de-enunciado]` Bound anonymous object-store writes: in `apps/gateway/src/application/routes/register-customer.use-case.ts`, prevent an unauthenticated loop from accumulating orphaned MinIO uploads (rate-limit-tied or defer the upload until after basic acceptance) (FR-022).
- [ ] T067 [US7] `[fuera-de-enunciado]` Invalidate prior live activation tokens: in `postgres-customer.repository.ts` `saveActivationToken`, mark the customer's unused tokens consumed inside the same transaction as the insert, so only the latest link validates (FR-023).
- [ ] T068 [P] [US7] Tests for the retry sweeper (a dropped-then-restored delivery is retried) and, if included, the token-invalidation behavior.

**Checkpoint**: Public surface hardened. **End of Phase P2 — validate and demo.**

---

## Phase 10: User Story 8 — Infrastructure & configuration hygiene (Priority: P3) `[Phase P3]`

**Goal**: A clean checkout comes up with derived, consistent configuration and no
versioned plaintext credential overriding the developer's.

**Independent Test**: `cp .env.example .env` + `write-host-env.sh` + `pnpm dev:host`
with zero manual correction; the broker authenticates with the configured
password.

**Statement anchor**: reproducibility of the local stack; §4.3 external DBs / local run.

- [ ] T069 [P] [US8] Correct the ports in `infra/docker/.env.example` to the ports the stack actually publishes (5673/15673/9002/9003), matching the README and recorded compose evidence.
- [ ] T070 [P] [US8] Derive ports in `infra/docker/scripts/write-host-env.sh` from the single source of truth instead of hardcoding `5673`/`9002`/`5433-5437` (honor the script's own promise).
- [ ] T071 [P] [US8] Fix the RabbitMQ credential import: stop `infra/docker/rabbitmq/rabbitmq_definitions.json` (with `load_definitions`) from importing a plaintext `changeme` that overrides `RABBITMQ_DEFAULT_USER/PASS`, so a developer's `.env` password actually takes effect.
- [ ] T072 [P] [US8] Replace `eval "$line"` with the safe `set -a; source` form (already used in `smoke-images.sh`) in `validate-env.sh`, `test-isolation.sh`, `test-failures.sh`, and `init-minio.sh`.

**Checkpoint**: Clean checkout reproducible.

---

## Phase 11: User Story 9 — Scheduled work runs reliably (Priority: P3) `[Phase P3]`

**Goal**: The deactivation job runs dependably (including at startup); concurrent
sweepers don't duplicate work; a manual deactivation's reason is preserved.

**Independent Test**: Restart on a short interval → the job still runs; two
sweepers → each due row claimed once; a manual deactivation reason appears in the
audit trail.

**Statement anchor**: Account function "proceso automático de desactivación de cuentas inactivas"; SRE "manejo de errores".

- [ ] T073 [US9] Run the deactivation job at startup and/or catch up missed runs (consult `deactivation_runs`) in `apps/services/account-service/src/infrastructure/scheduler/deactivation.scheduler.ts`, so a frequently restarted pod does not skip it forever (FR-030).
- [ ] T074 [US9] Fix the retry sweeper's lock in `apps/services/payment-service/src/infrastructure/persistence/postgres-payment.repository.ts` `due()`: run the `FOR UPDATE SKIP LOCKED` inside a real transaction so the lock holds across replicas (today it is autocommit and both sweepers read the same batch) (FR-031).
- [X] T075 [US9] Persist the manual-deactivation `reason`: read it in `set-account-status.use-case.ts`, store it, and carry it on `account.deactivated.v1` (contract change) so the audit trail shows why (FR-032, and the required-but-discarded `reason` finding).
- [ ] T076 [P] [US9] Tests: the job runs at startup; the retry sweeper claims each row once; the deactivation reason is persisted and emitted.

**Checkpoint**: Scheduled work reliable.

---

## Phase 12: User Story 10 — Documentation & contract consistency (Priority: P3) `[Phase P3]`

**Goal**: Exported schemas, the documentation inventory, and the decision records
match the code.

**Independent Test**: Regenerate schemas → count matches the catalog; the
inventory coverage claim is accurate; the ADR count and blocked-state notes match
reality.

**Statement anchor**: rubric §8.3 (−25% diagram/code inconsistency); §4.4 documentation quality.

- [ ] T077 [US10] Regenerate the exported JSON schemas (`pnpm --filter @bank/contracts schema:emit`) so `schema/*.json` matches the 55-contract catalog (currently 48), and add a drift test in `apps/packages/contracts/test/` that fails when `schema/` and the catalog disagree (FR-033).
- [ ] T078 [P] [US10] Fix `docs/DOC_INVENTORY.md` so its coverage claim is accurate (add the missing rules/rows, correct the "expected uncovered set is empty" claim, and fix the non-runnable verification snippet) (FR-034).
- [ ] T079 [P] [US10] Correct the ADR count in `docs/architecture/README.md` and `adr/README.md` (thirteen, not eleven) and reconcile the stale `blocked` notes in `docs/SECURITY.md`, `docs/PRODUCT_SENSE.md`, and the inventory's `FRONTEND.md` state (FR-035).

**Checkpoint**: Docs and contracts consistent.

---

## Phase 13: Polish & Cross-Cutting

**Purpose**: Close out and prove the whole feature.

- [ ] T080 Update `ARCHITECTURE.md` and `CLAUDE.md`/`AGENTS.md` status so the Kubernetes deployment (US1) is reflected as built (the constitution requires ARCHITECTURE.md to mirror the principles, and Principle VII is now conforming).
- [ ] T081 [P] Update the tech-debt record: close the debts this feature resolves (TD-031 outbox, TD-020 customer read, TD-023 identity validation, and the deactivation-reason/`bank.errors` findings) in `docs/TECH_DEBT.md` (or wherever tracked).
- [ ] T082 Run the full `specs/008-audit-remediation/quickstart.md` validation end to end (all three phases) and record evidence.
- [ ] T083 Final gate: `pnpm lint`, `pnpm test`, `pnpm test:contract`, `pnpm typecheck`, `pnpm images:smoke`, `pnpm images:flow` all green; confirm no synchronous inter-service call or cross-database access was introduced (isolation specs green).

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (P1 phase 1)** → no dependencies.
- **Foundational (phase 2)** → after Setup; conventions only, blocks nothing structurally.
- **Phase P1 (US1–US4)** → after Foundational. US1–US4 are largely independent (different services/trees) and can proceed in parallel if staffed; US2's deployment-diagram task (T020) depends on US1's chart existing (T007).
- **Phase P2 (US5–US7)** → after P1 is validated. US5, US6, US7 are independent of each other.
- **Phase P3 (US8–US10)** → after P2. All three independent.
- **Polish (phase 13)** → after all desired stories.

### Cross-story notes

- **T020** (US2 deployment diagram) depends on **T007** (US1 chart scaffold).
- **US6 handlers** (T054–T055) depend on the **new contracts** (T050–T052).
- **US7 T066** (bound uploads) is easier once **T065** (throttler) exists, but can be done independently.
- The outbox relay (US3) and the notification sweeper (US7 T063) share the "scheduler modeled on RetryScheduler" pattern but live in different services — no code dependency.

### Within each story

- Migrations before the repository code that uses the new columns.
- Contracts before the handlers that consume them.
- Service handlers before the Gateway routes before the frontend wiring.
- Money-path integration tests (US3) after the behavior they assert exists.

---

## Parallel Opportunities

- **Setup**: T002, T003 in parallel.
- **US1**: T008, T009, T010 (different template dirs) in parallel after the chart scaffold T007.
- **US2**: T016–T019 (manual, context, sequence diagrams) all in parallel; T020 waits on US1.
- **US3**: the three services' work (Transaction T023–T027, Payment T028–T031, Account T032–T033) proceed in parallel; the three integration-test tasks T034–T036 in parallel.
- **US6**: the four contract tasks T050–T053 in parallel; then handlers, then routes, then frontend.
- **US8**: T069–T072 all in parallel (different files).
- Different developers can own different P1 stories once Foundational is done.

---

## Implementation Strategy

### MVP (Phase P1)

1. Setup + Foundational.
2. **US1 Kubernetes** → the −100% rubric gate closed; validate on kind. This alone is the single biggest grade move.
3. **US2 Deliverables**, **US3 Money integrity**, **US4 Access control** → the rest of the criticals.
4. **STOP and validate Phase P1** — deploy on kind, run `images:flow`, demo the transfer and the refused IDOR. This is the gradeable core.

### Incremental delivery

- Phase P1 → validate/demo (the criticals).
- Phase P2 (US5–US7) → durability, UI coverage, hardening → validate/demo.
- Phase P3 (US8–US10) → hygiene, jobs, docs → validate/demo.

### Fidelity guard

- Every task traces to the statement or its rubric except the three tagged
  `[fuera-de-enunciado]` (T065, T066, T067), included by explicit user decision as
  audit hardening. Nothing else adds scope beyond the PDF.

---

## Notes

- `[P]` = different files/services, no dependency on an incomplete task.
- `[Story]` maps each task to its user story for traceability to spec.md.
- `[fuera-de-enunciado]` = beyond the literal project statement (pure security hardening), kept by user decision.
- Commit after each task or logical group; stop at any checkpoint to validate a story independently.
- The invariant from T005 holds throughout: async-only, one DB per service, isolation specs and lint architecture rules green.
