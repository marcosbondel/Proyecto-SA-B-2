# Tasks: Infraestructura local de desarrollo (T-06)

**Input**: Design documents from `/specs/006-local-dev-infra/`

**Prerequisites**: [plan.md](plan.md), [spec.md](spec.md), [research.md](research.md), [data-model.md](data-model.md), [contracts/](contracts/)

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1, US2, US3, US4, US5, US6)
- Include exact file paths in descriptions

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Create directory structure, placeholder files, and the environment-variable contract.

- [x] T001 Create `infra/docker/scripts/` directory and add `.gitkeep`
- [x] T002 Create `infra/docker/.env.example` with placeholders for all PostgreSQL, RabbitMQ, and MinIO variables per [contracts/env-vars.md](contracts/env-vars.md)
- [x] T003 [P] Create `specs/006-local-dev-infra/evidence/` directory and add `.gitkeep`
- [x] T004 [P] Update `infra/docker/README.md` to remove the "Blocked" notice and link to [quickstart.md](quickstart.md)
- [x] T005 Ensure `infra/k8s/` contains no database, broker, or object-store manifests beyond `README.md`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Build the shared Compose skeleton that every user story depends on.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [x] T006 Create `infra/docker/docker-compose.yml` with the fixed `bank-usac-local` network definition
- [x] T007 [P] Add the five PostgreSQL services to `infra/docker/docker-compose.yml` with pinned `postgres:18.4` image, distinct ports 5433–5437, distinct users, distinct databases, distinct volumes, and `pg_isready` health checks
- [x] T008 [P] Add the `rabbitmq` service to `infra/docker/docker-compose.yml` with pinned `rabbitmq:4.3.4-management` image, ports 5672/15672, volume `rabbitmq-data`, and `rabbitmq-diagnostics ping` health check
- [x] T009 [P] Add the `minio` service to `infra/docker/docker-compose.yml` with pinned `minio/minio:RELEASE.2024-11-07T00-52-20Z` image, ports 9000/9001, volume `minio-data`, and health check
- [x] T010 Declare all named volumes (`pgdata-*`, `rabbitmq-data`, `minio-data`) in `infra/docker/docker-compose.yml`
- [x] T011 Create `infra/docker/scripts/validate-env.sh` that fails fast if any required variable in [contracts/env-vars.md](contracts/env-vars.md) is empty or unset
- [x] T012 Run `docker compose -f infra/docker/docker-compose.yml config` and save the output to `specs/006-local-dev-infra/evidence/docker-compose-config.yml`

**Checkpoint**: `docker compose config` exits 0 and the rendered file contains seven services, one network, and seven volumes.

---

## Phase 3: User Story 1 — Un comando levanta el entorno completo y sano (Priority: P1) 🎯 MVP

**Goal**: From a clean clone, copy `.env.example`, fill values, run one command, and have RabbitMQ, five PostgreSQL instances, and MinIO all healthy.

**Independent Test**: `docker compose -f infra/docker/docker-compose.yml --env-file infra/docker/.env up -d && docker compose ps` shows seven healthy containers.

### Implementation for User Story 1

- [x] T013 [US1] Wire `validate-env.sh` into the documented startup command in `infra/docker/README.md` and [quickstart.md](quickstart.md)
- [x] T014 [US1] Verify that each PostgreSQL service starts independently with no cross-dependency declared in `infra/docker/docker-compose.yml`
- [x] T015 [US1] Verify RabbitMQ starts independently and does not depend on any database in `infra/docker/docker-compose.yml`
- [x] T016 [US1] Verify MinIO starts independently and does not depend on any database in `infra/docker/docker-compose.yml`
- [x] T017 [US1] Document the single startup command in `infra/docker/README.md` and [quickstart.md](quickstart.md)
- [x] T018 [US1] Capture `docker compose ps` output as `specs/006-local-dev-infra/evidence/containers-healthy.log`

**Checkpoint**: US1 is independently testable from a clean clone in under 5 minutes.

---

## Phase 4: User Story 2 — Cada servicio se autentica únicamente contra su propia base (Priority: P1)

**Goal**: Enforce and prove that each PostgreSQL user can only connect to its own database.

**Independent Test**: `./infra/docker/scripts/test-isolation.sh` shows 5 own connections accepted and 20 cross connections rejected.

### Implementation for User Story 2

- [x] T019 [P] [US2] Configure each PostgreSQL service in `infra/docker/docker-compose.yml` to create its database and application user on first start via `POSTGRES_DB`, `POSTGRES_USER`, and `POSTGRES_PASSWORD`
- [x] T020 [P] [US2] Ensure no shared users or superuser grants exist in any PostgreSQL initialization path
- [x] T021 [US2] Create `infra/docker/scripts/test-isolation.sh` that attempts the 5 own and 20 cross connections and reports pass/fail counts
- [x] T022 [US2] Run `test-isolation.sh` against the live stack and save output to `specs/006-local-dev-infra/evidence/test-isolation.log`
- [x] T023 [US2] Document the isolation proof in `infra/docker/README.md`

**Checkpoint**: The credential-isolation evidence file shows 5/5 accepted and 20/20 rejected.

---

## Phase 5: User Story 3 — El broker declara la topología de T-05 y demuestra un mensaje con `correlationId` (Priority: P1)

**Goal**: Load the broker topology from `docs/events/topology.md` at boot and prove a test message carries its `correlationId` through to the DLQ.

**Independent Test**: Exported broker definitions match [contracts/broker-topology.md](contracts/broker-topology.md), and the broker adapter integration test passes.

### Implementation for User Story 3

- [x] T024 [US3] Add `RABBITMQ_APP_USER` creation and permission restrictions in the broker definition generation so the application user has no administrator tags
- [x] T025 [US3] Create a generator script (e.g., `apps/packages/contracts/scripts/export-topology.ts`) that produces `rabbitmq_definitions.json` from `apps/packages/contracts/src/routing/topology.ts`
- [x] T026 [US3] Mount `rabbitmq_definitions.json` into the broker container and configure `load_definitions` in `infra/docker/docker-compose.yml`
- [x] T027 [US3] Create `infra/docker/scripts/test-broker.sh` that exports broker definitions via the management API and compares exchanges/queues/bindings with [contracts/broker-topology.md](contracts/broker-topology.md)
- [x] T028 [US3] Add a TypeScript broker integration test under `@bank/messaging` that publishes/consumes a message with `correlationId` and asserts a failed message reaches the DLQ with `x-attempt`, `x-failure-reason`, `x-failed-at`, and `x-original-routing-key`
- [x] T029 [US3] Save exported broker definitions to `specs/006-local-dev-infra/evidence/rabbitmq-definitions.json`
- [x] T030 [US3] Save broker adapter test output to `specs/006-local-dev-infra/evidence/test-broker.log`

**Checkpoint**: Broker topology exists before any application starts; DLQ headers are verified.

---

## Phase 6: User Story 4 — Los datos sobreviven reinicios y los cuatro fallos exigidos están probados (Priority: P2)

**Goal**: Prove data survives restarts and capture executable evidence for the four required failure scenarios.

**Independent Test**: `./infra/docker/scripts/test-persistence.sh` and `./infra/docker/scripts/test-failures.sh` both pass.

### Implementation for User Story 4

- [x] T031 [US4] Create `infra/docker/scripts/test-persistence.sh` that writes one row per database, restarts the stack, and verifies all five rows remain
- [x] T032 [US4] Run `test-persistence.sh` and save output to `specs/006-local-dev-infra/evidence/test-persistence.log`
- [x] T033 [US4] Create `infra/docker/scripts/test-failures.sh` with the four scenarios: (a) one DB down, others up; (b) wrong credentials rejected; (c) broker unavailable triggers controlled retry/error; (d) stopped consumer preserves durable messages
- [x] T034 [US4] Implement scenario (a) in `infra/docker/scripts/test-failures.sh`
- [x] T035 [US4] Implement scenario (b) in `infra/docker/scripts/test-failures.sh`
- [x] T036 [US4] Implement scenario (c) in `infra/docker/scripts/test-failures.sh` using `@bank/messaging` adapter logs
- [x] T037 [US4] Implement scenario (d) in `infra/docker/scripts/test-failures.sh`
- [x] T038 [US4] Run `test-failures.sh` and save output to `specs/006-local-dev-infra/evidence/test-failures.log`

**Checkpoint**: Persistence and all four failure scenarios have saved executable evidence.

---

## Phase 7: User Story 5 — La configuración es reproducible y los secretos nunca entran al repositorio (Priority: P2)

**Goal**: Ensure any teammate can reproduce the environment from `.env.example` and that no real credentials are committed.

**Independent Test**: Audit finds zero real credentials; `validate-env.sh` fails fast on missing variables; connection paths from host and from kind are documented.

### Implementation for User Story 5

- [x] T039 [P] [US5] Verify every variable referenced in `infra/docker/docker-compose.yml` exists in `infra/docker/.env.example`
- [x] T040 [P] [US5] Verify every variable in `infra/docker/.env.example` is documented in [contracts/env-vars.md](contracts/env-vars.md)
- [x] T041 [US5] Run a credential audit (e.g., `git-secrets` scan or manual review) and confirm zero real secrets in the repository
- [x] T042 [US5] Document host connection strings (`localhost` + ports) in [quickstart.md](quickstart.md) without real values
- [x] T043 [US5] Document kind connection mechanism via shared Docker network `bank-usac-local` and the `host.docker.internal` fallback in [quickstart.md](quickstart.md)
- [x] T044 [US5] Update `docs/SECURITY.md` to define the cross-service access policy and the local secret-loading mechanism, removing the two T-06 blocker notes
- [x] T045 [US5] Verify `infra/docker/.env.example` contains only placeholders and no default real passwords

**Checkpoint**: `.env.example` is complete; security blockers are resolved; no credentials are committed.

---

## Phase 8: User Story 6 — La limpieza del entorno está documentada y es segura (Priority: P3)

**Goal**: Document stop, standard clean-up, and destructive clean-up commands, plus troubleshooting for common failures.

**Independent Test**: Following the documented commands removes only what the user expects; the destructive variant is clearly marked.

### Implementation for User Story 6

- [x] T046 [US6] Document the standard stop command (`docker compose down`) in `infra/docker/README.md` and [quickstart.md](quickstart.md), noting that volumes are preserved
- [x] T047 [US6] Document the destructive clean-up command (`docker compose down -v`) in `infra/docker/README.md` and [quickstart.md](quickstart.md), explicitly warning that it deletes data
- [x] T048 [US6] Add a troubleshooting section to `infra/docker/README.md` covering port conflicts, missing `.env`, unhealthy containers, and orphaned volumes
- [x] T049 [US6] Document how to restart a single service without touching the rest (e.g., `docker compose up -d postgres-customer`)
- [x] T050 [US6] Verify none of the documented clean-up commands delete files outside Docker volumes or require `sudo`

**Checkpoint**: Clean-up commands are documented, safe, and destructive operations are explicit.

---

## Phase 9: Polish & Cross-Cutting Concerns

**Purpose**: Close debt, update indexes, and finalize the feature.

- [x] T051 [P] Update `AGENTS.md` to reflect that local infrastructure (T-06) is now built
- [x] T052 [P] Update `docs/METHODOLOGY.md` if ticket status tracking is required for T-06
- [x] T053 [P] Remove the "Blocked" notice from `infra/docker/README.md` if still present
- [x] T054 Close TD-014 in `docs/TECH_DEBT.md` with a link to the broker adapter test evidence
- [x] T055 Close TD-015 in `docs/TECH_DEBT.md` with a link to the Compose file evidence
- [x] T056 Run the full quickstart validation from [quickstart.md](quickstart.md) and confirm the evidence checklist is complete

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — can start immediately.
- **Foundational (Phase 2)**: Depends on Phase 1 — blocks all user stories.
- **User Story 1 (P1)**: Depends on Phase 2.
- **User Story 2 (P1)**: Depends on Phase 2 and US1 (the stack must be up to test isolation).
- **User Story 3 (P1)**: Depends on Phase 2 and US1.
- **User Story 4 (P2)**: Depends on Phase 2, US1, US2, and US3.
- **User Story 5 (P2)**: Depends on Phase 2 and US1; can be done in parallel with US2/US3/US4 once US1 is ready.
- **User Story 6 (P3)**: Depends on Phase 2 and US1.
- **Polish (Phase 9)**: Depends on all user stories.

### User Story Dependencies

```text
US1 (P1) ──┬── US2 (P1)
           ├── US3 (P1)
           ├── US4 (P2) ── depends on US2, US3
           ├── US5 (P2)
           └── US6 (P3)
```

### Parallel Opportunities

- Phase 1 tasks marked [P] can run in parallel.
- Phase 2 tasks T007, T008, T009 can run in parallel once the network is declared.
- Once Phase 2 is complete, US2, US3, US5, and US6 can start in parallel; US4 waits for US2 and US3.
- Phase 9 documentation tasks marked [P] can run in parallel.

---

## Parallel Example: Phase 2 Foundation

```bash
# These tasks touch different Compose service blocks:
T007 Add PostgreSQL services to docker-compose.yml
T008 Add RabbitMQ service to docker-compose.yml
T009 Add MinIO service to docker-compose.yml
```

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup.
2. Complete Phase 2: Foundational.
3. Complete Phase 3: US1 — stack up and healthy.
4. **STOP and VALIDATE**: clean clone + two-step startup under 5 minutes.

### Incremental Delivery

1. Setup + Foundational → foundation ready.
2. US1 → stack healthy.
3. US2 → database isolation proven.
4. US3 → broker topology and adapter test proven.
5. US4 → persistence and failure evidence captured.
6. US5 → reproducible config and security blockers closed.
7. US6 → cleanup and troubleshooting documented.
8. Polish → debt closed and indexes updated.

---

## Notes

- Each task includes an exact file path or output path.
- [P] tasks have no dependency on other incomplete tasks.
- Tests are executable scripts and saved logs, matching the evidence-driven methodology.
- Stop at any checkpoint to validate the related user story independently.
