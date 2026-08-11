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
There is no `.agents/commands/` any more. It held the home-grown `/spec-*` slash
commands; those were removed in favour of [Spec Kit](https://github.com/github/spec-kit),
which brings its own commands. The hook scripts they drove, under
`scripts/agent-checks/`, went with them.

Caveat worth knowing: unlike `.agents/skills/`, the `.agents/roles/` path is a
convention of this repository, not a cross-vendor standard. No other CLI reads it
today, and `npx skills` does not manage it. The symlinks are what make it work.

## The Roster

"Writes?" is what the harness actually enforces. **Blocked** is structural, via
`disallowedTools`. Everything else is now unrestricted at the tool level — the
"should write" column is a convention the role's own prompt carries.

| Role | Model | Writes? | Should write | Preloaded skills | Phase |
| --- | --- | --- | --- | --- | --- |
| `product-mvp` | opus | unrestricted | docs + `spec.md` | `spec-driven-development` | specify |
| `architect` | opus | unrestricted | docs only | `codebase-design`, `domain-modeling` | plan (before `planner`) |
| `planner` | opus | unrestricted | docs + `plan.md`, `tasks.md` | `writing-plans` | plan, tasks |
| `backend` | sonnet | unrestricted | server-side code + tests | `executing-plans`, `systematic-debugging` | implement |
| `frontend` | sonnet | unrestricted | web UI code | `executing-plans`, `frontend-design`, `web-design-guidelines` | implement |
| `mobile` | sonnet | unrestricted | mobile code | `executing-plans`, `frontend-design` | implement |
| `design` | sonnet | **no** (blocked) | — | `frontend-design`, `web-design-guidelines` | before implement |
| `qa` | sonnet | unrestricted | tests + `evidence.md` | `verification-before-completion`, `systematic-debugging` | verify |
| `reviewer` | opus | **no** (blocked) | — | `code-review` | review |
| `security` | opus | **no** (blocked) | — | `security-audit` | review |
| `infra-aws` | sonnet | unrestricted | IaC only, never applies | — | implement (infra) |

### Restrictions Are Structural, Not Advisory

Three roles carry `disallowedTools: Write, Edit, NotebookEdit`. `design`,
`reviewer`, and `security` **cannot** edit a file — the harness removes the
tools, so it is not an instruction they can rationalize their way past.

This matters more than it looks. A reviewer that can fix what it finds stops
reviewing and starts implementing, and the finding never gets written down.

### What Used To Be Enforced And No Longer Is

The other eight roles carried `PreToolUse` hooks calling scripts under
`scripts/agent-checks/`. Those scripts were deleted along with the home-grown
spec workflow, and the hooks were removed from the role frontmatter with them.
The restrictions they enforced are now conventions, stated in each role's prompt
and enforced by nothing:

- `product-mvp`, `architect`, `planner` were blocked from writing outside
  `docs/**`, `ARCHITECTURE.md`, `AGENTS.md`, `README.md`, and the one spec
  artifact each owned. They can now write anywhere.
- `backend`, `frontend`, `mobile`, `infra-aws` could not write production code
  until a spec's task list was approved. There is no gate at all now.
- `infra-aws` was blocked from `apply`, `deploy`, `destroy`, `kubectl apply`,
  `aws s3 rm`, and the rest of the mutating set. **It can now run them.** Treat
  "plans but never applies" as a hard rule in its prompt and hand mutating
  commands to a human.

If Spec Kit or a future gate reintroduces enforcement, this is the seam to wire
it into: a `PreToolUse` hook in the role frontmatter, a script that reads the
hook payload on stdin and exits 2 to block, so the reason feeds back to the
agent.

Structural enforcement is for the boundary that must never be crossed;
everything else is a prompt and a review. Right now only the three read-only
roles have such a boundary.

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

> Spawn a team using the backend, frontend, and qa agent types to implement the
> tasks.md of the tenant-search spec. Require plan approval before any teammate
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

Each phase has a role that owns it. The commands that used to dispatch them were
removed with the home-grown workflow; [Spec Kit](https://github.com/github/spec-kit)
supplies the procedure now, and this table is the role mapping to hang it on.

| Phase | Role | Output |
| --- | --- | --- |
| specify | `product-mvp` | `spec.md` |
| plan | `architect`, then `planner` | ADR in `docs/design-docs/`, `plan.md` |
| tasks | `planner` | `tasks.md` |
| implement | `backend`, `frontend`, `mobile`, `infra-aws` | the diff |
| verify | `qa` | `evidence.md`, criteria with real output |
| review | `reviewer`, `security` | findings with failure scenarios |
| done | main thread | `docs/` updated |

Between every pair of phases sits a human decision. Agents propose; engineers
approve. Nothing enforces that ordering any more — the gates that did were
deleted — so it holds only as long as the orchestrator respects it.

`design` sits outside the phase chain: invoke it before implementation when a
spec introduces new UI, and hand its direction to `frontend` or `mobile`.

The main conversation is the orchestrator. It is not a role and has no file —
that is you and the session you are in. Phase transitions belong to it, not to
any one worker.

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
