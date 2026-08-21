# Research: Local Development Infrastructure (T-06)

This document resolves the technical unknowns left open by the feature specification and records why each decision was chosen.

## 1. MinIO version

**Decision**: Pin `minio/minio:RELEASE.2024-11-07T00-52-20Z` and use the matching `minio/mc:RELEASE.2024-11-21T17-21-54Z` client for init.

**Rationale**:
- The specification requires a concrete MinIO version, just like PostgreSQL 18.4 and RabbitMQ 4.3.4-management.
- A date-stamped release is MinIO's stable channel and is available on Docker Hub.
- Pinning prevents silent upgrades that could change default bucket policies or retention behavior during the demonstration.

**Alternatives considered**:
- `minio/minio:latest` — rejected because it is mutable and could introduce breaking CLI or WebUI changes between clones.
- `minio/minio:RELEASE.2026-08-01...` (one week older) — rejected because the 2026-08-13 release was the latest stable at design time and had no reported critical issues; either would work, but one must be pinned.

## 2. RabbitMQ topology declaration mechanism

**Decision**: A single `rabbitmq_definitions.json` file mounted into the broker container, loaded automatically via the `load_definitions` configuration key. The file is generated from `apps/packages/contracts/src/routing/topology.ts` using a small TypeScript script so the definitions stay synchronized with the contract code.

**Rationale**:
- `load_definitions` is the RabbitMQ-supported way to declare exchanges, queues, bindings, users, vhosts, and permissions at boot time. It is idempotent and reproducible.
- Generating the JSON from the canonical `topology.ts` guarantees the broker declarations match the runtime assertions that `@bank/messaging` performs, satisfying the idempotency requirement in FR-009.
- The retry ladder (1 s, 5 s, 30 s) and DLQ are explicit in the generated JSON, with exact arguments from `docs/events/topology.md`.

**Alternatives considered**:
- A custom `init-rabbitmq.sh` script executed after the container starts — rejected because it is harder to make idempotent, harder to test offline, and slower than native definition loading.
- Declaring topology only at application startup via `@bank/messaging` — rejected because it would leave the broker empty until the first service boots, making broker health and topology inspection harder during demos.

## 3. MinIO retention policy

**Decision**: Configure a 24-hour lifecycle rule on the `customer-identity-documents` bucket using the MinIO Client (`mc ilm rule add`) during init.

**Rationale**:
- ADR-012 requires the object store to be a transfer buffer, not permanent storage. A fixed retention window enforces that intent.
- 24 hours is the default requested by the specification; it is long enough for asynchronous identity-validation workflows in a demo and short enough to avoid unbounded disk growth.
- The rule applies to all objects in the bucket and expires them after one day.

**Alternatives considered**:
- Bucket-level expiration set via environment variable at server start — rejected because MinIO does not support retention windows purely through environment variables; lifecycle rules must be set with `mc`.
- Manual cleanup script — rejected because it is not reproducible and could fail silently.

## 4. Environment-variable validation

**Decision**: A shell script `validate-env.sh` sourced by the startup command (and documented in `quickstart.md`) checks that every required variable is non-empty. It exits with code 1 and prints the missing variable name.

**Rationale**:
- Fail-fast behavior prevents Compose from starting with an empty password or port and failing later with a confusing database/broker error.
- A shell script keeps the validation next to the stack and runnable independently of any framework.
- FR-014 explicitly requires host, port, user, password, database, and exchange-name validation.

**Alternatives considered**:
- Validation inside a Node.js helper — rejected because it adds a build dependency before the stack can start; the stack should be usable from a machine with only Docker.
- Validation only through `.env.example` documentation — rejected because it is not executable and does not fail fast.

## 5. Executable evidence format

**Decision**: POSIX shell scripts for environment-level evidence (`test-isolation.sh`, `test-broker.sh`, `test-failures.sh`) and a TypeScript integration test for the broker publish/consume/reconnect behavior that exercises `@bank/messaging`.

**Rationale**:
- Shell scripts can be run directly against the live Compose stack without compiling anything, satisfying the "executable evidence" requirement.
- The broker publish/consume/reconnect test is written in TypeScript because it must use the project's own `@bank/messaging` adapter and close TD-014; this requires `pnpm build` and `pnpm test:broker` or similar.

**Alternatives considered**:
- Pure TypeScript for all evidence — rejected because it forces a build step before any infrastructure check can run.
- Pure shell for broker tests — rejected because it would not exercise the actual adapter code, leaving TD-014 unresolved.

## 6. Network connectivity to kind

**Decision**: Compose attaches all services to a fixed Docker bridge network named `bank-usac-local`. kind nodes are joined to this network during cluster creation (`kind create cluster --config kind-config.yaml` with an extra container label), and external dependencies are exposed in-cluster via selectorless Services in T-22.

**Rationale**:
- This is the primary mechanism decided by ADR-007. It works identically on macOS, Linux, and Windows because kind nodes are plain Docker containers.
- A fixed network name lets `docker compose` and the kind config agree without discovering dynamic names.

**Alternatives considered**:
- `host.docker.internal` as primary — rejected because it behaves differently across operating systems and Docker Desktop versions. It remains the documented fallback.
- kind port-forwarding of each dependency — rejected because it is fragile and duplicates the port surface that ADR-007 already solved with selectorless Services.
