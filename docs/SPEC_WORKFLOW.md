# Spec Workflow

Every change to this repository goes through a spec. This document is the
contract: what each phase produces, who owns it, and what the gate between
phases actually enforces.

The short version lives in [../specs/README.md](../specs/README.md). This file
is the reasoning behind it.

## The Two Altitudes

The most common way a spec-driven repository fails is that `docs/` and the spec
folder start describing the same thing, drift, and then nobody knows which one
is true. The split here is by lifespan, not by topic:

| | `specs/NNN-slug/` | `docs/` |
| --- | --- | --- |
| Holds | The work | The knowledge |
| Describes | A change | The system as it stands |
| Lifespan | Until closed, then archived | Permanent |
| Written by | `product-mvp`, `planner`, `qa` | `architect`, and `/spec-close` |

A spec says "add rate limiting to the search endpoint". `docs/` says "the search
endpoint is rate limited at 100 rpm per tenant". The first is archived when it
ships; the second has to be true forever. `/spec-close` is where the second gets
written, which is why that command is not optional bookkeeping.

## The Phases

```
specify ──▸ plan ──▸ tasks ──▸ implement ──▸ verify ──▸ review ──▸ done
        │        │         │              │          │
   gate_spec  gate_plan  gate_tasks   (no gate)  gate_verify  gate_review
```

| Phase | Owner | Produces | Entered when |
| --- | --- | --- | --- |
| `specify` | `product-mvp` | `spec.md` | `/spec-new` |
| `plan` | `architect`, then `planner` | ADR if needed, `plan.md` | `gate_spec` approved |
| `tasks` | `planner` | `tasks.md` | `gate_plan` approved |
| `implement` | `backend`, `frontend`, `mobile`, `infra-aws` | the diff | `gate_tasks` approved |
| `verify` | `qa` | `evidence.md` | always — verification never needs permission |
| `review` | `reviewer`, `security` | findings | `gate_verify` approved |
| `done` | main thread | updated `docs/`, archived spec | `gate_review` approved |

`verify` has no entry gate on purpose. Every other gate exists to stop work
running ahead of judgment; making someone ask permission to check their work
would invert that.

## What The Gates Actually Do

A gate is a line in `state.yaml` that only a human sets, through
`/spec-approve`. Two mechanisms read it:

**`spec-state.sh advance` refuses the transition.** This is what every
`/spec-*` command runs first. It is a soft gate — it stops the workflow, and an
agent that ignores the command entirely is not stopped by it.

**`validate-implementation-gate.sh` blocks the write.** Wired as a `PreToolUse`
hook on `backend`, `frontend`, `mobile`, and `infra-aws`, it refuses any write
to production code while no spec has `gate_tasks` approved and a phase of
`implement`, `verify`, or `review`. The harness removes the write, so it is not
an instruction the model can rationalise past.

That second one is the real gate. The rest is choreography.

It is deliberately coarse: it asks "is the factory cleared to build?", not "does
this line belong to task T-04". Enforcing that finer question would block honest
work far more often than it caught a real violation, and the fine-grained
ownership is already visible in `tasks.md` where a reviewer can check it.

Documentation, specs, scripts, and the agent scaffolding are never gated.
Reporting a blocker must not require passing the gate that blocked you.

## Artifact Ownership

Each artifact has exactly one writing role, enforced by
`validate-docs-write.sh` taking the allowed filenames as arguments:

| File | Written by | Everyone else |
| --- | --- | --- |
| `spec.md` | `product-mvp` | blocked |
| `plan.md`, `tasks.md` | `planner` | blocked |
| `evidence.md` | `qa` | blocked |
| `state.yaml` | `spec-state.sh` only | blocked |

`state.yaml` is not agent-writable at all. Gate approval is the engineer's
control point in this whole system; an agent that could edit those lines could
approve its own work.

## Traceability

The spec number is the key that survives archival. It appears in:

- the directory name, `specs/007-tenant-isolation/`
- the branch name, `007-tenant-isolation`
- the ADR the spec produced, which cites it
- the rows it left in `docs/TECH_DEBT.md`

And within a spec, `AC-NN` is the key that ties intent to proof:
`spec.md` defines it → `plan.md` says how it will be verified → `tasks.md` says
which task advances it → `evidence.md` shows the command output that proves it →
`reviewer` checks the diff against it.

`validate-spec-structure.sh` enforces that chain. It fails a spec whose tasks or
evidence reference an `AC-NN` the spec never defined — the quiet way a
requirement gets invented downstream and never agreed to.

## When Not To Open A Spec

Specs are not free, and a workflow that punishes small fixes gets routed around
until it is decorative.

- **Typo, comment, formatting, dependency bump with no behaviour change** — no
  spec. The human makes the change, or asks for it directly in a session with no
  implementing role. `/spec-status` will not know about it, which is correct.
- **A fix with a known reproduction** — `type: fix`. Short spec: the problem,
  the reproduction, and the criterion that proves it fixed. Ten minutes.
- **Everything else** — a spec. If you are wondering whether the work is big
  enough to need one, it is.

The escape hatch is honest, not silent: the implementing roles are hook-blocked,
so an agent cannot decide on its own that a change is too small to spec. It has
to hand the change back to a human and say so.

## Types

`type` in `state.yaml` decides how much of `spec.md` is required, so that
internal work does not have to fabricate a user story to get through the door.

| Type | Required in `spec.md` |
| --- | --- |
| `feature` | Everything |
| `fix` | Problem, reproduction, acceptance criteria |
| `refactor` | Problem, non-goals, criteria proving behaviour is unchanged |
| `infra` | Problem, goals, acceptance criteria, rollback |
| `debt` | Problem, acceptance criteria |

A refactor still gets acceptance criteria. "Nothing changed" is a testable
claim, and it is the only claim a refactor makes.

## Skill Path Overrides

Two installed skills carry file conventions from their upstream repositories
that do not apply here. The repository wins:

| Skill | Says | Here |
| --- | --- | --- |
| `spec-driven-development` | `tasks/plan.md`, `tasks/todo.md` | `specs/NNN-slug/plan.md`, `tasks.md` |
| `writing-plans` | `docs/superpowers/plans/YYYY-MM-DD-*.md` | `specs/NNN-slug/plan.md` |

`spec-driven-development` also references four skills that are not installed
(`planning-and-task-breakdown`, `incremental-implementation`,
`test-driven-development`, `context-engineering`) and commands that do not exist
here. Use it for its vocabulary and its four-phase discipline; take the file
layout and the commands from this document.
