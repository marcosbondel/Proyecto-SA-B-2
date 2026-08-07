# Agent Guide

Short map for AI agents working in this repository. Durable knowledge lives in
`docs/` — keep this file short and link to deeper docs instead of expanding it.

## Repo Status

Agent-first scaffold. **No application code, runtime, or framework exists yet**:
`apps/` is intentionally empty and `ARCHITECTURE.md` is a placeholder. There are
no build, test, or lint commands — do not invent them. When the stack is chosen,
record it in `ARCHITECTURE.md` and install stack-specific skills in the same
change (see [docs/AI_PROJECT_SKILLS.md](docs/AI_PROJECT_SKILLS.md)).

## Verification

- `sh scripts/agent-checks/check-doc-structure.sh` — fails when a required doc
  is missing, so deleting a "placeholder" doc breaks it. To make a doc
  required, add its path to the script.
- `sh scripts/agent-checks/validate-spec-structure.sh` — fails when a spec's
  phase outran its gate, its artifacts do not match its phase, or its tasks and
  evidence reference acceptance criteria the spec never defined.
- The hook scripts in `scripts/agent-checks/` need `jq` on PATH.

## Workflow

Every change goes through a spec in `specs/<NNN-slug>/`. The phases are
specify → plan → tasks → implement → verify → review → done, each separated by a
gate that only a human approves.

```
/spec-new "<idea>"      → specs/NNN-slug/spec.md      (product-mvp)
/spec-approve NNN spec
/spec-plan NNN          → plan.md, ADR if needed      (architect, planner)
/spec-approve NNN plan
/spec-tasks NNN         → tasks.md                    (planner)
/spec-approve NNN tasks     ← this is what unblocks code
/spec-build NNN         → the diff                    (backend/frontend/mobile)
/spec-verify NNN        → evidence.md                 (qa)
/spec-approve NNN verify
/spec-review NNN        → findings                    (reviewer, security)
/spec-approve NNN review
/spec-close NNN         → docs/ updated, spec archived
```

`/spec-status` shows where everything stands. Full contract:
[docs/SPEC_WORKFLOW.md](docs/SPEC_WORKFLOW.md). Role roster and invocation
rules: [docs/AI_PROJECT_AGENTS.md](docs/AI_PROJECT_AGENTS.md). Skill catalogue:
[docs/AI_PROJECT_SKILLS.md](docs/AI_PROJECT_SKILLS.md).

- `specs/` holds the work and is archived when a spec closes. `docs/` holds the
  knowledge that outlives it. `/spec-close` is where the second gets written —
  it is not optional bookkeeping.
- Writing production code with no approved task list is **blocked by a hook**,
  not discouraged by a rule. If it fires, the work is unspecced: say so and hand
  it back rather than routing around it.
- Trivial changes — typos, formatting, comments — need no spec. An agent cannot
  make that call for itself; it hands the change to a human.
- When a skill's advice conflicts with `AGENTS.md`, `ARCHITECTURE.md`, or
  `docs/`, the repository wins. Two skills carry upstream paths that do not
  apply here; the override table is in
  [docs/SPEC_WORKFLOW.md](docs/SPEC_WORKFLOW.md).
- Update stale docs in the same change that makes them stale.

## Layout Notes

- `.agents/skills/<name>/` is the real skill content (pinned by
  `skills-lock.json`); `.claude/skills/` is relative symlinks into it. Fresh
  clones need no install step. Edit the `.agents/` side only.
- `.agents/roles/<name>.md` and `.agents/commands/<name>.md` are the real role
  and slash-command definitions; `.claude/agents/` and `.claude/commands/` are
  symlinks into them.
- Role restrictions are structural, enforced by hooks in `scripts/agent-checks/`:
  - `design`/`reviewer`/`security` have no write tools at all.
  - `product-mvp`/`architect`/`planner` write `docs/**`, the root docs, and
    only the spec artifact each one owns — `spec.md` for `product-mvp`,
    `plan.md` and `tasks.md` for `planner`.
  - `backend`/`frontend`/`mobile`/`infra-aws` cannot write production code
    until some spec has its tasks gate approved.
  - `infra-aws` can plan but never apply.
- `state.yaml` is written by `scripts/agent-checks/spec-state.sh` and nothing
  else. Gate approval is the engineer's control point; an agent that could edit
  those lines could approve its own work.

## Maintenance Conventions

- Adding a role: write `.agents/roles/<name>.md`, symlink it with
  `ln -s ../../.agents/roles/<name>.md .claude/agents/<name>.md`, and add a row
  to the roster in `docs/AI_PROJECT_AGENTS.md`.
- Adding a command: write `.agents/commands/<name>.md`, symlink it with
  `ln -s ../../.agents/commands/<name>.md .claude/commands/<name>.md`.
- Adding a skill:
  `npx skills add <owner/repo> --skill <name> -a universal -a claude-code -y`.
  Repeat `--skill` for several skills — a comma-separated list is silently
  ignored while reporting success. Record additions in
  `docs/AI_PROJECT_SKILLS.md`. Repair a drifted tree with
  `npx skills experimental_install`.

## Boundaries

- Do not treat this file as a project encyclopedia; put durable knowledge in
  `docs/`.
- Do not bypass established architecture without updating the relevant docs.
