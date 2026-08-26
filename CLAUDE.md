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
Seven applications, all of them building, linting and testing. The contents are
the API Gateway (T-15) and the frontend shell it feeds. The Gateway carries
eleven routes, JWT authentication, D-06 role authorization, request/reply with a
five-second ceiling, seven error codes and a versioned OpenAPI contract; it has
no `domain/` layer and never will. `apps/web` carries the layout, the
role-filtered navigation, the session, four shared components and the **Clientes
module** (T-16, frontend half) in `app/components/customer/` and
`app/pages/clientes/`, plus public registration at `/registro`.

The **five domain services remain scaffolding** — health checks, environment
validation, empty `domain` and `application` layers. Their modules are T-16 to
T-20; the Clientes screens exist ahead of their service, and what the Gateway
cannot serve them is recorded as TD-020 to TD-023. Kubernetes deployment is not built yet.

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
24.19.0 (`.nvmrc`) and pnpm 11.21.0 (`packageManager`) are enforced.

```bash
pnpm install        # whole workspace, one lockfile
pnpm build          # shared packages, then the seven applications
pnpm lint           # style *and* the executable isolation rules
pnpm test           # unit tests everywhere
pnpm test:contract  # contract tests over @bank/contracts
pnpm format
pnpm dev
```

Per application: `pnpm --filter <name> <command>`. `pnpm build` must precede
testing a single application in a fresh clone — the shared packages are
consumed from `dist/`.

Two things worth knowing before you claim anything passed:

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
