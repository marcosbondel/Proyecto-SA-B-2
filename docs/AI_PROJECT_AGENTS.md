# AI Project Agents

This document defines the role agents installed in this repository: what each
one is for, what it is deliberately prevented from doing, and how they chain
into the loop described in [AI_PROJECT_SKILLS.md](AI_PROJECT_SKILLS.md).

Skills carry knowledge. Agents carry **isolation, restriction, and role**. Read
[Agents Versus Skills](#agents-versus-skills) before adding either.

## How Agents Work

An agent is a Markdown file with YAML frontmatter. The body is its system
prompt; the frontmatter is its configuration.

The property that matters most: **an agent starts with an empty context**. It
receives only its system prompt, the working directory, `AGENTS.md`, and the git
status — never the conversation history. It works in isolation and returns a
single summary.

That is the whole trade-off:

- **The win.** A test run producing 800 lines of output, a full security sweep,
  a codebase-wide search — all of it stays in the agent's context, and only the
  conclusion reaches yours.
- **The cost.** The agent knows nothing about what you just discussed. Whoever
  invokes it must put the relevant context into the invocation prompt.

### Three Levels Of Collaboration

**Subagents do not talk to each other.** They report to the main thread, which
acts as the message bus — chaining them in sequence or fanning them out in
parallel and synthesizing the results. Subagents can nest, capped here at two
layers by `CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH`. Ceilings: 200 spawned per
session, 20 running concurrently.

**Agent teams do talk to each other.** Each teammate is a full Claude Code
session with its own context, a mailbox, and a shared task list with
dependencies and file locking. Teams are enabled in
[`.claude/settings.json`](../.claude/settings.json) via
`CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS`. See
[Running A Team](#running-a-team) for when the extra cost is worth it.

**The bridge:** a teammate can be spawned using one of the role definitions
below, so each role is written once and serves both modes.

### The Bridge Between Agents And Skills

The `skills` frontmatter field preloads a skill's **full content** into the
agent's context at startup. This is what keeps the role files short: the agent
does not restate the standard, it loads it.

An agent can still invoke any unlisted skill through the Skill tool.

## Layout

Mirrors the skills layout, and for the same reason: the content should not be
owned by one vendor's directory name.

- `.agents/roles/<name>.md` holds the real definition. Single source of truth.
- `.claude/agents/<name>.md` is a relative symlink into `.agents/roles/`,
  because Claude Code reads `.claude/agents/` and nothing else.
- `.agents/commands/<name>.md` holds the `/spec-*` slash commands, symlinked the
  same way into `.claude/commands/`. A command is the procedure the orchestrator
  follows; a role is the worker it delegates to. Keeping them in `.agents/` means
  the workflow is portable even though the `/` invocation is not.
- `scripts/agent-checks/` holds the hook scripts that enforce role boundaries
  and the spec-state machinery the commands drive.

Caveat worth knowing: unlike `.agents/skills/`, the `.agents/roles/` and
`.agents/commands/` paths are conventions of this repository, not cross-vendor
standards. No other CLI reads them today, and `npx skills` does not manage them.
The symlinks are what make them work.

## The Roster

| Role | Model | Writes? | Preloaded skills | Phase |
| --- | --- | --- | --- | --- |
| `product-mvp` | opus | docs + `spec.md` (hook) | `spec-driven-development` | specify |
| `architect` | opus | docs only (hook) | `codebase-design`, `domain-modeling` | plan (before `planner`) |
| `planner` | opus | docs + `plan.md`, `tasks.md` (hook) | `writing-plans` | plan, tasks |
| `backend` | sonnet | yes, gated (hook) | `executing-plans`, `systematic-debugging` | implement |
| `frontend` | sonnet | yes, gated (hook) | `executing-plans`, `frontend-design`, `web-design-guidelines` | implement |
| `mobile` | sonnet | yes, gated (hook) | `executing-plans`, `frontend-design` | implement |
| `design` | sonnet | **no** (blocked) | `frontend-design`, `web-design-guidelines` | before implement |
| `qa` | sonnet | tests + `evidence.md` | `verification-before-completion`, `systematic-debugging` | verify |
| `reviewer` | opus | **no** (blocked) | `code-review` | review |
| `security` | opus | **no** (blocked) | `security-audit` | review |
| `infra-aws` | sonnet | yes, gated, no apply (hooks) | — | implement (infra) |

### Restrictions Are Structural, Not Advisory

Three roles carry `disallowedTools: Write, Edit, NotebookEdit`. `design`,
`reviewer`, and `security` **cannot** edit a file — the harness removes the
tools, so it is not an instruction they can rationalize their way past.

This matters more than it looks. A reviewer that can fix what it finds stops
reviewing and starts implementing, and the finding never gets written down.

The rest carry a `PreToolUse` hook instead, because their restriction is
conditional rather than absolute:

- `product-mvp`, `architect`, `planner` →
  [`validate-docs-write.sh`](../scripts/agent-checks/validate-docs-write.sh)
  blocks Write and Edit outside `docs/**`, `ARCHITECTURE.md`, `AGENTS.md`, and
  `README.md`. The script takes the spec artifacts a role owns as **arguments**,
  which is how `product-mvp` gets `spec.md` and nothing else, and `planner` gets
  `plan.md` and `tasks.md` and nothing else. Nobody gets `state.yaml`.
- `backend`, `frontend`, `mobile`, `infra-aws` →
  [`validate-implementation-gate.sh`](../scripts/agent-checks/validate-implementation-gate.sh)
  blocks writes to production code while no spec has `gate_tasks` approved and a
  phase of `implement`, `verify`, or `review`. Docs, specs, and scripts are
  never gated — reporting a blocker must not require passing the gate that
  blocked you.
- `infra-aws` also →
  [`validate-infra-command.sh`](../scripts/agent-checks/validate-infra-command.sh)
  allows `plan`, `diff`, and every read-only command, and blocks `apply`,
  `deploy`, `destroy`, `kubectl apply`, `aws s3 rm`, and the rest of the
  mutating set. The agent hands those commands to a human.

Every script reads the hook payload on stdin and exits 2 to block, which feeds
the reason back to the agent. Extend the pattern list in the infra script as the
stack grows — prefer blocking one command too many over losing a database.

### Why The Gate Is Coarse

`validate-implementation-gate.sh` asks "is the factory cleared to build?", not
"does this line belong to task T-04". Enforcing the finer question would block
honest work far more often than it caught a real violation, and task ownership
is already legible in `tasks.md` where `reviewer` can check it. Structural
enforcement is for the boundary that must never be crossed; everything else is a
prompt and a review.

### Memory

`architect`, `qa`, and `reviewer` set `memory: project`, giving each a
persistent directory under `.claude/agent-memory/<name>/` that survives across
sessions and is versionable.

They accumulate what a fresh context cannot rediscover: the test commands that
actually work, the flaky tests and their cause, recurring defect patterns,
conventions the team enforces but never wrote down. Instruct them to record
durable facts, never task status.

## Using The Roster

### Invocation

Three escalating levels of control:

1. **Describe the task.** Claude matches your request against each role's
   `description` and delegates. Describe the work, not the role.
2. **Name the role** when the match is wrong: "use the `reviewer` agent on this
   diff".
3. **@-mention** to guarantee it: type `@` and pick from the typeahead, or write
   `@agent-reviewer` manually. This forces which agent runs; the prompt is still
   written by the main thread.

To run an entire session as one role: `claude --agent backend`.

### Give It The Context It Lacks

The most common failure is a one-line delegation to an agent that starts blind.
Put the spec path, the plan step, the constraint, and the branch into the
invocation prompt. This is not optional overhead — it is the price of isolation.

### Parallel Work And Worktrees

`backend`, `frontend`, and `mobile` deliberately do **not** set
`isolation: worktree` in their frontmatter. Pass it per invocation instead:

> Run backend and frontend in parallel on worktrees for steps 3 and 4 of the plan.

The reason is a real gotcha: a worktree branches from the repository's **default
branch**, not from the parent session's `HEAD`. An agent isolated by default
would silently start from `master` while you are mid-feature on a branch.
Per-invocation isolation keeps the choice explicit — use it for independent
parallel work, skip it when the agent must build on your current branch.

Either way, give each parallel agent a disjoint set of files. Two agents editing
one file is the fastest way to lose work.

### Running A Team

Teams are enabled but not the default. Use a subagent chain first; reach for a
team only when the workers need to **argue**, not just report:

- Cross-layer features where `backend`, `frontend`, and `qa` must negotiate a
  contract as they build.
- Debugging with competing hypotheses, where teammates try to disprove each
  other. This beats sequential investigation, which anchors on the first
  plausible theory.
- Parallel review where `reviewer` and `security` challenge each other's
  findings.

Spawn one by naming the role definitions:

> Spawn a team using the backend, frontend, and qa agent types to implement
> specs/007-tenant-search/tasks.md. Require plan approval before any teammate
> makes changes.

Three things to know before you do:

- **Cost scales linearly.** Each teammate is a separate Claude Code session. For
  routine work a single session is cheaper and usually faster.
- **`skills` and `mcpServers` are ignored in teammate mode.** The body of the
  role definition still applies, appended to the teammate's system prompt, and
  `tools` and `model` still apply — but preloaded skills do not. Name the skill
  in the spawn prompt when it matters.
- **Teams are experimental.** `/resume` does not restore in-process teammates,
  task status can lag, and split-pane mode needs tmux or iTerm2 — it does not
  work in the VS Code integrated terminal, where in-process mode is the default.

Start with 3–5 teammates. Three focused teammates outperform five scattered ones.

## The Loop, With Roles

Each phase has a command that dispatches it and a role that owns it. The full
contract is [SPEC_WORKFLOW.md](SPEC_WORKFLOW.md).

| Phase | Command | Role | Output |
| --- | --- | --- | --- |
| specify | `/spec-new` | `product-mvp` | `specs/NNN-slug/spec.md` |
| plan | `/spec-plan` | `architect`, then `planner` | ADR in `docs/design-docs/`, `plan.md` |
| tasks | `/spec-tasks` | `planner` | `tasks.md` |
| implement | `/spec-build` | `backend`, `frontend`, `mobile`, `infra-aws` | the diff |
| verify | `/spec-verify` | `qa` | `evidence.md`, criteria with real output |
| review | `/spec-review` | `reviewer`, `security` | findings with failure scenarios |
| done | `/spec-close` | main thread | `docs/` updated, spec archived |

Between every pair of phases sits a gate that only a human approves, with
`/spec-approve <id> <gate>`. Agents propose; engineers approve. That is the
whole steering model, and `state.yaml` is deliberately not agent-writable so it
stays that way.

`design` sits outside the phase chain: invoke it before `/spec-build` when a
spec introduces new UI, and hand its direction to `frontend` or `mobile`.

The main conversation is the orchestrator. It is not a role and has no file —
that is you and the session you are in. It is also the only thing that runs
`spec-state.sh`, because phase transitions belong to the workflow, not to any
one worker.

## Agents Versus Skills

Before adding either, decide which one you actually need:

| Want | Use |
| --- | --- |
| Reusable knowledge or procedure, in the current context | a **skill** |
| Verbose work kept out of your context | an **agent** |
| A hard restriction the model cannot talk its way past | an **agent** (`tools`, `disallowedTools`, `hooks`) |
| A cheaper or stronger model for one kind of work | an **agent** (`model`) |
| Learning that survives across sessions | an **agent** (`memory`) |
| Parallelism | **agents**, one per disjoint file set |
| Workers that debate each other | an **agent team** |

## Maintenance

### Adding A Role

1. Write `.agents/roles/<name>.md`. Keep it under ~40 lines: contract, rules,
   boundaries. The knowledge belongs in a skill or in `docs/`.
2. Symlink it: `ln -s ../../.agents/roles/<name>.md .claude/agents/<name>.md`
3. Write the `description` as a **dispatch criterion**, not a biography. Claude
   reads it to decide when to delegate. "Reviews code" is useless; "Reviews a
   diff for standards and spec compliance, read-only, use before merging" works.
4. Add it to the roster table above.
5. Restart Claude Code if `.claude/agents/` did not exist when the session
   started. Otherwise edits are picked up within seconds, no restart needed.

### Keeping The Roster Small

Overpopulation is the standard failure mode. Symptoms: two roles whose
descriptions overlap, so dispatch becomes a coin flip; roles that never fire;
role prompts that have grown into essays duplicating `docs/`.

- One job per role, with a description no other role could match.
- If a role never gets delegated to in a month, delete it.
- If a role's prompt exceeds ~50 lines, the excess belongs in a skill or a doc.
- The repository wins. When a role's prompt conflicts with `AGENTS.md`,
  `ARCHITECTURE.md`, or `docs/`, the repository is the source of truth.

### Debugging Dispatch

- Wrong role fires → the two `description` fields overlap. Sharpen both.
- No role fires → the description does not match how you phrase the request.
  Rewrite it in your words, or @-mention.
- Role fails to launch → check `tools`. If no entry resolves to a real tool the
  agent refuses to start. Prefer `disallowedTools` (a denylist against the
  inherited pool) over a tight `tools` allowlist; it is more portable, because
  tool names differ across Claude Code versions and surfaces.
- Background agents get a **reduced built-in tool set**. `reviewer` and
  `security` set `background: true` and stay within it.
