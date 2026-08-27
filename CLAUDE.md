# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Start Here

**[AGENTS.md](AGENTS.md) is the operational source of truth for agents working in
this repository.** Read it before acting. It carries the repo status, the
workflow, the layout rules, and the maintenance conventions, and it is shared
with every AI tool — not just Claude Code. This file only adds Claude-specific
context on top of it.

When AGENTS.md and this file disagree, AGENTS.md wins. When a skill's advice
conflicts with either, the repository wins.

## Repo Status

A pnpm workspace with all code under `apps/`: Gateway and the Nuxt frontend at
the top level, the five domain services under `apps/services/`, and
`@bank/contracts`, `@bank/messaging`, `@bank/tooling` under `apps/packages/`.
Seven applications, all of them building, linting and testing. The Gateway
carries seventeen routes over fourteen paths, JWT authentication, D-06 role
authorization, request/reply with a five-second ceiling, seven error codes and a
versioned OpenAPI contract; it has no `domain/` layer and never will. `apps/web`
carries the layout, the role-filtered navigation, the session, four shared
components and five feature modules: **Clientes** (T-16) in
`app/components/customer/` + `app/pages/clientes/` with public registration at
`/registro`, **Cuentas** (T-17) in `app/components/account/` +
`app/pages/cuentas/`, **Transferencias** (T-18) in
`app/components/transaction/` + `app/pages/transferencias/`, **Pagos** (T-19) in
`app/components/payment/` + `app/pages/pagos/`, and **Auditoría** (T-20) in
`app/components/audit/` + `app/pages/auditoria/`.

**Customer Service is implemented** (T-16) — its own PostgreSQL schema, the five
message handlers, idempotency enforced by a unique constraint, scrypt
credentials, activation by hashed token, and the simulated identity validation.

**Account Service is implemented** (T-17) — its own schema, eight message
handlers, money as `NUMERIC(14,2)` never touched by a float, balances protected
by a row lock plus an optimistic version plus a column `CHECK`, idempotency
evaluated before any balance moves, the Saga's three movements, and the
automatic deactivation job with an injected clock. Its concurrency and
idempotency tests need a real PostgreSQL and skip without `DATABASE_URL`.

**Transaction Service is implemented** (T-18) — its own schema, nine message
handlers over the two queues it owns, the six-state machine as one pure function
that refuses every transition outside the diagram, transitions decided under a
row lock, consumption deduplicated by the envelope's `messageId` before any
state is touched, and an alias table so a retried `transactionId` resolves to
the transfer that exists. **It decides no funds**: the debit verdict arrives as
an event, and `test/isolation.spec.ts` fails the build if this service ever
queries another's table or makes an HTTP call. Its concurrency and constraint
tests need a real PostgreSQL and skip without `DATABASE_URL`.

**Notification & Audit Service is implemented** (T-20) — its own schema, five
queues instead of one (`audit.customer`, `audit.account`, `audit.transaction`,
`audit.payment`, and `audit.query` for the two questions), deduplication as the
primary key `(event_id, consumer)`, the payload redacted **before** the insert
so the one database that hears every event stores no document, address or
amount, and a simulated delivery channel that never throws. It is the only
service that takes no validator from the broker — a message it cannot parse is
recorded `INVALID` rather than parked, because the service whose job is to
record what arrived must not be the one that never sees it. It publishes replies
and nothing else, and `test/isolation.spec.ts` fails the build if that changes.
Its concurrency and constraint tests need a real PostgreSQL and skip without
`DATABASE_URL`.

**Payment Service remains scaffolding** — health checks, environment
validation, empty `domain` and `application` layers. Its module is T-19, already
built against it. Until the service exists a transfer stops at
`PAYMENT_PENDING` with the money already debited: the state machine is right and
nobody answers `payment.requested.v1`. What the Clientes screens still cannot
show is TD-020 and TD-023; the Cuentas screens TD-026 and TD-027; the
Transferencias screens TD-032 to TD-035; the Pagos screens TD-037 and TD-038;
the Auditoría screens TD-039 to TD-043. Kubernetes deployment is not built
yet.

## Project Documentation

Read [docs/DESIGN.md](docs/DESIGN.md) before creating or modifying any
interface, page, component, style, or interface text. This link is permanent
and must not be removed by a documentation change without an explicit team
decision. The complete project-documentation index is maintained in
[AGENTS.md](AGENTS.md), including [docs/DOC_INVENTORY.md](docs/DOC_INVENTORY.md)
for Markdown classification and [docs/OWNERSHIP.md](docs/OWNERSHIP.md) for
component ownership.

## Commands

Run from the **repository root**, never from an application directory. Node
24.19.0 (`.nvmrc`) and pnpm 11.21.0 (`packageManager`) are enforced. The task
runner is **Turborepo** (`turbo.json`); pnpm still owns resolution and linking.

```bash
pnpm install        # whole workspace, one lockfile
pnpm build          # shared packages, then the seven applications
pnpm lint           # style *and* the executable isolation rules
pnpm test           # unit tests everywhere
pnpm test:contract  # contract tests over @bank/contracts
pnpm typecheck
pnpm format
pnpm dev            # whole stack in Docker (infra/docker/docker-compose.dev.yml)
pnpm dev:infra      # only the databases, the broker and MinIO, detached
pnpm dev:host       # turbo run dev — the applications on the host, watch mode
```

Per application: `turbo run <task> --filter=<name>`, which brings the
dependencies' builds with it. `pnpm --filter <name> <command>` still works but
builds nothing, so it needs a `pnpm build` first in a fresh clone — the shared
packages are consumed from `dist/`.

Three things worth knowing before you claim anything passed:

- **A green run may not have run.** Turbo reports `FULL TURBO` when every task
  hit the cache. That is a real pass — the inputs are identical — but if you
  need to see the command actually execute, use `turbo run <task> --force`.
- **Lint enforces architecture.** A cross-service import, a framework import in
  `domain`, or an `infrastructure` import in `application` fails `pnpm lint`.
  The rules live in `apps/packages/tooling/eslint.base.mjs`. If one blocks you,
  the design is wrong — do not add an exception to make it pass.
- **`apps/web` has no component test framework.** Its `test` script is one
  `node --test` suite over `app/lib/`, not a Vue suite (TD-010). Do not claim
  component coverage — but note that everything in the shell that *decides*
  something lives in `app/lib/` as a pure function precisely so it stays
  testable despite TD-010. The six NestJS applications use Jest and do have real tests.

## Spec Workflow

Spec-driven work runs on **[Spec Kit](https://github.com/github/spec-kit)**
(`speckit` v0.12.2, under `.specify/`). The home-grown `/spec-*` command set that
used to live here was removed: its commands, its `spec-state.sh` state machine,
its `state.yaml` gates, its enforcement hooks under `scripts/agent-checks/`,
`docs/SPEC_WORKFLOW.md`, and the `docs/templates/spec/` templates are all gone.
Do not reference or recreate them.

The ten workflows are available here as skills: `/speckit-constitution`,
`/speckit-specify`, `/speckit-clarify`, `/speckit-plan`, `/speckit-tasks`,
`/speckit-analyze`, `/speckit-checklist`, `/speckit-implement`,
`/speckit-converge`, `/speckit-taskstoissues`. **Claude uses hyphens**; the same
workflows are invoked with dots (`/speckit.plan`) from opencode, which shares the
identical file. When a skill body names a command with a dot, convert it.

Their real content lives in `.agents/skills/speckit-<name>/SKILL.md` —
`.claude/skills/` only symlinks to it. Edit the `.agents/` side.

## The Harness

Two altitudes still hold, and they are worth keeping when Spec Kit lands: work
that is archived when it ships lives with the spec, and knowledge that must stay
true lives in `docs/`. Promoting the second out of the first is what keeps the
repo from going stale.

**What is still enforced.** Only what a role's frontmatter declares:

- `design`, `reviewer`, `security` have `disallowedTools: Write, Edit,
  NotebookEdit` — no write tools at all. A reviewer that could fix what it finds
  would stop reviewing and start implementing.

**What is no longer enforced** — these were hooks, and the hooks were deleted
with the scripts they called. They are conventions now, and nothing will stop an
agent from breaking them:

- Implementing roles (`backend`, `frontend`, `mobile`, `infra-aws`) could not
  write production code without an approved task list. That gate is gone.
- `product-mvp`, `planner`, and `qa` were each limited to the single spec
  artifact they own. That limit is documentation now.
- `infra-aws` was blocked from running mutating cloud commands. **Treat this as
  a hard rule anyway**: it plans, it never applies, and mutating commands go to
  a human.

**Traceability.** Acceptance-criteria IDs still tie intent to proof: `spec.md`
defines them → the plan says how each is verified → a task advances it →
evidence shows the real command output → `reviewer` checks the diff against it.
Nothing validates that chain automatically any more.

## Editing The Scaffolding

`.agents/` holds the real files; `.claude/agents/` and `.claude/skills/` are
relative symlinks into it — all 24 skills, including the ten from Spec Kit.
**Always edit the `.agents/` side.** Adding a role means writing the `.agents/`
file and creating the symlink by hand
(`ln -s ../../.agents/roles/<name>.md .claude/agents/<name>.md`); new roles also
get a row in [docs/AI_PROJECT_AGENTS.md](docs/AI_PROJECT_AGENTS.md).

A Spec Kit upgrade replaces those symlinks with per-tool copies. If
`specify integration upgrade` ever runs, re-collapse the ten speckit skills into
`.agents/skills/` and re-link both `.claude/skills/` and `.opencode/commands/`,
or Claude and opencode silently drift apart. See AGENTS.md for the layout.
