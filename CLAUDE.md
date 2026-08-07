# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Start Here

**[AGENTS.md](AGENTS.md) is the operational source of truth for agents working in
this repository.** Read it before acting. It carries the repo status, the spec
workflow, the layout rules, and the maintenance conventions, and it is shared
with every AI tool — not just Claude Code. This file only adds Claude-specific
context on top of it.

When AGENTS.md and this file disagree, AGENTS.md wins. When a skill's advice
conflicts with either, the repository wins (override table in
[docs/SPEC_WORKFLOW.md](docs/SPEC_WORKFLOW.md)).

## Repo Status

This is an agent-first scaffold with **no application code and no chosen stack**.
`apps/` is empty and `ARCHITECTURE.md` is a placeholder. There is no package
manager, build, lint, or test command — do not invent one, and do not assume one
exists because a role file mentions "run the tests". Choosing a stack is a human
decision recorded in `ARCHITECTURE.md`; the implementing roles are deliberately
blocked until it happens.

## Commands

Verification (the only runnable commands in the repo; the hook scripts need `jq`
on PATH):

```bash
sh scripts/agent-checks/check-doc-structure.sh      # required docs still exist
sh scripts/agent-checks/validate-spec-structure.sh  # spec phase/artifacts/AC chain
```

Spec state — every `/spec-*` command shells out to this, and it is the only
writer of `state.yaml`:

```bash
./scripts/agent-checks/spec-state.sh list              # every spec, phase, gates
./scripts/agent-checks/spec-state.sh next-id           # next free spec number
./scripts/agent-checks/spec-state.sh path <id>         # id → directory
./scripts/agent-checks/spec-state.sh get <id> <key>
./scripts/agent-checks/spec-state.sh advance <id>      # exit 3 if the gate refuses
./scripts/agent-checks/spec-state.sh approve <id> <gate>   # human action only
./scripts/agent-checks/spec-state.sh implementable     # exit 0 if code is unblocked
```

`<id>` accepts `7`, `007`, `007-slug`, or `slug`. Gates and `phase` cannot be set
via `set` — only through `approve`/`waive` and `advance`.

The workflow itself runs through the `/spec-*` slash commands
(`/spec-new`, `/spec-plan`, `/spec-tasks`, `/spec-approve`, `/spec-build`,
`/spec-verify`, `/spec-review`, `/spec-close`, `/spec-status`) — see AGENTS.md
for the ordering and [docs/SPEC_WORKFLOW.md](docs/SPEC_WORKFLOW.md) for the
contract behind each phase.

## Architecture Of The Harness

The system under construction has no architecture yet; the *harness* does, and
it is what you have to understand to be productive here.

**Two altitudes, split by lifespan.** `specs/NNN-slug/` holds the work (a change,
archived when it closes). `docs/` holds the knowledge (the system as it stands,
permanent). `/spec-close` is the only place the second gets written from the
first — losing that step is how the repo goes stale.

**Restrictions are structural, not advisory.** Roles are markdown files in
`.agents/roles/` whose frontmatter wires `PreToolUse` hooks and removes tools:

- `validate-implementation-gate.sh` — on `backend`, `frontend`, `mobile`,
  `infra-aws`. Refuses writes to production code unless some spec has
  `gate_tasks` approved and sits in `implement`/`verify`/`review`. Docs, specs,
  scripts, and agent scaffolding are never gated, so reporting a blocker never
  requires passing the gate that blocked you.
- `validate-docs-write.sh` — takes the allowed filenames as arguments, giving
  each spec artifact exactly one writing role (`spec.md` → `product-mvp`,
  `plan.md`/`tasks.md` → `planner`, `evidence.md` → `qa`).
- `validate-infra-command.sh` — `infra-aws` plans but never applies.
- `design`, `reviewer`, `security` have `disallowedTools: Write, Edit,
  NotebookEdit` — no write tools at all.

If a hook fires, the work is unspecced or out of role. Say so and hand it back;
routing around it defeats the only real enforcement in the system.

**`state.yaml` is flat on purpose** — one key per line, no nesting — so
`spec-state.sh` and the hooks can parse it with `grep`/`awk` and no YAML
dependency. No agent may write it.

**Traceability keys.** The spec number survives archival (directory, branch, ADR,
`docs/TECH_DEBT.md` rows). Inside a spec, `AC-NN` ties intent to proof:
`spec.md` defines it → `plan.md` says how it is verified → `tasks.md` says which
task advances it → `evidence.md` shows the real command output →
`reviewer` checks the diff against it. `validate-spec-structure.sh` fails a spec
whose tasks or evidence cite an `AC-NN` the spec never defined.

## Editing The Scaffolding

`.agents/` holds the real files; `.claude/agents/`, `.claude/commands/`, and
`.claude/skills/` are relative symlinks into it. **Always edit the `.agents/`
side.** Adding a role or command means writing the `.agents/` file and creating
the symlink by hand (`ln -s ../../.agents/roles/<name>.md
.claude/agents/<name>.md`); new roles also get a row in
[docs/AI_PROJECT_AGENTS.md](docs/AI_PROJECT_AGENTS.md).

Deleting a doc that looks like a placeholder will break
`check-doc-structure.sh` — its required-path list is the definition of which
docs must exist. Templates for new spec artifacts live in `docs/templates/spec/`.
