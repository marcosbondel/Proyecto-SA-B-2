# Implementation Plan: Audit Remediation

**Branch**: `feature/008-audit-remediation-fix` | **Date**: 2026-08-27 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/008-audit-remediation/spec.md`

## Summary

Remediate every finding from the full-repository audit (9 critical, 33 important,
40+ minor), delivered on one branch in three priority phases. Phase P1 fixes what
moves the grade or the money: the missing local Kubernetes deployment, the missing
grading deliverables (user manual, C4 Gateway, diagram/code consistency), the
money-integrity criticals (a transactional outbox so compensation and terminal
payment events cannot be lost, plus business-identity dedup so money cannot be
double-credited), and the access-control criticals (the customer-update IDOR, the
role-escalation gap, the lost-update race). Phases P2 and P3 add audit durability,
full UI functional coverage, public-surface hardening, infrastructure hygiene,
scheduler reliability, and documentation/contract consistency.

The technical approach is grounded in decisions already recorded in the repo
(ADR-007 fixes the Kubernetes mechanism; TD-031 names the outbox gap) and reuses
existing pieces (the `transaction_events` table, Payment's `RetryScheduler`, the
`notifications.status` column, Account's authorization pattern). See
[research.md](./research.md) for the grounded decisions and
[data-model.md](./data-model.md) for the schema and contract changes.

## Visual Design Check

**Source inspected**: `docs/DESIGN.md` → the Claude Design reference
(`bonking.dc.html` and the imported `support.js`).

**Screens and states this feature informs** (US6, P2):
- **Identity validation** (`/clientes/validaciones` and
  `/clientes/validaciones/[id]`) — built-but-disabled UI. Enabling it wires the
  approve/reject actions and adds the pending → submitting → confirmed/failed
  states the reference prescribes for an asynchronous command. Layout and
  component vocabulary are preserved unchanged.
- **Command-outcome surfaces** (registration confirmation, account opening) —
  reuse the pending/confirmed/failed timeline already used by the transfer detail
  screen, now applied for non-administrator roles.
- **Customer read** in the update form and validation detail — populate the
  currently-empty fields from the new read path, keeping the existing form layout.

**Visual evidence**: the `/run` skill launches the stack; the UI walkthrough in
[quickstart.md](./quickstart.md) captures the enabled validation flow and a
non-admin command resolving to a definitive outcome. No new visual language is
introduced; any deviation is recorded as intentional in the feature's design notes.

## Technical Context

**Language/Version**: TypeScript on Node 24.19.0 (`.nvmrc`), pnpm 11.21.0 workspace.

**Primary Dependencies**: NestJS (six backend apps), Nuxt 3 (`apps/web`), RabbitMQ
via `amqp-connection-manager` (`@bank/messaging`), PostgreSQL via `pg`, zod
contracts (`@bank/contracts`). New: `@nestjs/throttler` (Gateway rate limiting),
Helm + kind (deployment), no other runtime additions.

**Storage**: One external PostgreSQL per service (five instances); MinIO object
store for identity documents; RabbitMQ broker. All outside the Kubernetes cluster.

**Testing**: Jest for the six NestJS apps (unit + integration specs gated on
`DATABASE_URL`); `node --test` over `apps/web/app/lib/` for the frontend
(TD-010 — no Vue component framework); contract tests over `@bank/contracts`;
executable `isolation.spec.ts` per service; `images:smoke` / `images:flow` for the
built images. New: Payment integration tests against real PostgreSQL.

**Target Platform**: Local kind Kubernetes cluster (single node) with external
Docker-hosted dependencies; developer host via `pnpm dev:host` for iteration.

**Project Type**: Web — a monorepo of backend microservices + an API Gateway + a
Nuxt frontend, plus shared packages and infrastructure.

**Performance Goals**: The Gateway's request/reply keeps its 5-second ceiling; new
query handlers must answer within it. Rate limits on public routes are strict
enough to blunt brute force and unbounded uploads without blocking normal use.

**Constraints**: Communication between services stays 100% asynchronous (no HTTP,
no cross-database access); the Gateway holds no business logic and no database; the
outbox relay re-publishes the stored complete envelope (stable `idempotencyKey`);
databases stay outside the cluster; all isolation tests and lint architecture
rules keep passing.

**Scale/Scope**: Seven applications, three shared packages, infrastructure and
documentation. This plan touches all seven apps, both money-path services'
schemas, the contracts package (new query contracts), the messaging package
(error-queue binding, envelope strictness), the Gateway (routes, throttler), the
frontend (identity validation, outcome visibility), a new Helm chart, and the
documentation set.

## Constitution Check

*GATE: verdict per applicable principle. Re-checked after design below.*

| Principle | Verdict | Note |
|-----------|---------|------|
| I. Exactly five microservices | **PASS** | No service added, merged, or re-scoped. New query handlers stay inside Customer Service's own domain. |
| II. One DB per service, no cross-access | **PASS** | Outbox tables, `customers.version`, and query read models are each service's own tables. No query joins another domain. |
| III. Databases outside the cluster | **PASS (central to US1)** | The Helm chart deploys only workloads; the five DBs, broker, and object store stay external, reached via selectorless Services. A DB manifest inside the cluster would fail this — explicitly excluded. |
| IV. Asynchronous communication only | **PASS** | New query handlers are async request/reply over the broker (allowed). No HTTP between services; the outbox publishes to the broker. |
| V. Gateway-only entry, no business logic | **PASS** | New routes (identity validation, customer read, scoped outcome) only route to the broker; the domain decisions stay in the owning services. Rate limiting is edge concern, not business logic. |
| VI. Saga with compensation | **PASS (restored by US3)** | The outbox guarantees the compensation event is delivered; today it can be lost — this plan brings the principle back into conformance. |
| VII. Local Kubernetes deployment | **PASS (delivered by US1)** | Currently non-conforming (no manifests). The Helm chart + kind config brings it into conformance. |
| VIII. SRE from design | **PASS (hardened by US3/US5/US9)** | Idempotency keyed on business identity, durable audit of unprocessable messages, reliable scheduled jobs, correlationId preserved throughout. |

**Post-design re-check**: No new violation introduced by the design in
[data-model.md](./data-model.md). The one area to watch — new Customer Service
query handlers — is verified async-only and single-database; `isolation.spec.ts`
remains the executable guard. **Gate: PASS.**

## Project Structure

### Documentation (this feature)

```text
specs/008-audit-remediation/
├── plan.md              # This file
├── research.md          # Phase 0 — grounded decisions (R1–R9)
├── data-model.md        # Phase 1 — schema & contract changes
├── quickstart.md        # Phase 1 — validation scenarios
├── contracts/           # Phase 1 — new/changed message contracts
│   └── README.md
├── checklists/
│   └── requirements.md  # Spec quality checklist (from /speckit-specify)
└── tasks.md             # Phase 2 — created by /speckit-tasks (NOT here)
```

### Source Code (repository root)

```text
apps/
├── gateway/                              # US4 (identity wiring), US6 (routes), US7 (throttler)
│   └── src/interfaces/                   #   customers.controller.ts, guards, throttler
├── services/
│   ├── customer-service/                 # US4 (IDOR, role, lost update, blank), US6 (query handlers)
│   │   └── src/{domain,application,infrastructure,interfaces}/
│   ├── account-service/                  # US3 (compensation guard, business-id dedup), US9 (job at startup)
│   ├── transaction-service/              # US3 (outbox: transaction_events dispatch + relay, PAYMENT_SUCCEEDED idempotent)
│   ├── payment-service/                  # US3 (outbox dispatch column + relay, sweeper lock fix, integration tests)
│   └── notification-audit-service/       # US5 (bank.errors drainer, INVALID recording), US7 (notification sweeper)
├── packages/
│   ├── contracts/                        # US6 (customer.get / pending-validation / outcome query contracts), US10 (schema export + drift test)
│   ├── messaging/                        # US5 (bind + consume bank.errors, harden isEnvelope)
│   └── tooling/                          # US10 (optional: pg lint rule, shared HTTP-ban)
└── web/                                  # US6 (enable identity validation UI, non-admin outcome, customer read)

infra/
├── k8s/helm/bank-usac/                   # US1 — NEW Helm chart (templates per component, external-dep Services, ConfigMap, Secret)
├── k8s/kind/                             # US1 — NEW kind cluster config joined to bank-usac-local
└── docker/                               # US8 — .env.example ports, write-host-env.sh, rabbitmq defs, eval→source

docs/
├── manual/                               # US2 — NEW user manual (role × functionality)
├── architecture/diagrams/                # US2 — C4 context + Gateway, deployment ↔ real chart, source parity
└── (integrator technical document)       # US2 — maps each §4.4 deliverable to its file
```

**Structure Decision**: The monorepo layout is fixed; this feature edits within
it and adds two new trees — `infra/k8s/helm/bank-usac` + `infra/k8s/kind` (US1) and
`docs/manual` (US2). No application is added or removed; the five-service boundary
is untouched.

## Delivery Phases

The spec's priorities define the sequence. `tasks.md` will group tasks by phase;
each phase is independently demonstrable and committed incrementally.

**Phase P1 — grade and money (US1–US4).** The four critical clusters:
1. **US1 Kubernetes** — Helm chart, kind config, external-dependency Services,
   verified `helm upgrade --install` + a transfer end to end on the cluster.
2. **US2 Deliverables** — user manual, C4 context with Gateway, deployment diagram
   aligned to the real chart, diagram-source parity, integrator technical doc.
3. **US3 Money integrity** — transactional outbox in Transaction and Payment
   (re-publishing the stored envelope), `PAYMENT_SUCCEEDED` made idempotent,
   Account business-identity dedup + compensation-exists guard, Payment
   integration tests.
4. **US4 Access control** — customer-update authorization (IDOR), domain role
   validation on registration, `version` + row-lock on update, blank-value
   rejection.

**Phase P2 — durability, coverage, surface (US5–US7).**
5. **US5 Audit durability** — bind + consume `bank.errors`, record INVALID
   envelopes, harden `isEnvelope`.
6. **US6 UI coverage** — identity-validation route + enabled UI, customer read
   path (new query contracts), non-admin command-outcome visibility.
7. **US7 Hardening** — `@nestjs/throttler` on public routes, activation-token
   invalidation, notification retry sweeper, `REVEAL_ACTIVATION_LINKS` default-off.

**Phase P3 — hygiene, jobs, docs (US8–US10).**
8. **US8 Infra/config** — `.env.example` ports, `write-host-env.sh` derivation,
   RabbitMQ credential import, `eval`→`source` in scripts.
9. **US9 Scheduled work** — deactivation job at startup/catch-up, retry-sweeper
   lock fix, deactivation `reason` persisted.
10. **US10 Docs/contracts** — schema export regeneration + drift test,
    `DOC_INVENTORY` truthfulness, ADR count, blocked-state notes.

## Complexity Tracking

No constitution violations to justify. Two notes on deliberate net-new surface,
both required by the spec and constitution-compliant:

| Addition | Why needed | Simpler alternative rejected because |
|----------|------------|--------------------------------------|
| Transactional outbox in two money-path services | FR-007: a broker failure at the commit/publish boundary otherwise loses compensation/terminal events forever (TD-031) | Publishing inside the DB tx couples two systems and still fails after commit; broker persistence alone is defeated by inbound dedup |
| First query handlers in Customer Service | FR-018/019/020: no read model exists for a customer record, a pending-validation queue, or a scoped command outcome | Reading another service's data would violate Principle II; async request/reply is the allowed and isolated way to expose the read |
