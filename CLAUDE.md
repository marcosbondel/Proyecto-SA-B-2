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

A pnpm/Turborepo workspace: seven applications under `apps/` (Gateway, Nuxt
frontend and five domain services), and contracts, messaging, observability and
tooling under `apps/packages/`. The optional partner-bank mock is a test
application, not a sixth banking microservice.

**Phase III is implemented and deployed.** It adds lifecycle/anomaly and
transfer telemetry, runtime payment simulation, filtered audit and trace links,
interbank send/receive/reconciliation, and the OpenTelemetry/Prometheus/Tempo/
Loki/Grafana stack. Read [ARCHITECTURE.md](ARCHITECTURE.md) for boundaries,
[docs/TECHNICAL_DOCUMENT.md](docs/TECHNICAL_DOCUMENT.md) for the deliverables and
[docs/operations/CLOUD.md](docs/operations/CLOUD.md) for observed deployment.

The Gateway owns no domain layer, database or internal HTTP client. Domain
services communicate through AMQP and own their PostgreSQL databases outside
Kubernetes. Payment's HTTP reaches the external bank; Notification's HTTP
reaches Resend. Neither is an internal service-to-service exception.

The frontend maps the thirty-four prototype screens and adds Phase III routes;
[docs/FRONTEND.md](docs/FRONTEND.md#the-screen-inventory) distinguishes source,
Nitro tests and browser evidence. A `202` is acceptance, not business success;
interbank TIMEOUT retains reservation during reconciliation.

**Operational snapshot, 2026-10-21:** GKE is in `us-central1-c`; `prod` and
`dev` run separate workloads/brokers and distinct database names on shared VMs.
Production has the partner mock; dev has none, so mock failure experiments
require preparation. Observability has nine dashboards, sixteen alert rules
and seven runbooks. Desired NetworkPolicies exist in source but were absent in
the three live namespaces; RabbitMQ live was 3.13-management versus the desired
4.3.4. Do not infer applied controls from chart defaults. The deployment and
evidence documents record these differences without treating readiness as
proof of SLO or fault tolerance.

Terraform now declares Artifact Registry and the reserved Gateway IP; Helm owns
the Gateway Service, and CD updates the Cloud Run image. Historical TD-070 and
TD-079–081 must be read with their current entries in
[docs/TECH_DEBT.md](docs/TECH_DEBT.md), not the old premise of shared database
names or three wholly manual resources.

## Project Documentation

Read [docs/DESIGN.md](docs/DESIGN.md) before creating or modifying any
interface, page, component, style, or interface text. This link is permanent
and must not be removed by a documentation change without an explicit team
decision. Read [docs/operations/CONTAINERS.md](docs/operations/CONTAINERS.md) before
changing a Dockerfile, adding a variable a container needs at run time, or
touching a health check: it is the image inventory and the contract T-22 builds
the Helm chart against. Read
[docs/operations/CI.md](docs/operations/CI.md) before changing anything under
`.github/workflows/` or any script it calls, and
[docs/operations/CLOUD.md](docs/operations/CLOUD.md) before touching
`infra/terraform/gcp/` — it is the procedure from an empty GCP project to a
running system, and it names the steps Terraform does not yet cover.

**Start at [docs/README.md](docs/README.md)** — it lists every document in
`docs/` by what it answers, which is the fastest way to find the right one.
[AGENTS.md](AGENTS.md) keeps the short index of what must be read before acting,
[docs/DOC_INVENTORY.md](docs/DOC_INVENTORY.md) classifies every Markdown file in
the repository, and [docs/OWNERSHIP.md](docs/OWNERSHIP.md) names the owner of
each component.

**Agent documentation lives in [`context/`](context/README.md), not in `docs/`.**
The split is by audience: `docs/` explains the banking system, `context/`
explains how it is built with agents — the roles, the skills and the prompts.
Configuration the tools *execute* (`.agents/`, `.claude/`, `.opencode/`,
`.specify/`, plus `AGENTS.md` and this file) stays at the repository root,
because each tool looks for its own path there. Do not move those to make them
match; do put a new document about agent practice in `context/`.

`docs/` was reorganised on 2026-09-09: sixteen files went (scaffold boilerplate
that was never adapted, and Spanish duplicates that had drifted into stating
things the code contradicts), the diagram documents were gathered under
`docs/architecture/`, the test evidence under `docs/qa/`, and the two manuals
under `docs/manual/`. **Do not recreate `docs/templates/`, `docs/design-docs/`,
`docs/decisions/`, `docs/saga/` or `docs/uml/`** — each was removed for a reason
recorded in [docs/TECH_DEBT.md](docs/TECH_DEBT.md).

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
pnpm test:pyramid   # the 70/20/10 shape, measured per package and for the system
pnpm typecheck
pnpm format
pnpm dev            # whole stack in Docker (infra/docker/docker-compose.dev.yml)
pnpm dev:infra      # only the databases, the broker and MinIO, detached
pnpm dev:host       # turbo run dev — the applications on the host, watch mode

pnpm images:build   # the seven Docker images, tagged with the commit inside them
pnpm images:up      # the stack from those images (also stops the infra on :down)
pnpm images:smoke   # labels, port, user, secrets, liveness, readiness, degraded cases
pnpm images:flow    # register, open accounts, transfer — through the images
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
- **The test pyramid is enforced, not aspirational.** `pnpm test:pyramid`
  measures 70/20/10 by counting cases the runners actually executed, and exits
  non-zero on drift. One rule sets the layer: **integration means the test
  crosses a real process** (PostgreSQL, RabbitMQ, MinIO, a real Nitro server),
  and its file name must end in `.integration.spec.ts`, which is the entire
  classification mechanism. Everything else in-process is unit — including the
  gateway's Supertest suites, whose `test/support/harness.ts` doubles every
  port. `@bank/contracts` is a permanent exception: a schema package with no
  I/O has no process to cross. See AGENTS.md for the full rule.
- **`apps/web` has a second test runner.** `node --test` still owns the pure
  functions in `app/lib/`; Vitest with `@nuxt/test-utils` owns the suites that
  boot a real Nitro server, which is what finally closed TD-010. `pnpm --filter
  web test` runs both.
  Everything in the shell that *decides* something still lives in `app/lib/` as
  a pure function, which is why 272 of web's cases are on `node --test` and why
  that was worth doing before a Vue runner existed. What the Nitro suites add is
  the part a pure function cannot reach: the `.vue` files are **rendered**, by a
  real server, which is the first automated evidence this repository has that a
  screen draws at all (TD-054). Mounted component tests are now possible too,
  but they run in-process and therefore count as *unit* — adding them raises
  web's own integration target, so weigh them. The six NestJS applications use
  Jest and do have real tests.

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
get a row in [context/AI_PROJECT_AGENTS.md](context/AI_PROJECT_AGENTS.md).

A Spec Kit upgrade replaces those symlinks with per-tool copies. If
`specify integration upgrade` ever runs, re-collapse the ten speckit skills into
`.agents/skills/` and re-link both `.claude/skills/` and `.opencode/commands/`,
or Claude and opencode silently drift apart. See AGENTS.md for the layout.
