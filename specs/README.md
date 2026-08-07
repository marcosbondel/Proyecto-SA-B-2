# Specs

Every unit of work lives here, in its own directory. This is what the factory
consumes: a spec is created, moves through gated phases, and is archived when
shipped.

```
specs/
  NNN-slug/
    state.yaml     phase, type, and gate approvals — machine-readable
    spec.md        what and why, with AC-01… acceptance criteria
    plan.md        how: approach, file structure, steps, risks
    tasks.md       T-01… executable checklist, one owning role each
    evidence.md    real command output per acceptance criterion
  archive/
    NNN-slug/      shipped, superseded, or abandoned
```

`docs/` holds the knowledge that outlives a spec — architecture, ADRs, product
sense, the quality bar. `specs/` holds the work. When a spec closes, whatever
must survive it moves into `docs/`.

## Lifecycle

```
specify → plan → tasks → implement → verify → review → done
   │        │       │                    │        │
 gate_spec  │   gate_tasks           gate_verify  │
        gate_plan                            gate_review
```

Each arrow is a gate a human approves with `/spec-approve`. Agents propose;
engineers approve. See [docs/SPEC_WORKFLOW.md](../docs/SPEC_WORKFLOW.md) for
the full contract and [docs/AI_PROJECT_AGENTS.md](../docs/AI_PROJECT_AGENTS.md)
for which role owns which phase.

## Commands

| Command | Does |
| --- | --- |
| `/spec-new <idea>` | Creates `specs/NNN-slug/` and writes `spec.md` |
| `/spec-plan <id>` | Writes `plan.md` |
| `/spec-tasks <id>` | Writes `tasks.md` |
| `/spec-build <id>` | Implements the tasks |
| `/spec-verify <id>` | Writes `evidence.md` |
| `/spec-review <id>` | Runs `reviewer` and `security` |
| `/spec-approve <id> <gate>` | Human approves a gate |
| `/spec-status` | Every spec and its phase |
| `/spec-close <id>` | Archives the spec and updates `docs/` |

## Types

Not every spec is a product feature. `type` in `state.yaml` sets how much of
`spec.md` is required:

| Type | Meaning | `spec.md` requires |
| --- | --- | --- |
| `feature` | New user-visible behaviour | Everything |
| `fix` | Defect repair | Problem, reproduction, acceptance criteria |
| `refactor` | Internal restructuring, no behaviour change | Problem, non-goals, acceptance criteria proving behaviour is unchanged |
| `infra` | Deployment, pipelines, environments | Problem, goals, acceptance criteria, rollback |
| `debt` | Cleanup carried over from a shipped spec | Problem, acceptance criteria |

A refactor does not get a fabricated user story. It still gets acceptance
criteria — proving nothing changed is a testable claim.

## Numbering

Zero-padded, three digits, allocated by `/spec-new`. Never reused, including
after archival. The number is the traceability key: it appears in the branch
name, the commit trailer, and the ADR that the spec produced.
