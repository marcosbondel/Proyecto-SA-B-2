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

`apps/web/` holds a Nuxt 4 application (pnpm, `@nuxt/ui`) scaffolded from the
starter template. `ARCHITECTURE.md` records the selected Bank USAC target
architecture; the backend services, Gateway, and deployment are not implemented
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

Run from `apps/web/`:

```bash
pnpm install
pnpm dev        # nuxt dev
pnpm build      # nuxt build
pnpm generate   # nuxt generate
pnpm preview    # nuxt preview
```

That is the whole list. There is **no test and no lint script** — do not invent
one, and do not assume a suite exists because a role file mentions "run the
tests". Adding either means adding it to `apps/web/package.json` and recording
it in AGENTS.md in the same change.

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
