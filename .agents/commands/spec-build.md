---
description: Execute an approved task list, dispatching each task to its owning role and running independent batches in parallel.
argument-hint: <spec id> [task ids]
---

Implement spec **$ARGUMENTS**.

## 1. Check the gate

```sh
./scripts/agent-checks/spec-state.sh advance $ARGUMENTS
```

Refuses unless `gate_tasks` is approved. Once the phase reaches `implement`,
`validate-implementation-gate.sh` stops blocking code writes.

## 2. Dispatch

Read `tasks.md`. Work batch by batch, in dependency order.

For each task, invoke its owning role — `backend`, `frontend`, `mobile`,
`infra-aws`. Each agent starts blind, so the invocation carries:

- The task ID and its full text from `tasks.md`.
- The spec path and the specific acceptance criteria the task advances.
- The constraints `architect` set, and the ADR path if there is one.
- The exact file set that task owns.

Run a batch's tasks in parallel worktrees when the batch has more than one
task:

> Run backend and frontend in parallel on worktrees for T-03 and T-04.

Worktrees branch from the repository's default branch, not from your current
`HEAD` — do not use them for tasks that must build on the branch you are on.

## 3. Track

Tick each task in `tasks.md` only after its verification command has actually
been run and its output seen. A ticked box with no output behind it is the
failure this whole workflow exists to prevent.

If a role reports the plan is wrong, stop. Do not let it improvise a fix:
amend `plan.md`, re-approve, and continue. Silent plan drift is how a spec
stops describing the software.

## 4. Report back

The tasks completed, the files changed, the verification output for each, and
anything left unfinished with the reason. Then:

```
/spec-verify $ARGUMENTS
```

Do not claim the work is done. `qa` decides that.
