---
description: Break an approved plan into an executable task list with owning roles, dependencies, and per-task verification.
argument-hint: <spec id>
---

Break spec **$ARGUMENTS** into tasks.

## 1. Check the gate

```sh
./scripts/agent-checks/spec-state.sh advance $ARGUMENTS
```

Refuses unless `gate_plan` is approved.

## 2. Delegate

Invoke `planner` with `spec.md`, `plan.md`, and the template at
`docs/templates/spec/tasks.md`.

Task sizing, which is where this usually goes wrong:

- A task is the smallest unit that carries its own test cycle and is worth a
  fresh reviewer's gate. Fold setup, config, and scaffolding into the task
  whose deliverable needs them.
- Split only where a reviewer could reject one task while approving its
  neighbour.
- No task touches more than about five files.
- Every task names an owning role, its dependencies, the acceptance criteria it
  advances, and the exact command that verifies it.

## 3. Batch the parallel work

Fill the parallel batches table. Two tasks belong in the same batch only when
they have no dependency between them **and** disjoint file sets. Two agents
editing one file is the fastest way to lose work.

## 4. Validate and report

```sh
sh scripts/agent-checks/validate-spec-structure.sh $ARGUMENTS
```

This catches tasks that reference an `AC-NN` the spec never defined. Report the
task count, the batches, and any acceptance criterion no task covers. Then
stop:

```
/spec-approve $ARGUMENTS tasks
```

That approval is what unblocks the implementation hook. Until it lands, no
agent can write production code.
